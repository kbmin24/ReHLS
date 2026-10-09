import { sql, type Kysely } from 'kysely';

import type { Database, User } from '../db/types.js';
import { AppError } from '../utils/errors/errors.js';
import { user } from '../utils/errors/errorCodes.js';

export class UserRepository {
  constructor(private readonly db: Kysely<Database>) {}

  listAccounts() {
    return this.db.selectFrom('users')
      .select(['id', 'username', 'role', 'session_version', 'disabled_at'])
      .orderBy('username').execute();
  }

  createAccount(username: string, passwordHash: string, role: 'admin' | 'user'): Promise<User> {
    return this.db.insertInto('users')
      .values({ username, password_hash: passwordHash, role, session_version: 0 })
      .returningAll().executeTakeFirstOrThrow();
  }

  disableAccount(id: string): Promise<User | undefined> {
    return this.db.updateTable('users')
      .set({ disabled_at: new Date(), session_version: sql`session_version + 1` })
      .where('id', '=', id).where('disabled_at', 'is', null)
      .returningAll().executeTakeFirst();
  }

  resetAccountPassword(id: string, passwordHash: string): Promise<User | undefined> {
    return this.db.updateTable('users')
      .set({ password_hash: passwordHash, session_version: sql`session_version + 1` })
      .where('id', '=', id).returningAll().executeTakeFirst();
  }

  findById(id: string): Promise<User | undefined> {
    return this.db.selectFrom('users').selectAll().where('id', '=', id).executeTakeFirst();
  }

  findByUsername(username: string): Promise<User | undefined> {
    return this.db.selectFrom('users').selectAll()
      .where(sql<string>`lower(${sql.ref('username')})`, '=', sql<string>`lower(${username})`)
      .executeTakeFirst();
  }

  /** Creates the first admin, serializing concurrent bootstrap attempts. */
  async createFirstAdmin(username: string, passwordHash: string): Promise<User> {
    return this.db.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(524382, 1)`.execute(transaction);
      const existing = await transaction.selectFrom('users').select('id').executeTakeFirst();
      if (existing) throw new AppError(409, user.BOOTSTRAP_CLOSED);
      return transaction.insertInto('users')
        .values({ username, password_hash: passwordHash, role: 'admin', session_version: 0 })
        .returningAll().executeTakeFirstOrThrow();
    });
  }

  replacePassword(id: string, sessionVersion: number, passwordHash: string): Promise<User | undefined> {
    return this.db.updateTable('users')
      .set({ password_hash: passwordHash, session_version: sessionVersion + 1 })
      .where('id', '=', id)
      .where('session_version', '=', sessionVersion)
      .where('disabled_at', 'is', null)
      .returningAll().executeTakeFirst();
  }
}
