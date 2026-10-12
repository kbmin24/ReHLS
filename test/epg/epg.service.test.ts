import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import { up as createCore } from '../../db/migrations/001_core.js';
import { up as createPlaylist } from '../../db/migrations/002_playlist.js';
import { up as addRefreshLease } from '../../db/migrations/003_playlist_refresh_lease.js';
import { up as addNextRefresh } from '../../db/migrations/004_playlist_refresh_order_index.js';
import { up as addSourceName } from '../../db/migrations/005_playlist_source_name.js';
import { up as createGuide } from '../../db/migrations/006_xmltv.js';
import { up as addGuideSourceName } from '../../db/migrations/007_xmltv_source_name.js';
import { up as addChannelLogo } from '../../db/migrations/008_channel_logo.js';
import { ChannelRepository } from '../../server/src/channel/channel.repository.js';
import { ChannelService } from '../../server/src/channel/channel.service.js';
import type { Database } from '../../server/src/db/types.js';
import { EPGRepository } from '../../server/src/epg/epg.repository.js';
import { EPGService } from '../../server/src/epg/epg.service.js';
import { claimDueEpgRefresh } from '../../server/src/jobs/claim-due-refresh.js';

test('guide matching requires a unique owned tvg-id and a manual override takes precedence',
  { skip: !process.env.DATABASE_URL }, async () => {
    const schema = `task10_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
    try {
      await createCore(db);
      await createPlaylist(db);
      await addChannelLogo(db);
      await addRefreshLease(db);
      await addNextRefresh(db);
      await addSourceName(db);
      await createGuide(db);
      await addGuideSourceName(db);

      const owner = await db.insertInto('users').values({ username: 'owner', password_hash: 'unused', role: 'user', session_version: 0 })
        .returning('id').executeTakeFirstOrThrow();
      const other = await db.insertInto('users').values({ username: 'other', password_hash: 'unused', role: 'user', session_version: 0 })
        .returning('id').executeTakeFirstOrThrow();
      const playlist = await db.insertInto('playlist_sources').values({ owner_id: owner.id, url: 'https://8.8.8.8/list.m3u', name: 'List',
        refresh_interval: null, last_attempt_at: null, last_success_at: null, last_failure_code: null, lease_expires_at: null })
        .returning('id').executeTakeFirstOrThrow();
      const channel = await db.insertInto('channels').values({ source_id: playlist.id, name: 'One', tvg_id: 'one', group_title: null,
        stream_url: 'https://8.8.8.8/one.m3u8', match_key: 'one' }).returning('id').executeTakeFirstOrThrow();
      const epg = new EPGService(new EPGRepository(db), new ChannelService(new ChannelRepository(db)));
      const source = await epg.addSource(owner.id, 'https://8.8.8.8/guide.xml?secret=hidden', 60);
      assert.equal(JSON.stringify(source).includes('secret=hidden'), false);
      const now = new Date();
      assert.equal((await claimDueEpgRefresh(db, now))?.id, source.id);
      assert.equal(await claimDueEpgRefresh(db, now), null);
      assert.equal((await claimDueEpgRefresh(db, new Date(now.getTime() + 61_000)))?.id, source.id);

      const first = await db.insertInto('xmltv_channels').values({ source_id: source.id, xmltv_id: 'one', display_name: 'Guide One' })
        .returning('id').executeTakeFirstOrThrow();
      assert.equal((await epg.getChannelGuide(owner.id, channel.id)).match?.provenance, 'automatic');
      const variant = await db.insertInto('channels').values({ source_id: playlist.id, name: 'One SD', tvg_id: 'one@SD', group_title: null,
        stream_url: 'https://8.8.8.8/one-sd.m3u8', match_key: 'one@SD' }).returning('id').executeTakeFirstOrThrow();
      assert.equal((await epg.getChannelGuide(owner.id, variant.id)).match?.channel.id, first.id);
      const exact = await db.insertInto('xmltv_channels').values({ source_id: source.id, xmltv_id: 'one@SD', display_name: 'Guide One SD' })
        .returning('id').executeTakeFirstOrThrow();
      assert.equal((await epg.getChannelGuide(owner.id, variant.id)).match?.channel.id, exact.id);

      const caseChannel = await db.insertInto('channels').values({ source_id: playlist.id, name: 'Arte', tvg_id: 'arte.de@SD', group_title: null,
        stream_url: 'https://8.8.8.8/arte.m3u8', match_key: 'arte' }).returning('id').executeTakeFirstOrThrow();
      const caseGuide = await db.insertInto('xmltv_channels').values({ source_id: source.id, xmltv_id: 'ARTE.de', display_name: 'ARTE' })
        .returning('id').executeTakeFirstOrThrow();
      assert.equal((await epg.getChannelGuide(owner.id, caseChannel.id)).match?.channel.id, caseGuide.id);
      const exactGuide = await db.insertInto('xmltv_channels').values({ source_id: source.id, xmltv_id: 'arte.de', display_name: 'Arte exact' })
        .returning('id').executeTakeFirstOrThrow();
      assert.equal((await epg.getChannelGuide(owner.id, caseChannel.id)).match?.channel.id, exactGuide.id);

      const punctuationChannel = await db.insertInto('channels').values({ source_id: playlist.id, name: '1-2-3.tv', tvg_id: '123tv.de@SD', group_title: null,
        stream_url: 'https://8.8.8.8/123.m3u8', match_key: '123' }).returning('id').executeTakeFirstOrThrow();
      const punctuationGuide = await db.insertInto('xmltv_channels').values({ source_id: source.id, xmltv_id: '1-2-3tv.de', display_name: '1-2-3.tv' })
        .returning('id').executeTakeFirstOrThrow();
      assert.equal((await epg.getChannelGuide(owner.id, punctuationChannel.id)).match?.channel.id, punctuationGuide.id);

      const ambiguousChannel = await db.insertInto('channels').values({ source_id: playlist.id, name: 'Nitro', tvg_id: 'nitro.de@SD', group_title: null,
        stream_url: 'https://8.8.8.8/nitro.m3u8', match_key: 'nitro' }).returning('id').executeTakeFirstOrThrow();
      await db.insertInto('xmltv_channels').values([
        { source_id: source.id, xmltv_id: 'NITRO.de', display_name: 'NITRO' },
        { source_id: source.id, xmltv_id: 'Nitro.de', display_name: 'Nitro' },
      ]).execute();
      assert.equal((await epg.getChannelGuide(owner.id, ambiguousChannel.id)).match, null);

      const punctuationAmbiguous = await db.insertInto('channels').values({ source_id: playlist.id, name: 'AB', tvg_id: 'a_b.de@SD', group_title: null,
        stream_url: 'https://8.8.8.8/ab.m3u8', match_key: 'ab' }).returning('id').executeTakeFirstOrThrow();
      await db.insertInto('xmltv_channels').values([
        { source_id: source.id, xmltv_id: 'a-b.de', display_name: 'A-B' },
        { source_id: source.id, xmltv_id: 'ab.de', display_name: 'AB' },
      ]).execute();
      assert.equal((await epg.getChannelGuide(owner.id, punctuationAmbiguous.id)).match, null);

      const foreignSource = await epg.addSource(other.id, 'https://8.8.8.8/foreign.xml', null);
      await db.insertInto('xmltv_channels').values({ source_id: foreignSource.id, xmltv_id: 'HIDDEN.de', display_name: 'Hidden' }).execute();
      const foreignOnlyChannel = await db.insertInto('channels').values({ source_id: playlist.id, name: 'Hidden', tvg_id: 'hidden.de@SD', group_title: null,
        stream_url: 'https://8.8.8.8/hidden.m3u8', match_key: 'hidden' }).returning('id').executeTakeFirstOrThrow();
      assert.equal((await epg.getChannelGuide(owner.id, foreignOnlyChannel.id)).match, null);

      await assert.rejects(epg.getChannelGuide(other.id, channel.id),
        (error: { code?: { cause?: string } }) => error.code?.cause === 'NOT_FOUND');

      const source2 = await epg.addSource(owner.id, 'https://8.8.8.8/second.xml', null);
      await db.insertInto('xmltv_channels').values({ source_id: source2.id, xmltv_id: 'one@SD', display_name: 'Another One SD' }).execute();
      assert.equal((await epg.getChannelGuide(owner.id, variant.id)).match, null);
      await db.insertInto('xmltv_channels').values({ source_id: source2.id, xmltv_id: 'one', display_name: 'Another One' }).execute();
      assert.equal((await epg.getChannelGuide(owner.id, channel.id)).match, null);
      assert.equal((await epg.setOverride(owner.id, channel.id, first.id)).match?.channel.id, first.id);
      assert.equal((await epg.getChannelGuide(owner.id, channel.id)).match?.provenance, 'manual');
      assert.equal((await epg.clearOverride(owner.id, channel.id)).match, null);

      const inside = new Date(Date.now() - 60 * 60_000);
      const future = new Date(Date.now() + 23 * 60 * 60_000);
      await db.insertInto('xmltv_programs').values([
        { channel_id: first.id, title: 'In progress', starts_at: inside, ends_at: new Date(Date.now() + 30 * 60_000) },
        { channel_id: first.id, title: 'At the far edge', starts_at: future, ends_at: new Date(Date.now() + 25 * 60 * 60_000) },
        { channel_id: first.id, title: 'Already ended', starts_at: new Date(Date.now() - 3 * 60 * 60_000), ends_at: new Date(Date.now() - 2 * 60 * 60_000) },
        { channel_id: exactGuide.id, title: 'Exact match', starts_at: inside, ends_at: new Date(Date.now() + 30 * 60_000) },
      ]).execute();
      await epg.setOverride(owner.id, channel.id, first.id);
      const grid = await epg.getProgramGrid(owner.id, [channel.id, variant.id, ambiguousChannel.id, foreignOnlyChannel.id]);
      assert.equal(grid.startsAt.getTime() % (30 * 60_000), 0);
      assert.ok(grid.startsAt.getTime() <= Date.now());
      assert.equal(grid.endsAt.getTime() - grid.startsAt.getTime(), 24 * 60 * 60_000);
      assert.deepEqual(grid.rows[0]?.programs.map((program) => program.title), ['In progress', 'At the far edge']);
      assert.deepEqual(grid.rows[1]?.programs, []);
      assert.deepEqual(grid.rows[2]?.programs, []);
      assert.deepEqual(grid.rows[3]?.programs, []);

      const otherPlaylist = await db.insertInto('playlist_sources').values({ owner_id: other.id, url: 'https://8.8.8.8/other.m3u', name: 'Other',
        refresh_interval: null, last_attempt_at: null, last_success_at: null, last_failure_code: null, lease_expires_at: null })
        .returning('id').executeTakeFirstOrThrow();
      const otherChannel = await db.insertInto('channels').values({ source_id: otherPlaylist.id, name: 'Other', tvg_id: 'one', group_title: null,
        stream_url: 'https://8.8.8.8/other.m3u8', match_key: 'other' }).returning('id').executeTakeFirstOrThrow();
      await assert.rejects(epg.getProgramGrid(owner.id, [channel.id, otherChannel.id]),
        (error: { code?: { cause?: string } }) => error.code?.cause === 'NOT_FOUND');
    } finally {
      await db.destroy();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
