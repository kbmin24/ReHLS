import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

import type { ChannelService } from '../channel/channel.service.js';
import { assertPublicUrl, fetchPublic, PublicFetchError, type FetchLimits, type PublicFetchResult } from '../upstream/public-fetch.js';
import { AppError, NotFoundError } from '../utils/errors/errors.js';
import { epg } from '../utils/errors/errorCodes.js';
import { EPGRepository } from './epg.repository.js';
import { parseGuideDocument, XMLTV_LIMITS, XmltvParseError } from './xmltv.parse.js';

type Fetcher = (url: URL, limits: FetchLimits, signal?: AbortSignal) => Promise<PublicFetchResult>;

async function readCompressedBody(response: Response): Promise<Buffer> {
  if (!response.body) throw new XmltvParseError('PARSE_FAILED');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > XMLTV_LIMITS.maxCompressedBytes) throw new XmltvParseError('TOO_LARGE');
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

async function expandGuide(input: Buffer): Promise<string> {
  const gzip = input[0] === 0x1f && input[1] === 0x8b;
  const stream = gzip ? Readable.from(input).pipe(createGunzip()) : Readable.from(input);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > XMLTV_LIMITS.maxExpandedBytes) {
      stream.destroy();
      throw new XmltvParseError('TOO_LARGE');
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readGuide(response: Response): Promise<string> {
  const compressedBody = await readCompressedBody(response);
  return expandGuide(compressedBody);
}

export class EPGService {
  constructor(
    private readonly sources: EPGRepository,
    private readonly channels: ChannelService,
    private readonly fetcher: Fetcher = fetchPublic,
  ) {}

  async addSource(ownerId: string, value: string, refreshInterval: number | null) {
    if (refreshInterval !== null && (!Number.isSafeInteger(refreshInterval) || refreshInterval < 60 || refreshInterval > 2_592_000)) {
      throw new AppError(400, epg.INVALID_SOURCE);
    }
    let url: URL;
    try {
      url = new URL(value);
      await assertPublicUrl(url);
    } catch {
      throw new AppError(400, epg.INVALID_SOURCE);
    }
    return this.sources.createSource(ownerId, url.href, refreshInterval);
  }

  listSources(ownerId: string) { return this.sources.listOwned(ownerId); }
  requestRefresh(ownerId: string, sourceId: string) { return this.sources.requestRefresh(ownerId, sourceId); }
  removeSource(ownerId: string, sourceId: string) { return this.sources.removeOwned(ownerId, sourceId); }
  listGuideChannels(ownerId: string) { return this.sources.listGuideChannels(ownerId); }

  /** Returns a manual match first, then a unique owned tvg-id match. */
  async resolveGuideChannel(ownerId: string, channelId: string) {
    const channel = await this.channels.getOwned(ownerId, channelId);
    const manual = await this.sources.findManualMatch(ownerId, channelId);
    if (manual) return { channel: manual, provenance: 'manual' as const };
    if (!channel.tvgId) return null;
    const matches = await this.sources.findAutomaticMatches(ownerId, channel.tvgId);
    return matches.length === 1 ? { channel: matches[0]!, provenance: 'automatic' as const } : null;
  }

  async getChannelGuide(ownerId: string, channelId: string) {
    const match = await this.resolveGuideChannel(ownerId, channelId);
    const programs = match ? await this.sources.programsFor(match.channel.id, new Date()) :
      { current: null, upcoming: [] };
    return { match, ...programs };
  }

  async setOverride(ownerId: string, channelId: string, xmltvChannelId: string) {
    await this.channels.getOwned(ownerId, channelId);
    if (!await this.sources.findGuideChannel(ownerId, xmltvChannelId)) throw new NotFoundError();
    await this.sources.setOverride(channelId, xmltvChannelId);
    return this.getChannelGuide(ownerId, channelId);
  }

  async clearOverride(ownerId: string, channelId: string) {
    await this.channels.getOwned(ownerId, channelId);
    await this.sources.clearOverride(channelId);
    return this.getChannelGuide(ownerId, channelId);
  }

  /** Fetches and parses before replacing the last good owned snapshot. */
  async refreshSource(ownerId: string, sourceId: string): Promise<void> {
    const sourceUrl = await this.sources.findOwnedUrl(ownerId, sourceId);
    if (!sourceUrl) throw new NotFoundError();
    try {
      const { response } = await this.fetcher(new URL(sourceUrl), {
        timeoutMs: 30_000, maxBytes: XMLTV_LIMITS.maxCompressedBytes,
      });
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw new PublicFetchError('UNAVAILABLE');
      }
      const now = Date.now();
      const snapshot = parseGuideDocument(await readGuide(response), XMLTV_LIMITS, {
        startsAt: new Date(now - 12 * 60 * 60 * 1000),
        endsAt: new Date(now + 7 * 24 * 60 * 60 * 1000),
      });
      await this.sources.replaceSnapshot(ownerId, sourceId, snapshot);
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      const failure = this.failureFor(error);
      await this.sources.markFailure(ownerId, sourceId, failure.code.cause, new Date());
      throw failure;
    }
  }

  private failureFor(error: unknown): AppError {
    if (error instanceof XmltvParseError) {
      return new AppError(error.code === 'TOO_LARGE' ? 413 : 422, epg[error.code]);
    }
    if (error instanceof PublicFetchError) {
      if (error.code === 'TOO_LARGE') return new AppError(413, epg.TOO_LARGE);
      if (error.code === 'INVALID_URL') return new AppError(400, epg.INVALID_SOURCE);
    }
    return new AppError(502, epg.FETCH_FAILED);
  }
}
