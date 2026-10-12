import type { Kysely } from 'kysely';

import { defaultSourceName } from '../../server/src/utils/source-name.js';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('xmltv_sources')
    .addColumn('name', 'text').execute();

  const sources = await db.selectFrom('xmltv_sources').select(['id', 'url']).execute();
  for (const source of sources) {
    await db.updateTable('xmltv_sources')
      .set({ name: defaultSourceName(new URL(source.url)) })
      .where('id', '=', source.id).execute();
  }

  await db.schema.alterTable('xmltv_sources')
    .alterColumn('name', (col) => col.setNotNull()).execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('xmltv_sources')
    .dropColumn('name').execute();
}
