import { loadConfig } from '../config.js';
import { createDb } from '../db/pool.js';
import { sql } from 'kysely';
import { ChannelRepository } from '../channel/channel.repository.js';
import { PlaylistRepository } from '../playlist/playlist.repository.js';
import { PlaylistService } from '../playlist/playlist.service.js';
import { ChannelService } from '../channel/channel.service.js';
import { EPGRepository } from '../epg/epg.repository.js';
import { EPGService } from '../epg/epg.service.js';
import { claimDueEpgRefresh, claimDueRefresh } from '../jobs/claim-due-refresh.js';
import { AppError } from '../utils/errors/errors.js';

const db = createDb(loadConfig(process.env));
await sql`SELECT 1`.execute(db);

const playlists = new PlaylistService(new PlaylistRepository(db, new ChannelRepository(db)));
const epg = new EPGService(new EPGRepository(db), new ChannelService(new ChannelRepository(db)),
  undefined, (event) => console.log(JSON.stringify({ component: 'epg', at: new Date().toISOString(), ...event })));
let stopping = false;
let pollErrorReported = false;
async function poll(): Promise<void> {
  while (!stopping) {
    try {
      const claim = await claimDueRefresh(db, new Date());
      if (claim) {
        try { await playlists.refreshSource(claim.ownerId, claim.id); }
        catch { /* The source records a sanitized failure status. */ }
      }
      const guideClaim = await claimDueEpgRefresh(db, new Date());
      if (pollErrorReported) {
        console.log(JSON.stringify({ component: 'worker', stage: 'poll_recovered',
          at: new Date().toISOString() }));
        pollErrorReported = false;
      }
      if (guideClaim) {
        console.log(JSON.stringify({ component: 'epg', stage: 'claimed', sourceId: guideClaim.id,
          at: new Date().toISOString() }));
        try { await epg.refreshSource(guideClaim.ownerId, guideClaim.id); }
        catch (error) {
          console.log(JSON.stringify({ component: 'epg', stage: 'worker_error', sourceId: guideClaim.id,
            code: error instanceof AppError ? error.code.cause : 'UNEXPECTED',
            at: new Date().toISOString() }));
        }
      }
      if (claim || guideClaim) continue;
    } catch (error) {
      if (!pollErrorReported) {
        console.log(JSON.stringify({ component: 'worker', stage: 'poll_error',
          errorType: error instanceof Error ? error.constructor.name : 'UnknownError',
          at: new Date().toISOString() }));
        pollErrorReported = true;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
const work = poll();
process.on('SIGTERM', () => {
  stopping = true;
  void work.finally(() => db.destroy());
});
