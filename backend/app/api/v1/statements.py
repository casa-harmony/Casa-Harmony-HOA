from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

import uuid as _uuid
from datetime import date

from app.core.database import get_db, get_elevated_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.identity import Tenant
from app.models.statements import StatementDelivery, StatementRun
from app.models.subledger import ArHomeowner
from app.schemas.statements import DeliveryOut, OptOutIn, StatementRunIn, StatementRunOut
from app.services import audit, statements

router = APIRouter(
    prefix="/statements", tags=["statements"], dependencies=[Depends(require_active_tenant)]
)
# Signed-link downloads are intentionally unauthenticated (HMAC-verified).
public_router = APIRouter(prefix="/statements", tags=["statements"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.post("/run", response_model=StatementRunOut, status_code=status.HTTP_201_CREATED)
def run(payload: StatementRunIn, db: Session = Depends(get_db),
        p: Principal = Depends(require_permission("ar.manage"))):
    run = statements.run_statements(
        db, tenant_id=p.tenant_id, as_of=payload.as_of, send_email=payload.send_email,
        homeowner_ids=payload.homeowner_ids, created_by=p.user.id)
    audit.record(db, action="STATEMENT_RUN", entity_type="StatementRun", entity_id=run.id,
                 after={"run": run.run_number, "generated": run.generated, "sent": run.sent})
    return run


@router.get("/runs", response_model=list[StatementRunOut])
def list_runs(db: Session = Depends(get_db),
              p: Principal = Depends(require_permission("ar.manage"))):
    return db.execute(select(StatementRun).where(StatementRun.tenant_id == p.tenant_id)
                      .order_by(StatementRun.created_at.desc())).scalars().all()


@router.get("/runs/{run_id}/deliveries", response_model=list[DeliveryOut])
def deliveries(run_id: uuid.UUID, db: Session = Depends(get_db),
               p: Principal = Depends(require_permission("ar.manage"))):
    return db.execute(select(StatementDelivery).where(
        StatementDelivery.tenant_id == p.tenant_id,
        StatementDelivery.run_id == run_id).order_by(StatementDelivery.status)).scalars().all()


@router.get("/runs/{run_id}/report/export")
def export_report(run_id: uuid.UUID, db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("ar.manage"))):
    run = db.get(StatementRun, run_id)
    if run is None or run.tenant_id != p.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    t = db.get(Tenant, p.tenant_id)
    content = statements.build_delivery_report_workbook(db, p.tenant_id, run, t.name if t else "HOA")
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="statement_run_{run.run_number}.xlsx"'})


@public_router.get("/public")
def public_statement(t: _uuid.UUID, h: _uuid.UUID, e: int, sig: str,
                     db: Session = Depends(get_elevated_db)):
    """Login-free, signed-link statement download (fallback for large emailed PDFs)."""
    if not statements.verify_statement_link(t, h, e, sig):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid or expired link")
    ho = db.get(ArHomeowner, h)
    if ho is None or ho.tenant_id != t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    tn = db.get(Tenant, t)
    pdf = statements.build_statement_pdf(db, t, ho, date.today(), tn.name if tn else "HOA")
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="statement_{ho.account_number}.pdf"'})


@router.post("/opt-out", response_model=dict)
def opt_out(payload: OptOutIn, db: Session = Depends(get_db),
            p: Principal = Depends(require_permission("ar.manage"))):
    ho = db.get(ArHomeowner, payload.homeowner_id)
    if ho is None or ho.tenant_id != p.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Homeowner not found")
    ho.statement_opt_out = payload.opt_out
    db.flush()
    audit.record(db, action="STATEMENT_OPT_OUT", entity_type="ArHomeowner", entity_id=ho.id,
                 after={"opt_out": payload.opt_out})
    return {"homeowner_id": str(ho.id), "opt_out": ho.statement_opt_out}
