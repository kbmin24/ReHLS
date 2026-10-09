import type { Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('playlist_sources')
    .addColumn('lease_expires_at', 'timestamptz')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('playlist_sources')
    .dropColumn('lease_expires_at')
    .execute();
}
