# ReHLS Phase 2: Core Application Design

**Date:** 2026-10-05
**Status:** Approved for planning
**Parent:** [Project design](2026-10-04-rehls-project-design.md) and [roadmap](../../ROADMAP.md)

## Purpose and exit gate

Turn the Phase 1 local experiment into a persistent, self-hostable web application for more than one person. An instance admin creates two users; each user can save and refresh an M3U source, play an HLS channel through ReHLS, add an XMLTV source, and see current and upcoming programs. Neither user can read or act on the other's library, guide configuration, or media resources. A Linux Docker Compose restart preserves accounts, sources, channels, mappings, and guide data. Failed refreshes remain visible while the last good data stays usable.

This phase implements the full Phase 2 roadmap through vertical milestones: deployment and identity; private playlists and playback; guide ingestion and UI; then the two-user Compose exit check. Each milestone has an end-to-end user flow and tests. Phase 1 has no recorded browser or public-stream findings note, so Phase 2 begins with a controlled browser playback check before promoting its media code. A live public stream remains an additional smoke check, never an automated test dependency.

## Scope and architecture

A single repository contains a TypeScript Express API, media module, Vue/TypeScript/Tailwind client, and a TypeScript refresh worker. Docker Compose runs the app, worker, and PostgreSQL as separate processes. The app serves the built client from the same origin as its API and media routes. The worker uses the same domain modules and database, claims due refresh work without duplicate execution, and does not serve HTTP. Database migrations run explicitly before the app and worker start; a failed migration prevents startup. This is one deployable application, with no separately deployed microservices.

PostgreSQL owns users, session records, playlist and guide sources, parsed channels and programs, mapping overrides, and refresh status. It stores upstream source and channel URLs, but never live manifests, segment bytes, or key bytes. Short-lived HLS resource references live in a bounded app-process registry. An app restart may interrupt a current playback session; reloading its channel manifest starts a new one.

The Phase 1 `parseChannels`, public-destination fetch policy, and basic HLS rewrite behavior are candidates for selective reuse after tests and code review. Its static player, unauthenticated routes, and in-memory channel library are discarded. No Phase 1 file is copied solely because it exists.

## Identity and ownership

The first admin is created through a one-time server-side setup command when the user table is empty. The command reads the password without putting it in shell arguments, rejects later bootstrap attempts, and avoids an unauthenticated browser setup route. There is no public registration. An admin can create accounts, disable them, and reset their passwords; ordinary users can change their own password. Passwords use a maintained password-hashing library with a memory-hard algorithm. Login is rate-limited, and login and password changes rotate or revoke affected sessions.

Login creates an opaque, revocable, database-backed session so it survives app restarts. The browser receives only an `HttpOnly`, `SameSite` session cookie; use `Secure` when served over HTTPS. State-changing routes require same-origin request protection in addition to cookie settings. The server checks authentication and ownership on every source, channel, guide, mapping, and media route, including every nested HLS request. A disabled account cannot continue using an existing session. IDs are opaque; clients never receive upstream stream URLs, source credentials, or key material. Admin rights do not silently turn ordinary library routes into cross-user access.

All persistent records are associated with an owner directly or through a parent whose ownership is checked in the query. The main records are users, sessions, playlist sources, channels, XMLTV sources, XMLTV channel metadata, bounded programs, and explicit channel-to-guide overrides. Database constraints and transactional operations enforce parent relationships. API tests deliberately try cross-user IDs and nested media tokens.

## Playlist library and refresh

An authenticated user adds, lists, refreshes, and removes their own public HTTP(S) M3U sources. The UI lists sources, channel name and available metadata such as `tvg-id` and group, last successful refresh, last attempt, and a clear healthy/stale/failed state. A source can be refreshed on demand and is also refreshed periodically by the worker; the worker prevents concurrent refresh of the same source. The first import and each refresh have bounded download size, time, and parse work.

Fetch and parse complete before a database transaction replaces that source's channel snapshot. A failed fetch, parse, or empty result leaves the prior channels and IDs usable and records a sanitized failure state. A successful refresh updates the snapshot atomically and retains stable channel IDs when a channel can be matched to its previous entry; duplicate entries remain distinguishable. A removed source deletes only that user's associated channels and mappings. Source URLs remain server-side; the browser sees only safe metadata and opaque IDs.

## Playback and HLS trust boundary

