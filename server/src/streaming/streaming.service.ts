import type { ChannelService } from '../channel/channel.service.js';
import type { ResourceRegistry } from './streaming.registry.js';

/** Media operations must recheck account and channel ownership before each upstream fetch. */
export abstract class StreamingService {
  protected constructor(
    protected readonly channels: Pick<ChannelService, 'getOwned'>,
    protected readonly registry: ResourceRegistry,
  ) {}

  abstract getManifest(ownerId: string, channelId: string, signal: AbortSignal): Promise<Response>;
  abstract getResource(ownerId: string, token: string, signal: AbortSignal): Promise<Response>;
}
