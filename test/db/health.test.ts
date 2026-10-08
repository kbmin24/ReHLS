import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, test } from 'node:test';

import { createApp } from '../../server/src/index.js';

const servers: import('node:http').Server[] = [];
after(async () => {
  await Promise.all(servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

test('health reports database availability', async () => {
  const app = createApp({ query: async () => ({ rows: [{ ok: 1 }] }) });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
});

test('health fails when the database is unavailable', async () => {
  const app = createApp({ query: async () => { throw new Error('database down'); } });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 503);
});
