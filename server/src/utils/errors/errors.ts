import type { ErrorRequestHandler } from 'express';
import { app, rateLimit, user, validation, type ErrorCode } from './errorCodes.js';

type ErrorPayload = Record<string, unknown>;

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    public readonly payload?: ErrorPayload,
  ) {
    super(`${code.service}.${code.cause}`);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(payload?: ErrorPayload) {
    super(401, user.UNAUTHENTICATED, payload);
  }
}

export class InvalidCredentialsError extends AppError {
  constructor(payload?: ErrorPayload) {
    super(401, user.INVALID_CREDENTIALS, payload);
  }
}

export class ForbiddenError extends AppError {
  constructor(payload?: ErrorPayload) {
    super(403, user.FORBIDDEN, payload);
  }
}

export class InvalidInputError extends AppError {
  constructor(payload?: ErrorPayload) {
    super(400, validation.INVALID_INPUT, payload);
  }
}

export class InvalidUserInputError extends AppError {
  constructor(payload?: ErrorPayload) {
    super(400, user.INVALID_INPUT, payload);
  }
}

export class NotFoundError extends AppError {
  constructor(code: Extract<ErrorCode, { cause: 'NOT_FOUND' }> = app.NOT_FOUND, payload?: ErrorPayload) {
    super(404, code, payload);
  }
}

export class RateLimitedError extends AppError {
  constructor(payload?: ErrorPayload) {
    super(429, rateLimit.RATE_LIMITED, payload);
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  if (error instanceof AppError) {
    response.status(error.status).json({ code: error.code, ...(error.payload === undefined ? {} : { payload: error.payload }) });
    return;
  }
  if (error && typeof error === 'object' && 'status' in error && error.status === 400) {
    response.status(400).json({ code: validation.INVALID_INPUT });
    return;
  }
  response.status(500).json({ code: app.INTERNAL_ERROR });
};
