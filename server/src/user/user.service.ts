import argon2 from 'argon2';

import type { User } from '../db/types.js';
import { AppError, InvalidCredentialsError, InvalidUserInputError, NotFoundError, UnauthenticatedError } from '../utils/errors/errors.js';
import { user as userErrors } from '../utils/errors/errorCodes.js';
import { UserRepository } from './user.repository.js';

export type AuthUser = Pick<User, 'id' | 'username' | 'role' | 'session_version' | 'disabled_at'>;

const publicUser = (user: User): AuthUser => ({
  id: user.id,
  username: user.username,
  role: user.role,
  session_version: user.session_version,
  disabled_at: user.disabled_at,
});

export class UserService {
  constructor(private readonly users: UserRepository) {}

  async listAccounts(): Promise<AuthUser[]> {
    return this.users.listAccounts();
  }

  async createAccount(username: string, password: string, role: 'admin' | 'user'): Promise<AuthUser> {
    const normalized = username.trim();
    if (!normalized || normalized.length > 100 || password.length < 12 || password.length > 4096 || !['admin', 'user'].includes(role)) {
      throw new InvalidUserInputError();
    }
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    try {
      return publicUser(await this.users.createAccount(normalized, passwordHash, role));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        throw new AppError(409, userErrors.USERNAME_TAKEN);
      }
      throw error;
    }
  }

  async disableAccount(id: string): Promise<AuthUser> {
    const updated = await this.users.disableAccount(id);
    if (updated) return publicUser(updated);
    const existing = await this.users.findById(id);
    if (!existing) throw new NotFoundError();
    return publicUser(existing);
  }

  async resetAccountPassword(id: string, password: string): Promise<AuthUser> {
    if (password.length < 12 || password.length > 4096) throw new InvalidUserInputError();
    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const updated = await this.users.resetAccountPassword(id, hash);
    if (!updated) throw new NotFoundError();
    return publicUser(updated);
  }

  async createFirstAdmin(username: string, password: string): Promise<AuthUser> {
    if (!username.trim() || password.length < 12) throw new InvalidUserInputError();
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    return publicUser(await this.users.createFirstAdmin(username.trim(), passwordHash));
  }

  async authenticate(username: string, password: string): Promise<AuthUser> {
    const user = await this.users.findByUsername(username);
    if (!user || user.disabled_at || !(await argon2.verify(user.password_hash, password))) {
      throw new InvalidCredentialsError();
    }
    return publicUser(user);
  }

  async getActiveUser(id: string, sessionVersion: number): Promise<AuthUser | null> {
    const user = await this.users.findById(id);
    return user && !user.disabled_at && user.session_version === sessionVersion ? publicUser(user) : null;
  }

  async changeOwnPassword(id: string, sessionVersion: number, current: string, replacement: string): Promise<AuthUser> {
    if (replacement.length < 12) throw new InvalidUserInputError();
    const user = await this.users.findById(id);
    if (!user || user.disabled_at || user.session_version !== sessionVersion) throw new UnauthenticatedError();
    if (!(await argon2.verify(user.password_hash, current))) throw new InvalidCredentialsError();
    const hash = await argon2.hash(replacement, { type: argon2.argon2id });
    const updated = await this.users.replacePassword(id, sessionVersion, hash);
    if (!updated) throw new UnauthenticatedError();
    return publicUser(updated);
  }
}
