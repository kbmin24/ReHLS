import { sql, type Kysely } from 'kysely';

import { ChannelRepository, type ChannelSnapshot } from '../channel/channel.repository.js';
import type { Database, PlaylistSource } from '../db/types.js';
import { NotFoundError } from '../utils/errors/errors.js';

const safeSource = (source: PlaylistSource) => ({
  id: source.id,
  refreshInterval: source.refresh_interval,
  refreshStatus: source.refresh_status,
  lastAttemptAt: source.last_attempt_at,
  lastSuccessAt: source.last_success_at,
  lastFailureCode: source.last_failure_code,
  createdAt: source.created_at,
});

export class PlaylistRepository {
  constructor(private readonly db: Kysely<Database>, private readonly channels: ChannelRepository) {}

  async createSource(ownerId: string, url: string, refreshInterval: number | null) {
    const source = await this.db.insertInto('playlist_sources').values({
      owner_id: ownerId,
      url,
      refresh_interval: refreshInterval,
      last_attempt_at: null,
      last_success_at: null,
      last_failure_code: null,
    }).returningAll().executeTakeFirstOrThrow();
    return safeSource(source);
  }

  async listOwned(ownerId: string) {
    const rows = await this.db.selectFrom('playlist_sources').selectAll()
      .where('owner_id', '=', ownerId).orderBy('created_at').execute();
    return rows.map(safeSource);
  }

  async findOwnedUrl(ownerId: string, sourceId: string) {
    const source = await this.db.selectFrom('playlist_sources').select('url')
      .where('owner_id', '=', ownerId).where('id', '=', sourceId).executeTakeFirst();
    return source?.url;
  }

  /** Locks the owned source and replaces its channels and refresh status atomically. */
  replaceSnapshot(ownerId: string, sourceId: string, snapshot: ChannelSnapshot[]) {
    return this.db.transaction().execute(async (transaction) => {
      const source = await transaction.selectFrom('playlist_sources').select('id')
        .where('owner_id', '=', ownerId).where('id', '=', sourceId).forUpdate().executeTakeFirst();
      if (!source) throw new NotFoundError();
      await this.channels.replaceSnapshot(transaction, ownerId, sourceId, snapshot);
      const now = new Date();
      const updated = await transaction.updateTable('playlist_sources')
        .set({ refresh_status: 'healthy', last_attempt_at: now, last_success_at: now, last_failure_code: null })
        .where('owner_id', '=', ownerId).where('id', '=', sourceId).returningAll().executeTakeFirst();
      if (!updated) throw new NotFoundError();
      return safeSource(updated);
    });
  }

  markFailure(ownerId: string, sourceId: string, code: string, now: Date) {
    return this.db.updateTable('playlist_sources').set({
      refresh_status: sql<'stale' | 'failed'>`case when last_success_at is null then 'failed' else 'stale' end`,
      last_attempt_at: now,
      last_failure_code: code,
    }).where('owner_id', '=', ownerId).where('id', '=', sourceId).returningAll().executeTakeFirst();
  }

  removeOwned(ownerId: string, sourceId: string) {
    return this.db.deleteFrom('playlist_sources').where('owner_id', '=', ownerId).where('id', '=', sourceId)
      .returning('id').executeTakeFirst();
  }
}
