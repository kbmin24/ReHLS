import { rateLimit } from 'express-rate-limit';
import type { RequestHandler } from 'express';

import { RateLimitedError } from '../utils/errors/errors.js';

const reject = () => { throw new RateLimitedError(); };

export const publicRateLimit = () => rateLimit({
  windowMs: 15 * 60_000,
  limit: 100,
  skip: (request) => request.path.startsWith('/api/media/'),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: reject,
});

export const loginRateLimit = () => rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: reject,
});

export const adminRateLimit = () => rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: reject,
});

export const libraryRateLimit = () => rateLimit({
  windowMs: 15 * 60_000,
  limit: 60,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: reject,
});

export const mediaRateLimit = () => rateLimit({
  windowMs: 15 * 60_000,
  limit: 2400,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: reject,
});

export function mediaConcurrencyLimit(maxActive = 12): RequestHandler {
  let active = 0;
  return (_request, response, next) => {
    if (active >= maxActive) return next(new RateLimitedError());
    active++;
    response.once('close', () => { active--; });
    next();
  };
}
