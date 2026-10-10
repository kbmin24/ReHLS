import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ResourceRegistry } from '../../server/src/streaming/streaming.registry.js';

test('tokens are opaque, owner scoped, and expire', () => {
  let now = 1_000;
  const registry = new ResourceRegistry({ maxEntries: 2, ttlMs: 100, now: () => now });
  const token = registry.registerResource('owner-a', 'channel-a', new URL('https://cdn.example.org/live.ts?secret=value'), 'segment');

  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(token, /cdn|secret|owner|channel/);
  assert.equal(registry.lookupResource(token, 'owner-b'), undefined);
  assert.deepEqual(registry.lookupResource(token, 'owner-a'), {
    ownerId: 'owner-a', channelId: 'channel-a', url: new URL('https://cdn.example.org/live.ts?secret=value'), kind: 'segment',
  });
  now = 1_100;
  assert.equal(registry.lookupResource(token, 'owner-a'), undefined);
});

test('registry bounds entries and evicts the oldest token', () => {
  const registry = new ResourceRegistry({ maxEntries: 2, ttlMs: 1_000 });
  const first = registry.registerResource('owner-a', 'channel-a', new URL('https://cdn.example.org/a.ts'), 'segment');
  const second = registry.registerResource('owner-a', 'channel-a', new URL('https://cdn.example.org/b.ts'), 'segment');
  const third = registry.registerResource('owner-a', 'channel-a', new URL('https://cdn.example.org/c.ts'), 'segment');

  assert.equal(registry.lookupResource(first, 'owner-a'), undefined);
  assert.equal(registry.lookupResource(second, 'owner-a')?.url.pathname, '/b.ts');
  assert.equal(registry.lookupResource(third, 'owner-a')?.url.pathname, '/c.ts');
});
