export type ImportedChannel = {
  name: string;
  tvgId?: string;
  url: URL;
};

export type ParseChannelsResult = {
  channels: ImportedChannel[];
  skipped: number;
};

export function isPublicHttpUrl(url: URL): boolean {
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return ['http:', 'https:'].includes(url.protocol)
    && !url.username && !url.password
    && hostname !== 'localhost' && !hostname.endsWith('.localhost')
    && (!ipaddr.isValid(hostname) || isPublicAddress(hostname));
}

export function parseChannels(m3u: string): ParseChannelsResult {
  const channels: ImportedChannel[] = [];
  const entryCount = (m3u.match(/^#EXTINF:/gim) ?? []).length;

  for (const channel of parseM3U(m3u).channels) {
    const name = (channel.name || channel.tvgName || '').trim();
    let url: URL;
    try {
      url = new URL(channel.url || '');
    } catch {
      continue;
    }

    if (!name || !isPublicHttpUrl(url)) {
      continue;
    }

    channels.push({ name, tvgId: channel.tvgId || undefined, url });
  }

  return { channels, skipped: Math.max(0, entryCount - channels.length) };
}
import { parseM3U } from '@iptv/playlist';
import ipaddr from 'ipaddr.js';

import { isPublicAddress } from './public-fetch.js';
