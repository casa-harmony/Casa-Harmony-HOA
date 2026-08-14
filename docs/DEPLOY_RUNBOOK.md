# Deployment runbook — Railway (API + Web)

What must be fixed before this ships, and the exact sequence to deploy both
halves to Railway against Neon PostgreSQL.

Reviewed 2026-08-14 against `develop`. Every finding below was verified against
the running app or the build toolchain — the evidence is in the last section.
Supersedes nothing; [RAILWAY.md](RAILWAY.md) stays the platform-choice rationale,
this is the operational procedure.

---

## Verdict

**Do not deploy yet.** Not because the application is weak — WP1–WP7 landed and
the day-zero flow works end to end — but because of five specific release
blockers, one of which is severe and silent:

> The frontend Docker image **compiles the demo into the bundle**. Railway would
> serve a self-contained mock app that never contacts the backend, and it would
> look completely normal. Proven below.

The other four are: the production boot seeds a demo HOA with factory
credentials, all of the recent work is uncommitted, one Python dependency is
undeclared, and the web service has no healthcheck.

Fix Part 1, then Part 4 is a mechanical 40-minute deploy.

---

## Part 1 — Release blockers (P0)

Nothing deploys until all five are done.

### P0-1 · The Docker build ships the mock demo

**Severity: critical, silent.** The app would come up, log in, show dashboards,
and be entirely fake.

`lib/api.ts` decides its transport at **build** time:
`NEXT_PUBLIC_DATA_MODE === "live" ? "live" : "mock"`. Next.js inlines
`NEXT_PUBLIC_*` from the build environment, so anything absent at build becomes
`mock` — permanently, in the compiled bundle.

In the Docker build that variable is absent twice over:

- `frontend-mock/Dockerfile` declares `ARG NEXT_PUBLIC_API_BASE` but **no ARG for
  `NEXT_PUBLIC_DATA_MODE`**. A Railway service variable cannot reach a Dockerfile
  build unless the Dockerfile declares a matching `ARG`.
- `frontend-mock/.dockerignore` excludes `.env.local`, so the local file that
  currently supplies `live` is not in the build context either.

Verified: under Docker build conditions the compiled value is `mock`; with
`.env.local` present locally it is `live`. Same code, opposite behaviour.

**Fix:**

1. In `frontend-mock/Dockerfile`, immediately after the existing
   `ARG NEXT_PUBLIC_API_BASE` / `ENV NEXT_PUBLIC_API_BASE` pair, add the same
   pair for `NEXT_PUBLIC_DATA_MODE`, defaulting to `mock` (keep the safe default
   — an unconfigured build should stay the demo, per `AGENTS.md`).
2. Set `NEXT_PUBLIC_DATA_MODE=live` as a Railway **service variable** on the web
   service so it is passed as a build arg.
3. Add `NEXT_PUBLIC_DATA_MODE` to `frontend-mock/.env.example`, which does not
   mention it at all today.

**Verify after deploy:** open the deployed site, sign in, and confirm in the
browser Network tab that requests go to your API domain. If you see no network
calls to the API at all, it built in mock mode.

### P0-2 · Production boot seeds a demo HOA and factory credentials

`backend/entrypoint.sh` runs `python -m scripts.seed` on **every container
start**, unconditionally. That seed:

- Creates the `casa-harmony` demo tenant with demo residents and sample data.
- Creates `sysadmin@casaharmony.ai` with the hard-coded password
  `ChangeMe!Sysadmin1`.
- Falls back to `ChangeMe!Superadmin1` when `SUPERADMIN_PASSWORD` is unset
  (`scripts/seed.py:91`) — which defeats the WP8 change that made the setting
  default to `None`.
- **Prints the superadmin password to stdout** (`scripts/seed.py:194`), i.e.
  into Railway's log stream.

So a production deploy that forgets one variable comes up with a publicly known
administrator password, and the password is in the logs either way.

**Fix (all four):**

1. Gate seeding in `entrypoint.sh` behind an explicit opt-in — e.g. only run it
   when `RUN_SEED=true`. Migrations should still run unconditionally.
2. In `scripts/seed.py`, remove the `or "ChangeMe!Superadmin1"` fallback. When
   `SUPERADMIN_PASSWORD` is unset, exit with a clear error instead of inventing
   a password.
3. Remove the password from the completion print — print the email only.
4. Skip demo-tenant and demo-user creation when `ENVIRONMENT=production`; seed
   only permissions, system roles, and the superadmin. The demo HOA is a sales
   asset, not production data.

Note the entrypoint currently swallows seed failures (`|| echo "(seed
skipped/failed — continuing)"`). Once seeding is opt-in, let a requested seed
that fails stop the boot — a half-seeded database is worse than no boot.

### P0-3 · All recent work is uncommitted

