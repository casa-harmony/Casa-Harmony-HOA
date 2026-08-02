from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.identity import Tenant
from app.services import board_reports

router = APIRouter(prefix="/board", tags=["board"], dependencies=[Depends(require_active_tenant)])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _tname(db, tid):
    t = db.get(Tenant, tid)
    return t.name if t else "HOA"


@router.get("/exec-dashboard")
def exec_dashboard(db: Session = Depends(get_db),
                   p: Principal = Depends(require_permission("report.read"))):
    return board_reports.exec_dashboard(db, p.tenant_id)


@router.get("/cash-flow-forecast")
def cash_flow_forecast(start: date | None = None, months: int = 6, db: Session = Depends(get_db),
                       p: Principal = Depends(require_permission("report.read"))):
    rows = board_reports.cash_flow_forecast(db, p.tenant_id, start or date.today(), months)
    return [{**r, "opening": str(r["opening"]), "inflow": str(r["inflow"]),
             "outflow": str(r["outflow"]), "ending": str(r["ending"])} for r in rows]


@router.get("/cash-flow-forecast/export")
def cash_flow_forecast_export(start: date | None = None, months: int = 6, db: Session = Depends(get_db),
                              p: Principal = Depends(require_permission("report.read"))):
    content = board_reports.build_cash_flow_forecast_workbook(
        db, p.tenant_id, start or date.today(), months, _tname(db, p.tenant_id))
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="cash_flow_forecast.xlsx"'})


@router.get("/delinquency-packet/export")
def delinquency_packet_export(as_of: date | None = None, db: Session = Depends(get_db),
                              p: Principal = Depends(require_permission("report.read"))):
    d = as_of or date.today()
    content = board_reports.build_delinquency_packet_pdf(db, p.tenant_id, d, _tname(db, p.tenant_id))
    return Response(content=content, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="delinquency_packet_{d}.pdf"'})
