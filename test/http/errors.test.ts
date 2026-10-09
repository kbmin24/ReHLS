import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import express from 'express';

import { AppError, errorHandler } from '../../server/src/utils/errors/errors.js';

test('API errors include their source, cause, and optional payload', async () => {
  const app = express();
  app.get('/with-payload', () => {
    throw new AppError(409, { service: 'user', cause: 'BOOTSTRAP_CLOSED' }, { retryable: false });
  });
  app.get('/without-payload', () => {
    throw new AppError(401, { service: 'user', cause: 'UNAUTHENTICATED' });
  });
  app.use(errorHandler);

  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;

    const withPayload = await fetch(`${base}/with-payload`);
    assert.equal(withPayload.status, 409);
    assert.deepEqual(await withPayload.json(), {
      code: { service: 'user', cause: 'BOOTSTRAP_CLOSED' },
      payload: { retryable: false },
    });

    const withoutPayload = await fetch(`${base}/without-payload`);
    assert.equal(withoutPayload.status, 401);
    assert.deepEqual(await withoutPayload.json(), {
      code: { service: 'user', cause: 'UNAUTHENTICATED' },
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
