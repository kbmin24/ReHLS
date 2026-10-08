import { readFile } from 'node:fs/promises';

import { Response } from 'undici';

import { createApp } from '../src/app.js';
import type { UpstreamClient } from '../src/public-fetch.js';

const playlistUrl = 'https://fixture.example/channels.m3u';
const channelUrl = 'https://fixture.example/entry/master.m3u8?token=source';
const masterUrl = 'https://fixture.example/live/master.m3u8?token=final';
const mediaUrl = 'https://fixture.example/live/media.m3u8?token=media';
const sampleUrl = 'https://fixture.example/live/sample.ts?token=media';

const playlist = ['#EXTM3U', '#EXTINF:-1 tvg-id="fixture-channel",Fixture Channel', channelUrl, ''].join('\n');
const master = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-STREAM-INF:BANDWIDTH=500000,CODECS="avc1.42e01e,mp4a.40.2"',
  'media.m3u8?token=media',
  '',
].join('\n');
const media = [
  '#EXTM3U',
  '#EXT-X-VERSION:3',
  '#EXT-X-TARGETDURATION:4',
  '#EXT-X-MEDIA-SEQUENCE:0',
  '#EXTINF:4.0,',
  'sample.ts?token=media',
  '#EXT-X-ENDLIST',
  '',
].join('\n');
const sample = await readFile(new URL('./fixtures/sample.ts', import.meta.url));

const upstream: UpstreamClient = {
  async get(url, signal) {
    if (signal?.aborted) throw new Error('Fixture request cancelled');
    switch (url.href) {
      case playlistUrl:
        return { response: new Response(playlist), finalUrl: url };
      case channelUrl:
        return { response: new Response(master), finalUrl: new URL(masterUrl) };
      case mediaUrl:
        return { response: new Response(media), finalUrl: url };
      case sampleUrl:
        return {
          response: new Response(sample, { headers: { 'content-type': 'video/mp2t' } }),
          finalUrl: url,
        };
      default:
        throw new Error('Fixture URL not found');
    }
  },
};

const port = Number(process.env.PORT ?? 3000);
const server = createApp({ upstream }).listen(port, '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address !== 'string') {
    process.stdout.write('Fixture server: http://127.0.0.1:' + address.port + '\n');
    process.stdout.write('Import URL: ' + playlistUrl + '\n');
  }
});
