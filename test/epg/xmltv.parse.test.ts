import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { parseGuideDocument, XMLTV_LIMITS, XmltvParseError } from '../../server/src/epg/xmltv.parse.js';

const fixture = readFileSync(new URL('../fixtures/guide.xml', import.meta.url), 'utf8');
const window = { startsAt: new Date('2026-10-10T00:00:00Z'), endsAt: new Date('2026-10-11T00:00:00Z') };

test('normalizes XMLTV channels and UTC programs', () => {
  const guide = parseGuideDocument(fixture, XMLTV_LIMITS, window);
  assert.deepEqual(guide.channels, [{ xmltvId: 'news.example', displayName: 'Example News' }]);
  assert.equal(guide.programs[0]?.startsAt.toISOString(), '2026-10-10T10:00:00.000Z');
});

test('rejects duplicate channels, undeclared references, and declarations', () => {
  const invalid = [
    fixture.replace('</tv>', '<channel id="news.example"><display-name>Duplicate</display-name></channel></tv>'),
    fixture.replace('channel="news.example"', 'channel="missing"'),
    fixture.replace('<tv>', '<!DOCTYPE tv SYSTEM "external.dtd"><tv>'),
    fixture.replace('<tv>', '<!ENTITY x SYSTEM "file:///etc/passwd"><tv>'),
  ];
  for (const xml of invalid) {
    assert.throws(() => parseGuideDocument(xml, XMLTV_LIMITS, window), XmltvParseError);
  }
});

test('rejects invalid time, out-of-window-only data, and expanded-size excess', () => {
  const invalidTime = fixture.replace('20261010110000 +0000', 'not-a-time');
  assert.throws(() => parseGuideDocument(invalidTime, XMLTV_LIMITS, window), XmltvParseError);
  const outside = { startsAt: new Date('2027-01-01'), endsAt: new Date('2027-01-02') };
  assert.throws(() => parseGuideDocument(fixture, XMLTV_LIMITS, outside), XmltvParseError);
  assert.throws(() => parseGuideDocument(fixture, { ...XMLTV_LIMITS, maxExpandedBytes: 10 }, window), XmltvParseError);
});

test('collapses identical program entries within one source', () => {
  const duplicate = fixture.replace('</tv>', `${fixture.match(/<programme[\s\S]*?<\/programme>/)?.[0]}</tv>`);
  assert.equal(parseGuideDocument(duplicate, XMLTV_LIMITS, window).programs.length, 1);
});

test('decodes safe XML entities in guide text', () => {
  const encoded = fixture.replace('Example News', 'News &amp; More').replace('Morning News', 'Morning &#38; Evening');
  const guide = parseGuideDocument(encoded, XMLTV_LIMITS, window);
  assert.equal(guide.channels[0]?.displayName, 'News & More');
  assert.equal(guide.programs[0]?.title, 'Morning & Evening');
});
