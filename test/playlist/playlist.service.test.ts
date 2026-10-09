import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';

import { Kysely, PostgresDialect, sql } from 'kysely';
import { Pool } from 'pg';

import { up as createCore } from '../../db/migrations/001_core.js';
import { up as createPlaylist } from '../../db/migrations/002_playlist.js';
import { ChannelRepository } from '../../server/src/channel/channel.repository.js';
import { ChannelService } from '../../server/src/channel/channel.service.js';
import type { Database } from '../../server/src/db/types.js';
import { PlaylistRepository } from '../../server/src/playlist/playlist.repository.js';
import { PlaylistService } from '../../server/src/playlist/playlist.service.js';

test('refresh replaces channels, retains matchable IDs, and preserves the last good snapshot on failure',
  { skip: !process.env.DATABASE_URL }, async () => {
    const schema = `task5_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: process.env.DATABASE_URL });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
    const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
    try {
      await createCore(db);
      await createPlaylist(db);
      const owner = await db.insertInto('users').values({ username: 'owner', password_hash: 'unused', role: 'user', session_version: 0 })
        .returning('id').executeTakeFirstOrThrow();
      const other = await db.insertInto('users').values({ username: 'other', password_hash: 'unused', role: 'user', session_version: 0 })
        .returning('id').executeTakeFirstOrThrow();
      const channelRepository = new ChannelRepository(db);
      const channels = new ChannelService(channelRepository);
      let content = `#EXTM3U\n#EXTINF:-1 tvg-id="one",One\nhttps://streams.example.org/old.m3u8\n#EXTINF:-1 tvg-id="two",Two\nhttps://streams.example.org/two.m3u8\n`;
      let fail = false;
      const service = new PlaylistService(new PlaylistRepository(db, channelRepository), async (url) => {
        if (fail) throw new Error(`upstream ${url.href}?secret=abc`);
        return { response: new Response(content), finalUrl: url };
      });
      const source = await service.addSource(owner.id, 'https://8.8.8.8/list.m3u?secret=abc', null);
      assert.equal(JSON.stringify(source).includes('secret=abc'), false);
      await service.refreshSource(owner.id, source.id);
      const before = await channels.listOwned(owner.id);
      assert.equal(before.length, 2);
      assert.equal((await channels.listOwned(other.id)).length, 0);

      content = `#EXTM3U\n#EXTINF:-1 tvg-id="one",One\nhttps://streams.example.org/new.m3u8\n#EXTINF:-1 tvg-id="three",Three\nhttps://streams.example.org/three.m3u8\n`;
      await service.refreshSource(owner.id, source.id);
      const after = await channels.listOwned(owner.id);
      assert.equal(after.length, 2);
      assert.equal(after.find((channel) => channel.tvgId === 'one')?.id, before.find((channel) => channel.tvgId === 'one')?.id);
      assert.equal(after.some((channel) => channel.tvgId === 'two'), false);
      assert.equal((await channels.getOwned(owner.id, after.find((channel) => channel.tvgId === 'one')!.id)).streamUrl,
        'https://streams.example.org/new.m3u8');

      content = '#EXTM3U\n';
      await assert.rejects(service.refreshSource(owner.id, source.id));
      assert.deepEqual(await channels.listOwned(owner.id), after);

      const extra = Array.from({ length: 20_001 }, (_, index) =>
        `#EXTINF:-1,Extra ${index}\nhttps://streams.example.org/${index}.m3u8\n`).join('');
      content = `#EXTM3U\n${extra}`;
      await assert.rejects(service.refreshSource(owner.id, source.id),
        (error: { code?: { cause?: string } }) => error.code?.cause === 'TOO_LARGE');
      assert.deepEqual(await channels.listOwned(owner.id), after);

      await sql`CREATE FUNCTION reject_channel() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.name = 'Reject' THEN RAISE EXCEPTION 'rejected fixture'; END IF;
        RETURN NEW; END $$`.execute(db);
      await sql`CREATE TRIGGER reject_channel_insert BEFORE INSERT OR UPDATE ON channels
        FOR EACH ROW EXECUTE FUNCTION reject_channel()`.execute(db);
      content = `#EXTM3U\n${Array.from({ length: 200 }, (_, index) =>
        `#EXTINF:-1,New ${index}\nhttps://streams.example.org/new-${index}.m3u8\n`).join('')}` +
        '#EXTINF:-1,Reject\nhttps://streams.example.org/reject.m3u8\n';
      await assert.rejects(service.refreshSource(owner.id, source.id));
      assert.deepEqual(await channels.listOwned(owner.id), after);

      fail = true;
      await assert.rejects(service.refreshSource(owner.id, source.id),
        (error: Error) => !error.message.includes('secret=abc'));
      assert.deepEqual(await channels.listOwned(owner.id), after);
      assert.equal((await service.listSources(owner.id))[0]?.refreshStatus, 'stale');
      await assert.rejects(service.refreshSource(other.id, source.id));
      assert.equal((await service.listSources(other.id)).length, 0);
    } finally {
      await db.destroy();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  });
