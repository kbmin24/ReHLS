import { readFile } from 'node:fs/promises';
import session from 'express-session';
import { createApp } from './server/src/index.js';
import { ResourceRegistry } from './server/src/streaming/streaming.registry.js';
import { StreamingService } from './server/src/streaming/streaming.service.js';

const ownerId = '11111111-1111-4111-8111-111111111111';
const channelId = '22222222-2222-4222-8222-222222222222';
const sourceId = '33333333-3333-4333-8333-333333333333';
const user = { id: ownerId, username: 'fixture', role: 'user' as const, session_version: 0, disabled_at: null };
const manifest = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:9.9766,\n0.ts\n#EXTINF:9.9766,\n1.ts\n#EXT-X-ENDLIST\n';
const requests: string[] = [];
const streaming = new StreamingService(
  { getOwned: async () => ({ streamUrl: 'https://media.example.org/index.m3u8' }) },
  new ResourceRegistry({ maxEntries: 100, ttlMs: 120_000 }),
  async (url) => {
    requests.push(url.pathname);
    const body = url.pathname.endsWith('.m3u8') ? manifest : await readFile(`/tmp/rehls-${url.pathname.slice(1)}`);
    return { response: new Response(body, { headers: { 'content-type': url.pathname.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t' } }), finalUrl: url };
  },
);
const app = createApp({ query: async () => ({}) }, {
  config: { databaseUrl: 'postgres://unused', sessionSecret: 'a'.repeat(32),
    appOrigin: 'http://127.0.0.1:3000', port: 3000, trustProxy: false },
  sessionStore: new session.MemoryStore(), streaming,
  users: { authenticate: async () => user, getActiveUser: async () => user, changeOwnPassword: async () => user },
  channels: { listOwned: async () => [{ id: channelId, sourceId, name: 'Controlled video', group: null }] } as any,
  playlists: { listSources: async () => [{ id: sourceId, name: 'Controlled fixture' }] } as any,
});
app.get('/fixture-requests', (_request, response) => response.json(requests));
app.listen(3000, '127.0.0.1', () => console.log('fixture-ready'));
