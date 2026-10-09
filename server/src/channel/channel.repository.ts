import type { Kysely } from 'kysely';

import type { Database } from '../db/types.js';

export type ChannelSnapshot = {
  name: string;
  tvgId?: string;
  group?: string;
  url: string;
  matchKey: string;
};

export class ChannelRepository {
  constructor(private readonly db: Kysely<Database>) {}

  listOwned(ownerId: string) {
    return this.db.selectFrom('channels')
      .innerJoin('playlist_sources', 'playlist_sources.id', 'channels.source_id')
      .select(['channels.id', 'channels.source_id', 'channels.name', 'channels.tvg_id', 'channels.group_title'])
      .where('playlist_sources.owner_id', '=', ownerId)
      .orderBy('channels.name').orderBy('channels.id').execute();
  }

  getOwned(ownerId: string, channelId: string) {
    return this.db.selectFrom('channels')
      .innerJoin('playlist_sources', 'playlist_sources.id', 'channels.source_id')
      .select(['channels.id', 'channels.source_id', 'channels.name', 'channels.tvg_id', 'channels.group_title', 'channels.stream_url'])
      .where('channels.id', '=', channelId)
      .where('playlist_sources.owner_id', '=', ownerId).executeTakeFirst();
  }

  async replaceSnapshot(db: Kysely<Database>, ownerId: string, sourceId: string, channels: ChannelSnapshot[]): Promise<void> {
    const source = await db.selectFrom('playlist_sources').select('id')
      .where('id', '=', sourceId).where('owner_id', '=', ownerId).executeTakeFirst();
    if (!source) throw new Error('SOURCE_NOT_FOUND');

    for (let offset = 0; offset < channels.length; offset += 200) {
      const chunk = channels.slice(offset, offset + 200);
      await db.insertInto('channels').values(chunk.map((channel) => ({
        source_id: sourceId,
        name: channel.name,
        tvg_id: channel.tvgId ?? null,
        group_title: channel.group ?? null,
        stream_url: channel.url,
        match_key: channel.matchKey,
      }))).onConflict((conflict) => conflict.columns(['source_id', 'match_key']).doUpdateSet((update) => ({
        name: update.ref('excluded.name'),
        tvg_id: update.ref('excluded.tvg_id'),
        group_title: update.ref('excluded.group_title'),
        stream_url: update.ref('excluded.stream_url'),
      }))).execute();
    }

    await db.deleteFrom('channels').where('source_id', '=', sourceId)
      .where('match_key', 'not in', channels.map((channel) => channel.matchKey)).execute();
  }
}
