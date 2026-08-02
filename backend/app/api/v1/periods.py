from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.identity import Tenant
from app.schemas.period import PeriodOut, RollForwardOut
from app.services import audit, period_close, reports
from app.services.period_close import PeriodError

router = APIRouter(
    prefix="/periods", tags=["periods"], dependencies=[Depends(require_active_tenant)]
)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("", response_model=list[PeriodOut])
def list_periods(db: Session = Depends(get_db),
                 p: Principal = Depends(require_permission("gl.period.manage"))):
    return period_close.list_periods(db, p.tenant_id)


@router.post("/{period_name}/open", response_model=PeriodOut)
def open_period(period_name: str, db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("gl.period.manage"))):
    try:
        per = period_close.open_period(db, p.tenant_id, period_name, p.user.id)
    except (PeriodError, ValueError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="OPEN_PERIOD", entity_type="AccountingPeriod", entity_id=per.id)
    return per


@router.post("/{period_name}/close", response_model=PeriodOut)
def close_period(period_name: str, db: Session = Depends(get_db),
                 p: Principal = Depends(require_permission("gl.period.manage"))):
    try:
        per = period_close.close_period(db, p.tenant_id, period_name, p.user.id)
    except (PeriodError, ValueError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="CLOSE_PERIOD", entity_type="AccountingPeriod", entity_id=per.id)
    return per


@router.post("/{period_name}/reopen", response_model=PeriodOut)
def reopen_period(period_name: str, db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("gl.period.manage"))):
    try:
        per = period_close.reopen_period(db, p.tenant_id, period_name, p.user.id)
    except (PeriodError, ValueError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="REOPEN_PERIOD", entity_type="AccountingPeriod", entity_id=per.id)
    return per


@router.post("/year-end-close", response_model=RollForwardOut)
def year_end_close(year: int, retained_earnings_natural: str = "3000",
                   db: Session = Depends(get_db),
                   p: Principal = Depends(require_permission("gl.period.manage"))):
    try:
        batch = period_close.year_end_roll_forward(
            db, p.tenant_id, year, retained_earnings_natural, created_by=p.user.id)
    except (PeriodError, ValueError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="YEAR_END_CLOSE", entity_type="GlJeBatch", entity_id=batch.id,
                 after={"year": year})
    return RollForwardOut(batch_id=batch.id, batch_name=batch.batch_name,
                          control_total_dr=batch.control_total_dr,
                          control_total_cr=batch.control_total_cr)


def _tname(db, tid):
    t = db.get(Tenant, tid)
    return t.name if t else "HOA"


@router.get("/checklist/export")
def export_checklist(db: Session = Depends(get_db),
                     p: Principal = Depends(require_permission("report.read"))):
    content = reports.build_period_close_checklist(db, p.tenant_id, _tname(db, p.tenant_id))
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="period_close_checklist.xlsx"'})


@router.get("/{period_name}/trial-balance/export")
def export_trial_balance(period_name: str, db: Session = Depends(get_db),
                         p: Principal = Depends(require_permission("report.read"))):
    content = reports.build_trial_balance_workbook(db, p.tenant_id, period_name, _tname(db, p.tenant_id))
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": f'attachment; filename="trial_balance_{period_name}.xlsx"'})
