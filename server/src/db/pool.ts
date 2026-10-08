import { Pool } from 'pg';
import { Kysely, PostgresDialect, Generated } from 'kysely'
import { Database } from './types.js';

import type { Config } from '../config.js';

export const createDb = (config: Config) => new Kysely<Database>({
  dialect: new PostgresDialect({
    pool: new Pool({
      connectionString: config.databaseUrl,
      max: 10,
    }),
  }),
})
