import { Router } from 'express';
import { body } from 'express-validator';

import { UnauthenticatedError } from '../utils/errors/errors.js';
import { requireUser } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import type { AuthUser, UserService } from './user.service.js';

export type UserActions = Pick<UserService, 'authenticate' | 'getActiveUser' | 'changeOwnPassword'>;

function rotateSession(request: import('express').Request, user: AuthUser): Promise<void> {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => {
      if (error) return reject(error);
      request.session.userId = user.id;
      request.session.sessionVersion = user.session_version;
      request.session.save((saveError) => saveError ? reject(saveError) : resolve());
    });
  });
}

export function userRoutes(users: UserActions): Router {
  const router = Router();

  router.post('/login',
    body('username').isString().trim().notEmpty().isLength({ max: 100 }),
    body('password').isString().notEmpty(),
    validate,
    async (request, response) => {
      const user = await users.authenticate(request.body.username, request.body.password);
      await rotateSession(request, user);
      response.json({ user });
    });

  router.post('/logout', async (request, response) => {
    await new Promise<void>((resolve, reject) => request.session.destroy((error) => error ? reject(error) : resolve()));
    response.clearCookie('rehls.sid');
    response.status(204).end();
  });

  router.get('/me', requireUser(users), (request, response) => response.json({ user: request.authUser }));

  router.post('/password', requireUser(users),
    body('currentPassword').isString().notEmpty(),
    body('newPassword').isString().isLength({ min: 12 }),
    validate,
    async (request, response) => {
      const active = request.authUser;
      if (!active) throw new UnauthenticatedError();
      const user = await users.changeOwnPassword(active.id, active.session_version,
        request.body.currentPassword, request.body.newPassword);
      await rotateSession(request, user);
      response.json({ user });
    });

  return router;
}
