# Casa Harmony — agent working notes

Instructions for any coding agent working in this repo (Claude Code, OpenCode,
Aider, Cline, Codex, Continue…). `CLAUDE.md` points here; keep one file.

This is a **multi-tenant financial system for homeowner associations**. Bugs
here don't render wrong — they show one association another association's
money. Read the "Rules that must not be broken" section before changing
anything that touches data access.

---

## What this is

| Layer | Tech | Where |
|---|---|---|
| Backend | FastAPI + SQLAlchemy 2.0 + Alembic, Python 3.12 | `backend/` |
| Frontend | Next.js 16 (App Router), TypeScript, Tailwind | `frontend-mock/` |
| Database | PostgreSQL 18 on Neon, Row-Level Security | — |
| Files | Cloudinary | — |
| Email | SendGrid (falls back to logging when unset) | — |

Scale: ~36 API modules, ~36 model modules, 34 migrations, 45 frontend routes.

### Two frontends — only one is live

`frontend/` is the **client's original** delivery, kept for reference on `main`.
`frontend-mock/` is the one being built into the real product, despite the
name. **Work in `frontend-mock/`.** Do not "fix" `frontend/`.

### Branches

`main` holds the client-delivered code and is not modified. All work happens on
`develop` (or a branch off it).

---

## Rules that must not be broken

**1. The app must never connect to the database as an owner/superuser role.**
Neon's `neondb_owner` has `BYPASSRLS`. Connecting the API as that role silently
disables every tenant-isolation policy — no error, no log line, every HOA sees
every other HOA's ledger. The app connects as `casa_app`
(`NOSUPERUSER NOBYPASSRLS`); only Alembic uses the owner, via `MIGRATION_DB_URL`.

**2. Tenant scoping is not optional and not client-side.**
Every tenant table carries `tenant_id` *and* an RLS policy. Requests select the
HOA with the `X-Tenant-Id` header; `app/core/database.py` turns that into
transaction-local GUCs (`set_config(..., true)`). Never switch these to
session-level `SET` — that leaks across pooled connections.

**3. New tenant-scoped tables need RLS in the same migration.**
`ALTER TABLE <t> ENABLE ROW LEVEL SECURITY` plus a policy matching the existing
ones — **and** the restrictive sandbox policy, or the new table leaks across the
developer/live partition:

```sql
CREATE POLICY sandbox_tenant_visible ON <t> AS RESTRICTIVE
  USING (<t>.tenant_id IS NULL
         OR EXISTS (SELECT 1 FROM tenants x WHERE x.id = <t>.tenant_id))
  WITH CHECK (<t>.tenant_id IS NULL
         OR EXISTS (SELECT 1 FROM tenants x WHERE x.id = <t>.tenant_id));
```

Grants flow automatically via `ALTER DEFAULT PRIVILEGES`. A table without a
policy is readable across every HOA.

**4. The server decides permissions; the UI only reflects them.**
`lib/rbac.ts` drives navigation and labels. It is **not** an authorisation
boundary. Live permissions come from `/auth/me` per active tenant. Never add a
check to the frontend and call it done.

**5. The sandbox partition is a boundary; `is_demo` is not.**
`tenants.is_sandbox` / `users.is_sandbox` split the database into two mutually
invisible sets so a developer superadmin can drive the real app without touching
live data (`docs/COMMUNITIES.md`). It is enforced by the `app.sandbox` GUC and
RLS — never by an `if` in a route handler, and never from a client-supplied
field: the side is stamped on insert from the request context
(`_stamp_sandbox` in `app/models/identity.py`). `is_demo`, by contrast, is only
a display toggle. Don't conflate them.

**6. Don't log secrets or PII.** Tax IDs, bank details, and MFA secrets are
Fernet-encrypted at rest. Losing `FIELD_ENCRYPTION_KEY` makes them unreadable
forever.

---

## Frontend: mock vs live

One data layer, two transports, chosen by `NEXT_PUBLIC_DATA_MODE`:

```
lib/api.ts                 dispatcher + real HTTP transport (live)
lib/mock-data/mock-api.ts  in-browser store (mock, the default)
lib/api-error.ts           ApiError, shared by both
lib/auth-live.ts           real login / me / change-password
```

Screens call `apiFetch()` via `useApi` / `useMutate` and are unaware of which
transport is running. **Keep it that way** — don't import `mock-api` from a
page, and don't call `fetch()` directly in a component.

`mock` stays the default so an unconfigured build is always the safe,
self-contained demo. Set `NEXT_PUBLIC_DATA_MODE=live` to talk to FastAPI.

### The review/commenting feature stays

`lib/review/` + `app/api/review/` let a client comment on the deployed build,
with screenshots in Cloudinary and threads in Postgres. It is **inert unless
`REVIEW_PASSCODE` is set**, and unlocks per-browser via `/?review=<passcode>`.
It must keep working after the app is wired to the real backend. Do not remove
it.

