import { Router } from 'express';
import { body, param } from 'express-validator';

import { requireAdmin, requireUser } from '../middlewares/auth.js';
import { adminRateLimit } from '../middlewares/rate-limit.js';
import { validate } from '../middlewares/validate.js';
import type { UserActions } from '../user/user.routes.js';
import type { AdminService } from './admin.service.js';

export type AdminActions = Pick<AdminService, 'listUsers' | 'createUser' | 'disableUser' | 'resetPassword'>;

export function adminRoutes(users: UserActions, admin: AdminActions): Router {
  const router = Router();
  router.use(adminRateLimit(), requireUser(users), requireAdmin);

  router.get('/users', async (request, response) => {
    response.json({ users: await admin.listUsers(request.authUser!) });
  });

  router.post('/users',
    body('username').isString().trim().notEmpty().isLength({ max: 100 }),
    body('password').isString().isLength({ min: 12, max: 4096 }),
    body('role').isIn(['user', 'admin']), validate,
    async (request, response) => {
      const created = await admin.createUser(request.authUser!, request.body.username, request.body.password, request.body.role);
      response.status(201).json({ user: created });
    });

  router.post('/users/:id/disable', param('id').isUUID(), validate, async (request, response) => {
    response.json({ user: await admin.disableUser(request.authUser!, request.params.id as string) });
  });

  router.post('/users/:id/reset-password',
    param('id').isUUID(), body('password').isString().isLength({ min: 12, max: 4096 }), validate,
    async (request, response) => {
      response.json({ user: await admin.resetPassword(request.authUser!, request.params.id as string, request.body.password) });
    });

  return router;
}
