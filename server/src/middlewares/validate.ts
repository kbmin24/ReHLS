import type { RequestHandler } from 'express';
import { validationResult } from 'express-validator';

import { InvalidInputError } from '../utils/errors/errors.js';

export const validate: RequestHandler = (request, _response, next) => {
  if (!validationResult(request).isEmpty()) return next(new InvalidInputError());
  next();
};
