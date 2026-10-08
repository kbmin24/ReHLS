# ReHLS

Phase 2 setup is in progress. The project direction is in [the design](docs/superpowers/specs/2026-10-04-rehls-project-design.md) and [roadmap](docs/ROADMAP.md).

## Local development setup

The empty, Git-ignored `.env.local` is for local Node processes. Fill it using the variable names in [`.env.example`](.env.example). Set `DATABASE_URL` to your local PostgreSQL database, set a random `SESSION_SECRET` of at least 32 characters, and keep `APP_ORIGIN=http://127.0.0.1:5173` when using the Vite dev server. Do not put secrets in client-side `VITE_` variables.

After installing dependencies with `npm ci`, run `npm run migrate:local`, then start the API with `npm run dev` and the client with `npm run dev:client` in separate terminals. The client proxies `/api` to the local API. `npm run dev:worker` currently starts only the worker scaffold; refresh scheduling comes later in Phase 2. The first-admin command is added in the account milestone.

For Compose deployment, supply the same server configuration through the deployment environment. The container's `DATABASE_URL` must use the Compose database hostname (`db`) rather than the local host address. The app port is published on loopback by default.
