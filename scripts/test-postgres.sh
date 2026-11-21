#!/bin/sh
set -eu

check_database() {
  "$@" -X -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TEMP TABLE smoke_vectors (id integer PRIMARY KEY, embedding vector(3));
INSERT INTO smoke_vectors VALUES (1, '[1,0,0]'), (2, '[0,1,0]');
DO $$
BEGIN
  IF (SELECT id FROM smoke_vectors ORDER BY embedding <=> '[1,0,0]' LIMIT 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'pgvector smoke test returned an unexpected nearest neighbor';
  END IF;
END $$;
ROLLBACK;
SQL
}

if [ -n "${PGHOST:-}" ]; then
  check_database psql
else
  check_database docker compose -f infra/compose.yaml exec -T postgres psql -U knowledge_hub -d knowledge_hub
fi
