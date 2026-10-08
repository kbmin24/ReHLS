import { randomUUID } from 'node:crypto';

import type { ImportedChannel } from './import.js';
import type { ResourceKind } from './hls.js';

export type ListedChannel = {
  id: string;
  name: string;
  tvgId?: string;
};

export type HlsResource = {
  channelId: string;
  url: URL;
  kind: ResourceKind;
};

type StoredResource = HlsResource & {
  key: string;
  expiresAt: number;
};

const RESOURCE_TTL_MS = 10 * 60 * 1_000;
const MAX_RESOURCES = 20_000;

export class MemoryState {
  private channels = new Map<string, ImportedChannel>();
  private resources = new Map<string, StoredResource>();
  private resourceIds = new Map<string, string>();

  replaceChannels(channels: ImportedChannel[]): void {
    this.channels = new Map(channels.map((channel) => [randomUUID(), channel]));
    this.resources.clear();
    this.resourceIds.clear();
  }

  listChannels(): ListedChannel[] {
    return [...this.channels].map(([id, { name, tvgId }]) => ({ id, name, tvgId }));
  }

  getChannel(id: string): ImportedChannel | undefined {
    return this.channels.get(id);
  }

  registerResource(channelId: string, url: URL, kind: ResourceKind): string {
    if (!this.channels.has(channelId)) throw new Error('Unknown channel');
    const key = JSON.stringify([channelId, url.href, kind]);
    const existingId = this.resourceIds.get(key);
    if (existingId && this.getResource(existingId)) return '/api/media/' + existingId;

    if (this.resources.size >= MAX_RESOURCES) {
      const oldestId = this.resources.keys().next().value;
      if (oldestId) this.deleteResource(oldestId);
    }

    const id = randomUUID();
    this.resources.set(id, { channelId, url, kind, key, expiresAt: Date.now() + RESOURCE_TTL_MS });
    this.resourceIds.set(key, id);
    return '/api/media/' + id;
  }

  getResource(id: string): HlsResource | undefined {
    const resource = this.resources.get(id);
    if (!resource) return undefined;
    if (resource.expiresAt <= Date.now()) {
      this.deleteResource(id);
      return undefined;
    }
    return resource;
  }

  private deleteResource(id: string): void {
    const resource = this.resources.get(id);
    if (!resource) return;
    this.resources.delete(id);
    this.resourceIds.delete(resource.key);
  }
}
