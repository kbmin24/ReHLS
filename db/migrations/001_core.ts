import { sql, type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .ifNotExists()
    .addColumn('id', 'uuid', (col: any) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('username', 'text', (col: any) => col.notNull())
    .addColumn('password_hash', 'text', (col: any) => col.notNull())
    .addColumn('role', 'text', (col: any) => col.notNull().check(sql`role IN ('admin', 'user')`))
    .addColumn('session_version', 'integer', (col: any) => col.notNull().defaultTo(0))
    .addColumn('disabled_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col: any) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
  .createIndex('users_username_lower_idx')
  .unique()
  .on('users')
  .column(sql`lower(${sql.ref('username')})`)
  .execute();

  await db.schema
  .createIndex('users_id_idx')
  .unique()
  .on('users')
  .column('id')
  .execute();

  await db.schema
  .createTable('session')
  .ifNotExists()
  .addColumn('sid', 'varchar', (col: any) => col.primaryKey())
  .addColumn('sess', 'json', (col: any) => col.notNull())
  .addColumn('expire', 'timestamptz', (col: any) => col.notNull())
  .execute();

  await db.schema
  .createIndex('session_sid_idx')
  .on('session')
  .column('sid')
  .execute();

  await db.schema
  .createIndex('session_expire_idx')
  .on('session')
  .column('expire')
  .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('users').ifExists().execute();
  await db.schema.dropTable('session').ifExists().execute();
}
