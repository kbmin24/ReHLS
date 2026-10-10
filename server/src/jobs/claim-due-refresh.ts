import { sql, type Kysely } from 'kysely';

import type { Database } from '../db/types.js';

export type RefreshClaim = { id: string; ownerId: string };

/** Claims one due playlist for 60 seconds; an expired claim can be retried. */
export async function claimDueRefresh(db: Kysely<Database>, now: Date): Promise<RefreshClaim | null> {
  const result = await sql<{ id: string; owner_id: string }>`
    UPDATE playlist_sources
    SET lease_expires_at = ${new Date(now.getTime() + 60_000)}
    WHERE id = (
      SELECT id
      FROM playlist_sources
      WHERE COALESCE(lease_expires_at, '-infinity'::timestamp) < ${now}
        AND (
          refresh_status = 'queued'
          OR next_refresh_at_utc <= ${now}
        )
      ORDER BY created_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, owner_id;
  `.execute(db);
  const row = result.rows[0];
  return row ? { id: row.id, ownerId: row.owner_id } : null;
}
