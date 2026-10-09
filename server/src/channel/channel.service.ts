import { NotFoundError } from '../utils/errors/errors.js';
import { ChannelRepository } from './channel.repository.js';

export class ChannelService {
  constructor(private readonly channels: ChannelRepository) {}

  async listOwned(ownerId: string) {
    const rows = await this.channels.listOwned(ownerId);
    return rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      name: row.name,
      tvgId: row.tvg_id,
      group: row.group_title,
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
      streamUrl: row.stream_url,
    };
  }

}
