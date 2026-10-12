import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { ChannelService } from '../../server/src/channel/channel.service.js';
import type { EPGRepository } from '../../server/src/epg/epg.repository.js';
import { EPGService } from '../../server/src/epg/epg.service.js';
import { PublicFetchError } from '../../server/src/upstream/public-fetch.js';

type Progress = { sourceId: string; stage: string; elapsedMs: number; [key: string]: unknown };

test('guide refresh reports safe progress and the original failure cause', async () => {
  const sourceId = 'source-1';
  const sourceUrl = 'https://feed.example/guide.xml?secret=hidden';
  const events: Progress[] = [];
  const marked: string[] = [];
  let saved = false;
  const repository = {
    findOwnedUrl: async () => sourceUrl,
    replaceSnapshot: async () => { saved = true; },
    markFailure: async (_ownerId: string, _sourceId: string, code: string) => { marked.push(code); },
  } as unknown as EPGRepository;
  const channels = {} as ChannelService;
  const stamp = (date: Date) => date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
  const xml = '<tv><channel id="news"><display-name>News</display-name></channel>' +
    '<programme channel="news" start="' + stamp(new Date(Date.now() - 60_000)) +
    '" stop="' + stamp(new Date(Date.now() + 3_600_000)) + '"><title>Now</title></programme></tv>';
  const report = (event: Progress) => { events.push(event); };

  const success = new EPGService(repository, channels, async () => ({
    response: new Response(xml, { status: 200 }), finalUrl: new URL(sourceUrl),
  }), report);
  await success.refreshSource('owner-1', sourceId);

  assert.equal(saved, true);
  assert.deepEqual(events.map((event) => event.stage), [
    'fetch', 'response', 'download_start', 'download_progress', 'download', 'expand_start', 'expand',
    'parse', 'parsed_counts', 'parsed', 'save', 'complete',
  ]);
  assert.equal(events.find((event) => event.stage === 'download_progress')?.bytes, Buffer.byteLength(xml));
  assert.equal(events.find((event) => event.stage === 'parsed_counts')?.channels, 1);
  assert.equal(events.find((event) => event.stage === 'parsed_counts')?.programs, 1);
  assert.equal(events.every((event) => event.sourceId === sourceId && event.elapsedMs >= 0), true);
  assert.equal(JSON.stringify(events).includes('secret=hidden'), false);

  events.length = 0;
  const failure = new EPGService(repository, channels, async () => {
    throw new PublicFetchError('TIMEOUT');
  }, report);
  await assert.rejects(failure.refreshSource('owner-1', sourceId));
  assert.deepEqual(marked, ['FETCH_FAILED']);
  assert.equal(events.at(-1)?.stage, 'failed');
  assert.equal(events.at(-1)?.failureCode, 'FETCH_FAILED');
  assert.equal(events.at(-1)?.originalCode, 'TIMEOUT');
  assert.equal(JSON.stringify(events).includes('secret=hidden'), false);

  events.length = 0;
  const interrupted = new EPGService(repository, channels, async () => ({
    response: new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<tv>'));
        setTimeout(() => controller.error(new PublicFetchError('TIMEOUT')), 20);
      },
    }), { status: 200 }),
    finalUrl: new URL(sourceUrl),
  }), report);
  await assert.rejects(interrupted.refreshSource('owner-1', sourceId));
  assert.equal(events.at(-1)?.stage, 'failed');
  assert.equal(events.at(-1)?.originalCode, 'TIMEOUT');
  assert.equal(events.at(-1)?.downloadedBytes, 4);
  assert.equal(JSON.stringify(events).includes('secret=hidden'), false);

  const brokenConsole = new EPGService(repository, channels, async () => ({
    response: new Response(xml, { status: 200 }), finalUrl: new URL(sourceUrl),
  }), () => { throw new Error('console closed'); });
  await assert.doesNotReject(brokenConsole.refreshSource('owner-1', sourceId));
});
