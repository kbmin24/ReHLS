import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { LookupAddress } from 'node:dns';
import { Response } from 'undici';

import { createPublicClient, createPublicLookup, isPublicAddress } from '../src/public-fetch.js';

test('only globally routable addresses pass classification', () => {
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) {
    assert.equal(isPublicAddress(address), true, address);
  }
  for (const address of [
    '127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1',
    '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1',
    '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test('DNS lookup filters private answers before a connection can use them', async () => {
  const answers: LookupAddress[] = [
    { address: '127.0.0.1', family: 4 },
    { address: '8.8.8.8', family: 4 },
    { address: '::ffff:192.168.1.2', family: 6 },
  ];
  const lookup = createPublicLookup(async () => answers);
  const selected = await new Promise<LookupAddress[]>((resolve, reject) => {
    lookup('example.org', { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses as LookupAddress[]);
    });
  });
  assert.deepEqual(selected, [{ address: '8.8.8.8', family: 4 }]);
});

test('rejects unsupported, credentialed, and private URLs before dispatch', async () => {
  const called: string[] = [];
  const client = createPublicClient({
    request: async (url) => {
      called.push(url.href);
      return new Response('ok');
    },
  });
  for (const value of [
    'ftp://example.org/list.m3u',
    'https://user:secret@example.org/list.m3u',
    'http://127.0.0.1/list.m3u',
    'http://[::ffff:127.0.0.1]/list.m3u',
    'http://localhost/list.m3u',
  ]) {
    await assert.rejects(client.get(new URL(value)));
  }
  assert.deepEqual(called, []);
});

test('rejects a public redirect to a private destination', async () => {
  const called: string[] = [];
  const client = createPublicClient({
    request: async (url) => {
      called.push(url.href);
      return new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/private' },
      });
    },
  });
  await assert.rejects(client.get(new URL('https://example.org/list.m3u')));
  assert.deepEqual(called, ['https://example.org/list.m3u']);
});

test('follows at most four redirects and returns the final URL', async () => {
  let calls = 0;
  const client = createPublicClient({
    request: async () => {
      calls++;
      return new Response(null, { status: 302, headers: { location: `/hop${calls}` } });
    },
  });
  await assert.rejects(client.get(new URL('https://example.org/start')), /redirect/i);
  assert.equal(calls, 5);

  const finalClient = createPublicClient({
    request: async (url) => url.pathname === '/start'
      ? new Response(null, { status: 302, headers: { location: '/live/index.m3u8?token=abc' } })
      : new Response('manifest'),
  });
  const result = await finalClient.get(new URL('https://example.org/start'));
  assert.equal(result.finalUrl.href, 'https://example.org/live/index.m3u8?token=abc');
  assert.equal(await result.response.text(), 'manifest');
});

test('times out a stalled upstream request', async () => {
  const client = createPublicClient({
    timeoutMs: 20,
    request: async (_url, signal) => new Promise<Response>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  });
  await assert.rejects(client.get(new URL('https://example.org/slow')), /timed out/i);
});

test('does not expose an upstream URL when redirect cleanup fails', async () => {
  const client = createPublicClient({
    request: async () => {
      const response = new Response('redirect', { status: 302, headers: { location: '/next' } });
      response.body!.cancel = async () => { throw new Error('https://example.org/live?secret=abc'); };
      return response;
    },
  });
  await assert.rejects(
    client.get(new URL('https://example.org/live?secret=abc')),
    (error: Error) => !error.message.includes('secret=abc'),
  );
});

test('caller abort remains connected after response headers', async () => {
  const controller = new AbortController();
  let upstreamSignal: AbortSignal | undefined;
  const client = createPublicClient({
    request: async (_url, signal) => {
      upstreamSignal = signal;
      return new Response('segment');
    },
  });
  await client.get(new URL('https://example.org/segment.ts'), controller.signal);
  controller.abort();
  assert.equal(upstreamSignal?.aborted, true);
});
