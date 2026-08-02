# Deployment

Casa Harmony is a split stack: **FastAPI backend** + **PostgreSQL** + **Next.js frontend**.
The backend is a long-running process that uses persistent DB connections, PostgreSQL
**Row-Level Security** (per-request session GUCs + a restricted DB role), Alembic
migrations, and a **nightly posting job** — so it needs a container/VM host, not a
serverless platform.

## Quickest: one-click backend via `render.yaml` (free test env)

A Render **Blueprint** (`render.yaml` at the repo root) provisions the backend API
service for you — you only paste the DB/secret values.

1. **Database — Neon** (free, durable, no card): create a project at
   <https://neon.tech>, then run once in the Neon SQL editor:
   ```sql
   CREATE ROLE casa_app LOGIN PASSWORD '<pick-a-pw>'
     NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
   GRANT CONNECT ON DATABASE neondb TO casa_app;
   GRANT USAGE, CREATE ON SCHEMA public TO casa_app;
   ```
2. **Backend — Render**: <https://render.com> → **New → Blueprint** → pick this repo.
   Render reads `render.yaml` and creates `casa-harmony-api` (free). Fill the
   `sync: false` values: `FIELD_ENCRYPTION_KEY`, `POSTGRES_*` (the `casa_app` role),
   `MIGRATION_DB_URL` (owner role), `SUPERADMIN_*`. `SECRET_KEY` is auto-generated.
   - `MIGRATION_DB_URL` format: `postgresql+psycopg://<owner>:<pw>@<host>:5432/neondb?sslmode=require`
     (Neon gives `postgresql://…` — add `+psycopg`).
   - The container binds Render's injected `$PORT` automatically.
3. **Frontend — Vercel**: import `./frontend`, set
   `NEXT_PUBLIC_API_BASE=https://<service>.onrender.com/api/v1`, deploy. Then set
   `BACKEND_CORS_ORIGINS` (on Render) to the Vercel URL and redeploy the backend.
4. **Demo data** (optional) — Render → service → **Shell**:
   ```bash
   python -m scripts.seed_demo && python -m scripts.seed_maple_transactions
   ```

> Free-tier notes: Render free web services sleep after ~15 min idle (~50s cold
> start) — fine for testing. `ENABLE_SCHEDULER=true` (set in the blueprint) runs
> nightly GL posting in-process, so no paid cron is needed.

## AWS (cheapest: single EC2 box, Terraform)

Prefer AWS? `infra/aws/` is a Terraform module that stands up one Free‑Tier
`t3.micro` running the full `docker compose` (Postgres + backend + frontend) behind
Caddy/HTTPS — `terraform apply` and you're live (~$0 for 12 months). See
[`infra/aws/README.md`](../infra/aws/README.md).

## Recommended (production): Render (one platform)

| Component | Service | Notes |
|---|---|---|
| Database | Render PostgreSQL (or Neon / Supabase) | Real Postgres → RLS + `casa_app` role work as-is |
| Backend | Render Web Service (Docker, `backend/Dockerfile`) | Runs migrations + seed on start; binds `$PORT` |
| Nightly posting | Render Cron Job **or** `ENABLE_SCHEDULER=true` | Cron: `python -m scripts.run_nightly_posting` @ `0 2 * * *` |
| Frontend | Render Static/Node Service **or** Vercel | Next.js 15 |

### Why not Vercel for the backend
Vercel is excellent for the **Next.js frontend**, but its serverless functions don't suit
a persistent FastAPI app with pooled DB connections, session-scoped RLS GUCs, and a
cron/Celery posting worker. **Use Vercel for the frontend only**, pointed at the backend URL.

## Backend env vars

```
SECRET_KEY=<openssl rand -hex 32>          # JWT signing — REQUIRED, keep secret
FIELD_ENCRYPTION_KEY=<Fernet key>          # field encryption at rest — REQUIRED, persist it
POSTGRES_HOST=...    POSTGRES_PORT=5432
POSTGRES_DB=casa_harmony
POSTGRES_USER=casa_app                      # restricted, NOBYPASSRLS role — the app connects as this
POSTGRES_PASSWORD=...
MIGRATION_DB_URL=postgresql+psycopg://<owner>:<pw>@<host>:5432/casa_harmony  # owner role for DDL/migrations
SUPERADMIN_EMAIL=...   SUPERADMIN_PASSWORD=...   # initial platform admin (change after first login)
BACKEND_CORS_ORIGINS=https://<your-frontend-domain>
```

> Generate `FIELD_ENCRYPTION_KEY` once with:
> `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
> Losing it makes encrypted columns (Tax IDs, bank/MFA secrets) unrecoverable.

## Frontend env vars

```
NEXT_PUBLIC_API_BASE=https://<your-backend-domain>/api/v1
```

## Start sequence (the entrypoint does this)

1. `alembic upgrade head` using `MIGRATION_DB_URL` (the **owner** role: DDL + RLS policies + grants).
2. `python -m scripts.seed` as the **app** role (idempotent: SUPERADMIN, demo HOA, COA,
   standard accounts, demo masters, approval hierarchy).
3. `uvicorn app.main:app --port "${PORT:-8000}"` (binds the platform's `$PORT`, else 8000).

## Database role model

- **Owner** role: owns the schema, runs migrations. Has `BYPASSRLS` implicitly via ownership.
- **`casa_app`** role: `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS` — the app connects
  as this so RLS is always enforced. Grants flow via `ALTER DEFAULT PRIVILEGES`.

## Local (Docker Compose)

```bash
docker compose up --build      # Postgres + backend (migrate+seed) + frontend
# Frontend http://localhost:3000  ·  API docs http://localhost:8000/docs
```

## Going to production?

Before exposing this to real HOAs, work through **[`docs/GO_LIVE_CHECKLIST.md`](GO_LIVE_CHECKLIST.md)**
— rotating any test-exposed credentials, removing demo data, flipping
`ENVIRONMENT=production`, real OTP delivery, backups, and network hardening.

## Post-deploy checklist

- [ ] Change the SUPERADMIN password after first login.
- [ ] Confirm `FIELD_ENCRYPTION_KEY` and `SECRET_KEY` are set from secrets (not defaults).
- [ ] Restrict `BACKEND_CORS_ORIGINS` to the real frontend domain.
- [ ] Verify the nightly cron runs `run_nightly_posting`.
- [ ] Terminate TLS at the platform/load balancer (encryption in transit).
- [ ] Take a base backup / enable PITR on the managed Postgres.
