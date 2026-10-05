# Phase 1 archive

This directory preserves the local-only ReHLS proof of concept: M3U import, an in-memory channel list, and HLS restreaming through an Express backend with a disposable browser player. It is the Phase 1 attempt, not the durable Phase 2 application.

From this directory, with Node.js 24 or newer:

```sh
npm ci
npm test
npm run typecheck
npm run build
npm run dev
```

The development server binds to `127.0.0.1:3000` by default. The implementation supports ordinary unencrypted HLS master and media playlists with URI lines and complete segments. It rejects unsupported HLS features such as alternate rendition URIs, keys, maps, partial segments, and byte ranges.

The [Phase 1 design](docs/superpowers/specs/2026-10-04-rehls-phase-1-design.md) and [implementation plan](docs/superpowers/plans/2026-10-04-rehls-phase-1.md) are archived alongside the code. The repository's [project design](../../docs/superpowers/specs/2026-10-04-rehls-project-design.md) and [roadmap](../../docs/ROADMAP.md) remain at the root.
