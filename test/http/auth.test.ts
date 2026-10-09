import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import session from 'express-session';

import { createApp } from '../../server/src/index.js';

test('a disabled account or revoked session cannot keep using its cookie', async () => {
  let disabled = false;
  let sessionVersion = 0;
  const user = () => ({
    id: '9c5c2b54-780f-4f2a-9a95-5776fab83f31',
    username: 'alice',
    role: 'user' as const,
    session_version: sessionVersion,
    disabled_at: disabled ? new Date() : null,
  });
  const app = createApp(
    { query: async () => ({ rows: [{ ok: 1 }] }) },
    {
      config: {
        databaseUrl: 'postgresql://unused/unused',
        sessionSecret: 'a'.repeat(32),
        appOrigin: 'http://127.0.0.1:5173',
        port: 3000,
        trustProxy: false,
      },
      sessionStore: new session.MemoryStore(),
      users: {
        authenticate: async () => user(),
        getActiveUser: async (id: string, version: number) =>
          id === user().id && version === sessionVersion && !disabled ? user() : null,
        changeOwnPassword: async () => user(),
      },
    },
  );
  const server = app.listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'test-password' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
    assert.ok(cookie);

    const me = () => fetch(`${base}/api/auth/me`, { headers: { cookie } });
    assert.equal((await me()).status, 200);
    disabled = true;
    assert.equal((await me()).status, 401);
    disabled = false;
    sessionVersion++;
    assert.equal((await me()).status, 401);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
