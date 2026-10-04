# ReHLS Roadmap

This is the project-level sequence. The approved decisions and component boundaries are in [the project design](superpowers/specs/2026-10-04-rehls-project-design.md). Each phase gets its own narrower specification and implementation plan before coding.

## 1. Proof of concept: import and restream

**Outcome:** Establish that a real IPTV channel list can lead to backend-served HLS playback in a browser.

1. Build a small M3U importer that extracts channel names, stream URLs, and available IDs from a public HTTP(S) list.
2. Build a minimal Express HLS path that handles a representative master/media manifest, relative references, and segments without transcoding.
3. Add a disposable channel picker and player; exercise it with local fixtures and one public stream.
4. Record what can be reused in phase 2, including parser behavior, URL rewriting, and failure cases. Discard the proof of concept UI.

**Exit gate:** A channel from an imported list plays in the browser while playlist and media requests go through ReHLS. This phase is local-only and does not claim production security or persistence.

## 2. Core application: private libraries, playback, guide

**Outcome:** A usable, persistent multi-user web application.

1. Establish the TypeScript Express/Vue/Tailwind application, PostgreSQL migrations, and Linux Docker Compose deployment.
2. Add first-admin setup, admin-created accounts, login/session handling, and user-scoped access throughout the API.
3. Persist playlist sources and parsed channels; support refresh, last-good snapshots, and clear import status.
4. Carry forward and harden HLS playback with authenticated routes, public-destination URL validation, common HLS resource references, cancellation, and useful errors.
5. Add per-user XMLTV sources, scheduled refresh, `tvg-id` matching, manual mapping, and current/upcoming guide views.
6. Build the durable Vue library, guide, and player experience, then verify two-user isolation and restart persistence.

**Exit gate:** Two users can keep independent sources, watch channels, and see guide data after a Compose restart. Unavailable streams and stale data are visible rather than silently discarded.

## 3. Enrichment: conversion and recording

**Outcome:** Browser playback for more streams and durable user-owned recordings.

1. Add a direct-play versus transcode decision, FFmpeg process supervision, session cleanup, and concurrent-work limits.
2. Add optional VAAPI configuration and software fallback; verify both paths, with hardware validation on a compatible host.
3. Add a durable recording scheduler and local storage volume, then immediate, guide-based, and manual time-based jobs.
4. Add recording status, file access, interruption handling, and storage/concurrency controls.

**Exit gate:** A stream needing conversion plays without VAAPI, and all three recording entry paths produce usable files with accurate job states. Scheduled work remains represented after a restart.

## Planning rule

Keep phase 1 intentionally small. Before starting a phase, write and review its own spec and task-level implementation plan. Promote only proven phase 1 behavior into phase 2; do not carry over its temporary UI or local-only trust assumptions.
