# ReHLS Design Choices

This file records owner decisions that apply across tasks.

## Common principles

- ReHLS is a personal, self-hostable, multi-user IPTV web client, initially deployed with Linux Docker Compose.
- Keep work within the active phase. Phase 1 was a local-only proof of concept; Phase 2 builds the durable private application; FFmpeg conversion and recordings belong to Phase 3.
- Prefer maintained external libraries where they fit. Write custom code only for requirements those libraries do not cover.
- Keep code and abstractions small. Add files, helpers, and tests when they serve a concrete behavior, not every possible future case.
- Use JSDoc for non-obvious purpose or important limitations, rather than repeating types or self-evident code.
- Treat remote sources as untrusted. Accept only public HTTP(S) sources initially, enforce destination checks and resource limits, and never expose upstream secrets or URL query strings in logs or browser-visible errors.
- Keep each account's library, guide settings, media access, and eventual recordings private. Preserve the last good playlist or guide snapshot when a refresh fails and show its stale or failed status.
- Use controlled fixtures and streams for deterministic verification. Live public streams are additional smoke checks.
- Do not add bundled IPTV content, DRM handling, provider-specific authentication, or new architecture or phase scope without a new design decision.

## Backend

- Use Express and TypeScript with PostgreSQL persistence. Store source URLs and parsed metadata, not live manifests or video blobs.
- Organize the backend as a modular monolith. User, admin, streaming, playlist, channel, and EPG modules own their behavior and data access. Keep service dependencies acyclic; prefer calling another service over reaching into its repository.
- Put shared authentication, permission, and rate-limit middleware under `server/src/middlewares`, and small shared helpers under `server/src/utils`. Keep Phase 2 refresh scheduling in a small jobs module used by the worker, without a SchedulingService.
- Enforce ownership in services and apply coarse permission middleware at routes. Protect public routes with `helmet`, `express-validator`, and appropriate rate limits.
- Use user-supplied XMLTV URLs for guide data. Match playlist channels by `tvg-id`, with a manual override.
- Prefer direct HLS playback through authenticated backend routes. Validate initial, redirected, and nested resource destinations; bound fetch time and size. Do not create a generic open proxy. Add FFmpeg conversion, optional VAAPI, software fallback, and recordings in Phase 3.
- Return stable structured error codes for the frontend to interpret, rather than English user-facing messages. Separate causes when the frontend needs a different action; do not create a code for every throw site.
- Keep the error-code catalog as a simple array of causes per source. Authentication belongs to the `user` source; service-independent validation and rate limits have their own sources. Generate `{ service, cause }` values from those arrays instead of maintaining an object for each cause.
- `AppError` carries an HTTP status, a structured code, and an optional payload. The error handler returns the code and includes the payload only when supplied. Use short subclasses for recurring errors and direct `AppError` calls for uncommon ones.
- Obtain owner approval before any database schema or migration change.

## Frontend

- Use Vue and TypeScript with Tailwind CSS and daisyUI. Keep the Phase 2 interface functional and visually minimal while the login and admin pages are designed.
