import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { Router, type Response as ExpressResponse } from 'express';
import { param } from 'express-validator';

import { requireUser } from '../middlewares/auth.js';
import { mediaConcurrencyLimit, mediaRateLimit } from '../middlewares/rate-limit.js';
import { validate } from '../middlewares/validate.js';
import type { UserActions } from '../user/user.routes.js';
import { AppError } from '../utils/errors/errors.js';
import { streaming as streamingErrors } from '../utils/errors/errorCodes.js';
import type { StreamingService } from './streaming.service.js';

async function deliver(upstream: Response, response: ExpressResponse): Promise<void> {
  response.status(upstream.status);
  response.set('Cache-Control', 'no-store');

  const contentType = upstream.headers.get('content-type') ?? '';
  if (!/^(?:audio\/|video\/|application\/(?:octet-stream|vnd\.apple\.mpegurl))/.test(contentType)) {
    response.set('Content-Type', 'application/octet-stream');
  } else {
    response.set('Content-Type', contentType);
  }

  for (const header of ['content-range', 'accept-ranges']) {
    const value = upstream.headers.get(header);
    if (value) response.set(header, value);
  }

  if (!upstream.body) { response.end(); return; }

  try {
    await pipeline(Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream), response);
  } catch (error) {
    if (response.headersSent) { response.destroy(); return; }
    throw new AppError(502, streamingErrors.UNAVAILABLE);
  }
}

export function streamingRoutes(users: UserActions, streaming: StreamingService): Router {
  const router = Router();
  router.use(mediaRateLimit(), mediaConcurrencyLimit(), requireUser(users));

  router.get('/channels/:channelId/manifest',
    param('channelId').isUUID(),
    validate,
    async (request, response) => {
      const abort = new AbortController();
      response.once('close', () => {
        if (!response.writableEnded)
          abort.abort();
      });
      let manifestResponse: Response = await streaming.getManifest(request.authUser!.id, request.params.channelId as string, abort.signal);
      await deliver(manifestResponse, response);
  });

  router.get('/resources/:token',
    param('token').isString().isLength({ min: 32, max: 64 }),
    validate,
    async (request, response) => {
      const abort = new AbortController();
      response.once('close', () => {
        if (!response.writableEnded)
          abort.abort();
      });
      let requestedResoruce: Response = await streaming.getResource(request.authUser!.id, request.params.token as string,
        abort.signal, request.get('range'))
      await deliver(requestedResoruce, response);
    });
  return router;
}
