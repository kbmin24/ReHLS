# ReHLS Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a persistent, private, two-user IPTV client with backend-served HLS playback and XMLTV guide data through Linux Docker Compose.

**Architecture:** One TypeScript repository contains an Express API/media server, a Vue/Tailwind client, and a PostgreSQL-backed refresh worker. The server owns identity and every user-scoped API/media request; the worker refreshes M3U and XMLTV snapshots transactionally. Phase 1 code is reviewed and selectively promoted, while its UI and in-memory channel library remain archived.

**Tech Stack:** Node.js 24+, TypeScript, Express, Vue, Vite, Tailwind CSS, PostgreSQL, `pg`, `node-pg-migrate`, `express-session`, `connect-pg-simple`, `express-rate-limit`, `argon2`, hls.js, `@iptv/playlist`, `saxes`, Undici, the Node test runner with `tsx`, and Playwright. Confirm package maintenance and compatible current versions when executing; pin installed versions in the lockfile.

**Spec:** [Phase 2 design](../specs/2026-10-05-rehls-phase-2-design.md)

## Global Constraints

- No product code is written as part of this planning task. During execution, implement only Phase 2 scope from the approved spec.
- Linux Docker Compose runs one app process, one refresh worker, and PostgreSQL; the app serves the built client from the same origin.
- Run migrations before app/worker startup and fail startup if migration fails. Persist PostgreSQL data across Compose restarts.
- The first admin is created by a one-time server-side command when the user table is empty. There is no public registration.
- Every source, channel, guide, mapping, and nested media route authenticates and checks the owner. Admin library routes do not bypass ownership.
- Retain last-good M3U and XMLTV snapshots on failed or empty refreshes and expose status, last attempt, and last success.
- Fetch only public HTTP(S) destinations. Validate the connected address and each redirect and nested HLS URL; bound time, bytes, parser work, and media concurrency.
- Keep upstream URLs and query strings out of client URLs, API errors, and logs. Do not store manifests, segments, or keys in PostgreSQL.
- Support ordinary HLS plus alternate renditions, initialization maps, clear AES-128 keys, and byte ranges; reject unsupported forms before partial rewriting.
- Use controlled fixtures for deterministic tests. A public-stream smoke check is separate from the automated gate.
- FFmpeg, VAAPI, recording, DRM, low-latency HLS parts, provider-specific authentication/headers, and non-HTTP sources are outside this plan.

## Review Focus

1. **Account disabled during playback:** the next nested media request fails without fetching upstream. Pin this in Task 8.
2. **Refresh worker dies after claiming a source:** an expired lease allows another worker run to retry without deleting the last good snapshot. Pin this in Task 6.
3. **Duplicate M3U entries reorder:** both entries remain distinct, and unchanged entries keep stable IDs where matchable. Pin this in Task 5.
4. **Compressed XMLTV expands past the byte limit:** parsing stops and the prior guide remains visible. Pin this in Task 9.
5. **A media byte range exceeds the allowed response:** the server rejects it before streaming unbounded bytes and never leaks the upstream URL. Pin this in Task 7.

---

## File map and milestones

| Path | Responsibility |
| --- | --- |
| `package.json`, lockfile, `tsconfig*.json`, `vite.config.ts`, `playwright.config.ts`, `client/index.html` | One Node workspace, server/client scripts, typechecking, client build, and browser test configuration. |
| `Dockerfile`, `compose.yaml`, `.env.example`, `server/src/config.ts`, `server/src/db/pool.ts`, `db/migrations/*` | Deployment, required configuration, database access, and ordered schema changes. |
| `server/src/http/app.ts`, `server/src/http/errors.ts`, `server/src/auth/{accounts,sessions,routes,require-user}.ts` | HTTP composition, sanitized errors, identity, sessions, and ownership entry point. |
| `server/src/upstream/public-fetch.ts` | One public-only transport for playlist, guide, and every HLS resource. |
| `server/src/playlists/{parse,repository,refresh,routes}.ts` | M3U normalization, atomic snapshots, refresh logic, and owner-scoped APIs. |
| `server/src/worker/{claims,index}.ts` | Leased refresh claims and scheduling. |
| `server/src/media/{rewrite,registry,routes}.ts` | Supported HLS rewriting, scoped short-lived resource IDs, and streaming. |
| `server/src/guide/{parse,repository,refresh,mapping,routes}.ts` | Bounded XMLTV ingestion, transactional snapshots, matching, and guide APIs. |
| `client/src/{api.ts,App.vue,views/*.vue,components/*.vue}` | Same-origin UI for login, administration, private library, player, and guide. |
| `test/{auth,playlists,worker,media,guide}/*.test.ts`, `test/fixtures/*`, `e2e/*.spec.ts` | Local upstream and PostgreSQL integration tests plus browser exit checks. |
| `docs/phase-2-handoff.md`, `README.md` | Phase 1 promotion findings, runbook, smoke results, and Phase 2 exit evidence. |