---

## Commands

Backend (from `backend/`, venv at `.venv`):

```bash
./.venv/bin/uvicorn app.main:app --reload          # API on :8000, /docs for OpenAPI
set -a; . ./.env; set +a                            # load env into the shell
DATABASE_URL="$MIGRATION_DB_URL" ./.venv/bin/alembic upgrade head
./.venv/bin/alembic revision -m "what changed"      # then hand-write RLS
./.venv/bin/python -m scripts.seed                  # idempotent
./.venv/bin/python -m scripts.provision_neon --owner-url "<owner-url>"
./.venv/bin/python -m scripts.check_tenant_isolation # needs the API running
# Community (tenant) management — run as the owner; see docs/COMMUNITIES.md:
DATABASE_URL="$MIGRATION_DB_URL" ./.venv/bin/python -m scripts.create_community --name … --slug … --admin-email … --admin-password …
DATABASE_URL="$MIGRATION_DB_URL" ./.venv/bin/python -m scripts.purge_tenant --slug … --yes
# Developer sandbox — isolated from live data; see docs/COMMUNITIES.md:
DATABASE_URL="$MIGRATION_DB_URL" ./.venv/bin/python -m scripts.create_dev_admin --email … --password … --with-community "Name:slug"
DATABASE_URL="$MIGRATION_DB_URL" ./.venv/bin/python -m scripts.reset_sandbox --yes
```

Frontend (from `frontend-mock/`):

```bash
npm run dev
./node_modules/.bin/tsc --noEmit                    # run before every commit
npm run build
```

**Tests: run them against a local Postgres, not Neon.** The suite is chatty and
every query is a round trip to us-east-1; against Neon it takes tens of minutes,
against local Postgres it's minutes. `docker compose up postgres` then point
`POSTGRES_*` at localhost.

---

## Conventions

- Match surrounding style; this codebase uses module docstrings that explain
  *why*, not restatements of the code. Keep that.
- Backend: `app/api/v1/` (HTTP) → `app/services/` (logic) → `app/models/`.
  Business rules belong in services, not route handlers.
- Money is `numeric(18,2)`. Never float. Single currency (USD) — there is no
  multi-currency logic anywhere and none should be added.
- GL journals must balance; posting goes through `services/gl_posting.py`.
- Frontend: Tailwind + the local `components/ui` kit. Use existing components
  before adding a dependency.
- UUIDs are generated in Python, not by a Postgres extension. No migration
  requires `CREATE EXTENSION`.

---

## Outstanding work

As of 2026-08-14 (`develop`, this session). Day-zero flow (create a community,
provision an admin, sign in, bill and post an assessment, collect a receipt,
balance the trial balance, create a resident, resident portal login, unit
isolation) is **live-verified working end to end**, rerun fresh this session
— see `docs/CONFIDENCE_REPORT.md` for the full run and evidence. The prior
"Outstanding work" list (`extra: "forbid"` audit, the 6 failing tests, the
resident invite flow, the `gl_journal_id` dead field, and repo hygiene) is
**closed** — see `docs/CONFIDENCE_REPORT.md` for what changed and how each
was verified. What's below is new/residual, found while closing that list.

### Should-fix soon

**1. The resident invite email links to a frontend page that doesn't exist
yet.** `POST /residents` with `send_invite: true` now emails a working
set-password link (`POST /portal/accept-invite`, verified live end to end —
set password, log in, MFA, single-use token). But no `frontend-mock` page
consumes it, so a real resident clicking the link gets a 404. This mirrors a
pre-existing gap: the portal's `forgot-password`/`reset-password` endpoints
have had no frontend page either, backend-only since before this session. Add
`app/portal/accept-invite/page.tsx` (mirror `app/reset-password/page.tsx`,
POST to `/portal/accept-invite` with `{token, new_password}`) — and consider
the same for the existing portal forgot/reset flow while in there.

### Minor, non-blocking

**2. `ArReceipt.gl_journal_id`** (`app/models/subledger.py`) is genuinely
dead — never written, and not exposed by `ReceiptOut`, so it doesn't mislead
any caller the way the invoice-side field did. Low priority; remove in a
migration whenever someone's touching that model anyway.

### Reference

- `docs/DAY_ZERO_ARCHITECTURE.md` — the original architecture review; the nine
  work packages it lists (WP1–WP9) are all done.
- `docs/DEPLOY_RUNBOOK.md` — Railway deploy procedure; the P0/P1 blockers it
  lists are all closed.
- `docs/CONFIDENCE_REPORT.md` — the live-verification run behind this list,
  with full request/response evidence for every item above, plus what closed
  this session.

---

## Before you say it's done

1. `./node_modules/.bin/tsc --noEmit` clean.
2. Touched data access? Run `scripts/check_tenant_isolation.py` against a
   running API.
3. Added a migration? Apply it, then confirm the new tables have RLS enabled.
4. Don't claim a test passed without showing its output.
