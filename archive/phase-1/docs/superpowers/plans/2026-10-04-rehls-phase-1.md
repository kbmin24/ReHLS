# ReHLS Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a public IPTV M3U list and play one ordinary unencrypted HLS channel in a browser with manifests and segments served through ReHLS.

**Architecture:** One loopback-only Express/TypeScript process owns an in-memory channel list and opaque HLS resource registry. A shared public-only HTTP client fetches playlist and media resources. Static HTML and JavaScript with packaged hls.js provide a disposable picker and player.

**Tech Stack:** Node.js, TypeScript, Express, `@iptv/playlist`, Undici, `ipaddr.js`, hls.js, Node test runner with `tsx`.

**Spec:** [Phase 1 design](../specs/2026-10-04-rehls-phase-1-design.md)

## Global Constraints

- Bind the unauthenticated process to `127.0.0.1`; document that it is local-only.
- Import public HTTP(S) M3U URLs only. Reject URL credentials, private destinations, and redirects to them.
- Check DNS answers at connection time for every upstream fetch, including nested HLS resources.
- Limit redirects to four, upstream response time to 10 seconds, M3U bodies to 16 MiB, HLS manifests to 2 MiB, and media resources to 32 MiB.
- Keep the last good channel list when import fails. Keep state and HLS resource IDs in memory only.
- Do not put upstream URLs or query strings in API responses, browser resource URLs, or error logs.
- Support ordinary unencrypted master/media playlists with bare child-manifest and segment URI lines. Reject unsupported URI-bearing tags and byte ranges clearly.
- Use controlled fixtures for automated tests; treat a public stream as a separate manual smoke check.
- No accounts, PostgreSQL, Docker deployment, guide, runtime FFmpeg conversion, recording, or durable Vue UI in phase 1.

## Review Focus

1. A relative segment URI with its own query string resolves against the final redirected manifest URL and retains that query upstream; test in Task 3.
2. A master playlist referring to alternate audio, a key, a map, or byte ranges fails before the browser receives a partly rewritten manifest; test in Task 3.
3. DNS answers with both public and private addresses, including IPv4-mapped IPv6, never connect to a private address; test in Task 1.
4. A failed or empty re-import leaves the prior channel IDs playable; test in Task 2 and the Task 4 route test.
5. A disconnected browser aborts an in-flight segment fetch and does not leave a hanging response; test in Task 4.

---

## File Map

