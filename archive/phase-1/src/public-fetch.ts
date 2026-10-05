import { promises as dns } from 'node:dns';
import type { LookupAddress } from 'node:dns';
import type { LookupFunction } from 'node:net';

import ipaddr from 'ipaddr.js';
import { Agent, fetch, type Response } from 'undici';

export type UpstreamClient = {
  get(url: URL, signal?: AbortSignal): Promise<{ response: Response; finalUrl: URL }>;
};

type Request = (url: URL, signal: AbortSignal) => Promise<Response>;

type ClientOptions = {
  request?: Request;
  timeoutMs?: number;
};

export function isPublicAddress(address: string): boolean {
  try {
    return ipaddr.process(address).range() === 'unicast';
  } catch {
    return false;
  }
}

export function createPublicLookup(
  resolve: (hostname: string) => Promise<LookupAddress[]> = (hostname) => dns.lookup(hostname, { all: true }),
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        const allowed = addresses.filter(({ address, family }) =>
          isPublicAddress(address) && (!options.family || options.family === family),
        );
        if (allowed.length === 0) {
          callback(new Error('No public upstream address') as NodeJS.ErrnoException, '');
        } else if (options.all) {
          callback(null, allowed);
        } else {
          callback(null, allowed[0]!.address, allowed[0]!.family);
        }
      },
      () => callback(new Error('Upstream DNS lookup failed') as NodeJS.ErrnoException, ''),
    );
  };
}

function assertPublicUrl(url: URL): void {
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new Error('Only public HTTP(S) URLs are supported');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Only public HTTP(S) URLs are supported');
  }
  if (ipaddr.isValid(hostname) && !isPublicAddress(hostname)) {
    throw new Error('Only public HTTP(S) URLs are supported');
  }
}

const dispatcher = new Agent({ connect: { lookup: createPublicLookup() } });

async function requestUpstream(url: URL, signal: AbortSignal): Promise<Response> {
  return fetch(url, { dispatcher, redirect: 'manual', signal });
}

export function createPublicClient(options: ClientOptions = {}): UpstreamClient {
  const request = options.request ?? requestUpstream;
  const timeoutMs = options.timeoutMs ?? 10_000;

  return {
    async get(url, signal) {
      let current = new URL(url);
      const deadline = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;

      for (let redirects = 0; ; redirects++) {
        assertPublicUrl(current);
        let response: Response;
        try {
          response = await request(current, combined);
        } catch {
          if (deadline.aborted) throw new Error('Upstream request timed out');
          if (signal?.aborted) throw new Error('Upstream request cancelled');
          throw new Error('Upstream request failed');
        }

        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          if (!location) return { response, finalUrl: current };
          try {
            await response.body?.cancel();
          } catch {
            throw new Error('Upstream request failed');
          }
          if (redirects >= 4) throw new Error('Upstream redirect limit exceeded');
          try {
            current = new URL(location, current);
          } catch {
            throw new Error('Invalid upstream redirect');
          }
          continue;
        }

        return { response, finalUrl: current };
      }
    },
  };
}
