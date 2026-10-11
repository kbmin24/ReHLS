import { sql, type Kysely, type Transaction } from 'kysely';

import type { Database, XmltvSource } from '../db/types.js';
import { NotFoundError } from '../utils/errors/errors.js';
import type { GuideSnapshot } from './xmltv.types.js';

// avoids bombarding the DB
const BATCH_SIZE = 200;

const safeSource = (source: XmltvSource) => ({
  id: source.id,
  refreshInterval: source.refresh_interval,
  refreshStatus: source.refresh_status,
  lastAttemptAt: source.last_attempt_at,
  lastSuccessAt: source.last_success_at,
  lastFailureCode: source.last_failure_code,
  createdAt: source.created_at,
});

export class EPGRepository {
  constructor(private readonly db: Kysely<Database>) {}

  async createSource(ownerId: string, url: string, refreshInterval: number | null) {
    const source = await this.db.insertInto('xmltv_sources').values({
      owner_id: ownerId, url, refresh_interval: refreshInterval,
      last_attempt_at: null, last_success_at: null, last_failure_code: null, lease_expires_at: null,
    }).returningAll().executeTakeFirstOrThrow();
    return safeSource(source);
  }

  async listOwned(ownerId: string) {
    const rows = await this.db.selectFrom('xmltv_sources').selectAll()
      .where('owner_id', '=', ownerId).orderBy('created_at').execute();
    return rows.map(safeSource);
  }

  async requestRefresh(ownerId: string, sourceId: string) {
    const source = await this.db.updateTable('xmltv_sources').set({ refresh_status: 'queued' })
      .where('owner_id', '=', ownerId).where('id', '=', sourceId)
      .returningAll().executeTakeFirst();
    if (!source) throw new NotFoundError();
    return safeSource(source);
  }

  async removeOwned(ownerId: string, sourceId: string) {
    const source = await this.db.deleteFrom('xmltv_sources')
      .where('owner_id', '=', ownerId).where('id', '=', sourceId)
      .returning('id').executeTakeFirst();
    if (!source) throw new NotFoundError();
  }

  async listGuideChannels(ownerId: string) {
    const rows = await this.db.selectFrom('xmltv_channels')
      .innerJoin('xmltv_sources', 'xmltv_sources.id', 'xmltv_channels.source_id')
      .select(['xmltv_channels.id', 'xmltv_channels.xmltv_id', 'xmltv_channels.display_name', 'xmltv_channels.source_id'])
      .where('xmltv_sources.owner_id', '=', ownerId)
      .orderBy('xmltv_channels.display_name').orderBy('xmltv_channels.id').execute();
    return rows.map((row) => ({ id: row.id, xmltvId: row.xmltv_id,
      displayName: row.display_name, sourceId: row.source_id }));
  }

  async findGuideChannel(ownerId: string, guideChannelId: string) {
    const row = await this.db.selectFrom('xmltv_channels')
      .innerJoin('xmltv_sources', 'xmltv_sources.id', 'xmltv_channels.source_id')
      .select(['xmltv_channels.id', 'xmltv_channels.xmltv_id', 'xmltv_channels.display_name', 'xmltv_channels.source_id'])
      .where('xmltv_sources.owner_id', '=', ownerId)
      .where('xmltv_channels.id', '=', guideChannelId).executeTakeFirst();
    return row && { id: row.id, xmltvId: row.xmltv_id,
      displayName: row.display_name, sourceId: row.source_id };
  }

  async findManualMatch(ownerId: string, channelId: string) {
    const row = await this.db.selectFrom('channel_guide_overrides')
      .innerJoin('xmltv_channels', 'xmltv_channels.id', 'channel_guide_overrides.xmltv_channel_id')
      .innerJoin('xmltv_sources', 'xmltv_sources.id', 'xmltv_channels.source_id')
      .select(['xmltv_channels.id', 'xmltv_channels.xmltv_id', 'xmltv_channels.display_name', 'xmltv_channels.source_id'])
      .where('channel_guide_overrides.channel_id', '=', channelId)
      .where('xmltv_sources.owner_id', '=', ownerId).executeTakeFirst();
    return row && { id: row.id, xmltvId: row.xmltv_id,
      displayName: row.display_name, sourceId: row.source_id };
  }

  async findAutomaticMatches(ownerId: string, tvgId: string) {
    const rows = await this.db.selectFrom('xmltv_channels')
      .innerJoin('xmltv_sources', 'xmltv_sources.id', 'xmltv_channels.source_id')
      .select(['xmltv_channels.id', 'xmltv_channels.xmltv_id', 'xmltv_channels.display_name', 'xmltv_channels.source_id'])
      .where('xmltv_sources.owner_id', '=', ownerId)
      .where('xmltv_channels.xmltv_id', '=', tvgId).limit(2).execute();
    return rows.map((row) => ({ id: row.id, xmltvId: row.xmltv_id,
      displayName: row.display_name, sourceId: row.source_id }));
  }

