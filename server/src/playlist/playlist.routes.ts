import { Router } from 'express';
import { body, param } from 'express-validator';

import { requireUser } from '../middlewares/auth.js';
import { validate } from '../middlewares/validate.js';
import { libraryRateLimit } from '../middlewares/rate-limit.js';
import type { UserActions } from '../user/user.routes.js';
import type { PlaylistService } from './playlist.service.js';

export function playlistRoutes(users: UserActions, playlists: Pick<PlaylistService, 'listSources' | 'addSource' | 'removeSource' | 'requestRefresh'>): Router {
  const router = Router();
  router.use(libraryRateLimit(), requireUser(users));
  router.get('/sources', async (request, response) => {
    response.json({ sources: await playlists.listSources(request.authUser!.id) });
  });
  router.post('/sources',
    body('url').isString().isLength({ min: 1, max: 4096 }),
    body('name').optional({ nullable: true }).isString().trim().isLength({ max: 255 }),
    body('refreshInterval').optional({ nullable: true }).isInt({ min: 60, max: 2_592_000 }).toInt(), validate,
    async (request, response) => {
      const source = await playlists.addSource(request.authUser!.id, request.body.url,
        request.body.refreshInterval ?? null, request.body.name);
      response.status(201).json({ source });
    });
  router.post('/sources/:id/refresh', param('id').isUUID(), validate, async (request, response) => {
    response.json({ source: await playlists.requestRefresh(request.authUser!.id, request.params.id as string) });
  });
  router.delete('/sources/:id', param('id').isUUID(), validate, async (request, response) => {
    await playlists.removeSource(request.authUser!.id, request.params.id as string);
    response.status(204).end();
  });
  return router;
}
