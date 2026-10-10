import { assertUrlIsSafeToFetch, guardedFetch, isGuardedFetchError } from 'guarded-fetch';

export type FetchLimits = {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects?: number;
};

export type PublicFetchResult = { response: Response; finalUrl: URL };

export class PublicFetchError extends Error {
  constructor(public readonly code: 'INVALID_URL' | 'UNAVAILABLE' | 'TIMEOUT' | 'CANCELLED' | 'REDIRECT_LIMIT' | 'TOO_LARGE') {
    super(code);
  }
}

/** Validates a source when it is saved; fetches validate it again at request time. */
export async function assertPublicUrl(url: URL): Promise<void> {
  if (url.username || url.password) throw new PublicFetchError('INVALID_URL');
  try {
    await assertUrlIsSafeToFetch(url, { opaqueErrors: true });
  } catch {
    throw new PublicFetchError('INVALID_URL');
  }
}

function fetchError(error: unknown, deadline: AbortSignal, signal?: AbortSignal): PublicFetchError {
  if (signal?.aborted) return new PublicFetchError('CANCELLED');
  if (deadline.aborted) return new PublicFetchError('TIMEOUT');
  if (!isGuardedFetchError(error)) return new PublicFetchError('UNAVAILABLE');
  switch (error.code) {
    case 'invalid_url':
    case 'protocol_not_allowed':
    case 'host_not_allowed':
    case 'hostname_unsafe':
    case 'redirect_invalid':
    case 'redirect_to_unsafe_host':
      return new PublicFetchError('INVALID_URL');
    case 'too_many_redirects':
      return new PublicFetchError('REDIRECT_LIMIT');
    case 'timeout':
      return new PublicFetchError('TIMEOUT');
    case 'response_too_large':
      return new PublicFetchError('TOO_LARGE');
    default:
      return new PublicFetchError('UNAVAILABLE');
  }
}

/** Keeps a byte limit on streaming media responses, which guardedFetch leaves unread. */
function boundedResponse(response: Response, maxBytes: number, deadline: AbortSignal, signal?: AbortSignal): Response {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) {
    void response.body?.cancel().catch(() => undefined);
    throw new PublicFetchError('TOO_LARGE');
  }
  if (!response.body) return response;

  const reader = response.body.getReader();
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let received = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const onAbort = () => { void reader.cancel().catch(() => undefined); };
      combined.addEventListener('abort', onAbort, { once: true });
      try {
        if (combined.aborted) throw new PublicFetchError(signal?.aborted ? 'CANCELLED' : 'TIMEOUT');
        const { done, value } = await reader.read();
        if (combined.aborted) throw new PublicFetchError(signal?.aborted ? 'CANCELLED' : 'TIMEOUT');
        if (done) {
          controller.close();
          return;
        }
        received += value.byteLength;
        if (received > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new PublicFetchError('TOO_LARGE');
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error instanceof PublicFetchError ? error : new PublicFetchError('UNAVAILABLE'));
      } finally {
        combined.removeEventListener('abort', onAbort);
      }
    },
    cancel() { return reader.cancel().catch(() => undefined); },
  });
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(stream, { status: response.status, statusText: response.statusText, headers });
}

/** Applies ReHLS limits and safe error codes around guarded-fetch. */
export function createPublicFetcher(fetchImpl?: typeof globalThis.fetch) {
  return async (url: URL, limits: FetchLimits, signal?: AbortSignal, headers?: HeadersInit): Promise<PublicFetchResult> => {
    if (!Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs <= 0 ||
        !Number.isSafeInteger(limits.maxBytes) || limits.maxBytes <= 0 || url.username || url.password) {
      throw new PublicFetchError('INVALID_URL');
    }
    const deadline = AbortSignal.timeout(limits.timeoutMs);
    let response: Response;
    try {
      response = await guardedFetch(url, {
        timeoutMs: limits.timeoutMs,
        maxRedirects: limits.maxRedirects ?? 4,
        opaqueErrors: true,
        signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        ...(headers ? { headers } : {}),
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      });
    } catch (error) {
      throw fetchError(error, deadline, signal);
    }
    let finalUrl: URL;
    try {
      finalUrl = new URL(response.url);
    } catch {
      await response.body?.cancel().catch(() => undefined);
      throw new PublicFetchError('UNAVAILABLE');
    }
    return { response: boundedResponse(response, limits.maxBytes, deadline, signal), finalUrl };
  };
}

export const fetchPublic = createPublicFetcher();
