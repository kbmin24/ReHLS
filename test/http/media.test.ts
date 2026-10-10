import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import session from 'express-session';

import { createApp } from '../../server/src/index.js';
import { ResourceRegistry } from '../../server/src/streaming/streaming.registry.js';
import { StreamingService } from '../../server/src/streaming/streaming.service.js';
import { NotFoundError } from '../../server/src/utils/errors/errors.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const channelId = '22222222-2222-4222-8222-222222222222';

test('media routes require a session and return private rewritten media', async () => {
  const upstream: string[] = [];
  const streaming = new StreamingService(
    { getOwned: async (owner, channel) => {
      assert.equal(owner, ownerId);
      assert.equal(channel, channelId);
      return { streamUrl: 'https://media.example.org/index.m3u8?secret=root' };
    } },
    new ResourceRegistry({ maxEntries: 10, ttlMs: 60_000 }),
    async (url) => {
      upstream.push(url.href);
      return { response: new Response(url.pathname.endsWith('.m3u8')
        ? '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts?secret=child\n'
        : 'segment bytes', { headers: { 'content-type': 'text/html' } }), finalUrl: url };
    },
  );
  const user = { id: ownerId, username: 'viewer', role: 'user' as const, session_version: 0, disabled_at: null };
  const app = createApp({ query: async () => ({}) }, {
    config: { databaseUrl: 'postgres://unused', sessionSecret: 'a'.repeat(32),
      appOrigin: 'http://127.0.0.1:5173', port: 3000, trustProxy: false },
    sessionStore: new session.MemoryStore(), streaming,
    users: {
      authenticate: async () => user,
      getActiveUser: async () => user,
      changeOwnPassword: async () => user,
    },
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const manifestPath = `/api/media/channels/${channelId}/manifest`;
    const anonymous = await fetch(`${base}${manifestPath}`);
    assert.equal(anonymous.status, 401);
    assert.equal(upstream.length, 0);

    const login = await fetch(`${base}/api/auth/login`, { method: 'POST',
      headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'password' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(cookie);
    const manifest = await fetch(`${base}${manifestPath}`, { headers: { cookie } });
    assert.equal(manifest.status, 200);
    assert.equal(manifest.headers.get('cache-control'), 'no-store');
    const body = await manifest.text();
    const resourcePath = /\/api\/media\/resources\/[A-Za-z0-9_-]+/.exec(body)?.[0];
    assert.ok(resourcePath);
    assert.doesNotMatch(body, /secret=|media\.example/);
    const segment = await fetch(`${base}${resourcePath}`, { headers: { cookie } });
    assert.equal(segment.status, 200);
    assert.equal(segment.headers.get('cache-control'), 'no-store');
    assert.equal(segment.headers.get('content-type'), 'application/octet-stream');
    assert.equal(await segment.text(), 'segment bytes');
    assert.equal(upstream.length, 2);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('nested media stays private after channel removal or account disablement', async () => {
  const secondId = '33333333-3333-4333-8333-333333333333';
  let channelExists = true;
  let firstActive = true;
  let fetches = 0;
  const users = [ownerId, secondId].map((id) => ({ id, username: id === ownerId ? 'first' : 'second',
    role: 'user' as const, session_version: 0, disabled_at: null }));
  const streaming = new StreamingService(
    { getOwned: async (owner, channel) => {
      if (owner !== ownerId || channel !== channelId || !channelExists) throw new NotFoundError();
      return { streamUrl: 'https://media.example.org/master.m3u8?secret=root' };
    } },
    new ResourceRegistry({ maxEntries: 20, ttlMs: 60_000 }),
    async (url, _limits, _signal, headers) => {
      fetches++;
      const path = url.pathname;
      const body = path.endsWith('master.m3u8')
        ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000\nchild.m3u8?secret=child\n'
        : path.endsWith('child.m3u8')
          ? '#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:6\n#EXT-X-MAP:URI="init.mp4?secret=map",BYTERANGE="4@0"\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin?secret=key"\n#EXTINF:6.0,\nsegment.ts?secret=segment\n#EXT-X-ENDLIST\n'
          : path.endsWith('init.mp4') ? 'init' : path.endsWith('key.bin') ? '0123456789abcdef' : 'segment';
      return { response: new Response(body, path.endsWith('init.mp4') ? {
        status: 206, headers: { 'content-range': 'bytes 0-3/4', 'content-type': 'video/mp4' },
      } : undefined), finalUrl: url };
    },
  );
  const app = createApp({ query: async () => ({}) }, {
    config: { databaseUrl: 'postgres://unused', sessionSecret: 'a'.repeat(32),
      appOrigin: 'http://127.0.0.1:5173', port: 3000, trustProxy: false },
    sessionStore: new session.MemoryStore(), streaming,
    users: {
      authenticate: async (name) => users.find((user) => user.username === name)!,
      getActiveUser: async (id) => id === ownerId && !firstActive ? null : users.find((user) => user.id === id) ?? null,
      changeOwnPassword: async () => users[0]!,
    },
  });
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    async function login(username: string) {
      const response = await fetch(`${base}/api/auth/login`, { method: 'POST',
        headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: 'password' }) });
      assert.equal(response.status, 200);
      const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
      assert.ok(cookie);
      return cookie;
    }
    const first = await login('first');
    const second = await login('second');
    const get = (path: string, cookie: string) => fetch(`${base}${path}`, { headers: { cookie } });
    const root = `/api/media/channels/${channelId}/manifest`;
    assert.equal((await get(root, second)).status, 404);
    assert.equal(fetches, 0);
    const master = await get(root, first);
    assert.equal(master.status, 200);
    const childPath = /\/api\/media\/resources\/[A-Za-z0-9_-]+/.exec(await master.text())?.[0];
    assert.ok(childPath);
    assert.equal((await get(childPath, second)).status, 410);
    assert.equal(fetches, 1);
    const child = await get(childPath, first);
    assert.equal(child.status, 200);
    const childBody = await child.text();
    assert.doesNotMatch(childBody, /media\.example|secret=/);
    const paths = [...childBody.matchAll(/\/api\/media\/resources\/[A-Za-z0-9_-]+/g)].map(([path]) => path);
    assert.equal(paths.length, 3);
    for (const path of paths) {
      assert.equal((await get(path, second)).status, 410);
    }
    assert.equal(fetches, 2);
    const [map, key, segment] = await Promise.all(paths.map((path) => get(path, first)));
    assert.ok(map && key && segment);
    assert.equal(map.status, 206);
    assert.equal(map.headers.get('content-range'), 'bytes 0-3/4');
    assert.equal(await map.text(), 'init');
    assert.equal(await key.text(), '0123456789abcdef');
    assert.equal(await segment.text(), 'segment');
    for (const response of [map, key, segment]) assert.equal(response.headers.get('cache-control'), 'no-store');
    const beforeRemoval = fetches;
    channelExists = false;
    assert.equal((await get(paths[2]!, first)).status, 404);
    assert.equal(fetches, beforeRemoval);
    channelExists = true;
    firstActive = false;
    assert.equal((await get(paths[2]!, first)).status, 401);
    assert.equal(fetches, beforeRemoval);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
