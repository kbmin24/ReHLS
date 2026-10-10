import assert from 'node:assert/strict';
import { test } from 'node:test';

import { NotFoundError } from '../../server/src/utils/errors/errors.js';
import { PublicFetchError } from '../../server/src/upstream/public-fetch.js';
import { ResourceRegistry } from '../../server/src/streaming/streaming.registry.js';
import { StreamingService } from '../../server/src/streaming/streaming.service.js';

const ownerId = 'owner-a';
const channelId = 'channel-a';

test('root manifest rewrites a segment to an opaque owned resource', async () => {
  const fetched: string[] = [];
  const service = new StreamingService(
    { getOwned: async () => ({ id: channelId, streamUrl: 'https://media.example.org/live/index.m3u8?secret=root' }) },
    new ResourceRegistry({ maxEntries: 10, ttlMs: 60_000 }),
    async (url) => {
      fetched.push(url.href);
      return { response: new Response(url.pathname.endsWith('.m3u8')
        ? '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts?secret=child\n'
        : 'segment bytes', { status: 200 }), finalUrl: url };
    },
  );

  const manifest = await service.getManifest(ownerId, channelId, new AbortController().signal);
  const body = await manifest.text();
  const token = /\/api\/media\/resources\/([A-Za-z0-9_-]+)/.exec(body)?.[1];
  assert.ok(token);
  assert.doesNotMatch(body, /media\.example|secret=/);
  assert.equal(manifest.headers.get('content-type'), 'application/vnd.apple.mpegurl');

  const segment = await service.getResource(ownerId, token, new AbortController().signal);
  assert.equal(await segment.text(), 'segment bytes');
  assert.deepEqual(fetched, [
    'https://media.example.org/live/index.m3u8?secret=root',
    'https://media.example.org/live/segment.ts?secret=child',
  ]);
});

test('overlapping live segments keep the same resource URL across manifest refreshes', async () => {
  let sequence = 100;
  const service = new StreamingService(
    { getOwned: async () => ({ streamUrl: 'https://media.example.org/live.m3u8' }) },
    new ResourceRegistry({ maxEntries: 10, ttlMs: 60_000 }),
    async (url) => {
      const first = sequence++;
      return { response: new Response(`#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:${first}\n` +
        `#EXTINF:4,\n${first}.ts\n#EXTINF:4,\n${first + 1}.ts\n`), finalUrl: url };
    },
  );

  const first = await (await service.getManifest(ownerId, channelId, new AbortController().signal)).text();
  const second = await (await service.getManifest(ownerId, channelId, new AbortController().signal)).text();
  const firstUrls = first.split('\n').filter((line) => line.startsWith('/api/media/resources/'));
  const secondUrls = second.split('\n').filter((line) => line.startsWith('/api/media/resources/'));
  assert.equal(firstUrls[1], secondUrls[0]);
  assert.notEqual(firstUrls[0], secondUrls[1]);
});

test('nested token checks channel ownership before fetching', async () => {
  let fetches = 0;
  const registry = new ResourceRegistry({ maxEntries: 10, ttlMs: 60_000 });
  const token = registry.registerResource(ownerId, channelId, new URL('https://media.example.org/segment.ts'), 'segment');
  const service = new StreamingService(
    { getOwned: async () => { throw new NotFoundError(); } }, registry,
    async (url) => { fetches++; return { response: new Response('bytes'), finalUrl: url }; },
  );

  await assert.rejects(service.getResource(ownerId, token, new AbortController().signal), NotFoundError);
  assert.equal(fetches, 0);
});

