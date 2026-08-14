#!/usr/bin/env bash
# Container entrypoint: wait for PostgreSQL, run migrations (as the owner role),
# seed (as the restricted app role), then launch the API.
set -euo pipefail

# A managed database (Neon, Railway, RDS) is addressed by DATABASE_URL and is
# already up — there is no sidecar to wait for, and the compose-era default
# host ("postgres") would never resolve, hanging the container forever. Only
# wait when we're actually pointed at a POSTGRES_HOST sidecar.
if [ -n "${DATABASE_URL:-}" ]; then
  echo "✅ Using managed database from DATABASE_URL — skipping host wait."
else
  DB_HOST="${POSTGRES_HOST:-postgres}"
  DB_PORT="${POSTGRES_PORT:-5432}"

  echo "⏳ Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT} ..."
  for _ in $(seq 1 60); do
    nc -z "${DB_HOST}" "${DB_PORT}" && break
    sleep 1
  done
  if ! nc -z "${DB_HOST}" "${DB_PORT}"; then
    echo "❌ PostgreSQL at ${DB_HOST}:${DB_PORT} did not come up in 60s." >&2
    exit 1
  fi
  echo "✅ PostgreSQL is up."
fi

# Migrations require DDL privileges → run as the owner via MIGRATION_DB_URL.
echo "🏗  Running database migrations..."
DATABASE_URL="${MIGRATION_DB_URL:-${DATABASE_URL:-}}" alembic upgrade head

# Seeding is an explicit opt-in: it creates the SUPERADMIN and (outside
# production) the demo HOA. A requested seed that fails must stop the boot —
# a half-seeded database is worse than none — so `set -e` lets it exit here.
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "🌱 Seeding baseline data (RUN_SEED=true)..."
  python -m scripts.seed
else
  echo "🌱 Skipping seed (set RUN_SEED=true to seed on boot)."
fi

# Bind to $PORT when the platform injects one (Render/Railway/Fly), else 8000.
APP_PORT="${PORT:-8000}"
echo "🚀 Starting Casa Harmony API on :${APP_PORT}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${APP_PORT}"
