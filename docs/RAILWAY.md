# Deploying to Railway

**Recommendation: Railway alone, two services in one project.** Not Railway +
Vercel.

## Why Railway alone

Your instinct was right, with one correction: Railway can host both halves, but
not as one *server* — Python and Node are separate runtimes, so they run as two
**services**. What you get by keeping them on one platform is one bill, one set
of environment variables, one deploy pipeline, one place to read logs, and a
private network between them.

The backend is the constraint. It needs a long-lived process — a SQLAlchemy
connection pool, per-request RLS session variables, and the APScheduler nightly
GL posting job. Vercel's serverless functions suit none of that, which is why
splitting the stack would mean Vercel for the frontend and *still* Railway (or
Render) for the backend. That's two dashboards and two bills for no gain on an
internal ERP.

Take Vercel only if you specifically want its per-PR preview deployments for
client review. Railway has PR environments too, so this is a preference, not a
requirement.

| | Railway alone | Railway + Vercel |
|---|---|---|
| Platforms to operate | 1 | 2 |
| Frontend previews | PR environments | Best-in-class |
| Backend | Persistent container | Still Railway/Render |
| Private networking | Yes, internal DNS | Public hop |

## Layout

One Railway project, two services from this monorepo:

| Service | Root directory | Builds from |
|---|---|---|
| `casa-harmony-api` | `backend` | `backend/Dockerfile` |
| `casa-harmony-web` | `frontend-mock` | `frontend-mock/Dockerfile` |

Each directory has a `railway.json` declaring the Dockerfile build and restart
policy; the API also declares a `/health` healthcheck. Set the **Root
Directory** per service in Railway so each rebuilds only when its own files
change.

Postgres stays on **Neon** — Railway's own Postgres would work, but Neon is
already provisioned with the `casa_app` role and RLS verified.

## Environment variables

### `casa-harmony-api`

```
DATABASE_URL=postgresql+psycopg://casa_app:<pw>@<neon-host>/casa_harmony?sslmode=require
MIGRATION_DB_URL=postgresql+psycopg://neondb_owner:<pw>@<neon-host>/casa_harmony?sslmode=require
SECRET_KEY=<openssl rand -hex 32>
FIELD_ENCRYPTION_KEY=<Fernet key — generate once, never rotate casually>
ENVIRONMENT=production
BACKEND_CORS_ORIGINS=https://<web-service-domain>
FRONTEND_BASE_URL=https://<web-service-domain>
SUPERADMIN_EMAIL=...
SUPERADMIN_PASSWORD=...
SENDGRID_API_KEY=...
MAIL_FROM=no-reply@<your-domain>
ENABLE_SCHEDULER=true
```

`DATABASE_URL` must be the **`casa_app`** role. Pointing it at `neondb_owner`
silently disables Row-Level Security — see the hard rules in `AGENTS.md`.

`FRONTEND_BASE_URL` is the **web** service's domain, not the API's — it is the
address put into emailed invite, password-reset and statement links. Left unset
it defaults to `http://localhost:3000`, which sends every recipient to their own
machine. The API still boots without it (deliberately: link generation should
not be able to take the ledger down) and logs an error on startup, but any email
carrying a link is refused with a 400 until it is set.

Railway injects `PORT`; the entrypoint binds it automatically. The entrypoint
also skips the sidecar wait when `DATABASE_URL` is set, which is what makes it
work against Neon rather than hanging.

### `casa-harmony-web`

```
NEXT_PUBLIC_API_BASE=https://<api-service-domain>/api/v1
NEXT_PUBLIC_DATA_MODE=live
REVIEW_PASSCODE=<passcode>            # omit to disable client commenting
DATABASE_URL=<neon url for review comments>
CLOUDINARY_URL=cloudinary://<key>:<secret>@<cloud>
CLOUDINARY_FOLDER=casa-harmony/review
```

> `NEXT_PUBLIC_*` values are inlined at **build** time, not run time. Changing
> `NEXT_PUBLIC_API_BASE` or `NEXT_PUBLIC_DATA_MODE` requires a **redeploy**, not
> a restart. The Dockerfile takes `NEXT_PUBLIC_API_BASE` as a build ARG.

Leaving `NEXT_PUBLIC_DATA_MODE` unset ships the self-contained demo — safe, but
not what you want in production.

## Order of operations

1. Deploy `casa-harmony-api` first and note its public domain.
2. Set `NEXT_PUBLIC_API_BASE` on the web service to that domain + `/api/v1`,
   then deploy it.
3. Set `BACKEND_CORS_ORIGINS` on the API to the web service's domain and
   redeploy the API. Until this is done the browser blocks every call, which
   surfaces in the UI as "Could not reach the server".
4. Sign in as the superadmin and change the password.
5. Run `scripts/check_tenant_isolation.py --base https://<api>/api/v1` against
   the deployed API.

Migrations and the seed run automatically on API start, via `entrypoint.sh`.

## Costs

Railway bills usage with a monthly minimum on paid plans; two small services
plus Neon is modest. The thing to watch is not Railway but Neon's compute: an
always-on API holds connections open, which stops Neon suspending and burns
past the free plan's 100 CU-hours around mid-month. See the infrastructure
report for the numbers.