### Milestone A: Deployment and identity

### Task 1: Record the Phase 1 handoff

**Files:** Create `docs/phase-2-handoff.md`; read `archive/phase-1/src/{import,public-fetch,hls}.ts`, its tests, and fixture server. Do not modify the archive.

**Interfaces:** Produce a short reuse/rewrite/discard decision for the parser, fetch policy, HLS rewrite, in-memory state, and disposable UI. This is the input to Tasks 5, 7, and 8.

- [ ] **Step 1: Run the archived tests and fixture server.** Run `npm test`, `npm run typecheck`, and `npm run build` from `archive/phase-1/`; record pass/fail and the tested HLS subset.
- [ ] **Step 2: Perform the missing fixture-backed browser check.** Import `https://fixture.example/channels.m3u` through the fixture server, play the generated sample, and record picture/sound plus whether manifest, child manifest, and segment requests all target ReHLS. Record a failure precisely if a browser is unavailable.
- [ ] **Step 3: Write `docs/phase-2-handoff.md`.** State which behaviors are demonstrated, which code needs review or rewrite, and that no historical public-stream result was recorded. Do not claim the live smoke check has passed.
- [ ] **Step 4: Verify and commit.** Check every claimed result against command/browser evidence, then commit only the handoff note as `docs: record phase 1 promotion decisions`.

### Task 2: Bootstrap the repository, database, and Compose

**Files:** Create root `package.json`, lockfile, `tsconfig.json`, `tsconfig.server.json`, `tsconfig.client.json`, `vite.config.ts`, `client/index.html`, `Dockerfile`, `compose.yaml`, `.env.example`, `server/src/config.ts`, `server/src/db/pool.ts`, `server/src/http/app.ts`, `server/src/index.ts`, `db/migrations/001_core.ts`, and `test/db/migration.test.ts`.

**Interfaces:** `loadConfig(env)` returns validated database URL, session secret, app origin, proxy setting, and port; `createPool(config)` returns a `pg.Pool`; `createApp(deps)` creates the Express app. The first migration defines users (including a session version), PostgreSQL session storage, playlist sources/channels, XMLTV sources/channels/programs, mapping overrides, and refresh metadata with owner keys and foreign-key constraints. Later tasks extend this schema through new migrations, not edits to an applied migration.

- [ ] **Step 1: Write failing migration and HTTP smoke tests.** Assert an empty database migrates, the schema has required owner/foreign keys, a second migration run is idempotent, `/health` succeeds when DB is reachable, and malformed or missing required config prevents startup.
- [ ] **Step 2: Run those tests and confirm they fail because setup is absent.** Use a disposable PostgreSQL test database, never the user's existing database.
- [ ] **Step 3: Add the minimal root setup and Compose configuration.** Pin the runtime and dependencies; provide `npm test -- <test path>`, `npm run test:e2e -- <spec path>`, `npm run typecheck`, and `npm run build` scripts. Build server/client, add explicit migration startup, health checks, persistent DB volume, one worker replica, localhost-published app port, and no committed secrets.
- [ ] **Step 4: Run migration tests, typecheck, build, and `docker compose config`.** Confirm all pass and migration failure prevents app/worker startup.
- [ ] **Step 5: Commit** `feat: establish phase 2 app and database foundation`.

### Task 3: Bootstrap admin, login, and revocable sessions

**Files:** Create `server/src/auth/{accounts,sessions,routes,require-user}.ts`, `server/src/cli/create-admin.ts`, `test/auth/sessions.test.ts`; modify `server/src/http/app.ts` and config.

**Interfaces:** `createFirstAdmin(pool, username, password)` succeeds only while the users table is empty; `requireUser` resolves an active user on every request and compares its session version; `requireAdmin` adds role checking; `authRouter` exposes login, logout, current user, and own password change. Use `argon2` for password hashes and `express-session` with PostgreSQL storage for opaque revocable IDs. Require an `Origin` matching the configured app origin on unsafe HTTP methods; reject cross-site Fetch Metadata when present.