test('registered byte range is sent upstream and returned as a partial response', async () => {
  const registry = new ResourceRegistry({ maxEntries: 10, ttlMs: 60_000 });
  const token = registry.registerResource(ownerId, channelId, new URL('https://media.example.org/part.mp4'),
    'map', { offset: 10, length: 4 });
  let sentRange: string | null = null;
  let maxBytes = 0;
  const service = new StreamingService(
    { getOwned: async () => ({ streamUrl: 'https://media.example.org/index.m3u8' }) }, registry,
    async (url, limits, _signal, headers) => {
      sentRange = new Headers(headers).get('range');
      maxBytes = limits.maxBytes;
      return { response: new Response('four', { status: 206,
        headers: { 'content-range': 'bytes 10-13/100', 'content-type': 'video/mp4' } }), finalUrl: url };
    },
  );
  const response = await service.getResource(ownerId, token, new AbortController().signal);
  assert.equal(sentRange, 'bytes=10-13');
  assert.equal(maxBytes, 4);
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), 'bytes 10-13/100');
  assert.equal(await response.text(), 'four');
});

test('browser range is forwarded only for a bounded single range', async () => {
  const registry = new ResourceRegistry({ maxEntries: 10, ttlMs: 60_000 });
  const token = registry.registerResource(ownerId, channelId, new URL('https://media.example.org/segment.ts'), 'segment');
  let sentRange: string | null = null;
  let fetches = 0;
  let contentRange = 'bytes 10-13/100';
  const service = new StreamingService(
    { getOwned: async () => ({ streamUrl: 'https://media.example.org/index.m3u8' }) }, registry,
    async (url, _limits, _signal, headers) => {
      fetches++;
      sentRange = new Headers(headers).get('range');
      return { response: new Response('four', { status: 206,
        headers: { 'content-range': contentRange } }), finalUrl: url };
    },
  );
  const response = await service.getResource(ownerId, token, new AbortController().signal, 'bytes=10-13');
  assert.equal(response.status, 206);
  assert.equal(sentRange, 'bytes=10-13');
  contentRange = 'bytes 10-130/1000';
  await assert.rejects(service.getResource(ownerId, token, new AbortController().signal, 'bytes=10-13'));
  contentRange = 'bytes 10-13/100';
  await assert.rejects(service.getResource(ownerId, token, new AbortController().signal, 'bytes=10-13,20-23'));
  assert.equal(fetches, 2);
});

test('upstream failure and oversized nested resources use safe error codes', async () => {
  const registry = new ResourceRegistry({ maxEntries: 10, ttlMs: 60_000 });
  const token = registry.registerResource(ownerId, channelId,
    new URL('https://media.example.org/segment.ts?secret=private'), 'segment');
  let failWithSize = false;
  const service = new StreamingService(
    { getOwned: async () => ({ streamUrl: 'https://media.example.org/index.m3u8' }) }, registry,
    async () => { throw failWithSize
      ? new PublicFetchError('TOO_LARGE')
      : new Error('https://media.example.org/segment.ts?secret=private'); },
  );
  await assert.rejects(service.getResource(ownerId, token, new AbortController().signal),
    (error: { status?: number; code?: { cause?: string }; message?: string }) =>
      error.status === 502 && error.code?.cause === 'UNAVAILABLE' && !error.message?.includes('secret='));
  failWithSize = true;
  await assert.rejects(service.getResource(ownerId, token, new AbortController().signal),
    (error: { status?: number; code?: { cause?: string } }) =>
      error.status === 413 && error.code?.cause === 'TOO_LARGE');
});

test('cancelling a disconnected media request reaches the upstream fetch', async () => {
  const registry = new ResourceRegistry({ maxEntries: 10, ttlMs: 60_000 });
  const token = registry.registerResource(ownerId, channelId, new URL('https://media.example.org/segment.ts'), 'segment');
  let observedAbort = false;
  let fetchStarted!: () => void;
  const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
  const service = new StreamingService(
    { getOwned: async () => ({ streamUrl: 'https://media.example.org/index.m3u8' }) }, registry,
    async (_url, _limits, signal) => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => { observedAbort = true; reject(signal.reason); }, { once: true });
      fetchStarted();
    }),
  );
  const abort = new AbortController();
  const request = service.getResource(ownerId, token, abort.signal);
  await started;
  abort.abort();
  await assert.rejects(request);
  assert.equal(observedAbort, true);
});
