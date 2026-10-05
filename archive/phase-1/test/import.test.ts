import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test, type TestContext } from 'node:test';
import { Response } from 'undici';

import { createApp } from '../src/app.js';
import { parseChannels } from '../src/import.js';
import { MemoryState } from '../src/state.js';
import type { UpstreamClient } from '../src/public-fetch.js';

const playlist = await readFile(new URL('./fixtures/channels.m3u', import.meta.url), 'utf8');
const sourceUrl = 'https://example.org/channels.m3u';

async function startApp(upstream: UpstreamClient, t: TestContext) {
  const server = createApp({ upstream, state: new MemoryState() }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  t.after(() => new Promise<void>((resolve, reject) => server.close((error?: Error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function importPlaylist(baseUrl: string) {
  return fetch(`${baseUrl}/api/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: sourceUrl }),
  });
}

test('parser keeps duplicate names and tvg-id, and counts non-HTTP entries as skipped', () => {
  const result = parseChannels(playlist);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.channels.map(({ name, tvgId, url }: { name: string; tvgId?: string; url: URL }) => ({ name, tvgId, url: url.href })), [
    { name: 'News', tvgId: 'news-one', url: 'https://streams.example.org/news/index.m3u8?token=private' },
    { name: 'News', tvgId: undefined, url: 'https://streams.example.org/other/live' },
  ]);
});

test('import route reports counts and lists channels without upstream URLs', async (t) => {
  const upstream: UpstreamClient = {
    get: async (url) => ({ response: new Response(playlist), finalUrl: url }),
  };
  const baseUrl = await startApp(upstream, t);

  const imported = await importPlaylist(baseUrl);
  assert.equal(imported.status, 200);
  assert.deepEqual(await imported.json(), { imported: 2, skipped: 1 });

  const listed = await fetch(`${baseUrl}/api/channels`);
  assert.equal(listed.status, 200);
  const body = await listed.json() as { channels: { id: string; name: string; tvgId?: string }[] };
  assert.equal(body.channels.length, 2);
  assert.deepEqual(body.channels.map(({ name, tvgId }) => ({ name, tvgId })), [
    { name: 'News', tvgId: 'news-one' },
    { name: 'News', tvgId: undefined },
  ]);
  assert.ok(body.channels.every(({ id }) => typeof id === 'string' && id.length > 0));
  assert.notEqual(body.channels[0]!.id, body.channels[1]!.id);
  assert.doesNotMatch(JSON.stringify(body), /streams\.example\.org|token=private/);
});

test('failed and empty re-imports preserve the previous channel IDs', async (t) => {
  let response: 'valid' | 'failed' | 'empty' = 'valid';
  const upstream: UpstreamClient = {
    get: async (url) => {
      if (response === 'failed') throw new Error('https://example.org/channels.m3u?token=private');
      return { response: new Response(response === 'empty' ? '#EXTM3U\n' : playlist), finalUrl: url };
    },
  };
  const baseUrl = await startApp(upstream, t);
  assert.equal((await importPlaylist(baseUrl)).status, 200);
  const before = await (await fetch(`${baseUrl}/api/channels`)).json();

  for (const next of ['failed', 'empty'] as const) {
    response = next;
    const imported = await importPlaylist(baseUrl);
    assert.ok(imported.status >= 400, next);
    assert.doesNotMatch(await imported.text(), /token=private/);
    const after = await (await fetch(`${baseUrl}/api/channels`)).json();
    assert.deepEqual(after, before, next);
  }
});

test('oversized playlist returns a sanitized error and preserves the prior import', async (t) => {
  let oversized = false;
  const upstream: UpstreamClient = {
    get: async (url) => ({
      response: new Response(oversized ? new Uint8Array(16 * 1024 * 1024 + 1) : playlist),
      finalUrl: url,
    }),
  };
  const baseUrl = await startApp(upstream, t);
  assert.equal((await importPlaylist(baseUrl)).status, 200);
  const before = await (await fetch(baseUrl + '/api/channels')).json();

  oversized = true;
  const imported = await importPlaylist(baseUrl);
  assert.equal(imported.status, 413);
  assert.deepEqual(await imported.json(), { error: 'Playlist too large' });
  assert.deepEqual(await (await fetch(baseUrl + '/api/channels')).json(), before);
});

test('import route rejects a private playlist URL without revealing its query', async (t) => {
  const upstream: UpstreamClient = {
    get: async (url) => ({ response: new Response(playlist), finalUrl: url }),
  };
  const baseUrl = await startApp(upstream, t);
  const imported = await fetch(baseUrl + '/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'http://127.0.0.1/channels.m3u?token=private' }),
  });
  assert.equal(imported.status, 400);
  assert.doesNotMatch(await imported.text(), /token=private/);
});

test('malformed import JSON returns a sanitized client error', async (t) => {
  const upstream: UpstreamClient = {
    get: async (url) => ({ response: new Response(playlist), finalUrl: url }),
  };
  const baseUrl = await startApp(upstream, t);
  const imported = await fetch(baseUrl + '/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"url":"https://example.org/list.m3u?token=private"',
  });
  assert.equal(imported.status, 400);
  assert.deepEqual(await imported.json(), { error: 'Invalid request' });
});
