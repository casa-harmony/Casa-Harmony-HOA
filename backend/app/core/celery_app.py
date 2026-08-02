"""Celery Beat app for high-availability scheduling.

The periodic tasks wrap the SAME idempotent, per-tenant job functions used by the
in-process APScheduler (``app.core.scheduler``), so dev/single-instance can keep
using APScheduler (SCHEDULER_MODE=apscheduler) while production runs a single Beat
scheduler + N workers (SCHEDULER_MODE=celery) against a Redis broker.

Run in production:
    celery -A app.core.celery_app.celery_app worker --loglevel=info
    celery -A app.core.celery_app.celery_app beat   --loglevel=info
"""
from __future__ import annotations

import logging

from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

logger = logging.getLogger("casa-harmony.celery")

celery_app = Celery(
    "casa_harmony",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
)
celery_app.conf.update(
    task_track_started=True,
    task_acks_late=True,            # re-deliver if a worker dies mid-task
    worker_prefetch_multiplier=1,
    timezone="UTC",
    task_default_queue="casa",
)

_H = settings.POSTING_HOUR
_M = settings.POSTING_MINUTE

# Beat schedule mirrors the APScheduler cadence (staggered by hour).
celery_app.conf.beat_schedule = {
    "nightly-gl-posting": {
        "task": "casa.nightly_gl_posting",
        "schedule": crontab(hour=_H, minute=_M),
    },
    "po-budget-checks": {
        "task": "casa.po_budget_checks",
        "schedule": crontab(hour=(_H + 1) % 24, minute=_M),
    },
    "nightly-backup": {
        "task": "casa.nightly_backup",
        "schedule": crontab(hour=(_H + 2) % 24, minute=_M),
    },
    "monthly-jobs": {
        "task": "casa.monthly_jobs",
        "schedule": crontab(hour=(_H + 3) % 24, minute=_M),
    },
    "dunning-sweep": {
        "task": "casa.dunning_sweep",
        "schedule": crontab(hour=(_H + 4) % 24, minute=_M),
    },
}


def _run(name: str, fn):
    try:
        result = fn()
        logger.info("Celery task %s complete: %s", name, result)
        return result
    except Exception:  # pragma: no cover - logged + re-raised for Celery retry/alerting
        logger.exception("Celery task %s failed", name)
        raise


@celery_app.task(name="casa.nightly_gl_posting")
def nightly_gl_posting():
    from app.core.scheduler import run_nightly_posting
    return _run("nightly_gl_posting", run_nightly_posting)


@celery_app.task(name="casa.po_budget_checks")
def po_budget_checks():
    from app.core.scheduler import run_budget_check_sweep
    return _run("po_budget_checks", run_budget_check_sweep)


@celery_app.task(name="casa.nightly_backup")
def nightly_backup():
    from app.core.scheduler import run_nightly_backup
    return _run("nightly_backup", run_nightly_backup)


@celery_app.task(name="casa.monthly_jobs")
def monthly_jobs():
    from app.core.scheduler import run_monthly_jobs
    return _run("monthly_jobs", run_monthly_jobs)


@celery_app.task(name="casa.dunning_sweep")
def dunning_sweep():
    from app.core.scheduler import run_dunning_sweep
    return _run("dunning_sweep", run_dunning_sweep)


# Task names exposed for the admin /scheduler/info endpoint.
BEAT_TASKS = list(celery_app.conf.beat_schedule.keys())
