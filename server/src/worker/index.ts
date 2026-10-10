import { loadConfig } from '../config.js';
import { createDb } from '../db/pool.js';
import { sql } from 'kysely';
import { ChannelRepository } from '../channel/channel.repository.js';
import { PlaylistRepository } from '../playlist/playlist.repository.js';
import { PlaylistService } from '../playlist/playlist.service.js';
import { claimDueRefresh } from '../jobs/claim-due-refresh.js';

const db = createDb(loadConfig(process.env));
await sql`SELECT 1`.execute(db);

const playlists = new PlaylistService(new PlaylistRepository(db, new ChannelRepository(db)));
let stopping = false;
async function poll(): Promise<void> {
  while (!stopping) {
    try {
      const claim = await claimDueRefresh(db, new Date());
      if (claim) {
        try { await playlists.refreshSource(claim.ownerId, claim.id); }
        catch { /* The source records a sanitized failure status. */ }
        continue;
      }
    } catch {
      // A transient database failure should not spin the worker.
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
const work = poll();
process.on('SIGTERM', () => {
  stopping = true;
  void work.finally(() => db.destroy());
});