`git status` shows **60 modified files plus 3 untracked**, including every WP8
security change, the four fixes verified last session, and three new files
(`app/core/rate_limit.py`, `lib/portal-live.ts`,
`app/portal/login/live-portal-login.tsx`).

Railway builds from a git branch. None of this would ship.

**Fix:** review and commit before touching Railway. Two cautions when staging:

- `backend/.env` and `frontend-mock/.env.local` hold real Neon and Cloudinary
  credentials. `.gitignore` covers `.env` but **not** `.env.local` — confirm with
  `git status --porcelain` that neither appears before you commit.
- 36 of the modified files are test files with a one-line change each; commit
  them separately from the source changes so the real diff stays readable.

### P0-4 · `python-dateutil` is an undeclared dependency

`app/services/provisioning.py` imports `dateutil.relativedelta`, but
`requirements.txt` never lists `python-dateutil`. It resolves today only because
`celery` happens to require it. Remove or change Celery and community
provisioning breaks at runtime, in the one code path that matters most.

**Fix:** add an explicit pinned `python-dateutil` to `requirements.txt` under the
existing dependency-group comments. Also move `slowapi` and `celery[redis]` under
proper section headings — they were appended below the `# Testing` comment, which
now reads as though they were test-only.

### P0-5 · The web service has no healthcheck

`backend/railway.json` declares `healthcheckPath: /health`. `frontend-mock/
railway.json` declares none, so Railway marks the web service healthy as soon as
the process starts, before Next.js can serve. A broken build can sit "deployed"
and serve errors.

**Fix:** add a trivial health route to the frontend (a route handler returning
200) and declare `healthcheckPath` in `frontend-mock/railway.json`, matching the
API service.

---

## Part 2 — Logic and robustness fixes (P1)

Not deploy blockers, but these are what separate "it runs" from "it is a strong,
logical system". Do them before real associations are onboarded.

### P1-1 · Readiness "next action" links all 404

`app/services/readiness.py` returns routes that do not exist in this app:
`/settings/users`, `/accounting/coa`, `/accounting/periods`, `/settings/masters`,
`/receivables/homeowners`, `/settings/golive`.

The real routes are `/users`, `/coa`, `/periods`, `/vendors` (or `/cash`),
`/residents`, `/go-live`. The `ReadinessBanner` and every `ReadinessEmptyState`
renders these as links, so the guided-setup path built in WP3 — the thing that
tells a new administrator what to do next — is a dead end on nine screens.

**Fix:** correct the six route strings to the real paths. Then guard against
recurrence: add a test that asserts every `next_action_route` the service can
emit exists in the frontend route table.

### P1-2 · Resident portal login has no rate limiting

WP8 added `slowapi` and decorated the staff endpoints — `/auth/login` at
10/minute, `/auth/forgot-password` at 5/minute. `app/api/v1/portal.py` has **no
limiter decorators at all**. Verified: eight consecutive bad portal logins all
returned 401 with no throttling.

Residents are the largest and least sophisticated account population, and the
portal accepts an HOA slug plus a username — both guessable.

**Fix:** apply limits to `/portal/login`, `/portal/login/verify`, and
`/portal/forgot-password`. Rate-limit the verify step at least as tightly as
login, since it is the endpoint that accepts the one-time code.

### P1-3 · Sessions die hourly with no recovery

`ACCESS_TOKEN_EXPIRE_MINUTES` is 60. WP8 added a working `/auth/refresh`
endpoint and the login response now returns a `refresh_token` — but the frontend
**never calls it** (no reference anywhere in `app/` or `lib/`). A user mid-way
through a bank reconciliation is bounced to the sign-in screen with unsaved work.

**Fix:** store the refresh token alongside the access token in
`lib/api.ts`/`providers.tsx`, and on a 401 attempt one silent refresh before
tearing the session down in the existing unauthorized handler. Only sign the
user out if the refresh also fails.

### P1-4 · `purge_tenant.py` deletes users it was not asked to touch

Its orphan cleanup selects **every** non-superadmin user with no remaining
membership, platform-wide, not just users orphaned by the tenant being purged.
Observed twice during verification: purging one test tenant removed five
unrelated accounts.

On a production platform this is a data-loss bug — any user between memberships
(mid-transfer, or newly created before their grant lands) is deleted by an
unrelated tenant purge.

**Fix:** scope the orphan sweep to users who held a membership in the tenant
being purged. Also make `DELETE /tenants/{id}` and this script log which users
they removed.

### P1-5 · Users created via `POST /users` still bypass invitation

The create-user path sets `must_change_password=True` and requires the
administrator to type a temporary password, then presumably send it by hand.
`TenantAdminCreate` already accepts `send_invite`, but there is no invitation
delivery. This is the last manual, out-of-band credential step in the product.

