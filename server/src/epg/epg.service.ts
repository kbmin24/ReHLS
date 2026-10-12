import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

import type { ChannelService } from '../channel/channel.service.js';
import { assertPublicUrl, fetchPublic, PublicFetchError, type FetchLimits, type PublicFetchResult } from '../upstream/public-fetch.js';
import { AppError, NotFoundError } from '../utils/errors/errors.js';
import { epg, validation } from '../utils/errors/errorCodes.js';
import { defaultSourceName } from '../utils/source-name.js';
import { EPGRepository } from './epg.repository.js';
import { parseGuideDocument, XMLTV_LIMITS, XmltvParseError } from './xmltv.parse.js';

type Fetcher = (url: URL, limits: FetchLimits, signal?: AbortSignal) => Promise<PublicFetchResult>;
const EPG_FETCH_TIMEOUT_MS = 300_000;
const HALF_HOUR_MS = 30 * 60_000;
export type EpgRefreshProgress = {
  sourceId: string;
  stage: string;
  elapsedMs: number;
  [key: string]: string | number | boolean | null;
};
type ReportProgress = (event: EpgRefreshProgress) => void;

function matchStages(tvgId: string) {
  const separator = tvgId.indexOf('@');
  const candidates = separator > 0 ? [tvgId, tvgId.slice(0, separator)] : [tvgId];
  return (['exact', 'case', 'normalized'] as const)
    .flatMap((mode) => candidates.map((candidate) => ({ mode, candidate })));
}

async function readCompressedBody(response: Response, onChunk: (bytes: number) => void): Promise<Buffer> {
  if (!response.body) throw new XmltvParseError('PARSE_FAILED');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > XMLTV_LIMITS.maxCompressedBytes) throw new XmltvParseError('TOO_LARGE', 'DOWNLOAD_BYTES');
    chunks.push(bytes);
    onChunk(size);
  }
  return Buffer.concat(chunks);
}

