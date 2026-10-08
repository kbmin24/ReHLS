# ReHLS Phase 1: Import and Restream Design

**Date:** 2026-10-04  
**Status:** Draft for owner review  
**Parent:** [Project design](../../../../../docs/superpowers/specs/2026-10-04-rehls-project-design.md) and [roadmap](../../../../../docs/ROADMAP.md)

## Purpose and success

Prove, on one developer machine, that a public IPTV M3U list can be imported and one of its ordinary, unencrypted HLS channels can play in a browser while every manifest and media request passes through ReHLS. This experiment is local-only. Its player UI and in-memory state are disposable; parsing and media behavior may be reused after review.

The exit demonstration imports a representative public M3U list, selects an HLS channel, and shows a playing picture and sound with browser network requests addressed to ReHLS. Deterministic tests use local fixtures and a controlled upstream transport. A public stream is a separate manual smoke check because upstream availability changes.

## Approach

A single Express and TypeScript process listens on `127.0.0.1`. It serves a small static channel picker and video element, an import API, and HLS routes. The picker uses packaged hls.js when Media Source Extensions are available and native HLS as a fallback. The UI uses plain browser JavaScript because it will be replaced by the phase 2 Vue application. There is no database, account system, Docker deployment, FFmpeg, or background worker in this phase.

The alternative of building the durable Vue application now would put phase 2 structure into a throwaway experiment. A browser-direct player would not test the backend restream path. The single-process approach keeps this phase's result focused on the uncertain media behavior.

## Import and channel state

The user enters one public HTTP(S) M3U URL. `POST /api/import` accepts JSON `{ "url": "https://..." }`, fetches at most 16 MiB, parses IPTV `#EXTINF` entries with `@iptv/playlist`, and keeps each usable channel's display name, optional `tvg-id`, and HTTP(S) stream URL in memory. It returns `{ "imported": number, "skipped": number }`. Non-HTTP(S) channel entries are skipped and counted. A channel gets an opaque ID; `GET /api/channels` returns `{ "channels": [{ "id", "name", "tvgId" }] }`, never source URLs. A failed or empty import leaves the last good in-memory list intact and returns a sanitized `{ "error": string }`. Restarting loses the list by design.

The importer does not require a `.m3u8` suffix on a channel URL; the media route confirms that the response is an HLS manifest. Duplicate names may remain distinct channels. The UI shows the number imported and skipped, or a useful import failure.

## HLS flow and supported subset

`GET /api/channels/:id/manifest.m3u8` fetches that channel's current manifest. For the supported HLS subset, the backend resolves each bare URI line against the manifest URL and rewrites it to an opaque ReHLS resource route. In a master manifest, those lines identify child media manifests; in a media manifest, they identify segments. Nested manifests are fetched again on each request, so live updates are not cached as fixed files. An in-memory, bounded resource registry maps opaque IDs to upstream URLs and resource kinds; it expires old entries. Upstream query strings remain on the server and survive URI resolution. The browser receives only ReHLS resource URLs.

The initial supported subset is ordinary master or media playlists with `#EXT-X-STREAM-INF` variants and bare segment URI lines, using complete unencrypted segments. Other non-URI tags needed for ordinary playback pass through. Unhandled URI-bearing tags such as alternate rendition URIs, encryption keys, initialization maps, and partial segments, plus byte ranges, fail with a clear unsupported-stream response before a broken playlist is sent. Phase 2 will extend HLS coverage. HLS is served without transcoding. Segment bytes and a safe content type pass through; browser disconnects cancel upstream reads.

## Fetch and trust boundary

Although the process binds only to loopback, all user-supplied and nested upstream URLs are untrusted. A shared fetch path accepts only HTTP(S), rejects credentials and non-public IP destinations, checks DNS answers at connection time, and manually checks every redirect (maximum four). It has a 10-second connection/response deadline, a 16 MiB M3U limit, a 2 MiB manifest limit, and a 32 MiB per-resource media limit. It does not forward arbitrary browser headers or become a generic URL proxy. Errors and logs omit upstream query strings. The controlled test transport is injected into the app and is unavailable as a runtime mode.

This is a local proof of concept, not an authenticated public service. Production-level ownership, session handling, and wider HLS security coverage belong to phase 2.

## Verification and handoff

Automated tests cover M3U metadata extraction, skipped unsupported URLs, failed-import preservation, URL and redirect rejection, master and media rewriting, relative paths with query strings, resource size limits, unsupported HLS tags, and cancellation. An integration fixture proves that a selected channel's manifest, nested manifest, and segment all travel through ReHLS. A short generated H.264/AAC transport-stream fixture supports a browser playback check without relying on a live public source. A separate public-stream smoke check records the imported list, selected channel, playback result, browser used, and whether all media requests target ReHLS. If no public stream is reachable, record the environmental failure separately from deterministic test results.

At the end, add a short phase 1 findings note identifying parser and proxy behavior worth carrying into phase 2, unsupported stream forms observed, and the disposable UI and memory-state pieces to discard. No phase 2 implementation starts as part of this phase.

## References

- [RFC 8216 HLS playlist and relative URI rules](https://www.rfc-editor.org/rfc/rfc8216)
- [`@iptv/playlist` parser API](https://github.com/ektotv/playlist)
- [hls.js browser integration](https://github.com/video-dev/hls.js)
- [Undici fetch and dispatcher documentation](https://github.com/nodejs/undici/blob/main/docs/docs/api/Fetch.md)
- [ipaddr.js address classification](https://github.com/whitequark/ipaddr.js)
