import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

import { fetchPublic, PublicFetchError, type FetchLimits, type PublicFetchResult } from '../upstream/public-fetch.js';
import { AppError, NotFoundError } from '../utils/errors/errors.js';
import { epg } from '../utils/errors/errorCodes.js';
import { EPGRepository } from './epg.repository.js';
import { parseGuideDocument, XMLTV_LIMITS, XmltvParseError } from './xmltv.parse.js';

type Fetcher = (url: URL, limits: FetchLimits, signal?: AbortSignal) => Promise<PublicFetchResult>;

async function readGuide(response: Response): Promise<string> {
  if (!response.body) throw new XmltvParseError('PARSE_FAILED');
  const compressedChunks: Buffer[] = [];
  let compressedSize = 0;
  for await (const chunk of Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    compressedSize += bytes.byteLength;
    if (compressedSize > XMLTV_LIMITS.maxCompressedBytes) throw new XmltvParseError('TOO_LARGE');
    compressedChunks.push(bytes);
  }
  const input = Buffer.concat(compressedChunks);
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

export class EPGService {
  constructor(private readonly sources: EPGRepository, private readonly fetcher: Fetcher = fetchPublic) {}

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
