import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('playlist_sources')
    .addColumn('next_refresh_at_utc', 'timestamptz', (col) => col
      .generatedAlwaysAs(sql`date_add(
        coalesce(last_attempt_at, '-infinity'::timestamptz),
        refresh_interval * interval '1 second',
        'UTC'
      )`)
      .stored())
    .execute();

  await db.schema.createIndex('playlist_sources_next_refresh_at_utc_idx')
    .on('playlist_sources').column('next_refresh_at_utc').execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropIndex('playlist_sources_next_refresh_at_utc_idx').execute();
  await db.schema.alterTable('playlist_sources')
    .dropColumn('next_refresh_at_utc').execute();
}
