import { Router } from 'express';
import { param } from 'express-validator';

import { requireUser } from '../middlewares/auth.js';
import { libraryRateLimit } from '../middlewares/rate-limit.js';
import { validate } from '../middlewares/validate.js';
import type { UserActions } from '../user/user.routes.js';
import type { ChannelService } from './channel.service.js';

export function channelRoutes(users: UserActions, channels: Pick<ChannelService, 'listOwned' | 'getLogo'>): Router {
  const router = Router();
  router.use(libraryRateLimit(), requireUser(users));
  router.get('/', async (request, response) => {
    response.json({ channels: await channels.listOwned(request.authUser!.id) });
  });
  router.get('/:channelId/logo', param('channelId').isUUID(), validate, async (request, response) => {
    const abort = new AbortController();
    const onClose = () => { if (!response.writableEnded) abort.abort(); };
    response.once('close', onClose);
    try {
      const logo = await channels.getLogo(request.authUser!.id, request.params.channelId as string, abort.signal);
      response.set('Cache-Control', 'no-store');
      response.type(logo.contentType).send(logo.bytes);
    } finally {
      response.off('close', onClose);
    }
  });
  return router;
}
