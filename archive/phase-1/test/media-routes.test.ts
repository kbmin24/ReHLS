import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';
import { Response } from 'undici';

import { createApp } from '../src/app.js';
import type { UpstreamClient } from '../src/public-fetch.js';
import { MemoryState } from '../src/state.js';

const master = await readFile(new URL('./fixtures/master.m3u8', import.meta.url), 'utf8');
const media = await readFile(new URL('./fixtures/media.m3u8', import.meta.url), 'utf8');
const sourceUrl = new URL('https://streams.example.org/news/index.m3u8?token=private');
const masterUrl = new URL('https://cdn.example.org/live/master.m3u8?session=server');
const childUrl = new URL('https://cdn.example.org/live/low/index.m3u8?auth=one');
const segmentUrl = new URL('https://cdn.example.org/live/seg-101.ts?sig=abc');

function channelState() {
  const state = new MemoryState();
  state.replaceChannels([{ name: 'News', tvgId: 'news-one', url: sourceUrl }]);
  return { state, channelId: state.listChannels()[0]!.id };
}

async function startApp(t: TestContext, upstream: UpstreamClient, state: MemoryState) {
  const server = createApp({ upstream, state }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) =>
    server.close((error?: Error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return 'http://127.0.0.1:' + address.port;
}

function resourcePaths(manifest: string): string[] {
  return manifest.split(/\r?\n/).filter((line) => line.startsWith('/api/media/'));
}

test('resource IDs are reused while active and cleared by a successful channel replacement', () => {
  const { state, channelId } = channelState();
  const first = state.registerResource(channelId, segmentUrl, 'segment');
  assert.equal(state.registerResource(channelId, segmentUrl, 'segment'), first);

  state.replaceChannels([{ name: 'Replacement', url: sourceUrl }]);
  assert.equal(state.getResource(first.slice('/api/media/'.length)), undefined);
});

test('resource registry evicts its oldest entry at the 20,000-entry cap', () => {
  const { state, channelId } = channelState();
  const first = state.registerResource(channelId, segmentUrl, 'segment');
  let newest = first;
  for (let index = 0; index < 20_000; index++) {
    newest = state.registerResource(channelId, new URL('https://media.example.org/segment-' + index + '.ts'), 'segment');
  }
  assert.equal(state.getResource(first.slice('/api/media/'.length)), undefined);
  assert.ok(state.getResource(newest.slice('/api/media/'.length)));
});

test('master, child media playlist, and segment all pass through opaque ReHLS routes', async (t) => {
  const seen: string[] = [];
  const upstream: UpstreamClient = {
    get: async (url) => {
      seen.push(url.href);
      if (url.href === sourceUrl.href) {
        return { response: new Response(master), finalUrl: masterUrl };
      }
      if (url.href === childUrl.href) {
        return { response: new Response(media), finalUrl: childUrl };
      }
      if (url.href === segmentUrl.href) {
        return {
          response: new Response(new Uint8Array([0x47, 0x01, 0x02]), {
            headers: { 'content-type': 'video/mp2t' },
          }),
          finalUrl: segmentUrl,
        };
      }
      throw new Error('Unexpected upstream URL');
    },
  };
  const { state, channelId } = channelState();
  const baseUrl = await startApp(t, upstream, state);

  const root = await fetch(baseUrl + '/api/channels/' + channelId + '/manifest.m3u8');
  assert.equal(root.status, 200);
  const rootText = await root.text();
  assert.doesNotMatch(rootText, /https?:\/\/|auth=one|token=private/);
  const [childPath] = resourcePaths(rootText);
  assert.ok(childPath);

  const child = await fetch(baseUrl + childPath);
  assert.equal(child.status, 200);
  const childText = await child.text();
  assert.match(childText, /#EXTINF:6\.0,/);
  assert.doesNotMatch(childText, /https?:\/\/|sig=abc|key=def/);
  const [segmentPath] = resourcePaths(childText);
  assert.ok(segmentPath);

  const segment = await fetch(baseUrl + segmentPath);
  assert.equal(segment.status, 200);
  assert.match(segment.headers.get('content-type') ?? '', /video\/mp2t/);
  assert.deepEqual([...new Uint8Array(await segment.arrayBuffer())], [0x47, 0x01, 0x02]);
  assert.deepEqual(seen, [sourceUrl.href, childUrl.href, segmentUrl.href]);
});

test('a media playlist can be the channel root without a master playlist', async (t) => {
  const finalUrl = new URL('https://cdn.example.org/live/levels/media.m3u8?session=server');
  const seen: string[] = [];
  const upstream: UpstreamClient = {
    get: async (url) => {
      seen.push(url.href);
      if (url.href === sourceUrl.href) return { response: new Response(media), finalUrl };
      if (url.href === segmentUrl.href) {
        return { response: new Response(new Uint8Array([0x47])), finalUrl: url };
      }
      throw new Error('Unexpected upstream URL');
    },
  };
  const { state, channelId } = channelState();
  const baseUrl = await startApp(t, upstream, state);

  const root = await fetch(baseUrl + '/api/channels/' + channelId + '/manifest.m3u8');
  assert.equal(root.status, 200);
  const [segmentPath] = resourcePaths(await root.text());
  assert.ok(segmentPath);
  assert.equal((await fetch(baseUrl + segmentPath)).status, 200);
  assert.deepEqual(seen, [sourceUrl.href, segmentUrl.href]);
});

test('failed re-import leaves the old channel ID playable', async (t) => {
  const importUrl = 'https://example.org/channels.m3u';
  let failImport = false;
  const upstream: UpstreamClient = {
    get: async (url) => {
      if (url.href === importUrl) {
        if (failImport) throw new Error(importUrl + '?token=secret');
        const playlist = ['#EXTM3U', '#EXTINF:-1,News', sourceUrl.href, ''].join('\n');
        return { response: new Response(playlist), finalUrl: url };
      }
      if (url.href === sourceUrl.href) {
        return { response: new Response(media), finalUrl: childUrl };
      }
      throw new Error('Unexpected upstream URL');
    },
  };
  const state = new MemoryState();
  const baseUrl = await startApp(t, upstream, state);
  const importRequest = () => fetch(baseUrl + '/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: importUrl }),
  });

  assert.equal((await importRequest()).status, 200);
  const [channel] = state.listChannels();
  assert.ok(channel);
  failImport = true;
  assert.equal((await importRequest()).status, 502);
  assert.equal((await fetch(baseUrl + '/api/channels/' + channel.id + '/manifest.m3u8')).status, 200);
  assert.equal(state.listChannels()[0]?.id, channel.id);
});

test('missing channel and resource IDs return 404', async (t) => {
  const upstream: UpstreamClient = {
    get: async () => { throw new Error('Upstream must not be fetched'); },
  };
  const baseUrl = await startApp(t, upstream, new MemoryState());
  assert.equal((await fetch(baseUrl + '/api/channels/missing/manifest.m3u8')).status, 404);
  assert.equal((await fetch(baseUrl + '/api/media/missing')).status, 404);
});

test('an expired resource ID is no longer served', async (t) => {
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  const { state, channelId } = channelState();
  const path = state.registerResource(channelId, segmentUrl, 'segment');
  const upstream: UpstreamClient = {
    get: async (url) => ({ response: new Response(new Uint8Array([0x47])), finalUrl: url }),
  };
  const baseUrl = await startApp(t, upstream, state);
  now += 10 * 60 * 1_000 + 1;

  assert.equal((await fetch(baseUrl + path)).status, 404);
});

test('an oversized HLS manifest is rejected before rewriting', async (t) => {
  const upstream: UpstreamClient = {
    get: async (url) => ({
      response: new Response(new Uint8Array(2 * 1024 * 1024 + 1)),
      finalUrl: url,
    }),
  };
  const { state, channelId } = channelState();
  const baseUrl = await startApp(t, upstream, state);
  assert.equal((await fetch(baseUrl + '/api/channels/' + channelId + '/manifest.m3u8')).status, 413);
});

test('an oversized segment with a declared length is rejected', async (t) => {
  const upstream: UpstreamClient = {
    get: async (url) => ({
      response: new Response(new Uint8Array(32 * 1024 * 1024 + 1), {
        headers: { 'content-length': String(32 * 1024 * 1024 + 1) },
      }),
      finalUrl: url,
    }),
  };
  const { state, channelId } = channelState();
  const path = state.registerResource(channelId, segmentUrl, 'segment');
  const baseUrl = await startApp(t, upstream, state);
  assert.equal((await fetch(baseUrl + path)).status, 413);
});

test('upstream failures return a sanitized media error', async (t) => {
  const upstream: UpstreamClient = {
    get: async () => { throw new Error('https://upstream.example.org/live?token=secret'); },
  };
  const { state, channelId } = channelState();
  const baseUrl = await startApp(t, upstream, state);
  const result = await fetch(baseUrl + '/api/channels/' + channelId + '/manifest.m3u8');
  assert.equal(result.status, 502);
  assert.doesNotMatch(await result.text(), /upstream\.example\.org|token=secret/);
});

test('unsupported HLS tags return an unsupported-stream error', async (t) => {
  const encrypted = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:6.0,\nseg.ts\n';
  const upstream: UpstreamClient = {
    get: async (url) => ({ response: new Response(encrypted), finalUrl: url }),
  };
  const { state, channelId } = channelState();
  const baseUrl = await startApp(t, upstream, state);
  const result = await fetch(baseUrl + '/api/channels/' + channelId + '/manifest.m3u8');
  assert.equal(result.status, 422);
  assert.match(await result.text(), /unsupported/i);
});

test('browser disconnect aborts an in-flight segment fetch', async (t) => {
  let upstreamSignal: AbortSignal | undefined;
  const upstream: UpstreamClient = {
    get: async (url, signal) => {
      upstreamSignal = signal;
      if (!signal) throw new Error('Missing upstream abort signal');
      const body = (async function* () {
        yield new Uint8Array([0x47]);
        if (!signal.aborted) await once(signal, 'abort');
      })();
      return { response: new Response(body, { headers: { 'content-type': 'video/mp2t' } }), finalUrl: url };
    },
  };
  const { state, channelId } = channelState();
  const path = state.registerResource(channelId, segmentUrl, 'segment');
  const baseUrl = await startApp(t, upstream, state);
  const browser = new AbortController();

  const segment = await fetch(baseUrl + path, { signal: browser.signal });
  assert.equal(segment.status, 200);
  await segment.body!.getReader().read();
  browser.abort();
  assert.ok(upstreamSignal);
  if (!upstreamSignal.aborted) {
    await once(upstreamSignal, 'abort', { signal: AbortSignal.timeout(1_000) });
  }
  assert.equal(upstreamSignal.aborted, true);
});
