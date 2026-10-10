import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
  InvalidHlsError,
  rewriteManifest,
  UnsupportedHlsError,
  type ByteRange,
  type ResourceKind,
} from '../../server/src/streaming/streaming.rewrite.js';

const master = await readFile(new URL('../fixtures/hls/master.m3u8', import.meta.url), 'utf8');
const media = await readFile(new URL('../fixtures/hls/media.m3u8', import.meta.url), 'utf8');

type Registered = { url: string; kind: ResourceKind; range?: ByteRange };

function capture() {
  const resources: Registered[] = [];
  return {
    resources,
    register(url: URL, kind: ResourceKind, range?: ByteRange) {
      resources.push({ url: url.href, kind, ...(range ? { range } : {}) });
      return `/api/media/opaque-${resources.length}`;
    },
  };
}

test('rewrites master variants and alternate renditions against the final URL', () => {
  const { resources, register } = capture();
  const rewritten = rewriteManifest(master, new URL('https://cdn.example.org/live/master.m3u8?session=secret'), register);

  assert.deepEqual(resources, [
    { url: 'https://cdn.example.org/live/audio/en.m3u8?sig=audio', kind: 'manifest' },
    { url: 'https://other.example.org/frames.m3u8?sig=frames', kind: 'manifest' },
    { url: 'https://cdn.example.org/live/low/index.m3u8?sig=variant', kind: 'manifest' },
  ]);
  assert.equal((rewritten.match(/\/api\/media\/opaque-\d/g) ?? []).length, 3);
  assert.doesNotMatch(rewritten, /sig=|session=|cdn\.example\.org/);
});

test('rewrites map, clear key, and implicit byte ranges without exposing queries', () => {
  const { resources, register } = capture();
  const rewritten = rewriteManifest(media, new URL('https://cdn.example.org/live/media.m3u8?session=secret'), register);

  assert.deepEqual(resources, [
    { url: 'https://cdn.example.org/live/init.mp4?sig=map', kind: 'map', range: { offset: 0, length: 4 } },
    { url: 'https://cdn.example.org/live/keys/live.key?sig=key', kind: 'key' },
    { url: 'https://cdn.example.org/live/segments/live.ts?sig=segment', kind: 'segment', range: { offset: 10, length: 4 } },
    { url: 'https://cdn.example.org/live/segments/live.ts?sig=segment', kind: 'segment', range: { offset: 14, length: 4 } },
  ]);
  assert.equal((rewritten.match(/\/api\/media\/opaque-\d/g) ?? []).length, 4);
  assert.ok(rewritten.indexOf('#EXT-X-MAP') < rewritten.indexOf('#EXT-X-KEY'));
  assert.match(rewritten, /#EXT-X-BYTERANGE:4@14\n\/api\/media\/opaque-4/);
  assert.doesNotMatch(rewritten, /sig=|session=|cdn\.example\.org/);
});

test('rejects unsupported tags and encryption before registering any resource', () => {
  for (const unsupported of [
    '#EXT-X-PART:DURATION=0.5,URI="part.ts"',
    '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.bin"',
  ]) {
    const { resources, register } = capture();
    assert.throws(
      () => rewriteManifest(`${media}${unsupported}\n`, new URL('https://cdn.example.org/live/media.m3u8'), register),
      UnsupportedHlsError,
    );
    assert.deepEqual(resources, []);
  }
});

test('rejects malformed manifests before registering any resource', () => {
  for (const malformed of [
    '#EXTINF:6.0,\nsegment.ts\n',
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\n',
    '#EXTM3U\n#EXTINF:6.0,\n',
  ]) {
    const { resources, register } = capture();
    assert.throws(
      () => rewriteManifest(malformed, new URL('https://cdn.example.org/live/media.m3u8'), register),
      InvalidHlsError,
    );
    assert.deepEqual(resources, []);
  }
});

test('rejects unhandled URI tags and unsupported resource URLs before registering', () => {
  for (const line of [
    '#EXT-X-SESSION-DATA:DATA-ID="metadata",URI="metadata.json?secret=value"',
    '#EXTINF:6.0,\nhttps://user:pass@cdn.example.org/private.ts',
    '#EXTINF:6.0,\nftp://cdn.example.org/private.ts',
  ]) {
    const { resources, register } = capture();
    assert.throws(
      () => rewriteManifest(`#EXTM3U\n${line}\n`, new URL('https://cdn.example.org/live/media.m3u8'), register),
      UnsupportedHlsError,
    );
    assert.deepEqual(resources, []);
  }
});

test('rejects an implicit byte range after a different resource', () => {
  const { resources, register } = capture();
  const text = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\n#EXT-X-BYTERANGE:4@10\na.ts\n#EXTINF:6.0,\n#EXT-X-BYTERANGE:4\nb.ts\n';
  assert.throws(() => rewriteManifest(text, new URL('https://cdn.example.org/live/media.m3u8'), register), InvalidHlsError);
  assert.deepEqual(resources, []);
});

test('rejects upstream URLs hidden in retained metadata', () => {
  for (const text of [
    '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="https://cdn.example.org/private?secret=value",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nvideo.m3u8\n',
    '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,URI="https://cdn.example.org/private?secret=value"\nvideo.m3u8\n',
    '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,https://cdn.example.org/private?secret=value\nsegment.ts\n',
  ]) {
    const { resources, register } = capture();
    assert.throws(() => rewriteManifest(text, new URL('https://cdn.example.org/live/media.m3u8'), register), UnsupportedHlsError);
    assert.deepEqual(resources, []);
  }
});

test('rejects malformed URI-bearing tag attributes before registering', () => {
  for (const text of [
    '#EXTM3U\n#EXT-X-STREAM-INF:CODECS="avc1"\nvariant.m3u8\n',
    '#EXTM3U\n#EXT-X-I-FRAME-STREAM-INF:URI="frames.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nvariant.m3u8\n',
    '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x123\n#EXTINF:6.0,\nsegment.ts\n',
    '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MAP:URI="init.mp4",BYTERANGE=4@0\n#EXTINF:6.0,\nsegment.ts\n',
  ]) {
    const { resources, register } = capture();
    assert.throws(() => rewriteManifest(text, new URL('https://cdn.example.org/live/media.m3u8'), register), InvalidHlsError);
    assert.deepEqual(resources, []);
  }
});
