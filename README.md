# Personal Knowledge Hub

Personal Knowledge Hub is a private notes project. The current API provides account registration and browser sessions backed by PostgreSQL.

## Local setup

Use Node 24.7 or later in the Node 24 release line and pnpm 12.16.1 on your PATH. Start Docker Desktop or a Docker Engine with Compose.

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
cp .env.example .env
git config --local core.hooksPath .githooks
docker compose --env-file .env -f infra/compose.yaml up -d --wait
pnpm --filter @knowledge-hub/database db:migrate
pnpm dev
```

Open the Vite URL printed by `pnpm dev` (default `http://localhost:5173`). Vite forwards API requests to the API on loopback. For a production build, serve the static assets and route `/api/` to NestJS on the same origin.

```sh
curl --fail http://127.0.0.1:3000/api/v1/health
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm build
```

The integration smoke test exercises pgvector with synthetic vectors and rolls back its changes. It uses the Compose service by default. Set standard PostgreSQL environment variables including `PGHOST` to use a separate database with `psql` installed. The relational and auth integration tests each create and drop a temporary database, so the test role needs permission to create databases.

## Browser authentication

The API serves its generated OpenAPI JSON at `/api/v1/openapi.json`. Registration and login accept JSON with `email` and `password`, start a seven-day session, and return the account and a session-bound CSRF token. Call `GET /api/v1/auth/me` to recover that token after a page reload. Send it as `X-CSRF-Token` on authenticated writes. Logout revokes the current session and clears its cookie. Browser requests across allowed origins must use `credentials: 'include'`.

Every auth POST requires an exact allowlisted browser `Origin`. Local defaults allow Vite development and preview on ports 5173 and 4173 on `localhost` and `127.0.0.1`. For production, set `NODE_ENV=production` and `WEB_ORIGINS` to a comma-separated list of exact HTTPS origins, with no paths or trailing slashes. Serve the web app and API on the same HTTPS origin where possible. If they use different origins, deploy them on the same site so the host-only, `SameSite=Lax` session cookie works. HTTPS deployments use a `Secure`, `HttpOnly` cookie with the `__Host-` prefix.

Registration and login share a limit of ten attempts per minute per direct client IP per API process. Requests forwarded by a reverse proxy share its IP quota. Keep the API on loopback behind the proxy. Expired sessions stop authenticating immediately. Operators can periodically remove expired rows with `DELETE FROM sessions WHERE expires_at <= now()`.

## Database migrations

With Compose running, apply the checked-in migrations with:

```sh
pnpm --filter @knowledge-hub/database db:migrate
```

This applies the Drizzle migrations and initializes the Graphile Worker schema through its migration API. The command exits once both schemas are ready. The migration command and API load the local `.env` and accept `DATABASE_URL` or standard PostgreSQL connection variables. If your `.env` predates the database package, add the `PGPASSWORD` setting from `.env.example` for the local Compose database.

After changing the Drizzle schema, generate and review a new migration with `pnpm --filter @knowledge-hub/database db:generate --name=describe_change`. Keep applied migrations intact.

On a local development database, optionally load the synthetic garden note and its tag after migrating:

```sh
pnpm --filter @knowledge-hub/database db:seed
```

Rerunning the seed preserves existing fixture rows and creates no duplicates. The fixture account has a disabled password placeholder and no session.

Stop the development database with `docker compose --env-file .env -f infra/compose.yaml down`. The volume retains development data. Docker and model downloads are independent. Milestone 0 requires no AI runtime.

See the [implementation plan](docs/IMPLEMENTATION_PLAN.md) and [guardrail setup](docs/HOOKS.md) for release order and CI.
