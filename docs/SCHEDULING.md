# Scheduled / Nightly GL Posting

Approved GL journal batches are posted to `GL_BALANCES` by a nightly job. The job
is **idempotent** (already-`POSTED` batches are skipped) and runs **per tenant** in
its own transaction, so one HOA's failure never blocks the others.

## Run it

```bash
cd backend && source .venv/bin/activate
python -m scripts.run_nightly_posting
```

It iterates every tenant, calls `post_all_approved`, and prints per-tenant counts.

It can also be triggered ad-hoc for a single HOA from the API/UI:
`POST /api/v1/gl/posting-runs` (or the **Run Nightly Posting** button on the GL screen).

## In-process scheduler (single-instance deployments)

Set `ENABLE_SCHEDULER=true` (optionally `POSTING_HOUR`/`POSTING_MINUTE`, UTC) and the
backend runs nightly posting itself via APScheduler — no external cron needed. Use this
only for a **single** backend instance; with multiple workers it would run once per
worker, so prefer cron or the Celery beat recipe below at scale.

## Schedule with cron

```cron
# Post approved GL batches every night at 02:00
0 2 * * *  cd /opt/casa-harmony/backend && /opt/casa-harmony/backend/.venv/bin/python -m scripts.run_nightly_posting >> /var/log/casa-harmony/posting.log 2>&1
```

## Schedule with Celery (production)

For a managed worker fleet, wrap the per-tenant function in a Celery task and drive
it with Celery Beat. `post_for_tenant(tenant_id)` is already factored for this:

```python
# tasks.py
from celery import Celery
from celery.schedules import crontab
from scripts.run_nightly_posting import post_for_tenant
from app.core.database import session_for
from app.models.identity import Tenant
from sqlalchemy import select

app = Celery("casa_harmony", broker="redis://localhost:6379/0")

@app.task
def post_tenant(tenant_id: str):
    return post_for_tenant(tenant_id)

@app.task
def nightly_posting():
    reg = session_for(None, True)
    try:
        ids = [str(t.id) for t in reg.execute(select(Tenant)).scalars()]
    finally:
        reg.close()
    for tid in ids:
        post_tenant.delay(tid)

app.conf.beat_schedule = {
    "nightly-posting": {"task": "tasks.nightly_posting", "schedule": crontab(hour=2, minute=0)},
}
```

## What posting does

1. Validates the batch is `APPROVED` and balanced (Σ debits = Σ credits).
2. For each journal line, accumulates `period_net_dr` / `period_net_cr` into the
   `GL_BALANCES` row for that code combination + accounting period (creating it on
   first activity), carrying the **fund** value for fund-based reporting.
3. Marks the batch and its headers `POSTED` and stamps `posted_at`.

Because balances are keyed by code combination (which embeds the Fund segment),
**fund balances and a fund-based trial balance are always derivable** — the core
HOA fund-accounting requirement.

## HA scheduling with Celery Beat (P31)

For multi-instance / high-availability production, run scheduling out-of-process via
Celery Beat + workers instead of the in-process APScheduler.

**Modes** (`SCHEDULER_MODE`):
- `apscheduler` (default) — in-process; good for dev / single instance. Gated by
  `ENABLE_SCHEDULER=true`.
- `celery` — the FastAPI app does NOT start the in-process scheduler; a separate
  Celery Beat process emits the schedule and workers execute tasks.

**Periodic tasks** (all wrap the same idempotent per-tenant functions as APScheduler):
`casa.nightly_gl_posting`, `casa.po_budget_checks`, `casa.nightly_backup`,
`casa.monthly_jobs` (monthly statements + board packets), `casa.dunning_sweep`.

**Run locally**:
```
export SCHEDULER_MODE=celery CELERY_BROKER_URL=redis://localhost:6379/0 \
       CELERY_RESULT_BACKEND=redis://localhost:6379/1
celery -A app.core.celery_app.celery_app worker --loglevel=info -Q casa
celery -A app.core.celery_app.celery_app beat   --loglevel=info   # exactly ONE beat
```

**On AWS** (compose override): add `infra/aws/compose.celery.yml` (Redis + worker +
beat) and set `SCHEDULER_MODE=celery` in `/opt/casa/.env`:
```
docker compose -f docker-compose.yml -f infra/aws/compose.prod.yml \
  -f infra/aws/compose.celery.yml --env-file /opt/casa/.env up -d --build
```

**Reliability**: tasks use `task_acks_late` (re-delivered if a worker dies) and log
failures; per-tenant errors are isolated so one tenant cannot block others. Run
exactly one Beat scheduler cluster-wide to avoid duplicate firings. The admin
`GET /api/v1/scheduler/info` reports the active mode + job list; manual triggers
(`POST /scheduler/run/{job}`) work in both modes.
