import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { parseChannels } from '../../server/src/playlist/playlist.parse.js';

const fixture = await readFile(new URL('../fixtures/channels.m3u', import.meta.url), 'utf8');

test('parses metadata and skips malformed or unsupported channels', () => {
  const result = parseChannels(fixture);

  assert.equal(result.skipped, 2);
  assert.deepEqual(result.channels.map(({ name, tvgId, group, url }) => ({ name, tvgId, group, url })), [
    { name: 'News', tvgId: 'news', group: 'News', url: 'https://streams.example.org/one.m3u8' },
    { name: 'News', tvgId: 'news', group: 'News', url: 'https://streams.example.org/two.m3u8' },
  ]);
});

test('a uniquely identified channel keeps its match key when its stream URL changes', () => {
  const before = parseChannels(`#EXTM3U
#EXTINF:-1 tvg-id="unique-news" group-title="News",News
https://streams.example.org/old.m3u8
`);
  const after = parseChannels(`#EXTM3U
#EXTINF:-1 tvg-id="unique-news" group-title="News",News
https://streams.example.org/new.m3u8
`);

  assert.equal(after.channels[0]?.matchKey, before.channels[0]?.matchKey);
});

test('distinct duplicate entries retain match keys when reordered', () => {
  const first = `#EXTM3U
#EXTINF:-1 tvg-id="news",News
https://streams.example.org/one.m3u8
#EXTINF:-1 tvg-id="news",News
https://streams.example.org/two.m3u8
`;
  const second = `#EXTM3U
#EXTINF:-1 tvg-id="news",News
https://streams.example.org/two.m3u8
#EXTINF:-1 tvg-id="news",News
https://streams.example.org/one.m3u8
`;
  const keys = (text: string) => new Map(parseChannels(text).channels.map((channel) => [channel.url, channel.matchKey]));

  assert.deepEqual(keys(second), keys(first));
  assert.notEqual(keys(first).get('https://streams.example.org/one.m3u8'), keys(first).get('https://streams.example.org/two.m3u8'));
});

test('rejects a playlist with more than 20,000 channel entries', () => {
  const entry = '#EXTINF:-1,Channel\nhttps://streams.example.org/live.m3u8\n';
  assert.throws(() => parseChannels(`#EXTM3U\n${entry.repeat(20_001)}`), /entry limit/i);
});
