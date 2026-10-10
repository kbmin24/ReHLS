import { createHash } from 'node:crypto';

import { parseM3U } from '@iptv/playlist';

export type ParsedChannel = {
  name: string;
  tvgId?: string;
  group?: string;
  url: string;
  matchKey: string;
};

export type ParseChannelsResult = {
  channels: ParsedChannel[];
  skipped: number;
};

/** Unique tvg-id entries survive URL changes; duplicates use their URL to stay distinct across reorders. */
export function parseChannels(text: string): ParseChannelsResult {
  if (Buffer.byteLength(text, 'utf8') > 16 * 1024 * 1024) {
    throw new Error('Playlist size limit exceeded');
  }
  const declaredEntries = text.match(/^#EXTINF:/gim)?.length ?? 0;
  if (declaredEntries > 20_000) throw new Error('Playlist entry limit exceeded');

  const channels: ParsedChannel[] = [];
  const occurrences = new Map<string, number>();
  const entries = parseM3U(text).channels;
  const tvgIdCounts = new Map<string, number>();
  for (const entry of entries) {
    const tvgId = entry.tvgId?.trim();
    if (tvgId) tvgIdCounts.set(tvgId, (tvgIdCounts.get(tvgId) ?? 0) + 1);
  }

  for (const entry of entries) {
    // filter sane values
    const name = (entry.name || entry.tvgName || '').trim();
    let url: URL;
    try {
      url = new URL(entry.url || '');
    } catch {
      continue;
    }
    if (!name || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue;

    // normalise values
    const tvgId = entry.tvgId?.trim() || undefined;
    const group = entry.groupTitle?.trim() || undefined;
    const identity = tvgId && tvgIdCounts.get(tvgId) === 1
      ? JSON.stringify(['tvg-id', tvgId])
      : JSON.stringify([name, tvgId, group, url.href]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    const matchKey = createHash('sha256').update(identity).update(`:${occurrence}`).digest('hex');
    channels.push({ name, tvgId, group, url: url.href, matchKey });
  }

  return { channels, skipped: Math.max(0, declaredEntries - channels.length) };
}
