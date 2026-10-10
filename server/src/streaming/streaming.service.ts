import type { FetchLimits, PublicFetchResult } from '../upstream/public-fetch.js';
import { fetchPublic, PublicFetchError } from '../upstream/public-fetch.js';
import { AppError } from '../utils/errors/errors.js';
import { streaming } from '../utils/errors/errorCodes.js';
import { ResourceRegistry, type RegisteredResource } from './streaming.registry.js';
import { InvalidHlsError, rewriteManifest, UnsupportedHlsError } from './streaming.rewrite.js';

type OwnedChannels = { getOwned(ownerId: string, channelId: string): Promise<{ streamUrl: string }> };
type Fetcher = (url: URL, limits: FetchLimits, signal?: AbortSignal, headers?: HeadersInit) => Promise<PublicFetchResult>;

const manifestLimits = { timeoutMs: 10_000, maxBytes: 1024 * 1024 };
const resourceLimits = { timeoutMs: 20_000, maxBytes: 32 * 1024 * 1024 };

function checkedRangeHeader(value: string): { start: number; end?: number } {
  const match = /^bytes=(0|[1-9]\d*)-(0|[1-9]\d*)?$/.exec(value);
  const start = Number(match?.[1]);
  const end = match?.[2] === undefined ? undefined : Number(match[2]);
  if (!match || !Number.isSafeInteger(start) || (end !== undefined &&
      (!Number.isSafeInteger(end) || end < start || end - start + 1 > resourceLimits.maxBytes))) {
    throw new AppError(416, streaming.INVALID_RANGE);
  }
  return { start, ...(end === undefined ? {} : { end }) };
}

/** Resolves only owned channels and opaque resource tokens; all upstream requests use the guarded fetch path. */
export class StreamingService {
  constructor(
    private readonly channels: OwnedChannels,
    private readonly registry: ResourceRegistry,
    private readonly fetcher: Fetcher = fetchPublic,
  ) {}

  async getManifest(ownerId: string, channelId: string, signal: AbortSignal): Promise<Response> {
    const channel = await this.channels.getOwned(ownerId, channelId);
    let url: URL;
    try { url = new URL(channel.streamUrl); } catch { throw new AppError(502, streaming.UNAVAILABLE); }
    return this.fetchManifest(ownerId, channelId, url, signal);
  }

  async getResource(ownerId: string, token: string, signal: AbortSignal, requestedRange?: string): Promise<Response> {
    const resource = this.registry.lookupResource(token, ownerId);
    if (!resource) throw new AppError(410, streaming.EXPIRED);
    await this.channels.getOwned(ownerId, resource.channelId);
    if (resource.kind === 'manifest') return this.fetchManifest(ownerId, resource.channelId, resource.url, signal);
    return this.fetchResource(resource, signal, requestedRange);
  }

  private async fetchManifest(ownerId: string, channelId: string, url: URL, signal: AbortSignal): Promise<Response> {
    try {
      const { response, finalUrl } = await this.fetcher(url, manifestLimits, signal);
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError(502, streaming.UNAVAILABLE);
      }
      const text = await response.text();
      const rewritten = rewriteManifest(text, finalUrl, (childUrl, kind, range) => {
        const token = this.registry.registerResource(ownerId, channelId, childUrl, kind, range);
        return `/api/media/resources/${token}`;
      });
      return new Response(rewritten, { headers: { 'content-type': 'application/vnd.apple.mpegurl' } });
    } catch (error) { throw this.mediaError(error); }
  }

  private async fetchResource(resource: RegisteredResource, signal: AbortSignal, requestedRange?: string): Promise<Response> {
    try {
      const range = resource.range;
      const rangeHeader = range ? `bytes=${range.offset}-${range.offset + range.length - 1}` : requestedRange;
      const expected = rangeHeader ? checkedRangeHeader(rangeHeader) : undefined;
      if (range && requestedRange && requestedRange !== rangeHeader) throw new AppError(416, streaming.INVALID_RANGE);
      const limits = expected?.end === undefined ? resourceLimits
        : { ...resourceLimits, maxBytes: expected.end - expected.start + 1 };
      const { response } = await this.fetcher(resource.url, limits, signal,
        rangeHeader ? { range: rangeHeader } : undefined);
      const contentRange = response.headers.get('content-range');
      const expectedPrefix = expected && (expected.end === undefined
        ? `bytes ${expected.start}-` : `bytes ${expected.start}-${expected.end}/`);
      if (!response.ok || (expected && (response.status !== 206 ||
          !contentRange?.startsWith(expectedPrefix!)))) {
        await response.body?.cancel();
        throw new AppError(502, streaming.UNAVAILABLE);
      }
      return response;
    } catch (error) { throw this.mediaError(error); }
  }

  private mediaError(error: unknown): AppError {
    if (error instanceof AppError) return error;
    if (error instanceof UnsupportedHlsError) return new AppError(422, streaming.UNSUPPORTED);
    if (error instanceof InvalidHlsError) return new AppError(422, streaming.INVALID);
    if (error instanceof PublicFetchError && error.code === 'TOO_LARGE') return new AppError(413, streaming.TOO_LARGE);
    return new AppError(502, streaming.UNAVAILABLE);
  }
}
