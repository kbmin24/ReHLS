import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { test } from 'node:test';

import session from 'express-session';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import { up as createCore } from '../../db/migrations/001_core.js';
import { up as createPlaylist } from '../../db/migrations/002_playlist.js';
import { up as addRefreshLease } from '../../db/migrations/003_playlist_refresh_lease.js';
import { up as addNextRefresh } from '../../db/migrations/004_playlist_refresh_order_index.js';
import { up as addSourceName } from '../../db/migrations/005_playlist_source_name.js';
import { ChannelRepository } from '../../server/src/channel/channel.repository.js';
import { ChannelService } from '../../server/src/channel/channel.service.js';
import type { Database } from '../../server/src/db/types.js';
import { createApp } from '../../server/src/index.js';
import { claimDueRefresh } from '../../server/src/jobs/claim-due-refresh.js';
import { PlaylistRepository } from '../../server/src/playlist/playlist.repository.js';
import { PlaylistService } from '../../server/src/playlist/playlist.service.js';

test('playlist API isolates accounts and expired refresh claims retry without losing channels',
  { skip: !process.env.DATABASE_URL }, async () => {
    const schema = `task6_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
    try {
      await createCore(db);
      await createPlaylist(db);
      await addRefreshLease(db);
      await addNextRefresh(db);
      await addSourceName(db);
      const first = await db.insertInto('users').values({ username: 'first', password_hash: 'unused', role: 'user', session_version: 0 })
        .returningAll().executeTakeFirstOrThrow();
      const second = await db.insertInto('users').values({ username: 'second', password_hash: 'unused', role: 'user', session_version: 0 })
        .returningAll().executeTakeFirstOrThrow();
      const users = [first, second];
      const channelRepository = new ChannelRepository(db);
      const channels = new ChannelService(channelRepository);
      let content = '#EXTM3U\n#EXTINF:-1 tvg-id="one",One\nhttps://streams.example.org/one.m3u8\n';
      const playlists = new PlaylistService(new PlaylistRepository(db, channelRepository), async (url) =>
        ({ response: new Response(content), finalUrl: url }));
      const app = createApp({ query: async () => ({}) }, {
        config: { databaseUrl: process.env.DATABASE_URL!, sessionSecret: 'a'.repeat(32),
          appOrigin: 'http://127.0.0.1:5173', port: 3000, trustProxy: false },
        sessionStore: new session.MemoryStore(), playlists, channels,
        users: {
          authenticate: async (name) => users.find((user) => user.username === name)!,
          getActiveUser: async (id) => users.find((user) => user.id === id) ?? null,
          changeOwnPassword: async () => first,
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
            body: JSON.stringify({ username, password: 'test-password' }) });
          assert.equal(response.status, 200);
          const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
          assert.ok(cookie);
          return cookie;
        }
        const firstCookie = await login('first');
        const secondCookie = await login('second');
        const request = (cookie: string, path: string, method = 'GET', body?: unknown) => fetch(`${base}${path}`, {
          method, headers: { cookie, origin: 'http://127.0.0.1:5173', ...(body ? { 'content-type': 'application/json' } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const created = await request(firstCookie, '/api/playlists/sources', 'POST',
          { url: 'https://8.8.8.8/playlist.m3u?secret=hidden', refreshInterval: 60 });
        assert.equal(created.status, 201);
        const createdBody = await created.json() as { source: { id: string; name: string } };
        const sourceId = createdBody.source.id;
        assert.equal(createdBody.source.name, 'playlist.m3u');
        assert.equal(JSON.stringify(createdBody).includes('secret=hidden'), false);

        const now = new Date();
        assert.equal((await claimDueRefresh(db, now))?.id, sourceId);
        assert.equal(await claimDueRefresh(db, now), null);
        const retried = await Promise.all([
          claimDueRefresh(db, new Date(now.getTime() + 61_000)),
          claimDueRefresh(db, new Date(now.getTime() + 61_000)),
        ]);
        assert.deepEqual(retried.map((claim) => claim?.id ?? null).sort(), [null, sourceId].sort());
        await playlists.refreshSource(first.id, sourceId);
        const firstChannels = await (await request(firstCookie, '/api/channels')).json() as { channels: { id: string }[] };
        assert.equal(firstChannels.channels.length, 1);
        const channelId = firstChannels.channels[0]!.id;
        assert.equal((await request(secondCookie, '/api/channels')).status, 200);
        assert.deepEqual(await (await request(secondCookie, '/api/channels')).json(), { channels: [] });
        assert.deepEqual(await (await request(secondCookie, '/api/playlists/sources')).json(), { sources: [] });
        assert.equal((await request(secondCookie, `/api/playlists/sources/${sourceId}/refresh`, 'POST')).status, 404);
        assert.equal((await request(secondCookie, `/api/playlists/sources/${sourceId}`, 'DELETE')).status, 404);
        await assert.rejects(channels.getOwned(second.id, channelId),
          (error: { code?: { cause?: string } }) => error.code?.cause === 'NOT_FOUND');

        content = '#EXTM3U\n';
        await assert.rejects(playlists.refreshSource(first.id, sourceId));
        const stale = await (await request(firstCookie, '/api/playlists/sources')).json() as
          { sources: { refreshStatus: string; lastAttemptAt: string; lastSuccessAt: string }[] };
        assert.equal(stale.sources[0]?.refreshStatus, 'stale');
        assert.ok(stale.sources[0]?.lastAttemptAt);
        assert.ok(stale.sources[0]?.lastSuccessAt);
        assert.equal((await (await request(firstCookie, '/api/channels')).json() as { channels: unknown[] }).channels.length, 1);
        assert.equal((await claimDueRefresh(db, new Date(Date.now() + 61_000)))?.id, sourceId);
        assert.equal((await request(firstCookie, `/api/playlists/sources/${sourceId}/refresh`, 'POST')).status, 200);
        assert.equal((await request(firstCookie, `/api/playlists/sources/${sourceId}`, 'DELETE')).status, 204);
        assert.deepEqual(await (await request(firstCookie, '/api/channels')).json(), { channels: [] });
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      await db.destroy();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
