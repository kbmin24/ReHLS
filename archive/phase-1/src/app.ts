import { once } from 'node:events';
import path from 'node:path';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import type { Response as UpstreamResponse } from 'undici';

import { InvalidHlsError, rewriteManifest, UnsupportedHlsError } from './hls.js';
import type { UpstreamClient } from './public-fetch.js';
import { isPublicHttpUrl, parseChannels } from './import.js';
import { MemoryState } from './state.js';

export type AppDependencies = {
  upstream: UpstreamClient;
  state?: MemoryState;
};

const MAX_PLAYLIST_BYTES = 16 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_SEGMENT_BYTES = 32 * 1024 * 1024;

class BodyTooLargeError extends Error {}

async function readText(response: UpstreamResponse, maxBytes: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new BodyTooLargeError();
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function abortOnDisconnect(response: Response): AbortController {
  const controller = new AbortController();
  response.once('close', () => {
    if (!response.writableFinished) controller.abort();
  });
  return controller;
}

function sendMediaError(response: Response, error: unknown): void {
  if (response.destroyed) return;
  if (response.headersSent) {
    response.destroy();
    return;
  }
  if (error instanceof BodyTooLargeError) {
    response.status(413).json({ error: 'Media resource too large' });
  } else if (error instanceof UnsupportedHlsError) {
    response.status(422).json({ error: 'Unsupported HLS feature' });
  } else if (error instanceof InvalidHlsError) {
    response.status(422).json({ error: 'Invalid HLS playlist' });
  } else {
    response.status(502).json({ error: 'Upstream media failed' });
  }
}

export function createApp({ upstream, state = new MemoryState() }: AppDependencies): Express {
  const app = express();
  app.use(express.json({ limit: '16kb' }));

  app.get('/api/channels', (_request, response) => {
    response.json({ channels: state.listChannels() });
  });

  app.post('/api/import', async (request, response) => {
    const value = request.body?.url;
    if (typeof value !== 'string') {
      response.status(400).json({ error: 'A public HTTP(S) playlist URL is required' });
      return;
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      response.status(400).json({ error: 'A public HTTP(S) playlist URL is required' });
      return;
    }
    if (!isPublicHttpUrl(url)) {
      response.status(400).json({ error: 'A public HTTP(S) playlist URL is required' });
      return;
    }

    try {
      const { response: upstreamResponse } = await upstream.get(url);
      if (!upstreamResponse.ok) {
        await upstreamResponse.body?.cancel().catch(() => {});
        response.status(502).json({ error: 'Playlist fetch failed' });
        return;
      }
      const text = await readText(upstreamResponse, MAX_PLAYLIST_BYTES);
      const { channels, skipped } = parseChannels(text);
      if (channels.length === 0) {
        response.status(422).json({ error: 'Playlist has no usable channels' });
        return;
      }
      state.replaceChannels(channels);
      response.json({ imported: channels.length, skipped });
    } catch (error) {
      const tooLarge = error instanceof BodyTooLargeError;
      response.status(tooLarge ? 413 : 502).json({
        error: tooLarge ? 'Playlist too large' : 'Playlist import failed',
      });
    }
  });

  async function serveManifest(channelId: string, url: URL, response: Response): Promise<void> {
    const controller = abortOnDisconnect(response);
    try {
      const { response: upstreamResponse, finalUrl } = await upstream.get(url, controller.signal);
      if (!upstreamResponse.ok) {
        await upstreamResponse.body?.cancel().catch(() => {});
        response.status(502).json({ error: 'Upstream media failed' });
        return;
      }
      const text = await readText(upstreamResponse, MAX_MANIFEST_BYTES);
      const rewritten = rewriteManifest(text, finalUrl, (resourceUrl, kind) =>
        state.registerResource(channelId, resourceUrl, kind));
      if (response.destroyed) return;
      response.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.send(rewritten);
    } catch (error) {
      sendMediaError(response, error);
    }
  }

  async function serveSegment(url: URL, response: Response): Promise<void> {
    const controller = abortOnDisconnect(response);
    try {
      const { response: upstreamResponse } = await upstream.get(url, controller.signal);
      if (!upstreamResponse.ok) {
        await upstreamResponse.body?.cancel().catch(() => {});
        response.status(502).json({ error: 'Upstream media failed' });
        return;
      }
      const length = Number(upstreamResponse.headers.get('content-length'));
      if (length > MAX_SEGMENT_BYTES) {
        await upstreamResponse.body?.cancel().catch(() => {});
        response.status(413).json({ error: 'Media resource too large' });
        return;
      }

      const upstreamType = upstreamResponse.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      const safeType = upstreamType && /^(?:video\/(?:mp2t|mp4)|audio\/(?:aac|mp4|mpeg)|application\/octet-stream)$/.test(upstreamType)
        ? upstreamType : 'application/octet-stream';
      response.setHeader('Content-Type', safeType);
      response.setHeader('X-Content-Type-Options', 'nosniff');

      const reader = upstreamResponse.body?.getReader();
      if (!reader) {
        response.end();
        return;
      }
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done || controller.signal.aborted) break;
          size += value.byteLength;
          if (size > MAX_SEGMENT_BYTES) {
            await reader.cancel().catch(() => {});
            response.destroy();
            return;
          }
          if (!response.write(value)) {
            await once(response, 'drain', { signal: controller.signal });
          }
        }
        if (!response.destroyed) response.end();
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      sendMediaError(response, error);
    }
  }

  app.get('/api/channels/:id/manifest.m3u8', async (request, response) => {
    const channel = state.getChannel(request.params.id);
    if (!channel) {
      response.status(404).json({ error: 'Channel not found' });
      return;
    }
    await serveManifest(request.params.id, channel.url, response);
  });

  app.get('/api/media/:resourceId', async (request, response) => {
    const resource = state.getResource(request.params.resourceId);
    if (!resource || !state.getChannel(resource.channelId)) {
      response.status(404).json({ error: 'Resource not found' });
      return;
    }
    if (resource.kind === 'manifest') {
      await serveManifest(resource.channelId, resource.url, response);
    } else {
      await serveSegment(resource.url, response);
    }
  });

  app.get('/vendor/hls.min.js', (_request, response) => {
    response.sendFile(path.resolve('node_modules/hls.js/dist/hls.min.js'));
  });
  app.use(express.static(path.resolve('public')));

  app.use((_error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    response.status(400).json({ error: 'Invalid request' });
  });

  return app;
}
