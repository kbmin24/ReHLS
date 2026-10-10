import { randomBytes } from 'node:crypto';

import type { ByteRange, ResourceKind } from './streaming.rewrite.js';

export type RegisteredResource = {
  ownerId: string;
  channelId: string;
  url: URL;
  kind: ResourceKind;
  range?: ByteRange;
};

type Entry = RegisteredResource & { expiresAt: number; key: string };

export class ResourceRegistry {
  private readonly entries = new Map<string, Entry>();
  private readonly tokensByResource = new Map<string, string>();
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

    // If we are registering a resource that is already registered, return the existing token and refresh its expiration.
    const key = JSON.stringify([ownerId, channelId, kind, url.href, range?.offset ?? null, range?.length ?? null]);
    const existingToken = this.tokensByResource.get(key);
    if (existingToken) {
      const existing = this.entries.get(existingToken);
      if (existing) {
        this.refreshEntry(existingToken, existing);
        return existingToken;
      }
      this.tokensByResource.delete(key);
    }
    while (this.entries.size >= this.options.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.deleteEntry(oldest);
    }
    const token = randomBytes(24).toString('base64url');
    this.entries.set(token, {
      ownerId,
      channelId,
      url: new URL(url),
      kind,
      key,
      ...(range ? { range: { ...range } } : {}),
      expiresAt: this.now() + this.options.ttlMs,
    });
    this.tokensByResource.set(key, token);
    return token;
  }

  lookupResource(token: string, ownerId: string): RegisteredResource | undefined {
    const entry = this.entries.get(token);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.deleteEntry(token);
      return undefined;
    }
    if (entry.ownerId !== ownerId) return undefined;
    if (entry.kind === 'manifest') this.refreshEntry(token, entry);
    const { expiresAt: _expiresAt, key: _key, ...resource } = entry;
    return { ...resource, url: new URL(resource.url), ...(resource.range ? { range: { ...resource.range } } : {}) };
  }

  private refreshEntry(token: string, entry: Entry): void {
    entry.expiresAt = this.now() + this.options.ttlMs;
    this.entries.delete(token);
    this.entries.set(token, entry);
  }

  private deleteEntry(token: string): void {
    const entry = this.entries.get(token);
    if (!entry) return;
    this.entries.delete(token);
    if (this.tokensByResource.get(entry.key) === token) this.tokensByResource.delete(entry.key);
  }

  private removeExpired(): void {
    const now = this.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) this.deleteEntry(token);
    }
  }
}
