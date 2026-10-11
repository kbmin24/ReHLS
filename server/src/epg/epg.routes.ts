import { Router } from 'express';
import { body, param } from 'express-validator';

import { requireUser } from '../middlewares/auth.js';
import { libraryRateLimit } from '../middlewares/rate-limit.js';
import { validate } from '../middlewares/validate.js';
import type { UserActions } from '../user/user.routes.js';

type GuideSource = {
  id: string;
  refreshInterval: number | null;
  refreshStatus: 'queued' | 'healthy' | 'stale' | 'failed';
  lastAttemptAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureCode: string | null;
  createdAt: Date;
};

type GuideChannel = { id: string; xmltvId: string; displayName: string; sourceId: string };
type Program = { title: string; startsAt: Date; endsAt: Date };
type ChannelGuide = {
  match: { channel: GuideChannel; provenance: 'manual' | 'automatic' } | null;
  current: Program | null;
  upcoming: Program[];
};

/** API-facing guide operations; ownership is checked again in the service. */
export type EPGActions = {
  listSources(ownerId: string): Promise<GuideSource[]>;
  addSource(ownerId: string, url: string, refreshInterval: number | null): Promise<GuideSource>;
  requestRefresh(ownerId: string, sourceId: string): Promise<GuideSource>;
  removeSource(ownerId: string, sourceId: string): Promise<void>;
  listGuideChannels(ownerId: string): Promise<GuideChannel[]>;
  getChannelGuide(ownerId: string, channelId: string): Promise<ChannelGuide>;
  setOverride(ownerId: string, channelId: string, xmltvChannelId: string): Promise<ChannelGuide>;
  clearOverride(ownerId: string, channelId: string): Promise<ChannelGuide>;
};

export function epgRoutes(users: UserActions, epg: EPGActions): Router {
  const router = Router();
  router.use(libraryRateLimit(), requireUser(users));

  router.get('/sources', async (request, response) => {
    response.json({ sources: await epg.listSources(request.authUser!.id) });
  });
  router.post('/sources',
    body('url').isString().isLength({ min: 1, max: 4096 }),
    body('refreshInterval').optional({ nullable: true }).isInt({ min: 60, max: 2_592_000 }).toInt(),
    validate,
    async (request, response) => {
      const source = await epg.addSource(request.authUser!.id, request.body.url,
        request.body.refreshInterval ?? null);
      response.status(201).json({ source });
    });
  router.post('/sources/:id/refresh', param('id').isUUID(), validate, async (request, response) => {
    response.json({ source: await epg.requestRefresh(request.authUser!.id, request.params.id as string) });
  });
  router.delete('/sources/:id', param('id').isUUID(), validate, async (request, response) => {
    await epg.removeSource(request.authUser!.id, request.params.id as string);
    response.status(204).end();
  });

  router.get('/channels', async (request, response) => {
    response.json({ channels: await epg.listGuideChannels(request.authUser!.id) });
  });
  router.get('/channels/:channelId/guide', param('channelId').isUUID(), validate, async (request, response) => {
    response.json(await epg.getChannelGuide(request.authUser!.id, request.params.channelId as string));
  });
  router.put('/channels/:channelId/mapping',
    param('channelId').isUUID(), body('xmltvChannelId').isUUID(), validate,
    async (request, response) => {
      response.json(await epg.setOverride(request.authUser!.id, request.params.channelId as string,
        request.body.xmltvChannelId));
    });
  router.delete('/channels/:channelId/mapping', param('channelId').isUUID(), validate,
    async (request, response) => {
      response.json(await epg.clearOverride(request.authUser!.id, request.params.channelId as string));
    });

  return router;
}
