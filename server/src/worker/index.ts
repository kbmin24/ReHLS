import { loadConfig } from '../config.js';
import { createDb } from '../db/pool.js';
import { sql } from 'kysely';

const db = createDb(loadConfig(process.env));
await sql`SELECT 1`.execute(db);

// Refresh scheduling is added in Task 6; keep this process alive for Compose wiring.
const heartbeat = setInterval(() => void sql`SELECT 1`.execute(db).catch(() => process.exit(1)), 30_000);
process.on('SIGTERM', () => {
  clearInterval(heartbeat);
  void db.destroy();
});
