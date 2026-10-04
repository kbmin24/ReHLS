# ReHLS instructions for coding agents

Read [the project design](docs/superpowers/specs/2026-10-04-rehls-project-design.md) and [roadmap](docs/ROADMAP.md) before planning or implementation. They capture owner-approved project direction; phase-specific specs and plans supply implementation details.

## Current state

The repository contains planning documents and a placeholder README. Do not infer an existing application architecture. The owner explicitly requested planning first and no product code yet. Start a phase only after its narrower spec and implementation plan have been reviewed.

## Project commitments

- Target a personal, self-hostable, multi-user IPTV web client for Linux Docker Compose.
- Use Express and TypeScript for the backend, Vue and TypeScript with Tailwind CSS for the frontend, and PostgreSQL for production persistence.
- Treat phase 1 as a local-only proof of concept: import M3U, select a channel, and restream HLS through the backend without transcoding. Keep its UI disposable.
- In the durable app, make playlist libraries, guide settings, and recordings private to each account. Admins create accounts.
- Store source URLs and parsed channel metadata, not live manifest history or video blobs, in PostgreSQL.
- Use user-supplied XMLTV URLs for guide data. Match by `tvg-id` with a manual override.
- Prefer direct HLS playback. Add FFmpeg conversion, optional VAAPI, software fallback, and recordings in phase 3.
- Support only public HTTP(S) sources initially. Do not add bundled IPTV content, DRM handling, or provider-specific authentication without a new design decision.

## Engineering boundaries

- Prefer maintained external libraries whenever possible and appropriate; write custom code when a library does not fit the requirement.
- Treat remote playlist, guide, manifest, and media URLs as untrusted. Apply public-destination checks to initial requests, redirects, and nested HLS resources; bound fetch time and size. Do not create a generic open proxy.
- Check account ownership on every durable API and media route. Do not expose upstream URL query strings in logs or browser-visible errors.
- Preserve the last good playlist or guide snapshot when refresh fails, and surface stale or failed status.
- Keep API, media, guide ingestion, and jobs in clear modules. Do not split into deployed microservices before a demonstrated need.
- Prefer local fixtures and controlled streams for automated verification; live public streams are an additional smoke check, not a deterministic test dependency.
- Keep future changes within the active phase. Record new scope decisions in the design or a phase spec before changing implementation direction.

## Working agreement

Write a phase-specific spec and implementation plan before product code. Review the relevant documents, make the smallest testable change for the active task, and report verification results and remaining limits. Do not start coding solely from this project-level roadmap.
