import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.createTable('xmltv_sources')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('owner_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('url', 'text', (col) => col.notNull())
    .addColumn('refresh_interval', 'integer', (col) => col.check(sql`refresh_interval > 0`))
    .addColumn('refresh_status', 'text', (col) => col.notNull().defaultTo('queued').check(sql`refresh_status IN ('queued', 'healthy', 'stale', 'failed')`))
    .addColumn('last_attempt_at', 'timestamptz')
    .addColumn('last_success_at', 'timestamptz')
    .addColumn('last_failure_code', 'text')
    .addColumn('lease_expires_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
  await db.schema.createIndex('xmltv_sources_owner_idx').on('xmltv_sources').column('owner_id').execute();
  await db.schema.createIndex('xmltv_sources_due_idx').on('xmltv_sources').columns(['refresh_status', 'last_attempt_at']).execute();

  await db.schema.createTable('xmltv_channels')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('source_id', 'uuid', (col) => col.notNull().references('xmltv_sources.id').onDelete('cascade'))
    .addColumn('xmltv_id', 'text', (col) => col.notNull())
    .addColumn('display_name', 'text', (col) => col.notNull())
    .execute();
  await db.schema.createIndex('xmltv_channels_source_xmltv_id_idx').unique()
    .on('xmltv_channels').columns(['source_id', 'xmltv_id']).execute();

  await db.schema.createTable('xmltv_programs')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('channel_id', 'uuid', (col) => col.notNull().references('xmltv_channels.id').onDelete('cascade'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('starts_at', 'timestamptz', (col) => col.notNull())
    .addColumn('ends_at', 'timestamptz', (col) => col.notNull().check(sql`ends_at > starts_at`))
    .execute();
  await db.schema.createIndex('xmltv_programs_channel_start_idx').on('xmltv_programs').columns(['channel_id', 'starts_at']).execute();

  await db.schema.createTable('channel_guide_overrides')
    .addColumn('channel_id', 'uuid', (col) => col.primaryKey().references('channels.id').onDelete('cascade'))
    .addColumn('xmltv_channel_id', 'uuid', (col) => col.notNull().references('xmltv_channels.id').onDelete('cascade'))
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('channel_guide_overrides').execute();
  await db.schema.dropTable('xmltv_programs').execute();
  await db.schema.dropTable('xmltv_channels').execute();
  await db.schema.dropTable('xmltv_sources').execute();
}
