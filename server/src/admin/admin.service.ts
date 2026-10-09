import { ForbiddenError, InvalidUserInputError } from '../utils/errors/errors.js';
import type { AuthUser, UserService } from '../user/user.service.js';

type AccountActions = Pick<UserService, 'listAccounts' | 'createAccount' | 'disableAccount' | 'resetAccountPassword'>;

export class AdminService {
  constructor(private readonly users: AccountActions) {}

  private requireAdmin(actor: AuthUser): void {
    if (actor.role !== 'admin' || actor.disabled_at) throw new ForbiddenError();
  }

  listUsers(actor: AuthUser): Promise<AuthUser[]> {
    this.requireAdmin(actor);
    return this.users.listAccounts();
  }

  createUser(actor: AuthUser, username: string, password: string, role: 'admin' | 'user'): Promise<AuthUser> {
    this.requireAdmin(actor);
    return this.users.createAccount(username, password, role);
  }

  disableUser(actor: AuthUser, id: string): Promise<AuthUser> {
    this.requireAdmin(actor);
    if (actor.id === id) throw new InvalidUserInputError();
    return this.users.disableAccount(id);
  }

  resetPassword(actor: AuthUser, id: string, password: string): Promise<AuthUser> {
    this.requireAdmin(actor);
    return this.users.resetAccountPassword(id, password);
  }
}
