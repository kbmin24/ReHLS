import { assertPublicUrl, fetchPublic, PublicFetchError, type PublicFetchResult, type FetchLimits } from '../upstream/public-fetch.js';
import { AppError, NotFoundError } from '../utils/errors/errors.js';
import { app, playlist } from '../utils/errors/errorCodes.js';
import { parseChannels } from './playlist.parse.js';
import { PlaylistRepository } from './playlist.repository.js';

type Fetcher = (url: URL, limits: FetchLimits, signal?: AbortSignal) => Promise<PublicFetchResult>;

export class PlaylistService {
  constructor(
    private readonly sources: PlaylistRepository,
    private readonly fetcher: Fetcher = fetchPublic,
  ) {}

  async addSource(ownerId: string, value: string, refreshInterval: number | null) {
    if (refreshInterval !== null && (!Number.isSafeInteger(refreshInterval) || refreshInterval <= 0)) {
      throw new AppError(400, playlist.INVALID_SOURCE);
    }
    let url: URL;
    try {
      url = new URL(value);
      await assertPublicUrl(url);
    } catch {
      throw new AppError(400, playlist.INVALID_SOURCE);
    }
    return this.sources.createSource(ownerId, url.href, refreshInterval);
  }

  async listSources(ownerId: string) {
    return this.sources.listOwned(ownerId);
  }

  async removeSource(ownerId: string, sourceId: string) {
    if (!await this.sources.removeOwned(ownerId, sourceId)) throw new NotFoundError();
  }

  /** Fetches before opening the transaction; failed imports leave the previous channels usable. */
  async refreshSource(ownerId: string, sourceId: string) {
    const sourceUrl = await this.sources.findOwnedUrl(ownerId, sourceId);
    if (!sourceUrl) throw new NotFoundError();

    try {
      const { response } = await this.fetcher(new URL(sourceUrl), { timeoutMs: 15_000, maxBytes: 16 * 1024 * 1024 });
      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        throw new PublicFetchError('UNAVAILABLE');
      }
      const parsed = parseChannels(await response.text());
      if (parsed.channels.length === 0) throw new AppError(422, playlist.EMPTY_PLAYLIST);

      return this.sources.replaceSnapshot(ownerId, sourceId, parsed.channels);
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      const failure = this.failureFor(error);
      await this.sources.markFailure(ownerId, sourceId, failure.code.cause, new Date());
      throw failure;
    }
  }

  private failureFor(error: unknown): AppError {
    if (error instanceof AppError) return error;
    if (error instanceof PublicFetchError) {
      if (error.code === 'TOO_LARGE') return new AppError(413, playlist.TOO_LARGE);
      if (error.code === 'INVALID_URL') return new AppError(400, playlist.INVALID_SOURCE);
      return new AppError(502, playlist.FETCH_FAILED);
    }
    if (error instanceof Error && (error.message === 'Playlist size limit exceeded' ||
        error.message === 'Playlist entry limit exceeded')) {
      return new AppError(413, playlist.TOO_LARGE);
    }
    return new AppError(500, app.INTERNAL_ERROR);
  }
}
