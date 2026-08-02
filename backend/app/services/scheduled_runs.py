"""Per-tenant scheduled job logic (monthly AR statements + board packet email),
each recording a ScheduledJobRun for the monitor dashboard.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.identity import Tenant
from app.models.scheduling import ScheduledJobRun, SchedulerConfig
from app.services import board_reports, notifications, statements

JOB_STATEMENTS = "MONTHLY_STATEMENTS"
JOB_BOARD_PACKET = "BOARD_PACKET"


def get_config(db: Session, tenant_id) -> SchedulerConfig:
    c = db.execute(select(SchedulerConfig).where(SchedulerConfig.tenant_id == tenant_id)).scalar_one_or_none()
    if c is None:
        from app.core.model_defaults import make_default
        c = make_default(SchedulerConfig, tenant_id=tenant_id)
    return c


def _log(db, tenant_id, job_name, trigger, started, status, summary):
    db.add(ScheduledJobRun(tenant_id=tenant_id, job_name=job_name, trigger=trigger, status=status,
                           summary=summary, started_at=started, finished_at=datetime.now(timezone.utc)))
    db.flush()


def run_statements_for_tenant(db: Session, tenant_id, *, trigger="MANUAL", as_of=None,
                              attach_pdf=None, created_by=None) -> dict:
    started = datetime.now(timezone.utc)
    if attach_pdf is None:
        attach_pdf = get_config(db, tenant_id).attach_statement_pdf
    try:
        run = statements.run_statements(db, tenant_id=tenant_id, as_of=as_of or date.today(),
                                        send_email=True, attach_pdf=attach_pdf, created_by=created_by)
        summary = f"{run.run_number}: {run.generated} generated, {run.sent} sent, {run.skipped} skipped, {run.failed} failed"
        _log(db, tenant_id, JOB_STATEMENTS, trigger, started, "SUCCESS", summary)
        return {"status": "SUCCESS", "summary": summary, "run_id": str(run.id)}
    except Exception as exc:  # pragma: no cover - recorded, not raised
        _log(db, tenant_id, JOB_STATEMENTS, trigger, started, "FAILED", str(exc)[:500])
        return {"status": "FAILED", "summary": str(exc)[:500]}


def run_board_packet_for_tenant(db: Session, tenant_id, *, trigger="MANUAL", created_by=None) -> dict:
    started = datetime.now(timezone.utc)
    try:
        t = db.get(Tenant, tenant_id)
        tname = t.name if t else "HOA"
        dash = board_reports.exec_dashboard(db, tenant_id)
        msg = (f"{tname} board packet — cash ${dash['cash_total']}, AR ${dash['ar_open_total']}, "
               f"delinquent ${dash['delinquent_total']}, open cases {dash['open_cases']}, "
               f"filed liens {dash['filed_liens']}. Full delinquency packet + cash-flow forecast "
               f"are available in the Board Dashboard.")
        # Attach the delinquency packet PDF when configured (toggle on the scheduler config).
        attach = None
        if get_config(db, tenant_id).attach_board_pdf:
            from datetime import date as _date
            pdf = board_reports.build_delinquency_packet_pdf(db, tenant_id, _date.today(), tname)
            attach = [("board_packet.pdf", pdf, "application/pdf")]
        recipients = notifications._users_with_role(db, tenant_id, "BOARD_MEMBER")
        emailed = 0
        for u in recipients:
            if u.email and not u.email.endswith("@anonymized.invalid"):
                notifications._send_email(u.email, f"{tname} — Monthly Board Packet", msg, attachments=attach)
                emailed += 1
        # Also raise an in-app notification to the Board.
        notifications.create_notification(db, tenant_id=tenant_id, category="INFO", message=msg,
                                          entity_type="BoardPacket", recipient_role_code="BOARD_MEMBER")
        summary = f"Board packet sent to {emailed} board member(s)"
        _log(db, tenant_id, JOB_BOARD_PACKET, trigger, started, "SUCCESS", summary)
        return {"status": "SUCCESS", "summary": summary}
    except Exception as exc:  # pragma: no cover
        _log(db, tenant_id, JOB_BOARD_PACKET, trigger, started, "FAILED", str(exc)[:500])
        return {"status": "FAILED", "summary": str(exc)[:500]}


def recent_runs(db: Session, tenant_id, limit=50):
    return db.execute(select(ScheduledJobRun).where(ScheduledJobRun.tenant_id == tenant_id)
                      .order_by(ScheduledJobRun.created_at.desc()).limit(limit)).scalars().all()