  setOverride(channelId: string, guideChannelId: string) {
    return this.db.insertInto('channel_guide_overrides')
      .values({ channel_id: channelId, xmltv_channel_id: guideChannelId })
      .onConflict((conflict) => conflict.column('channel_id').doUpdateSet({ xmltv_channel_id: guideChannelId }))
      .execute();
  }

  clearOverride(channelId: string) {
    return this.db.deleteFrom('channel_guide_overrides').where('channel_id', '=', channelId).execute();
  }

  async programsFor(guideChannelId: string, now: Date) {
    const current = await this.db.selectFrom('xmltv_programs')
      .select(['title', 'starts_at', 'ends_at']).where('channel_id', '=', guideChannelId)
      .where('starts_at', '<=', now).where('ends_at', '>', now)
      .orderBy('starts_at', 'desc').limit(1).executeTakeFirst();
    const upcoming = await this.db.selectFrom('xmltv_programs')
      .select(['title', 'starts_at', 'ends_at']).where('channel_id', '=', guideChannelId)
      .where('starts_at', '>', now).orderBy('starts_at').limit(10).execute();
    const safeProgram = (row: { title: string; starts_at: Date; ends_at: Date }) =>
      ({ title: row.title, startsAt: row.starts_at, endsAt: row.ends_at });
    return { current: current ? safeProgram(current) : null, upcoming: upcoming.map(safeProgram) };
  }

  async findOwnedUrl(ownerId: string, sourceId: string): Promise<string | undefined> {
    const source = await this.db.selectFrom('xmltv_sources').select('url')
      .where('owner_id', '=', ownerId).where('id', '=', sourceId).executeTakeFirst();
    return source?.url;
  }

  /** Replaces only one owned source's guide in a transaction. */
  replaceSnapshot(ownerId: string, sourceId: string, snapshot: GuideSnapshot) {
    return this.db.transaction().execute(async (transaction) => {
      const source = await transaction.selectFrom('xmltv_sources').select('id')
        .where('owner_id', '=', ownerId).where('id', '=', sourceId).forUpdate().executeTakeFirst();
      if (!source) throw new NotFoundError();

      const channelIds = await this.replaceChannels(transaction, sourceId, snapshot);
      await this.replacePrograms(transaction, channelIds, snapshot);
      await this.markSuccess(transaction, ownerId, sourceId);
    });
  }

  private async replaceChannels(transaction: Transaction<Database>, sourceId: string, snapshot: GuideSnapshot) {
    const channelIds = new Map<string, string>();

    for (let offset = 0; offset < snapshot.channels.length; offset += BATCH_SIZE) {
      const batch = snapshot.channels.slice(offset, offset + BATCH_SIZE);
      const rows = await transaction.insertInto('xmltv_channels')
        .values(batch.map((channel) => ({
          source_id: sourceId,
          xmltv_id: channel.xmltvId,
          display_name: channel.displayName,
        })))
        .onConflict((conflict) => conflict.columns(['source_id', 'xmltv_id']).doUpdateSet((update) => ({
          display_name: update.ref('excluded.display_name'),
        })))
        .returning(['id', 'xmltv_id'])
        .execute();

      for (const row of rows) channelIds.set(row.xmltv_id, row.id);
    }

    await transaction.deleteFrom('xmltv_channels')
      .where('source_id', '=', sourceId)
      .where('xmltv_id', 'not in', snapshot.channels.map((channel) => channel.xmltvId))
      .execute();

    return channelIds;
  }

  private async replacePrograms(transaction: Transaction<Database>, channelIds: Map<string, string>, snapshot: GuideSnapshot) {
    await transaction.deleteFrom('xmltv_programs')
      .where('channel_id', 'in', [...channelIds.values()])
      .execute();

    for (let offset = 0; offset < snapshot.programs.length; offset += BATCH_SIZE) {
      const batch = snapshot.programs.slice(offset, offset + BATCH_SIZE);
      await transaction.insertInto('xmltv_programs')
        .values(batch.map((program) => ({
          channel_id: channelIds.get(program.xmltvId)!,
          title: program.title,
          starts_at: program.startsAt,
          ends_at: program.endsAt,
        })))
        .execute();
    }
  }

  private markSuccess(transaction: Transaction<Database>, ownerId: string, sourceId: string) {
    const now = new Date();
    return transaction.updateTable('xmltv_sources')
      .set({
        refresh_status: 'healthy',
        last_attempt_at: now,
        last_success_at: now,
        last_failure_code: null,
        lease_expires_at: null,
      })
      .where('owner_id', '=', ownerId)
      .where('id', '=', sourceId)
      .execute();
  }

  markFailure(ownerId: string, sourceId: string, code: string, now: Date) {
    return this.db.updateTable('xmltv_sources').set({
      refresh_status: sql<'stale' | 'failed'>`case when last_success_at is null then 'failed' else 'stale' end`,
      last_attempt_at: now, last_failure_code: code, lease_expires_at: null,
    }).where('owner_id', '=', ownerId).where('id', '=', sourceId).execute();
  }
}
