import { Router, type RequestHandler } from 'express';
import { param } from 'express-validator';

import { requireUser } from '../middlewares/auth.js';
import { mediaRateLimit } from '../middlewares/rate-limit.js';
import { validate } from '../middlewares/validate.js';
import type { UserActions } from '../user/user.routes.js';

export type MediaHandlers = { manifest: RequestHandler; resource: RequestHandler };

/** Authenticated route boundaries; mount when media delivery is implemented. */
export function streamingRoutes(users: UserActions, handlers: MediaHandlers): Router {
  const router = Router();
  router.use(mediaRateLimit(), requireUser(users));
  router.get('/channels/:channelId/manifest', param('channelId').isUUID(), validate, handlers.manifest);
  router.get('/resources/:token', param('token').isString().isLength({ min: 32, max: 64 }), validate, handlers.resource);
  return router;
}
