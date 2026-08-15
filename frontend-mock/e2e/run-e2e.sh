#!/usr/bin/env bash
# E2E orchestration: boots the real backend + the live-mode frontend, runs the
# Playwright suite, tears everything down. Everything in one shell because
# background servers are killed when the invoking shell exits.
#
#   bash e2e/run-e2e.sh [--flow <name>] [--api-only]
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FE="$ROOT/frontend-mock"
BE="$ROOT/backend"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-3000}"
FLOW="${1:-all}"
ARGS=""
[ "$FLOW" != "all" ] && ARGS="--flow $FLOW"

API_LOG=/tmp/casa_e2e_api.log
WEB_LOG=/tmp/casa_e2e_web.log

cleanup() {
  [ -n "${API_PID:-}" ] && kill "$API_PID" 2>/dev/null
  [ -n "${WEB_PID:-}" ] && kill "$WEB_PID" 2>/dev/null
  wait 2>/dev/null
  echo "--- teardown: servers stopped ---"
}
trap cleanup EXIT

echo "==> booting backend on :$API_PORT"
# Load backend secrets (SA credentials for the E2E login) into the shell.
set -a
. "$BE/.env" 2>/dev/null || echo "(no backend/.env — relying on exported vars)"
set +a
export SA_EMAIL="${SUPERADMIN_EMAIL:-superadmin@casaharmony.ai}"
export SA_PW="${SUPERADMIN_PASSWORD:-ChangeMe!Superadmin1}"

cd "$BE" && ./.venv/bin/uvicorn app.main:app --port "$API_PORT" > "$API_LOG" 2>&1 &
API_PID=$!

echo "==> booting frontend (live mode) on :$WEB_PORT"
cd "$FE" && npx next dev --port "$WEB_PORT" > "$WEB_LOG" 2>&1 &
WEB_PID=$!

echo "==> waiting for API"
for i in $(seq 1 40); do
  curl -s -o /dev/null "http://127.0.0.1:$API_PORT/health" && break
  sleep 1
done
curl -s -o /dev/null "http://127.0.0.1:$API_PORT/health" || { echo "API failed to boot"; tail -20 "$API_LOG"; exit 1; }

echo "==> waiting for web"
for i in $(seq 1 90); do
  curl -s -o /dev/null "http://127.0.0.1:$WEB_PORT/login" && break
  sleep 1
done
curl -s -o /dev/null "http://127.0.0.1:$WEB_PORT/login" || { echo "WEB failed to boot"; tail -20 "$WEB_LOG"; exit 1; }

echo "==> running playwright suite"
cd "$FE" && node e2e/e2e-runner.js $ARGS
RC=$?

echo "--- API log tail ---"
tail -5 "$API_LOG"
echo "--- web log tail ---"
tail -5 "$WEB_LOG"
exit $RC
