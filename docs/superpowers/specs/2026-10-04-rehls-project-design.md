# ReHLS Project Design

**Date:** 2026-10-04  
**Status:** Proposed for owner review

## Purpose

ReHLS is a personal, self-hostable web client for people who know how to host software and want to watch IPTV channels from M3U channel lists and HLS streams. It will let multiple users keep private channel libraries, watch through the ReHLS backend, consult a program guide, and eventually transcode and record programs. The first deployment target is Linux with Docker Compose.

The project is intentionally split into a disposable proof of concept, a durable core application, and media enrichment. Phase 1 establishes that playlist import and backend-served browser playback work before the production architecture is built. Its UI may be discarded; proven parser and proxy behavior may be carried forward.

## Confirmed decisions

| Area | Decision |
| --- | --- |
| Phase 1 success | Import an IPTV `.m3u` channel list, select one channel, and play its HLS `.m3u8` stream through the backend in a browser. |
| Account model | An instance admin creates accounts. Each user has a private library and owns their sources, guide settings, and recordings. |
| Guide | Users supply XMLTV feed URLs. ReHLS refreshes and stores parsed guide data. |
| Source types | Public HTTP(S) playlists and streams first. |
| Persistence | Store playlist source URLs and parsed channel metadata in PostgreSQL; do not archive changing live HLS manifests. |
| Deployment | Linux with Docker Compose first. |
| Media conversion | Direct play when possible; FFmpeg transcoding when needed, with optional VAAPI and software fallback. |
| Recording | Immediate recording, guide-based scheduling, and manual channel/time scheduling. |

The repository already uses the GNU AGPL v3 license. The planned backend is Express with TypeScript, the frontend is Vue with TypeScript and Tailwind CSS, and the production database is PostgreSQL.

## System shape

The production system is a modular application in one codebase. The API owns accounts, sources, channels, guide mappings, and recording metadata. A media module resolves channel streams and serves HLS resources through authenticated, account-scoped routes. A background job process refreshes sources and guides and, in phase 3, runs recording and transcoding work. These processes share PostgreSQL; recording files live on a persistent host-mounted volume. This boundary permits separate processes without requiring independently deployed services at the outset.

```mermaid
flowchart LR
  Browser[Vue browser client] --> API[Express API and media routes]
  API --> DB[(PostgreSQL)]
  API -->|validated HTTP(S)| Upstream[Playlist and HLS sources]
  Worker[Background jobs] --> DB
  Worker -->|validated HTTP(S)| Upstream
  Worker --> FFmpeg[FFmpeg / optional VAAPI]
  FFmpeg --> Files[(Recording volume)]
```

### Playlist and playback flow

An authenticated user adds a public HTTP(S) M3U source. ReHLS fetches and parses it, stores the source URL and channel metadata under that user's account, and preserves the last good import if a refresh fails. The library shows refresh status. A channel retains its upstream HLS URL; the database does not retain the continuously changing manifest or video segments.

For playback, the browser requests a user-owned channel from ReHLS. The media route fetches its HLS manifest, resolves relative references against the manifest URL, rewrites child playlist and media resource URLs to ReHLS routes, and streams the referenced resources. Query strings on upstream URLs must survive rewriting. The initial proof of concept targets an ordinary, unencrypted HLS stream with master or media playlists and segment references. The phase 2 media hardening pass covers common HLS URI-bearing tags, byte ranges, and clear-key AES-128 HLS where browser playback supports them. A source outside the supported set produces a clear error. ReHLS is not a generic open URL proxy.

The phase 1 UI is only a channel picker and player. The phase 2 Vue UI replaces it with account management, private libraries, guide views, and playback. Phase 1 may keep imports in memory. PostgreSQL persistence starts in phase 2.

### Guide flow

A user supplies an XMLTV feed URL. A scheduled refresh parses channel and programme entries and stores a bounded, useful guide window. The primary match is playlist `tvg-id` to XMLTV channel ID; users can override a mismatch manually. Current and next program information is derived from refreshed guide entries and current time, rather than requiring a live third-party lookup for every page view. Failed refreshes retain the last good data and show when it became stale. Missing guide data never prevents channel playback.

### Transcoding and recording flow

Phase 3 adds a media capability check and FFmpeg path for streams that the browser cannot play directly. VAAPI acceleration is optional; software FFmpeg encoding is the fallback. ReHLS limits concurrent conversions, owns subprocess lifetimes, and cleans up abandoned sessions. Direct playback remains the first choice.

Recording schedules are durable PostgreSQL jobs. A user can start recording a channel immediately, choose a guide program, or enter a channel and time range. A worker launches FFmpeg, writes to the persistent volume, and tracks pending, running, completed, failed, and interrupted outcomes. Jobs survive application restarts as schedule records; an interrupted or missed capture is reported accurately. Files and metadata are scoped to the owning account. The first release uses local filesystem storage rather than object storage.

## Trust and failure boundaries

Playlist, guide, and embedded HLS URLs are untrusted input. Production fetches must allow only public HTTP(S) destinations, validate every redirect and embedded resource fetch, restrict response sizes and timeouts, and avoid exposing internal network services. All library, playback, and recording routes require authentication and ownership checks. The unauthenticated phase 1 experiment should bind to localhost and is not a deployable public service.

Upstream channels can disappear, stall, or change formats. Playback should surface those errors, cancel disconnected fetches, and avoid persisting broken manifest state. Import and guide refreshes should retain the last good snapshot on failure. FFmpeg failures and storage exhaustion should result in failed recording status and useful logs. Logs should identify jobs and channels without exposing sensitive URL query strings.

Users supply and are responsible for the sources they access and record. ReHLS does not bundle channels, guide data, or a content service.

## Phase gates

1. **Proof of concept:** A representative IPTV M3U list imports; a selected live HLS channel plays in a browser with playlist and media requests passing through ReHLS. Parsing, relative URI handling, and proxy behavior are checked against local fixtures. The result is documented as reusable or disposable before phase 2 begins.
2. **Core application:** Two admin-created users independently save and refresh sources, play channels, and see current and upcoming programs from their XMLTV feeds. Their data stays private. The application and PostgreSQL restart cleanly through Docker Compose, preserving data and reporting stale imports.
3. **Enrichment:** An incompatible stream can play through FFmpeg with software fallback when VAAPI is unavailable. Immediate, guide-based, and manual scheduled recordings create usable files, survive scheduler restarts as durable jobs, and show accurate failure states. VAAPI is verified separately on a compatible host.

## Initial scope limits

The first roadmap excludes DRM-protected streams, provider-specific authentication or custom upstream headers, non-HTTP stream protocols, automatic guide discovery, series recording rules, timeshift, and a distributed service architecture. Their absence must be presented as a supported-scope limit rather than hidden behind a generic playback error. Product code, scaffolding, and dependency installation begin only after a phase-specific spec and implementation plan are reviewed.

## Source references

- [HLS protocol and playlist URI rules (RFC 8216)](https://www.rfc-editor.org/rfc/rfc8216.html)
- [Example public IPTV M3U distribution](https://github.com/iptv-org/iptv)
- [XMLTV channel and programme format](https://github.com/XMLTV/xmltv/blob/master/xmltv.dtd)
- [FFmpeg command-line and hardware acceleration documentation](https://www.ffmpeg.org/ffmpeg.html)
