import { sql, type Kysely, type Transaction } from 'kysely';

import type { Database } from '../db/types.js';
import { NotFoundError } from '../utils/errors/errors.js';
import type { GuideSnapshot } from './xmltv.types.js';

const BATCH_SIZE = 200;

export class EPGRepository {
  constructor(private readonly db: Kysely<Database>) {}

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
