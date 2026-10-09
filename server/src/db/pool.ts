import { Pool } from 'pg';
import { Kysely, PostgresDialect } from 'kysely'
import { Database } from './types.js';

import type { Config } from '../config.js';

export const createPool = (config: Config) => new Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

export const createDb = (config: Config, pool = createPool(config)) => new Kysely<Database>({
  dialect: new PostgresDialect({
    pool,
  }),
})