- [ ] **Step 1: Write failing tests.** Cover first-admin race attempts, no later bootstrap, no public registration, invalid login, login rate limit, session cookie attributes, session rotation on login, logout revocation, app restart persistence, disabled account denial, password-change revocation, and cross-origin mutation rejection.
- [ ] **Step 2: Run `npm test -- test/auth/sessions.test.ts` and observe expected failures.**
- [ ] **Step 3: Implement the command, middleware, and routes.** Read the bootstrap password without shell arguments; use database uniqueness/transaction boundaries for the first-admin race. Never log passwords, session IDs, or raw request bodies.
- [ ] **Step 4: Run auth tests, typecheck, and build; confirm pass.**
- [ ] **Step 5: Commit** `feat: add admin bootstrap and durable sessions`.

### Task 4: Admin account management and first client flow

**Files:** Create `server/src/auth/admin-routes.ts`, `client/src/{api.ts,App.vue,main.ts}`, `client/src/views/{LoginView,AdminUsersView}.vue`, `playwright.config.ts`, `e2e/auth.spec.ts`; modify app wiring.

**Interfaces:** Admin routes create, list, disable, and reset passwords for accounts; ordinary routes cannot use them. `api.ts` sends same-origin credentials, handles session expiry, and never stores credentials in local storage. The client gates admin controls by the current-user role while the server remains authoritative.

- [ ] **Step 1: Write failing API and browser tests.** An admin can create two users; a non-admin cannot list/create/disable/reset accounts; disabling a user invalidates the next request; login and logout work in the built Vue client; a narrow viewport remains usable.
- [ ] **Step 2: Run focused API and Playwright tests; confirm expected failures.**
- [ ] **Step 3: Implement only account management and login views.** Serve built client from Express on the API origin; use accessible labels and status messages.
- [ ] **Step 4: Run auth tests, browser tests, typecheck, and build; confirm pass.**
- [ ] **Step 5: Commit** `feat: manage accounts in the durable client`.

### Milestone B: Private playlists and playback

### Task 5: Public fetch and transactional playlist snapshots

**Files:** Create `server/src/upstream/public-fetch.ts`, `server/src/playlists/{parse,repository,refresh}.ts`, `test/playlists/refresh.test.ts`, `test/fixtures/channels.m3u`; add a migration only if Task 2's schema needs a new field.

**Interfaces:** `fetchPublic(url, limits, signal)` returns response plus final URL after validating each actual connection and redirect; `parseChannels(text)` returns normalized name, optional `tvgId`/group, URL, and a stable match key; `refreshPlaylist(sourceId, deps)` fetches/parses first, then atomically upserts the owned source's channels and status. `listChannels(ownerId, sourceId)` exposes safe metadata only.

- [ ] **Step 1: Write failing tests.** Cover public-to-private redirect, mixed public/private DNS answers, IPv4-mapped IPv6, response timeout/size, credentialed URLs, malicious log text, duplicate M3U entries that reorder, stable IDs for matchable entries, empty/failing refresh preserving IDs, and successful atomic removal of vanished channels.
- [ ] **Step 2: Run `npm test -- test/playlists/refresh.test.ts`; confirm expected failures.**
- [ ] **Step 3: Review Phase 1 handoff, then implement the shared fetch path and playlist modules.** Validate at connection time; limit M3U to 16 MiB and never expose upstream query strings in returned errors.
- [ ] **Step 4: Run focused tests, Phase 1-equivalent parser/fetch fixtures, typecheck, and build; confirm pass.**
- [ ] **Step 5: Commit** `feat: persist private playlist snapshots`.

### Task 6: Playlist APIs, worker claims, and library UI

**Files:** Create `server/src/playlists/routes.ts`, `server/src/worker/{claims,index}.ts`, `client/src/views/LibraryView.vue`, `test/playlists/routes.test.ts`, `test/worker/claims.test.ts`, `e2e/library.spec.ts`; modify app wiring and Compose worker command.

**Interfaces:** Source routes add/list/remove/request-refresh by authenticated owner; channel routes list owned channels. `claimDueRefresh(pool, now)` leases one due playlist or XMLTV job using PostgreSQL row locking; an expired lease may be retried. `runWorker(deps, signal)` polls due work and calls the correct refresh service. An immediate refresh request sets due time; it does not run unbounded network work in the HTTP request.

