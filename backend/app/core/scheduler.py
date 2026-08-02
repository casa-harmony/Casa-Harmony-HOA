"""In-process nightly GL posting scheduler (APScheduler).

Off by default; enable with ``ENABLE_SCHEDULER=true``. Runs the same idempotent,
per-tenant posting used by ``scripts/run_nightly_posting.py`` on a cron. For a
multi-worker deployment prefer the Celery recipe in docs/SCHEDULING.md (a single
beat scheduler) so the job runs once, not once per worker.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from app.core.config import settings
from app.core.database import session_for
from app.models.identity import Tenant
from app.services.gl_batch import post_all_approved
from app.services.matching import run_budget_checks

logger = logging.getLogger("casa-harmony.scheduler")
_scheduler: BackgroundScheduler | None = None


def run_nightly_posting() -> int:
    """Post all APPROVED GL batches for every tenant. Returns total posted."""
    reg = session_for(tenant_id=None, is_superadmin=True)
    try:
        tenant_ids = [t.id for t in reg.execute(select(Tenant)).scalars()]
    finally:
        reg.close()

    total = 0
    for tid in tenant_ids:
        db = session_for(tenant_id=tid, is_superadmin=True)
        try:
            posted = post_all_approved(db, tid)
            db.commit()
            total += len(posted)
        except Exception:  # pragma: no cover - one tenant must not block others
            db.rollback()
            logger.exception("Nightly posting failed for tenant %s", tid)
        finally:
            db.close()
    logger.info("Nightly posting complete: %d batch(es) across %d tenant(s)", total, len(tenant_ids))
    return total


def run_budget_check_sweep() -> int:
    """Per-tenant periodic PO budget check → Board alerts. Returns alerts raised."""
    reg = session_for(tenant_id=None, is_superadmin=True)
    try:
        tenant_ids = [t.id for t in reg.execute(select(Tenant)).scalars()]
    finally:
        reg.close()
    total = 0
    for tid in tenant_ids:
        db = session_for(tenant_id=tid, is_superadmin=True)
        try:
            total += run_budget_checks(db, tid)
            db.commit()
        except Exception:  # pragma: no cover - isolate tenant failures
            db.rollback()
            logger.exception("Budget check failed for tenant %s", tid)
        finally:
            db.close()
    logger.info("Budget check sweep complete: %d alert(s) across %d tenant(s)", total, len(tenant_ids))
    return total


def run_nightly_backup() -> int:
    """Per-tenant database backup (one pg_dump covers all; recorded per tenant)."""
    from app.services.golive_exec import run_backup

    reg = session_for(tenant_id=None, is_superadmin=True)
    try:
        tenant_ids = [t.id for t in reg.execute(select(Tenant)).scalars()]
    finally:
        reg.close()
    ok = 0
    for tid in tenant_ids:
        db = session_for(tenant_id=tid, is_superadmin=True)
        try:
            rec = run_backup(db, tid)
            db.commit()
            ok += 1 if rec.status == "SUCCESS" else 0
        except Exception:  # pragma: no cover - isolate tenant failures
            db.rollback()
            logger.exception("Backup failed for tenant %s", tid)
        finally:
            db.close()
    logger.info("Nightly backup complete: %d successful across %d tenant(s)", ok, len(tenant_ids))
    return ok


def run_monthly_jobs() -> int:
    """Daily check: run each tenant's enabled monthly statement/board-packet jobs when
    today matches their configured day_of_month. Returns jobs executed."""
    from datetime import date
    from app.models.scheduling import SchedulerConfig
    from app.services.scheduled_runs import (
        run_board_packet_for_tenant, run_statements_for_tenant)

    reg = session_for(tenant_id=None, is_superadmin=True)
    try:
        tenant_ids = [t.id for t in reg.execute(select(Tenant)).scalars()]
    finally:
        reg.close()
    today = date.today().day
    ran = 0
    for tid in tenant_ids:
        db = session_for(tenant_id=tid, is_superadmin=True)
        try:
            cfg = db.execute(select(SchedulerConfig).where(
                SchedulerConfig.tenant_id == tid)).scalar_one_or_none()
            if cfg is None or cfg.day_of_month != today:
                continue
            if cfg.monthly_statements_enabled:
                run_statements_for_tenant(db, tid, trigger="CRON")
                ran += 1
            if cfg.board_packet_enabled:
                run_board_packet_for_tenant(db, tid, trigger="CRON")
                ran += 1
            db.commit()
        except Exception:  # pragma: no cover - isolate tenant failures
            db.rollback()
            logger.exception("Monthly jobs failed for tenant %s", tid)
        finally:
            db.close()
    logger.info("Monthly jobs complete: %d job(s) run", ran)
    return ran


def run_dunning_sweep() -> int:
    """Daily per-tenant dunning run for tenants with dunning enabled. Returns actions."""
    from datetime import date
    from app.models.scheduling import SchedulerConfig
    from app.services.dunning import run_dunning

    reg = session_for(tenant_id=None, is_superadmin=True)
    try:
        tenant_ids = [t.id for t in reg.execute(select(Tenant)).scalars()]
    finally:
        reg.close()
    total = 0
    for tid in tenant_ids:
        db = session_for(tenant_id=tid, is_superadmin=True)
        try:
            cfg = db.execute(select(SchedulerConfig).where(
                SchedulerConfig.tenant_id == tid)).scalar_one_or_none()
            if cfg is None or not cfg.dunning_enabled:
                continue
            res = run_dunning(db, tenant_id=tid, as_of=date.today())
            db.commit()
            total += res["reminders_sent"] + res["escalations"]
        except Exception:  # pragma: no cover - isolate tenant failures
            db.rollback()
            logger.exception("Dunning sweep failed for tenant %s", tid)
        finally:
            db.close()
    logger.info("Dunning sweep complete: %d action(s)", total)
    return total


def start_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    sched = BackgroundScheduler(timezone="UTC")
    sched.add_job(
        run_nightly_posting,
        CronTrigger(hour=settings.POSTING_HOUR, minute=settings.POSTING_MINUTE),
        id="nightly_gl_posting", replace_existing=True,
    )
    # Periodic PO budget-check sweep → Board alerts (runs an hour after posting).
    sched.add_job(
        run_budget_check_sweep,
        CronTrigger(hour=(settings.POSTING_HOUR + 1) % 24, minute=settings.POSTING_MINUTE),
        id="po_budget_checks", replace_existing=True,
    )
    # Nightly encrypted DB backup (runs two hours after posting) when enabled.
    if getattr(settings, "BACKUP_ENABLED", False):
        sched.add_job(
            run_nightly_backup,
            CronTrigger(hour=(settings.POSTING_HOUR + 2) % 24, minute=settings.POSTING_MINUTE),
            id="nightly_backup", replace_existing=True,
        )
    # Daily check for per-tenant monthly statement / board-packet runs.
    sched.add_job(
        run_monthly_jobs,
        CronTrigger(hour=(settings.POSTING_HOUR + 3) % 24, minute=settings.POSTING_MINUTE),
        id="monthly_jobs", replace_existing=True,
    )
    # Daily dunning sweep (per-tenant, gated by config.dunning_enabled).
    sched.add_job(
        run_dunning_sweep,
        CronTrigger(hour=(settings.POSTING_HOUR + 4) % 24, minute=settings.POSTING_MINUTE),
        id="dunning_sweep", replace_existing=True,
    )
    sched.start()
    _scheduler = sched
    logger.info("Nightly GL posting scheduler started (%02d:%02d UTC)",
                settings.POSTING_HOUR, settings.POSTING_MINUTE)


def shutdown_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