Playback starts from a channel owned by the active user. The server fetches its current HLS manifest, resolves relative references against the final upstream URL, and rewrites every supported referenced manifest, segment, initialization section, alternate rendition, and clear AES-128 key URI to a ReHLS route. Byte-range playlists and HTTP range requests are supported with bounded responses and correct range semantics. The supported HLS subset and any unsupported tag or encryption method are detected before returning a partly rewritten manifest. DRM, low-latency HLS parts, provider-specific headers, and transcoding remain outside this phase.

Every initial URL, redirect, DNS answer used for connection, and nested HLS resource must resolve to a public HTTP(S) destination. The fetch path limits redirect count, time, body size, and media concurrency; browser disconnects cancel upstream work. Media tokens are opaque, short-lived, and bound to the owning user and channel. A token cannot grant access after its source or account is removed or disabled. No route accepts an arbitrary browser-supplied upstream URL. Upstream query strings must survive server-side resolution but never appear in browser URLs, API errors, or logs. Key responses and private metadata are not cached in shared browser or intermediary caches.

The Vue player uses direct HLS playback through native support or hls.js and sends only same-origin media requests. It distinguishes unavailable upstream, unsupported stream, expired playback, and authentication failure in user-facing status. Playback never depends on guide availability.

## XMLTV and guide

Each user can add, list, refresh, and remove their own public HTTP(S) XMLTV source. The worker refreshes sources periodically; a user may request an immediate refresh. Downloads, decompression, parsing, and stored program counts are bounded. Parsing uses a maintained XMLTV-capable library if it fits the feed formats and limits; a small adapter handles ReHLS-specific normalization. A successful refresh atomically replaces that source's bounded guide window, including XMLTV channel IDs and programs. A failed or empty refresh preserves the last good snapshot and records a sanitized error and stale timestamp.

Automatic matching uses a playlist channel's `tvg-id` against an XMLTV channel ID among that user's guide sources. When absent or ambiguous, the user can explicitly choose a guide channel; an override takes precedence until removed. Mapping can also be cleared. The UI shows the chosen match and whether it is automatic or manual. Current and upcoming programs come from the stored snapshot and current time; missing guide data shows an empty state and does not block playback. Program records retain at least title, start, end, and source identity; out-of-window entries are pruned only after a successful refresh.

## Client and deployment

The durable Vue client has login, admin account management, a private source and channel library, a channel player, guide-source settings, mapping controls, and current/upcoming program views. It shows import and guide freshness next to the affected data and keeps the last good content visible during failures. Responsive layouts must remain usable on a desktop and a narrow screen. The interface does not expose upstream URLs or Phase 1's disposable controls.

Compose provides health checks, persistent PostgreSQL storage, app and worker configuration, and a documented first-admin command. The default published app port binds to localhost; operators placing it on a network use HTTPS through a reverse proxy and configure trusted proxy handling explicitly. Secrets are supplied at deployment, never committed. Startup and restart instructions include migration, backup/restore, and the limits of in-flight playback during an app restart.

## Verification and release gate

1. Review the archived Phase 1 parser/fetch/HLS tests and run a fixture-backed browser playback check. Record what was reused, rewritten, or discarded. A public stream smoke result is documented separately, including an unavailable upstream as an environmental result.
2. Exercise account bootstrap, login/logout, session persistence and revocation, admin-only account management, and cross-user denial for every API and nested media path.
3. Exercise successful and failed M3U and XMLTV refreshes against controlled fixtures. Verify atomic replacement, last-good preservation, visible stale status, stable channel identity where matchable, mapping precedence, and bounded input behavior.
4. Exercise master and media playlists, alternate renditions, initialization maps, clear AES-128 keys, byte ranges, redirects, public-destination validation, cancellation, and sanitized failures with controlled upstream servers. Unsupported formats produce explicit errors before partial manifests.
5. In a browser, two admin-created users independently save sources, play fixture channels with every media request going through ReHLS, and see current/upcoming guide data. Cross-user IDs and tokens fail. Restart Compose and verify their data and guide state persist; deliberately fail refreshes and verify last-good data plus visible status.

No FFmpeg conversion, VAAPI, recordings, bundled streams or guide data, DRM, automatic guide discovery, non-HTTP sources, provider-specific authentication, or series rules are part of this phase. Any new scope decision changes this spec before implementation.

## Protocol and security references

- [HLS URI, encryption, and byte-range rules (RFC 8216)](https://www.rfc-editor.org/rfc/rfc8216.html)
- [OWASP session management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP CSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
