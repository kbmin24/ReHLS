import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  InvalidHlsError,
  rewriteManifest,
  UnsupportedHlsError,
  type ResourceKind,
} from '../src/hls.js';

const master = await readFile(new URL('./fixtures/master.m3u8', import.meta.url), 'utf8');
const media = await readFile(new URL('./fixtures/media.m3u8', import.meta.url), 'utf8');

test('master variants become opaque manifest paths while other tags stay intact', () => {
  const registered: { url: string; kind: ResourceKind }[] = [];
  const rewritten = rewriteManifest(
    master,
    new URL('https://cdn.example.org/live/master.m3u8?session=original'),
    (url, kind) => {
      registered.push({ url: url.href, kind });
      return '/api/media/manifest-' + registered.length;
    },
  );

  assert.deepEqual(registered, [
    { url: 'https://cdn.example.org/live/low/index.m3u8?auth=one', kind: 'manifest' },
    { url: 'https://other.example.org/high/index.m3u8?auth=two', kind: 'manifest' },
  ]);
  assert.equal(rewritten, [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-STREAM-INF:BANDWIDTH=800000',
    '/api/media/manifest-1',
    '#EXT-X-STREAM-INF:BANDWIDTH=1600000',
    '/api/media/manifest-2',
    '',
  ].join('\n'));
});

test('media segments resolve relative paths and queries against the final manifest URL', () => {
  const registered: { url: string; kind: ResourceKind }[] = [];
  const rewritten = rewriteManifest(
    media,
    new URL('https://cdn.example.org/live/levels/media.m3u8?session=original'),
    (url, kind) => {
      registered.push({ url: url.href, kind });
      return '/api/media/segment-' + registered.length;
    },
  );

  assert.deepEqual(registered, [
    { url: 'https://cdn.example.org/live/seg-101.ts?sig=abc', kind: 'segment' },
    { url: 'https://media.example.org/seg-102.ts?key=def', kind: 'segment' },
  ]);
  assert.equal(rewritten, [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:6',
    '#EXT-X-MEDIA-SEQUENCE:101',
    '#EXTINF:6.0,',
    '/api/media/segment-1',
    '#EXTINF:6.0,',
    '/api/media/segment-2',
    '',
  ].join('\n'));
});

const unsupportedManifests = [
  ['encryption key', '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"'],
  ['alternate audio', '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="audio.m3u8"'],
  ['initialization map', '#EXT-X-MAP:URI="init.mp4"'],
  ['partial segment', '#EXT-X-PART:DURATION=0.5,URI="part.ts"'],
  ['byte range', '#EXT-X-BYTERANGE:100@0'],
  ['unhandled URI tag', '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=100000,URI="iframes.m3u8"'],
] as const;

for (const [feature, tag] of unsupportedManifests) {
  test('rejects ' + feature + ' instead of returning a partly rewritten playlist', () => {
    const input = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000',
      'low/index.m3u8',
      tag,
      '',
    ].join('\n');
    assert.throws(
      () => rewriteManifest(input, new URL('https://cdn.example.org/live/master.m3u8'), () => '/api/media/opaque'),
      UnsupportedHlsError,
    );
  });
}

const invalidManifests = [
  ['missing HLS header', '#EXTINF:6.0,\nsegment.ts\n'],
  ['missing variant URI', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n'],
  ['mixed master and media tags', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nvariant.m3u8\n#EXTINF:6.0,\nsegment.ts\n'],
] as const;

for (const [problem, input] of invalidManifests) {
  test('rejects ' + problem + ' as an invalid HLS playlist', () => {
    assert.throws(
      () => rewriteManifest(input, new URL('https://cdn.example.org/live/index.m3u8'), () => '/api/media/opaque'),
      InvalidHlsError,
    );
  });
}
