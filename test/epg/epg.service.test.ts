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
      await addRefreshLease(db);
      await addNextRefresh(db);
      await addSourceName(db);
      await createGuide(db);

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
      await assert.rejects(epg.getChannelGuide(other.id, channel.id),
        (error: { code?: { cause?: string } }) => error.code?.cause === 'NOT_FOUND');

      const source2 = await epg.addSource(owner.id, 'https://8.8.8.8/second.xml', null);
      await db.insertInto('xmltv_channels').values({ source_id: source2.id, xmltv_id: 'one', display_name: 'Another One' }).execute();
      assert.equal((await epg.getChannelGuide(owner.id, channel.id)).match, null);
      assert.equal((await epg.setOverride(owner.id, channel.id, first.id)).match?.channel.id, first.id);
      assert.equal((await epg.getChannelGuide(owner.id, channel.id)).match?.provenance, 'manual');
      assert.equal((await epg.clearOverride(owner.id, channel.id)).match, null);
    } finally {
      await db.destroy();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