- [ ] **Step 1: Write failing tests.** Cover cross-user source/channel IDs, source removal isolation, due/on-demand refresh, two concurrent claimers selecting different work, expired claim retry after worker death, stale state showing last-good channels, and URL redaction in API responses.
- [ ] **Step 2: Run focused API/worker/browser tests; confirm expected failures.**
- [ ] **Step 3: Implement routes, leased claims, and the library view.** Show queued, healthy, stale, and failed states with last attempt/success; avoid a worker busy loop.
- [ ] **Step 4: Run focused tests, typecheck, build, and a Compose worker restart check; confirm pass.**
- [ ] **Step 5: Commit** `feat: refresh and browse private playlists`.

### Task 7: Expand HLS rewriting and bounded resource delivery

**Files:** Create `server/src/media/{rewrite,registry}.ts`, `test/media/{rewrite,registry}.test.ts`, HLS playlist fixtures under `test/fixtures/hls/`, plus a sample map and key resource.

**Interfaces:** `rewriteManifest(text, finalUrl, register)` returns a complete rewritten manifest or a typed unsupported/invalid error; its callback receives URL, resource kind, and optional range. `registerResource(ownerId, channelId, url, kind, range?)` in the bounded registry returns an opaque short-lived token; `getResource(token)` returns the server-side tuple or expiry. Resource kinds cover manifest, segment, initialization map, and clear AES-128 key.

- [ ] **Step 1: Write failing tests.** Cover relative/absolute references and query preservation; alternate renditions, maps, keys, byte-range offsets and inherited offsets; malformed tags and DRM/low-latency tags failing before any rewritten output; token expiry, bounded registry, and cross-user token binding.
- [ ] **Step 2: Run `npm test -- test/media/rewrite.test.ts test/media/registry.test.ts`; confirm expected failures.**
- [ ] **Step 3: Implement supported RFC 8216 subset and registry.** Carry over only reviewed Phase 1 behavior; do not parse unsupported tags as safe passthrough.
- [ ] **Step 4: Run focused tests, typecheck, and build; confirm pass.**
- [ ] **Step 5: Commit** `feat: rewrite supported HLS resources`.

### Task 8: Authenticated media routes and player

**Files:** Create `server/src/media/routes.ts`, `client/src/views/PlayerView.vue`, `test/media/routes.test.ts`, `e2e/playback.spec.ts`; modify app wiring.

**Interfaces:** A root manifest route accepts an owned channel ID. A nested resource route accepts only a registry token, authenticates again, checks active account and channel ownership, and fetches through `fetchPublic`. No route accepts an upstream URL from the browser. The player uses native HLS or hls.js and only same-origin paths.

- [ ] **Step 1: Write failing tests.** Exercise root/child manifest, segment, key, map, and byte-range response headers and bodies; oversized requested range; source deletion; account disabled between manifest and segment; token from another user; upstream failure/redaction; disconnect cancellation; unsupported HLS error before response body.
- [ ] **Step 2: Run focused route/browser tests; confirm expected failures.**
- [ ] **Step 3: Implement routes and player.** Check owner before each fetch, cap media to 32 MiB per response, and mark private media/key responses `no-store`. Distinguish unavailable, unsupported, expired, and unauthenticated states in the UI.
- [ ] **Step 4: Run media tests and fixture browser playback; inspect browser network requests for only ReHLS media URLs. Run typecheck/build; confirm pass.**
- [ ] **Step 5: Commit** `feat: play owner-scoped HLS through ReHLS`.

### Milestone C: XMLTV guide

### Task 9: Bounded XMLTV parser and transactional guide snapshots

**Files:** Create `server/src/guide/{parse,repository,refresh}.ts`, `test/guide/refresh.test.ts`, `test/fixtures/{guide.xml,guide.xml.gz}`; add a migration only for fields the Task 2 schema did not anticipate.

**Interfaces:** `parseXmltv(stream, limits, window)` emits normalized XMLTV channels and programs with bounded count, text length, and time window; `refreshGuide(sourceId, deps)` fetches through `fetchPublic`, parses before committing, then atomically replaces that owned source's guide snapshot and status. Reject DTD/external entities. Normalize XMLTV timestamps to UTC while retaining source channel IDs.

