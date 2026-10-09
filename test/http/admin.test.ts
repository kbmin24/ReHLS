import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';

import session from 'express-session';

import { createApp } from '../../server/src/index.js';

test('admin account routes deny ordinary users and validate creation', async () => {
  const admin = { id: 'c99bde9d-a55b-4ed9-8e44-572cc35d7084', username: 'operator', role: 'admin' as const, session_version: 0, disabled_at: null };
  const viewer = { id: 'bf62dfb3-88db-4970-baf3-58752e8c81a4', username: 'viewer', role: 'user' as const, session_version: 0, disabled_at: null };
  const accounts = [admin, viewer];
  const users = {
    authenticate: async (name: string) => name === 'operator' ? admin : viewer,
    getActiveUser: async (id: string) => accounts.find(user => user.id === id) ?? null,
    changeOwnPassword: async () => viewer,
  };
  const app = createApp({ query: async () => ({ rows: [{ ok: 1 }] }) }, {
    config: { databaseUrl: 'postgresql://unused/unused', sessionSecret: 'a'.repeat(32), appOrigin: 'http://127.0.0.1:5173', port: 3000, trustProxy: false },
    sessionStore: new session.MemoryStore(),
    users,
    admin: {
      listUsers: async () => accounts,
      createUser: async () => viewer,
      disableUser: async () => viewer,
      resetPassword: async () => viewer,
    },
  });
  const server = app.listen(0, '127.0.0.1');

  try {
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const login = async (username: string) => {
      const response = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: 'password' }),
      });
      assert.equal(response.status, 200);
      const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
      assert.ok(cookie);
      return cookie;
    };
    const viewerCookie = await login('viewer');
    const adminCookie = await login('operator');

    const denied = await fetch(`${base}/api/admin/users`, { headers: { cookie: viewerCookie } });
    assert.equal(denied.status, 403);

    const listed = await fetch(`${base}/api/admin/users`, { headers: { cookie: adminCookie } });
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).users.map((user: { username: string }) => user.username), ['operator', 'viewer']);

    const invalid = await fetch(`${base}/api/admin/users`, {
      method: 'POST',
      headers: { cookie: adminCookie, origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'newuser', password: 'short', role: 'user' }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
