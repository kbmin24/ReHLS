import { randomBytes } from 'node:crypto';

import type { ByteRange, ResourceKind } from './streaming.rewrite.js';

export type RegisteredResource = {
  ownerId: string;
  channelId: string;
  url: URL;
  kind: ResourceKind;
  range?: ByteRange;
};

type Entry = RegisteredResource & { expiresAt: number };

export class ResourceRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(private readonly options: { maxEntries: number; ttlMs: number; now?: () => number }) {
    if (!Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1 ||
        !Number.isSafeInteger(options.ttlMs) || options.ttlMs < 1) {
      throw new RangeError('Invalid registry limits');
    }
    this.now = options.now ?? Date.now;
  }

  registerResource(ownerId: string, channelId: string, url: URL, kind: ResourceKind, range?: ByteRange): string {
    this.removeExpired();
    while (this.entries.size >= this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    const token = randomBytes(24).toString('base64url');
    this.entries.set(token, {
      ownerId, channelId, url: new URL(url), kind,
      ...(range ? { range: { ...range } } : {}),
      expiresAt: this.now() + this.options.ttlMs,
    });
    return token;
  }

  lookupResource(token: string, ownerId: string): RegisteredResource | undefined {
    const entry = this.entries.get(token);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(token);
      return undefined;
    }
    if (entry.ownerId !== ownerId) return undefined;
    const { expiresAt: _expiresAt, ...resource } = entry;
    return { ...resource, url: new URL(resource.url), ...(resource.range ? { range: { ...resource.range } } : {}) };
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(token);
    }
  }
}
