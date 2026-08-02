#!/usr/bin/env bash
# Container entrypoint: wait for PostgreSQL, run migrations (as the owner role),
# seed (as the restricted app role), then launch the API.
set -euo pipefail

DB_HOST="${POSTGRES_HOST:-postgres}"
DB_PORT="${POSTGRES_PORT:-5432}"

echo "⏳ Waiting for PostgreSQL at ${DB_HOST}:${DB_PORT} ..."
until nc -z "${DB_HOST}" "${DB_PORT}"; do
  sleep 1
done
echo "✅ PostgreSQL is up."

# Migrations require DDL privileges → run as the owner via MIGRATION_DB_URL.
echo "🏗  Running database migrations..."
DATABASE_URL="${MIGRATION_DB_URL:-${DATABASE_URL:-}}" alembic upgrade head

echo "🌱 Seeding baseline data..."
python -m scripts.seed || echo "(seed skipped/failed — continuing)"

# Bind to $PORT when the platform injects one (Render/Railway/Fly), else 8000.
APP_PORT="${PORT:-8000}"
echo "🚀 Starting Casa Harmony API on :${APP_PORT}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${APP_PORT}"
