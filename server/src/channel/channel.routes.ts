import { Router } from 'express';

import { requireUser } from '../middlewares/auth.js';
import { libraryRateLimit } from '../middlewares/rate-limit.js';
import type { UserActions } from '../user/user.routes.js';
import type { ChannelService } from './channel.service.js';

export function channelRoutes(users: UserActions, channels: Pick<ChannelService, 'listOwned'>): Router {
  const router = Router();
  router.use(libraryRateLimit(), requireUser(users));
  router.get('/', async (request, response) => {
    response.json({ channels: await channels.listOwned(request.authUser!.id) });
  });
  return router;
}