async function expandGuide(input: Buffer, onProgress: (bytes: number) => void): Promise<string> {
  const gzip = input[0] === 0x1f && input[1] === 0x8b;
  const stream = gzip ? Readable.from(input).pipe(createGunzip()) : Readable.from(input);
  const chunks: Buffer[] = [];
  let size = 0;
  let nextReport = 128 * 1024 * 1024;
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > XMLTV_LIMITS.maxExpandedBytes) {
      stream.destroy();
      throw new XmltvParseError('TOO_LARGE', 'EXPANDED_BYTES');
    }
    chunks.push(bytes);
    if (size >= nextReport) {
      onProgress(size);
      nextReport = (Math.floor(size / (128 * 1024 * 1024)) + 1) * 128 * 1024 * 1024;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class EPGService {
  constructor(
    private readonly sources: EPGRepository,
    private readonly channels: ChannelService,
    private readonly fetcher: Fetcher = fetchPublic,
    private readonly reportProgress: ReportProgress = () => undefined,
  ) {}

  async addSource(ownerId: string, value: string, refreshInterval: number | null, requestedName?: string | null) {
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
    if (requestedName != null && typeof requestedName !== 'string') {
      throw new AppError(400, validation.INVALID_INPUT);
    }
    const name = requestedName?.trim() ?? '';
    if (name.length > 255) throw new AppError(400, validation.INVALID_INPUT);
    return this.sources.createSource(ownerId, url.href, refreshInterval, name || defaultSourceName(url));
  }

  listSources(ownerId: string)
  {
    return this.sources.listOwned(ownerId);
  }
  requestRefresh(ownerId: string, sourceId: string) {
    return this.sources.requestRefresh(ownerId, sourceId);
  }
  removeSource(ownerId: string, sourceId: string) {
    return this.sources.removeOwned(ownerId, sourceId);
  }
  listGuideChannels(ownerId: string) {
    return this.sources.listGuideChannels(ownerId);
  }

  /** Returns a manual match first, then the first unique owned ID match by decreasing specificity. */
  async resolveGuideChannel(ownerId: string, channelId: string) {
    const channel = await this.channels.getOwned(ownerId, channelId);
    const manual = await this.sources.findManualMatch(ownerId, channelId);
    if (manual) return { channel: manual, provenance: 'manual' as const };
    if (!channel.tvgId) return null;
    for (const { mode, candidate } of matchStages(channel.tvgId)) {
      const matches = await this.sources.findAutomaticMatches(ownerId, candidate, mode);
      if (matches.length > 1) return null;
      if (matches.length === 1) return {
        channel: matches[0]!, provenance: 'automatic' as const
      };
    }
    return null;
  }

  async getChannelGuide(ownerId: string, channelId: string) {
    const match = await this.resolveGuideChannel(ownerId, channelId);
    const programs = match ? await this.sources.programsFor(match.channel.id, new Date()) :
      { current: null, upcoming: [] };
    return { match, ...programs };
  }

  /** Resolves a bounded set of owned playlist channels and their overlapping programs in bulk. */
  async getProgramGrid(ownerId: string, requestedIds: string[]) {
    const channelIds = [...new Set(requestedIds)];
    if (channelIds.length === 0 || channelIds.length > 500) throw new AppError(400, validation.INVALID_INPUT);
    const owned = new Map((await this.channels.listOwned(ownerId)).map((channel) => [channel.id, channel]));
    const channels = channelIds.map((id) => {
      const channel = owned.get(id);
      if (!channel) throw new NotFoundError();
      return channel;
    });
    const startsAt = new Date(Math.floor(Date.now() / HALF_HOUR_MS) * HALF_HOUR_MS);
    const endsAt = new Date(startsAt.getTime() + 24 * 60 * 60 * 1000);
    const [guideChannels, manualMatches] = await Promise.all([
      this.sources.listGuideChannels(ownerId),
      this.sources.findManualMatches(ownerId, channelIds),
    ]);
    const manual = new Map(manualMatches.map((row) => [row.channel_id, row.id]));
    const lookup = new Map<string, string[]>();
    for (const guideChannel of guideChannels) {
      for (const [mode, key] of [
        ['exact', guideChannel.xmltvId],
        ['case', guideChannel.xmltvId.toLowerCase()],
        ['normalized', guideChannel.xmltvId.toLowerCase().replace(/[^a-z0-9]/g, '')],
      ]) {
        if (!key) continue;
        const lookupKey = mode + ':' + key;
        const matches = lookup.get(lookupKey) ?? [];
        matches.push(guideChannel.id);
        lookup.set(lookupKey, matches);
      }
    }
    const matched = new Map<string, string>();
    for (const channel of channels) {
      const manualId = manual.get(channel.id);
      if (manualId) { matched.set(channel.id, manualId); continue; }
      if (!channel.tvgId) continue;
      for (const { mode, candidate } of matchStages(channel.tvgId)) {
        const key = mode === 'exact' ? candidate : mode === 'case' ? candidate.toLowerCase()
          : candidate.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!key) continue;
        const matches = lookup.get(mode + ':' + key) ?? [];
        if (matches.length > 1) break;
        if (matches.length === 1) { matched.set(channel.id, matches[0]!); break; }
      }
    }
    const programs = await this.sources.programsOverlapping(ownerId, [...new Set(matched.values())], startsAt, endsAt);
    const byGuide = new Map<string, { title: string; startsAt: Date; endsAt: Date }[]>();
    for (const program of programs) {
      const list = byGuide.get(program.channel_id) ?? [];
      list.push({ title: program.title, startsAt: program.starts_at, endsAt: program.ends_at });
      byGuide.set(program.channel_id, list);
    }
    return { startsAt, endsAt, rows: channelIds.map((channelId) => ({
      channelId, programs: byGuide.get(matched.get(channelId) ?? '') ?? [],
    })) };
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
    const started = Date.now();
    let stage = 'fetch';
    let downloadedBytes = 0;
    const report = (nextStage: string, details: Record<string, string | number | boolean | null> = {}) => {
      stage = nextStage;
      try {
        this.reportProgress({ sourceId, stage, elapsedMs: Date.now() - started, ...details });
      } catch {
        // Diagnostics must not change refresh results.
      }
    };
    try {
      report('fetch', { timeoutMs: EPG_FETCH_TIMEOUT_MS, maxBytes: XMLTV_LIMITS.maxCompressedBytes });
      const { response } = await this.fetcher(new URL(sourceUrl), {
        timeoutMs: EPG_FETCH_TIMEOUT_MS, maxBytes: XMLTV_LIMITS.maxCompressedBytes,
      });
      report('response', { status: response.status });
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw new PublicFetchError('UNAVAILABLE');
      }
      report('download_start');
      let lastByteAt = Date.now();
      let nextReport = 4 * 1024 * 1024;
      const heartbeat = setInterval(() => {
        report('download_progress', { bytes: downloadedBytes, idleMs: Date.now() - lastByteAt });
      }, 10_000);
      heartbeat.unref();
      let compressed: Buffer;
      try {
        compressed = await readCompressedBody(response, (bytes) => {
          const firstChunk = downloadedBytes === 0;
          downloadedBytes = bytes;
          lastByteAt = Date.now();
          if (firstChunk || bytes >= nextReport) {
            report('download_progress', { bytes, idleMs: 0 });
            nextReport = (Math.floor(bytes / (4 * 1024 * 1024)) + 1) * 4 * 1024 * 1024;
          }
        });
      } finally {
        clearInterval(heartbeat);
      }
      report('download', { bytes: compressed.byteLength });
      const gzip = compressed[0] === 0x1f && compressed[1] === 0x8b;
      report('expand_start', { gzip });
      const xml = await expandGuide(compressed, (bytes) => report('expand_progress', { bytes }));
      report('expand', { bytes: Buffer.byteLength(xml, 'utf8') });
      const now = Date.now();
      report('parse', { maxChannels: XMLTV_LIMITS.maxChannels, maxPrograms: XMLTV_LIMITS.maxPrograms });
      const snapshot = parseGuideDocument(xml, XMLTV_LIMITS, {
        startsAt: new Date(now - 12 * 60 * 60 * 1000),
        endsAt: new Date(now + 7 * 24 * 60 * 60 * 1000),
      }, (channels, programs) => report('parsed_counts', { channels, programs }));
      report('parsed', { channels: snapshot.channels.length, programs: snapshot.programs.length });
      report('save');
      await this.sources.replaceSnapshot(ownerId, sourceId, snapshot);
      report('complete');
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      const failure = this.failureFor(error);
      report('failed', {
        atStage: stage,
        failureCode: failure.code.cause,
        originalType: error instanceof PublicFetchError ? 'PublicFetchError'
          : error instanceof XmltvParseError ? 'XmltvParseError' : 'UnexpectedError',
        originalCode: error instanceof PublicFetchError || error instanceof XmltvParseError ? error.code : null,
        reason: error instanceof XmltvParseError ? error.reason ?? null : null,
        downloadedBytes,
      });
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
