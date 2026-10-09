import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('playlist_sources')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('owner_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('url', 'text', (col) => col.notNull())
    .addColumn('refresh_interval', 'integer', (col) => col.check(sql`refresh_interval > 0`))
    .addColumn('refresh_status', 'text', (col) => col.notNull().defaultTo('queued').check(sql`refresh_status IN ('queued', 'healthy', 'stale', 'failed')`))
    .addColumn('last_attempt_at', 'timestamptz')
    .addColumn('last_success_at', 'timestamptz')
    .addColumn('last_failure_code', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex('playlist_sources_owner_idx')
    .on('playlist_sources').column('owner_id').execute();

  await db.schema
    .createTable('channels')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('source_id', 'uuid', (col) => col.notNull().references('playlist_sources.id').onDelete('cascade'))
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('tvg_id', 'text')
    .addColumn('group_title', 'text')
    .addColumn('stream_url', 'text', (col) => col.notNull())
    .addColumn('match_key', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex('channels_source_match_key_idx')
    .unique().on('channels').columns(['source_id', 'match_key']).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('channels').execute();
  await db.schema.dropTable('playlist_sources').execute();
}