**Fix:** implement `send_invite` to generate a reset token and email it via the
existing notification service, and default the admin UI to invitation rather
than a typed password.

### P1-6 · Report catalog is a stub

`GET /reports/catalog` returns three reports. The codebase publishes roughly
forty `*/export` endpoints. The screen works, so this is not broken — it is
just 7% delivered against what WP7 specified.

**Fix:** extend the catalog to cover the existing export endpoints, keeping the
per-permission filtering that already works.

---

## Part 3 — Secrets and environment inventory

Generate the two cryptographic secrets **once** and store them in a password
manager before you create any Railway service.

| Secret | How to generate | Consequence of loss |
|---|---|---|
| `SECRET_KEY` | `python -c "import secrets; print(secrets.token_urlsafe(64))"` | All sessions invalidated; users re-login. Recoverable. |
| `FIELD_ENCRYPTION_KEY` | `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` | **Unrecoverable.** Tax IDs, bank details, and MFA secrets become permanently unreadable. Never rotate casually. |

### Database roles — the one rule that must not be broken

Two different Neon connection strings, two different roles:

| Variable | Role | Why |
|---|---|---|
| `DATABASE_URL` | `casa_app` (`NOSUPERUSER NOBYPASSRLS`) | The app connects as this. |
| `MIGRATION_DB_URL` | `neondb_owner` | Alembic only; needs DDL. |

Pointing `DATABASE_URL` at the owner role silently disables every Row-Level
Security policy — no error, no log line, and every HOA can read every other
HOA's ledger. Confirm the role in the URL before you paste it.

### `casa-harmony-api` variables

| Variable | Value | Notes |
|---|---|---|
| `ENVIRONMENT` | `production` | Gates `dev_otp` exposure and direct portal payment. Must be exactly this. |
| `DATABASE_URL` | Neon URL, `casa_app` role | Prefix `postgresql+psycopg://`, keep `?sslmode=require` |
| `MIGRATION_DB_URL` | Neon URL, owner role | Same prefix and suffix |
| `SECRET_KEY` | generated above | |
| `FIELD_ENCRYPTION_KEY` | generated above | |
| `SUPERADMIN_EMAIL` | your admin address | |
| `SUPERADMIN_PASSWORD` | a strong, unique password | Required once P0-2 removes the fallback |
| `RUN_SEED` | `true` for first boot only | Then remove it and redeploy (see P0-2) |
| `BACKEND_CORS_ORIGINS` | web service URL | Set in step 6 below, not before |
| `FRONTEND_BASE_URL` | web service URL | Used in password-reset links |
| `SENDGRID_API_KEY` | your key | Without it, reset links and OTPs are only logged |
| `MAIL_FROM` | `no-reply@yourdomain` | |
| `CLOUDINARY_URL` | `cloudinary://key:secret@cloud` | Without it, uploads go to disk and vanish on redeploy |
| `CLOUDINARY_FOLDER` | `casa-harmony/documents` | |
| `ENABLE_SCHEDULER` | `true` | In-process nightly GL posting |
| `ALLOW_DIRECT_PORTAL_PAYMENT` | leave unset | Already force-disabled in production |

Do **not** set `PORT` — Railway injects it and the entrypoint binds it.

### `casa-harmony-web` variables

| Variable | Value | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_BASE` | `https://<api-domain>/api/v1` | **Build-time.** Include the `/api/v1` suffix. |
| `NEXT_PUBLIC_DATA_MODE` | `live` | **Build-time.** Useless until P0-1 is fixed. |
| `REVIEW_PASSCODE` | passcode, or omit | Omit to disable client commenting entirely |
| `DATABASE_URL` | Neon URL for review comments | Only if review mode is on. Separate concern from the API's database. |
| `CLOUDINARY_URL` | `cloudinary://key:secret@cloud` | Review screenshots |
| `CLOUDINARY_FOLDER` | `casa-harmony/review` | |

> Both `NEXT_PUBLIC_*` values are compiled into the bundle. Changing either
> requires a **redeploy**, not a restart.

---

## Part 4 — Deploy sequence

Order matters: the web build needs the API's domain, and the API's CORS needs the
web domain. That circular dependency is why the API is deployed twice.

1. **Commit and push** everything from P0-3 to the branch Railway will track.
2. **Create the Railway project** with two services from this monorepo. Set each
   service's **Root Directory** — `backend` and `frontend-mock` respectively — so
   each rebuilds only on its own changes. Both already carry a `railway.json`
   declaring the Dockerfile build.
3. **Deploy `casa-harmony-api`** with every variable from Part 3 except
   `BACKEND_CORS_ORIGINS`, and with `RUN_SEED=true`. Watch the deploy log for the
   migration output.
4. **Confirm the API is healthy**: `GET https://<api-domain>/health` returns
   `{"status":"ok", "environment":"production"}`. If `environment` says anything
   else, `ENVIRONMENT` is wrong and resident OTP codes will be exposed in API
   responses — fix before continuing.
