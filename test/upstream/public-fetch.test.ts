import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertPublicUrl, createPublicFetcher, PublicFetchError } from '../../server/src/upstream/public-fetch.js';

const limits = { timeoutMs: 1_000, maxBytes: 16 };

function responseAt(url: URL, body: BodyInit | null, init?: ResponseInit): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, 'url', { value: url.href });
  return response;
}

test('rejects private and credentialed source URLs', async () => {
  await assert.rejects(assertPublicUrl(new URL('http://127.0.0.1/list?secret=abc')),
    (error: unknown) => error instanceof PublicFetchError && error.code === 'INVALID_URL');
  await assert.rejects(assertPublicUrl(new URL('https://user:pass@8.8.8.8/list')),
    (error: unknown) => error instanceof PublicFetchError && error.code === 'INVALID_URL');
});

test('rejects a redirect to a private destination before making that request', async () => {
  const requested: string[] = [];
  const fetchPublic = createPublicFetcher(async (input) => {
    const url = new URL(String(input));
    requested.push(url.href);
    return responseAt(url, null, { status: 302, headers: { location: 'http://127.0.0.1/private' } });
  });
  await assert.rejects(fetchPublic(new URL('https://8.8.8.8/start?secret=abc'), limits),
    (error: unknown) => error instanceof PublicFetchError && error.code === 'INVALID_URL');
  assert.deepEqual(requested, ['https://8.8.8.8/start?secret=abc']);
});

test('returns the final redirect URL and bounds streamed response bytes', async () => {
  const fetchPublic = createPublicFetcher(async (input) => {
    const url = new URL(String(input));
    return url.pathname === '/start'
      ? responseAt(url, null, { status: 302, headers: { location: '/next?secret=abc' } })
      : responseAt(url, '01234567890123456');
  });
  const result = await fetchPublic(new URL('https://8.8.8.8/start'), limits);
  assert.equal(result.finalUrl.href, 'https://8.8.8.8/next?secret=abc');
  await assert.rejects(result.response.text(),
    (error: unknown) => error instanceof PublicFetchError && error.code === 'TOO_LARGE');
});

test('upstream errors do not expose URL query strings', async () => {
  const fetchPublic = createPublicFetcher(async () => { throw new Error('https://8.8.8.8/list?secret=abc'); });
  await assert.rejects(fetchPublic(new URL('https://8.8.8.8/list?secret=abc'), limits),
    (error: Error) => error instanceof PublicFetchError && !error.message.includes('secret=abc'));
});

test('a stalled response body is cancelled when the fetch deadline expires', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull: () => new Promise<void>(() => undefined),
    cancel: () => { cancelled = true; },
  });
  const fetchPublic = createPublicFetcher(async (input) => responseAt(new URL(String(input)), body));
  const result = await fetchPublic(new URL('https://8.8.8.8/live'), { timeoutMs: 20, maxBytes: 16 });
  await assert.rejects(result.response.text(),
    (error: unknown) => error instanceof PublicFetchError && error.code === 'TIMEOUT');
  assert.equal(cancelled, true);
});

test('a stalled request fails with the timeout code', async () => {
  const fetchPublic = createPublicFetcher(async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
  }));
  await assert.rejects(fetchPublic(new URL('https://8.8.8.8/live'), { timeoutMs: 20, maxBytes: 16 }),
    (error: unknown) => error instanceof PublicFetchError && error.code === 'TIMEOUT');
});
