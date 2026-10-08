import { promises as fs } from 'node:fs';
import path from 'node:path';

import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { loadConfig } from '../server/src/config.js';
import { createDb } from '../server/src/db/pool.js';

const db = createDb(loadConfig(process.env));

try {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(import.meta.dirname, 'migrations'),
    }),
  });
  const { error, results } = await migrator.migrateToLatest();
  for (const result of results ?? []) {
    console.log(`${result.migrationName}: ${result.status}`);
  }
  if (error) throw error;
} catch (error) {
  console.error('Error occurred during migration:', error);
} finally {
  await db.destroy();
}