5. **Deploy `casa-harmony-web`** with `NEXT_PUBLIC_API_BASE` pointed at the API
   domain and `NEXT_PUBLIC_DATA_MODE=live`.
6. **Set `BACKEND_CORS_ORIGINS`** on the API to the web service's exact origin
   (scheme + host, no trailing slash, no path) and **redeploy the API**. Until
   this is done the browser blocks every request and the UI reports "Could not
   reach the server".
7. **Remove `RUN_SEED`** from the API service and redeploy, so subsequent
   restarts never re-seed.
8. **Sign in and change the superadmin password immediately.** WP8's
   `must_change_password` enforcement will force this on first login.
9. **Run the isolation check** against the deployed API:
   `scripts/check_tenant_isolation.py --base https://<api-domain>/api/v1`.

---

## Part 5 — Post-deploy smoke test

This is the day-zero rehearsal, run against production. It is the only test that
proves the deployment actually works rather than merely starting.

1. Open the web service. **In the browser Network tab, confirm requests hit your
   API domain** — this is the P0-1 check and the single most important one.
2. Sign in as the superadmin. You should be forced to change the password.
3. Confirm the sidebar renders and the community switcher is populated.
4. Create a community, supplying the administrator email and password.
5. Confirm on the new community: chart of accounts present, 24 accounting
   periods, payment terms, approval hierarchy, go-live checklist.
6. Sign out; sign in as that community's administrator; change the password;
   confirm they see exactly one community and cannot reach any other.
7. Add a homeowner and a billing plan, run an assessment, post it, record a
   receipt, and open the trial balance — **confirm it balances**.
8. Create a resident, sign in at `/portal/login` with slug + username + password,
   complete the one-time code step, and confirm only that resident's unit shows.
9. Confirm the OTP is **not** present in the API response (it must only appear
   when `ENVIRONMENT=development`).
10. Upload a document, redeploy the API, and confirm the document still
    downloads — this proves Cloudinary is configured rather than local disk.

If step 10 fails, `CLOUDINARY_URL` is missing and every uploaded document will be
lost on each deploy.

---

## Part 6 — Day-2 operations

- **Neon compute is the cost to watch**, not Railway. An always-on API holds
  connections open, which prevents Neon suspending and burns through the free
  plan's compute allowance around mid-month. Budget for a paid Neon plan or
  accept cold starts.
- **Backups.** `BACKUP_ENABLED` runs a nightly encrypted dump inside the
  scheduler, but Neon's own point-in-time restore is the real safety net.
  Configure and **test a restore** — it is an item on the go-live checklist and
  the one people skip.
- **`numReplicas` must stay 1** while `SCHEDULER_MODE=apscheduler`. The scheduler
  is in-process; two replicas would run the nightly GL posting twice. Moving to
  Celery is a prerequisite for horizontal scaling.
- **Log hygiene.** After P0-2, confirm no credential appears in the deploy log.
- **Rotate the factory credentials** documented in `COMMUNITIES.md` if that file
  was ever accurate for your database, and complete the manual security items on
  the go-live checklist (`rotate_repo_token`, `rotate_cloud_keys`, `verify_tls`).

---

## Evidence log

| Probe | Result |
|---|---|
| Simulated Docker build env (no `.env.local`, only the `API_BASE` arg) | Compiled `DATA_MODE` = **`mock`**; with `.env.local` present = `live`. Confirms P0-1. |
| `grep ARG frontend-mock/Dockerfile` | Only `NEXT_PUBLIC_API_BASE` declared |
| `grep .dockerignore` | `.env.local` excluded from build context |
| `npm run build` | Succeeds, exit 0, 45 routes emitted |
| `tsc --noEmit` | Clean |
| `check-endpoints.mjs` | 264 published, 147 requested, **0 unmatched** |
| `git status` | 60 modified + 3 untracked files. Confirms P0-3. |
| `grep dateutil requirements.txt` | Absent; provided transitively by `celery`. Confirms P0-4. |
| `grep limiter.limit app/api/v1/portal.py` | No matches; 8 bad portal logins all returned 401 unthrottled. Confirms P1-2. |
| `grep next_action_route app/services/readiness.py` | Six routes, none of which exist in `app/(app)/`. Confirms P1-1. |
| `grep -rn "refresh_token" frontend-mock/` | No matches. Confirms P1-3. |
| `scripts/seed.py:91`, `:194` | Password fallback and password printed to stdout. Confirms P0-2. |
| `git ls-files | grep .env` | Only `.env.example` files tracked — no secrets committed |

Docker was not running locally, so the two images were not built here. Railway
will be the first real build of both Dockerfiles — watch those logs closely on
the first deploy.