| File | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore` | Minimal Node/TypeScript runtime, scripts, pinned dependencies, ignored build output. |
| `src/public-fetch.ts` | Public HTTP(S) validation, DNS filtering, manual redirects, deadline, shared upstream interface. |
| `src/import.ts` | Normalize `@iptv/playlist` output to channel name, optional ID, and stream URL. |
| `src/state.ts` | Last-good in-memory channels and bounded opaque HLS resource registry. |
| `src/hls.ts` | Classify supported HLS manifests and rewrite URI lines. |
| `src/app.ts`, `src/index.ts` | Express routes and loopback startup. |
| `public/index.html`, `public/player.js` | Disposable picker and packaged hls.js player. |
| `test/*.test.ts`, `test/fixture-server.ts`, `test/fixtures/*` | Unit and HTTP fixture checks; browser fixture server with generated test media. |
| `README.md`, `docs/phase-1-findings.md` | Local run instructions and phase gate evidence. |

### Task 1: Minimal runtime and public upstream client

**Files:** Create `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `src/public-fetch.ts`, `test/public-fetch.test.ts`.

**Interfaces:** Export `type UpstreamClient = { get(url: URL, signal?: AbortSignal): Promise<{ response: Response; finalUrl: URL }> }`, `createPublicClient(): UpstreamClient`, and `isPublicAddress(address: string): boolean`. Later tasks consume `UpstreamClient`; callers enforce body-size limits while reading. The client follows at most four redirects manually and returns the response plus its final URL for URI resolution.

- [ ] **Step 1: Add the minimal package test script and write failing tests** for HTTP(S)-only URLs, URL credentials, loopback/private/link-local/reserved and IPv4-mapped IPv6 addresses, mixed DNS answers, a public-to-private redirect, redirect limit, and timeout. Use a controlled resolver/transport seam; assert no forbidden request is dispatched.
- [ ] **Step 2: Run `npm test -- test/public-fetch.test.ts`** and confirm failures are due to missing behavior.
- [ ] **Step 3: Add the smallest Node/TypeScript setup and implement `createPublicClient` and `isPublicAddress`** in `src/public-fetch.ts`. Use Undici's per-request dispatcher with filtered connection-time DNS lookup, `ipaddr.js` range classification, manual redirects, and a 10-second deadline. Do not forward caller-supplied headers.
- [ ] **Step 4: Run `npm test -- test/public-fetch.test.ts` and `npm run typecheck`**; both pass.
- [ ] **Step 5: Commit** the runtime and public-client files with `feat: add bounded public upstream fetch`.

### Task 2: M3U import and last-good state

**Files:** Create `src/import.ts`, `src/state.ts`, `src/app.ts`, `test/import.test.ts`, `test/fixtures/channels.m3u`.

**Interfaces:** Export `type ImportedChannel = { name: string; tvgId?: string; url: URL }` and `parseChannels(m3u: string): { channels: ImportedChannel[]; skipped: number }`. Export `class MemoryState` with `replaceChannels(channels: ImportedChannel[]): void`, `listChannels(): { id: string; name: string; tvgId?: string }[]`, and `getChannel(id: string): ImportedChannel | undefined`. Task 4 extends this class with resource methods. Export `createApp(deps: { upstream: UpstreamClient; state?: MemoryState }): Express` from `src/app.ts`.

- [ ] **Step 1: Write failing parser and route tests.** A fixture with two public channels, duplicate names, one `tvg-id`, and one non-HTTP entry yields two channels and one skipped entry. `POST /api/import` with `{ "url": "https://example.org/list.m3u" }` returns `{ "imported": 2, "skipped": 1 }`; `GET /api/channels` returns `{ "channels": [...] }` with opaque IDs and metadata but no upstream URLs. A failed or empty second import preserves the original IDs and list.
- [ ] **Step 2: Run `npm test -- test/import.test.ts`** and confirm the missing behavior fails.
- [ ] **Step 3: Implement `parseChannels`, `MemoryState`, and the two API routes.** Read at most 16 MiB before parsing; assign IDs only on a successful nonempty import. Return a sanitized 4xx for invalid input and 5xx/502 for upstream failure, without exposing URL query strings.
- [ ] **Step 4: Run `npm test -- test/import.test.ts` and `npm run typecheck`**; both pass.
- [ ] **Step 5: Commit** with `feat: import M3U channels in memory`.

### Task 3: HLS manifest rewrite

**Files:** Create `src/hls.ts`, `test/hls.test.ts`, `test/fixtures/master.m3u8`, `test/fixtures/media.m3u8`.

**Interfaces:** Export `type ResourceKind = 'manifest' | 'segment'` and `rewriteManifest(text: string, baseUrl: URL, register: (url: URL, kind: ResourceKind) => string): string`. The callback returns an opaque ReHLS path. `rewriteManifest` throws `UnsupportedHlsError` for the excluded HLS features and `InvalidHlsError` for malformed input.

- [ ] **Step 1: Write failing tests** showing master variant lines become manifest paths, media URI lines become segment paths, relative paths and queries resolve against `baseUrl`, non-URI tags remain intact, and absolute public-looking references are passed to the registration callback for later validation.
- [ ] **Step 2: Add failing tests** showing encrypted/key URI, alternate-rendition URI, initialization map, partial segments, byte ranges, any other unhandled `URI=` tag, and malformed or mixed master/media playlists fail before any rewritten output is returned.
- [ ] **Step 3: Run `npm test -- test/hls.test.ts`** and confirm the expected failures.
- [ ] **Step 4: Implement `rewriteManifest`** using line-oriented HLS handling and `new URL(reference, baseUrl)`; keep this subset explicit rather than adding a general HLS parser.
- [ ] **Step 5: Run `npm test -- test/hls.test.ts` and `npm run typecheck`**; both pass.
- [ ] **Step 6: Commit** with `feat: rewrite supported HLS manifests`.

### Task 4: Opaque media routes and cancellation

**Files:** Modify `src/state.ts`, `src/app.ts`; create `test/media-routes.test.ts` and controlled fixture responses.

**Interfaces:** Extend `MemoryState` with `registerResource(channelId: string, url: URL, kind: ResourceKind): string` and `getResource(id: string): { channelId: string; url: URL; kind: ResourceKind } | undefined`. The registry reuses IDs for an active channel/URL/kind tuple, expires entries after 10 minutes, and caps itself at 20,000 entries. Routes are `GET /api/channels/:id/manifest.m3u8` and `GET /api/media/:resourceId`.

- [ ] **Step 1: Write failing HTTP tests** using an injected `UpstreamClient`: root master manifest, child media manifest, and segment each return through ReHLS; nested requests use opaque IDs and preserve upstream query strings internally. Test a media playlist without a master too.
- [ ] **Step 2: Add failing tests** for missing channel/resource, expired resource ID, oversized manifest or segment, upstream failure without URL leakage, unsupported HLS response, and browser disconnect aborting the upstream signal.
- [ ] **Step 3: Run `npm test -- test/media-routes.test.ts`** and confirm the expected failures.
- [ ] **Step 4: Implement registry and routes.** Use the final response URL as the manifest rewrite base, cap manifest reads at 2 MiB and streaming media at 32 MiB, pass only safe content headers, and stop streaming on client disconnect. Check every nested URL through `UpstreamClient`.
- [ ] **Step 5: Run `npm test -- test/media-routes.test.ts`, `npm test`, and `npm run typecheck`**; all pass.
- [ ] **Step 6: Commit** with `feat: restream HLS through opaque routes`.

### Task 5: Disposable player and phase gate

**Files:** Create `public/index.html`, `public/player.js`, `src/index.ts`, `test/fixture-server.ts`, `test/fixtures/sample.ts`, `docs/phase-1-findings.md`; modify `src/app.ts`, `README.md`, `package.json`.

**Interfaces:** `src/index.ts` starts `createApp` on `127.0.0.1`; `public/player.js` calls the import and channel APIs and loads only `/api/channels/:id/manifest.m3u8` into hls.js or native HLS. No upstream URL enters browser state.

- [ ] **Step 1: Create the controlled fixture server and generated media sample.** The fixture server maps the public-looking import URL `https://fixture.example/channels.m3u` and its HLS URLs to checked-in fixture responses through injected `UpstreamClient`; it listens only on loopback. Generate a four-second H.264/AAC transport stream containing a test pattern and tone, and keep it under `test/fixtures/sample.ts`.
- [ ] **Step 2: Run a browser check against the fixture server** and confirm that import and playback cannot yet be completed because the UI is missing.
- [ ] **Step 3: Add the static picker/player and loopback startup.** Serve packaged hls.js locally, show import/playback errors in plain language, and dispose the previous hls.js instance on channel change.
- [ ] **Step 4: Run `npm test`, `npm run typecheck`, and `npm run build`**; all pass. Start `test/fixture-server.ts`, which injects only the controlled transport into `createApp`, then play the checked-in sample in a browser: root manifest, nested manifest, and segment requests must all target ReHLS and produce picture and sound.
- [ ] **Step 5: Try one public M3U/HLS stream manually.** Record the source category, browser, observed result, and upstream availability separately from deterministic tests. Do not treat an unavailable public stream as a code regression without fixture evidence.
- [ ] **Step 6: Update `README.md`** with local run steps, supported stream subset, loopback-only warning, and test commands. Fill `docs/phase-1-findings.md` with the exit-gate result, reusable parser/proxy behavior, failure cases, and disposable parts.
- [ ] **Step 7: Commit** with `docs: record phase 1 playback findings` after the UI and documentation are verified.

## Completion Gate

Phase 1 is complete only when the fixture-backed test suite passes, a browser can play a selected fixture channel through ReHLS, the public-stream smoke result is documented, and the findings note says what to reuse or discard. Review those findings before starting phase 2.
