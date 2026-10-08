import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express from 'express';
import { sql } from 'kysely';
import helmet from 'helmet';

import { loadConfig } from './config.js';
import { createDb } from './db/pool.js';

export type HealthDatabase = { query(sql: string): Promise<unknown> };

export function createApp(db: HealthDatabase): express.Express {
  const app = express();
  app.use(helmet());

  app.get('/health', async (_request, response) => {
    try {
      await db.query('SELECT 1');
      response.json({ status: 'ok' });
    } catch {
      response.status(503).json({ status: 'unavailable' });
    }
  });

  const client = path.resolve('dist/client');
  app.use(express.static(client));
  app.get(/^(?!\/api\/).*/, (_request, response) => response.sendFile(path.join(client, 'index.html')));

  return app;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig(process.env);
  const db = createDb(config);
  const app = createApp({ query: () => sql`SELECT 1`.execute(db) });
  if (config.trustProxy) app.set('trust proxy', 1);

  const server = app.listen(config.port, '0.0.0.0');
  process.on('SIGTERM', () => {
    server.close(() => void db.destroy());
  });
}