- [ ] **Step 1: Write failing tests.** Cover valid channels/programs, timezone offsets, malformed time, missing channel references, DTD/entity input, out-of-window programs, duplicate IDs, empty/failing refresh retaining last-good data, source URL redaction, and compressed input that expands past the limit while retaining the old guide.
- [ ] **Step 2: Run `npm test -- test/guide/refresh.test.ts`; confirm expected failures.**
- [ ] **Step 3: Implement streaming `saxes` adapter, compressed-input handling, and transactional snapshot.** Bound compressed input, decompressed bytes, XML depth/text, program count, and refresh time; retain 12 hours past and 7 days ahead as the guide window.
- [ ] **Step 4: Run focused tests, typecheck, and build; confirm pass.**
- [ ] **Step 5: Commit** `feat: persist bounded XMLTV snapshots`.

### Task 10: Guide source APIs and mapping rules

**Files:** Create `server/src/guide/{mapping,routes}.ts`, `test/guide/{routes,mapping}.test.ts`; extend worker dispatch and app wiring.

**Interfaces:** Guide source routes add/list/remove/request-refresh by owner. `resolveGuideChannel(ownerId, channelId)` returns a manual mapping when set, else a unique `tvg-id` match among that user's guide sources, else no match. Routes set/clear overrides and return current/upcoming programs plus match provenance; they never query another owner's feed.

- [ ] **Step 1: Write failing tests.** Cover automatic exact `tvg-id` match, absent/ambiguous matches, manual override precedence and clearing, cross-user guide source/channel/mapping IDs, and failed refresh with old programs still queryable.
- [ ] **Step 2: Run focused guide/worker tests; confirm expected failures.**
- [ ] **Step 3: Implement routes, mapping resolution, and worker guide dispatch.** Return safe refresh status and empty current/upcoming state when no match or program exists.
- [ ] **Step 4: Run guide tests, typecheck, build, and worker retry check; confirm pass.**
- [ ] **Step 5: Commit** `feat: expose private guide and mapping APIs`.

### Task 11: Guide settings and now/next client

**Files:** Create `client/src/views/GuideView.vue`, `client/src/components/{GuideSourceStatus,ChannelMapping}.vue`, `e2e/guide.spec.ts`; modify library/player navigation.

**Interfaces:** The client lets a user add/refresh/remove their XMLTV source, inspect automatic/manual match, change or clear an override, and see current/upcoming programs beside owned channels. Guide failure never disables playback.

- [ ] **Step 1: Write failing browser tests.** Cover a source with matching `tvg-id`, manual override of an ambiguous match, no-guide empty state, stale status with old programs still visible, and a narrow viewport.
- [ ] **Step 2: Run Playwright guide tests; confirm expected failures.**
- [ ] **Step 3: Implement settings, mapping, and program views using existing safe APIs.** Display source freshness and match provenance without upstream URLs.
- [ ] **Step 4: Run guide browser tests, typecheck, and build; confirm pass.**
- [ ] **Step 5: Commit** `feat: show private current and upcoming guide`.

### Milestone D: Compose exit gate and documentation

### Task 12: Two-user restart, deployment, and smoke evidence

**Files:** Create `e2e/phase-2-exit.spec.ts`; update `README.md`, `.env.example`, `docs/phase-2-handoff.md`, and Compose/Docker files only where verification exposes a specific gap.

**Interfaces:** The README documents local setup, first-admin command, migration, worker, HTTPS proxy expectations, backup/restore, and playback restart limit. The handoff records fixture browser results, selective Phase 1 promotion, public-stream smoke outcome, known unsupported forms, and the exit-gate result.

- [ ] **Step 1: Write the two-user exit test.** Admin creates users A and B; both add distinct playlist/XMLTV fixtures and play channels; each sees own now/next data; all cross-user API and nested media IDs fail; a Compose restart preserves records and sessions; failed source refreshes preserve last-good data with visible stale/failed status.
- [ ] **Step 2: Run the test against a disposable Compose stack; record failures and fix only identified Phase 2 gaps.** Keep this task focused on integration, not new product scope.
- [ ] **Step 3: Run full tests, typecheck, build, and `docker compose config`; verify a fresh install and a restart.** Capture commands and results in the handoff note.
- [ ] **Step 4: Attempt one public HTTP(S) M3U/HLS smoke check.** Record browser, source category, playback result, whether all media requests target ReHLS, and whether failure came from upstream availability. Never make the automated exit gate depend on the public source.
- [ ] **Step 5: Document deployment and recovery, then commit** `docs: verify phase 2 exit gate` after results and limits are recorded.

## Plan completion check

The plan is implemented only when every task's focused tests and commit exist, the full controlled exit check passes, and the handoff note records any public-stream limitation separately. If the exit check finds a missing requirement, update this plan and the approved spec before adding scope.
