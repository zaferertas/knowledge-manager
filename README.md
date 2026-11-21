# Personal Knowledge Hub

Private notes and question answering from your own notes. The initial scaffold provides a web page, an API liveness endpoint, and a PostgreSQL/pgvector smoke test.

## Local setup

Use Node 24 and pnpm 12.16.1 on your PATH. Start Docker Desktop or a Docker Engine with Compose.

```sh
corepack enable pnpm
pnpm install --frozen-lockfile
cp .env.example .env
git config --local core.hooksPath .githooks
docker compose --env-file .env -f infra/compose.yaml up -d --wait
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

The integration smoke test exercises pgvector with synthetic vectors and rolls back its changes. It uses the Compose service by default. Set standard PostgreSQL environment variables including `PGHOST` to use a separate database with `psql` installed. The relational test creates and drops a separate temporary database, so the test role needs permission to create databases.

## Database migrations

With Compose running, apply the checked-in migrations with:

```sh
pnpm --filter @knowledge-hub/database db:migrate
```

This applies the Drizzle migrations and initializes the Graphile Worker schema through its migration API. The command exits once both schemas are ready. It loads the local `.env` and accepts standard PostgreSQL connection variables. If your `.env` predates the database package, add the `PGPASSWORD` setting from `.env.example` for the local Compose database.

After changing the Drizzle schema, generate and review a new migration with `pnpm --filter @knowledge-hub/database db:generate --name=describe_change`. Keep applied migrations intact.

Stop the development database with `docker compose --env-file .env -f infra/compose.yaml down`. The volume retains development data. Docker and model downloads are independent. Milestone 0 requires no AI runtime.

See the [implementation plan](docs/IMPLEMENTATION_PLAN.md) and [guardrail setup](docs/HOOKS.md) for release order and CI.
