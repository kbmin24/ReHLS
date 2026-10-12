import { fetchPublic, type FetchLimits, type PublicFetchResult } from '../upstream/public-fetch.js';
import { channel as channelErrors } from '../utils/errors/errorCodes.js';
import { AppError, NotFoundError } from '../utils/errors/errors.js';
import { ChannelRepository } from './channel.repository.js';

type LogoFetcher = (url: URL, limits: FetchLimits, signal?: AbortSignal) => Promise<PublicFetchResult>;
const logoTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const maxLogoBytes = 1024 * 1024;

export class ChannelService {
  constructor(private readonly channels: ChannelRepository, private readonly fetchLogo: LogoFetcher = fetchPublic) {}

  async listOwned(ownerId: string) {
    const rows = await this.channels.listOwned(ownerId);
    return rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      name: row.name,
      tvgId: row.tvg_id,
      group: row.group_title,
      hasLogo: row.logo_url !== null,
    }));
  }

  async getOwned(ownerId: string, channelId: string) {
    const row = await this.channels.getOwned(ownerId, channelId);
    if (!row) throw new NotFoundError();
    return {
      id: row.id,
      sourceId: row.source_id,
      name: row.name,
      tvgId: row.tvg_id,
      group: row.group_title,
      logoUrl: row.logo_url,
      streamUrl: row.stream_url,
    };
  }

  async getLogo(ownerId: string, channelId: string, signal?: AbortSignal) {
    const channel = await this.getOwned(ownerId, channelId);
    if (!channel.logoUrl) throw new NotFoundError();
    try {
      const { response } = await this.fetchLogo(new URL(channel.logoUrl),
        { timeoutMs: 5000, maxBytes: maxLogoBytes }, signal);
      const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
      if (response.status !== 200 || !contentType || !logoTypes.has(contentType)) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error('INVALID_LOGO_RESPONSE');
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maxLogoBytes) throw new Error('LOGO_TOO_LARGE');
      return { contentType, bytes };
    } catch {
      throw new AppError(502, channelErrors.LOGO_UNAVAILABLE);
    }
  }
}
