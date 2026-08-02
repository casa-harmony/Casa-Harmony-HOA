from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.scheduling import SchedulerConfig
from app.schemas.scheduling import JobRunOut, SchedulerConfigIn, SchedulerConfigOut
from app.services import audit, scheduled_runs

router = APIRouter(
    prefix="/scheduler", tags=["scheduler"], dependencies=[Depends(require_active_tenant)]
)


@router.get("/info")
def scheduler_info(db: Session = Depends(get_db),
                   p: Principal = Depends(require_permission("scheduler.manage"))):
    """Active scheduling mode + the periodic jobs (for the admin monitor)."""
    from app.core.config import settings
    jobs = [
        {"id": "nightly_gl_posting", "desc": "Post approved GL batches"},
        {"id": "po_budget_checks", "desc": "PO budget overrun alerts"},
        {"id": "nightly_backup", "desc": "Encrypted DB backup", "enabled": settings.BACKUP_ENABLED},
        {"id": "monthly_jobs", "desc": "Monthly statements + board packets"},
        {"id": "dunning_sweep", "desc": "Daily dunning"},
    ]
    return {"mode": settings.SCHEDULER_MODE,
            "in_process_enabled": settings.ENABLE_SCHEDULER and settings.SCHEDULER_MODE != "celery",
            "jobs": jobs}


@router.get("/config", response_model=SchedulerConfigOut)
def get_config(db: Session = Depends(get_db),
               p: Principal = Depends(require_permission("scheduler.manage"))):
    return scheduled_runs.get_config(db, p.tenant_id)


@router.put("/config", response_model=SchedulerConfigOut)
def put_config(payload: SchedulerConfigIn, db: Session = Depends(get_db),
               p: Principal = Depends(require_permission("scheduler.manage"))):
    c = db.execute(select(SchedulerConfig).where(SchedulerConfig.tenant_id == p.tenant_id)).scalar_one_or_none()
    if c is None:
        c = SchedulerConfig(tenant_id=p.tenant_id, created_by=p.user.id, updated_by=p.user.id)
        db.add(c)
    c.monthly_statements_enabled = payload.monthly_statements_enabled
    c.board_packet_enabled = payload.board_packet_enabled
    c.day_of_month = payload.day_of_month
    c.attach_statement_pdf = payload.attach_statement_pdf
    c.attach_board_pdf = payload.attach_board_pdf
    c.dunning_enabled = payload.dunning_enabled
    db.flush()
    audit.record(db, action="UPDATE", entity_type="SchedulerConfig", entity_id=c.id,
                 after={"statements": c.monthly_statements_enabled, "board": c.board_packet_enabled,
                        "day": c.day_of_month})
    return c


@router.get("/runs", response_model=list[JobRunOut])
def list_runs(db: Session = Depends(get_db),
              p: Principal = Depends(require_permission("scheduler.manage"))):
    return scheduled_runs.recent_runs(db, p.tenant_id)


@router.post("/run/{job}")
def trigger(job: str, db: Session = Depends(get_db),
            p: Principal = Depends(require_permission("scheduler.manage"))):
    if job == "statements":
        res = scheduled_runs.run_statements_for_tenant(db, p.tenant_id, trigger="MANUAL", created_by=p.user.id)
    elif job == "board-packet":
        res = scheduled_runs.run_board_packet_for_tenant(db, p.tenant_id, trigger="MANUAL", created_by=p.user.id)
    else:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown job")
    audit.record(db, action="TRIGGER_JOB", entity_type="ScheduledJobRun",
                 after={"job": job, "status": res["status"]})
    return res
