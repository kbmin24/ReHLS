import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultSourceName } from '../../server/src/playlist/playlist.name.js';

test('playlist name defaults to the decoded URL filename without query or fragment', () => {
  assert.equal(defaultSourceName(new URL('https://example.org/lists/My%20Channels.m3u?token=secret#part')),
    'My Channels.m3u');
});

test('playlist name falls back to the hostname when the URL has no filename', () => {
  assert.equal(defaultSourceName(new URL('https://example.org/lists/')), 'example.org');
});
