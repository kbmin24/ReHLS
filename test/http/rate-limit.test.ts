import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { test } from 'node:test';

import { createApp } from '../../server/src/index.js';

async function firstLimitedRequest(path: string, options?: RequestInit): Promise<number | null> {
  const app = createApp({ query: async () => ({ rows: [{ ok: 1 }] }) });
  const server: Server = app.listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');

    for (let requestNumber = 1; requestNumber <= 500; requestNumber++) {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, options);
      await response.arrayBuffer();
      if (response.status === 429) return requestNumber;
    }
    return null;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('public routes are limited and login has a stricter limit', async () => {
  const globalLimitAt = await firstLimitedRequest('/health');
  const loginLimitAt = await firstLimitedRequest('/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:5173',
    },
    body: JSON.stringify({ username: 'missing', password: 'wrong' }),
  });

  assert.ok(globalLimitAt !== null, 'public requests should eventually receive 429');
  assert.ok(loginLimitAt !== null, 'login attempts should eventually receive 429');
  assert.ok(loginLimitAt < globalLimitAt, 'login should be limited before general public requests');
});
