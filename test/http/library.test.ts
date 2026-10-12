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
import { up as createGuide } from '../../db/migrations/006_xmltv.js';
import { up as addGuideSourceName } from '../../db/migrations/007_xmltv_source_name.js';
import { ChannelRepository } from '../../server/src/channel/channel.repository.js';
import { ChannelService } from '../../server/src/channel/channel.service.js';
import type { Database } from '../../server/src/db/types.js';
import { createApp } from '../../server/src/index.js';
import { EPGRepository } from '../../server/src/epg/epg.repository.js';
import { EPGService } from '../../server/src/epg/epg.service.js';
import { claimDueRefresh } from '../../server/src/jobs/claim-due-refresh.js';
import { PlaylistRepository } from '../../server/src/playlist/playlist.repository.js';
import { PlaylistService } from '../../server/src/playlist/playlist.service.js';

test('playlist and guide APIs isolate accounts and retain snapshots after failed refresh',
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
      await createGuide(db);
      const legacyOwner = await db.insertInto('users').values({ username: 'legacy', password_hash: 'unused', role: 'user', session_version: 0 })
        .returning('id').executeTakeFirstOrThrow();
      const legacyGuide = await db.insertInto('xmltv_sources').values({
        owner_id: legacyOwner.id, url: 'https://8.8.8.8/guides/My%20Guide.xml?secret=hidden', refresh_interval: null,
      } as any).returning('id').executeTakeFirstOrThrow();
      await addGuideSourceName(db);
      const backfilled = await db.selectFrom('xmltv_sources').select('name').where('id', '=', legacyGuide.id).executeTakeFirstOrThrow();
      assert.equal(backfilled.name, 'My Guide.xml');
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
      const guideNow = Date.now();
      const xmltvTime = (offsetMs: number) =>
        `${new Date(guideNow + offsetMs).toISOString().replace(/[-:T]/g, '').slice(0, 14)} +0000`;
      let guideContent = `<tv><channel id="one"><display-name>Guide One</display-name></channel>` +
        `<programme channel="one" start="${xmltvTime(-3_600_000)}" stop="${xmltvTime(3_600_000)}"><title>On now</title></programme>` +
        `<programme channel="one" start="${xmltvTime(3_600_000)}" stop="${xmltvTime(7_200_000)}"><title>Up next</title></programme></tv>`;
      const epg = new EPGService(new EPGRepository(db), channels, async (url) =>
        ({ response: new Response(guideContent), finalUrl: url }));
      const app = createApp({ query: async () => ({}) }, {
        config: { databaseUrl: process.env.DATABASE_URL!, sessionSecret: 'a'.repeat(32),
          appOrigin: 'http://127.0.0.1:5173', port: 3000, trustProxy: false },
        sessionStore: new session.MemoryStore(), playlists, channels, epg,
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
        const secondPlaylist = await playlists.addSource(second.id, 'https://8.8.8.8/second.m3u', null);
        await playlists.refreshSource(second.id, secondPlaylist.id);
        const secondChannels = await (await request(secondCookie, '/api/channels')).json() as { channels: { id: string }[] };
        const secondChannelId = secondChannels.channels[0]!.id;

        const addedGuide = await request(firstCookie, '/api/epg/sources', 'POST',
          { url: 'https://8.8.8.8/guide.xml?secret=hidden', name: '   ', refreshInterval: 60 });
        assert.equal(addedGuide.status, 201);
        const guideBody = await addedGuide.json() as { source: { id: string; name: string; refreshStatus: string } };
        const guideSourceId = guideBody.source.id;
        assert.equal(guideBody.source.name, 'guide.xml');
        assert.equal(guideBody.source.refreshStatus, 'queued');
        assert.equal(JSON.stringify(guideBody).includes('secret=hidden'), false);
        const invalidGuide = await request(firstCookie, '/api/epg/sources', 'POST',
          { url: 'http://127.0.0.1/private.xml?secret=hidden' });
        assert.equal(invalidGuide.status, 400);
        assert.deepEqual(await invalidGuide.json(), { code: { service: 'epg', cause: 'INVALID_SOURCE' } });
        assert.deepEqual(await (await request(secondCookie, '/api/epg/sources')).json(), { sources: [] });
        assert.equal((await request(secondCookie, `/api/epg/sources/${guideSourceId}/refresh`, 'POST')).status, 404);
        assert.equal((await request(secondCookie, `/api/epg/sources/${guideSourceId}`, 'DELETE')).status, 404);
        assert.equal((await request(secondCookie, `/api/epg/channels/${channelId}/guide`)).status, 404);
        assert.equal((await request(secondCookie, `/api/epg/channels/${channelId}/mapping`, 'DELETE')).status, 404);
        assert.equal((await request(firstCookie, `/api/epg/channels/${secondChannelId}/guide`)).status, 404);

        await epg.refreshSource(first.id, guideSourceId);
        const guideList = await (await request(firstCookie, '/api/epg/sources')).json() as
          { sources: { refreshStatus: string; lastSuccessAt: string }[] };
        assert.equal(guideList.sources[0]?.refreshStatus, 'healthy');
        assert.ok(guideList.sources[0]?.lastSuccessAt);
        assert.equal(JSON.stringify(guideList).includes('secret=hidden'), false);
        const ownedGuideChannels = await (await request(firstCookie, '/api/epg/channels')).json() as
          { channels: { id: string }[] };
        const guideChannelId = ownedGuideChannels.channels[0]!.id;
        assert.deepEqual(await (await request(secondCookie, '/api/epg/channels')).json(), { channels: [] });
        const exactGuide = await (await request(firstCookie, `/api/epg/channels/${channelId}/guide`)).json() as
          { match: { provenance: string }; current: { title: string }; upcoming: { title: string }[] };
        assert.equal(exactGuide.match.provenance, 'automatic');
        assert.equal(exactGuide.current.title, 'On now');
        assert.equal(exactGuide.upcoming[0]?.title, 'Up next');
        const gridResponse = await request(firstCookie, '/api/epg/grid', 'POST', { channelIds: [channelId] });
        assert.equal(gridResponse.status, 200);
        const grid = await gridResponse.json() as { startsAt: string; endsAt: string; rows: { channelId: string; programs: { title: string }[] }[] };
        assert.equal(new Date(grid.startsAt).getTime() % (30 * 60_000), 0);
        assert.equal(new Date(grid.endsAt).getTime() - new Date(grid.startsAt).getTime(), 24 * 60 * 60_000);
        assert.deepEqual(grid.rows.map((row) => [row.channelId, row.programs.map((program) => program.title)]),
          [[channelId, ['On now', 'Up next']]]);
        const fullBatch = await request(firstCookie, '/api/epg/grid', 'POST',
          { channelIds: Array(500).fill(channelId) });
        assert.equal(fullBatch.status, 200);
        assert.equal((await request(firstCookie, '/api/epg/grid', 'POST', { channelIds: ['bad'] })).status, 400);
        assert.equal((await request(firstCookie, '/api/epg/grid', 'POST', { channelIds: [channelId, secondChannelId] })).status, 404);
        assert.equal((await request(secondCookie, '/api/epg/grid', 'POST', { channelIds: [channelId] })).status, 404);
        const forbiddenMapping = await request(secondCookie, `/api/epg/channels/${secondChannelId}/mapping`, 'PUT',
          { xmltvChannelId: guideChannelId });
        assert.equal(forbiddenMapping.status, 404);
        assert.deepEqual(await forbiddenMapping.json(), { code: { service: 'app', cause: 'NOT_FOUND' } });
        assert.equal((await request(firstCookie, `/api/epg/channels/${secondChannelId}/mapping`, 'PUT',
          { xmltvChannelId: guideChannelId })).status, 404);

        await db.updateTable('channels').set({ tvg_id: 'absent' }).where('id', '=', channelId).execute();
        assert.deepEqual(await (await request(firstCookie, `/api/epg/channels/${channelId}/guide`)).json(),
          { match: null, current: null, upcoming: [] });
        await db.updateTable('channels').set({ tvg_id: 'one' }).where('id', '=', channelId).execute();
        const secondGuide = await epg.addSource(first.id, 'https://8.8.8.8/other-guide.xml', null);
        await epg.refreshSource(first.id, secondGuide.id);
        assert.deepEqual(await (await request(firstCookie, `/api/epg/channels/${channelId}/guide`)).json(),
          { match: null, current: null, upcoming: [] });
        const manual = await request(firstCookie, `/api/epg/channels/${channelId}/mapping`, 'PUT',
          { xmltvChannelId: guideChannelId });
        assert.equal(manual.status, 200);
        assert.equal(((await manual.json()) as { match: { provenance: string } }).match.provenance, 'manual');
        assert.equal((await request(firstCookie, `/api/epg/channels/${channelId}/mapping`, 'DELETE')).status, 200);
        assert.deepEqual(await (await request(firstCookie, `/api/epg/channels/${channelId}/guide`)).json(),
          { match: null, current: null, upcoming: [] });
        await request(firstCookie, `/api/epg/channels/${channelId}/mapping`, 'PUT', { xmltvChannelId: guideChannelId });

        guideContent = '<tv></tv>';
        await assert.rejects(epg.refreshSource(first.id, guideSourceId),
          (error: { code?: { cause?: string } }) => error.code?.cause === 'EMPTY_GUIDE');
        const staleGuide = await (await request(firstCookie, '/api/epg/sources')).json() as
          { sources: { id: string; refreshStatus: string; lastFailureCode: string; lastSuccessAt: string }[] };
        const oldSource = staleGuide.sources.find((source) => source.id === guideSourceId)!;
        assert.equal(oldSource.refreshStatus, 'stale');
        assert.equal(oldSource.lastFailureCode, 'EMPTY_GUIDE');
        assert.ok(oldSource.lastSuccessAt);
        assert.equal(JSON.stringify(staleGuide).includes('secret=hidden'), false);
        const retainedGuide = await (await request(firstCookie, `/api/epg/channels/${channelId}/guide`)).json() as
          { current: { title: string }; match: { provenance: string } };
        assert.equal(retainedGuide.current.title, 'On now');
        assert.equal(retainedGuide.match.provenance, 'manual');

        assert.equal((await request(secondCookie, '/api/channels')).status, 200);
        assert.equal(secondChannels.channels.length, 1);
        const secondSources = await (await request(secondCookie, '/api/playlists/sources')).json() as
          { sources: { id: string }[] };
        assert.deepEqual(secondSources.sources.map((source) => source.id), [secondPlaylist.id]);
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

        const namedGuide = await request(firstCookie, '/api/epg/sources', 'POST',
          { url: 'https://8.8.8.8/custom.xml?secret=hidden', name: '  My EPG  ' });
        assert.equal(namedGuide.status, 201);
        const namedBody = await namedGuide.json() as { source: { name: string } };
        assert.equal(namedBody.source.name, 'My EPG');
        assert.equal(JSON.stringify(namedBody).includes('secret=hidden'), false);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      await db.destroy();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
