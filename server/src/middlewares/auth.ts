import type { RequestHandler } from 'express';

import { ForbiddenError, UnauthenticatedError } from '../utils/errors/errors.js';
import type { AuthUser, UserService } from '../user/user.service.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
    sessionVersion?: number;
  }
}

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

export function requireUser(users: Pick<UserService, 'getActiveUser'>): RequestHandler {
  return async (request, _response, next) => {
    try {
      const { userId, sessionVersion } = request.session;
      if (!userId || sessionVersion === undefined) throw new UnauthenticatedError();
      const user = await users.getActiveUser(userId, sessionVersion);
      if (!user) throw new UnauthenticatedError();
      request.authUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export const requireAdmin: RequestHandler = (request, _response, next) => {
  if (request.authUser?.role !== 'admin') return next(new ForbiddenError());
  next();
};
