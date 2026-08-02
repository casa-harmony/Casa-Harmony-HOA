from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.budgeting import BudgetControlSettings, BudgetVersion
from app.models.identity import Tenant
from app.schemas.budgeting import (
    ApproveIn,
    BvARow,
    ControlIn,
    ControlOut,
    SpreadIn,
    VersionCreate,
    VersionDetail,
    VersionOut,
)
from app.services import audit, budgeting, reports
from app.services.budgeting import BudgetError

router = APIRouter(
    prefix="/budgeting", tags=["budgeting"], dependencies=[Depends(require_active_tenant)]
)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _err(exc: BudgetError):
    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.get("/versions", response_model=list[VersionOut])
def list_versions(db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("budget.manage"))):
    return db.execute(select(BudgetVersion).where(BudgetVersion.tenant_id == p.tenant_id)
                      .order_by(BudgetVersion.fiscal_year.desc(), BudgetVersion.name)).scalars().all()


@router.post("/versions", response_model=VersionOut, status_code=status.HTTP_201_CREATED)
def create_version(payload: VersionCreate, db: Session = Depends(get_db),
                   p: Principal = Depends(require_permission("budget.manage"))):
    try:
        v = budgeting.create_version(db, tenant_id=p.tenant_id, created_by=p.user.id,
                                     **payload.model_dump())
    except BudgetError as exc:
        _err(exc)
    audit.record(db, action="CREATE", entity_type="BudgetVersion", entity_id=v.id,
                 after={"name": v.name})
    return v


@router.get("/versions/{version_id}", response_model=VersionDetail)
def get_version(version_id: uuid.UUID, db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("budget.manage"))):
    v = db.get(BudgetVersion, version_id)
    if v is None or v.tenant_id != p.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    return v


@router.post("/versions/{version_id}/spread", response_model=VersionDetail)
def spread(version_id: uuid.UUID, payload: SpreadIn, db: Session = Depends(get_db),
           p: Principal = Depends(require_permission("budget.manage"))):
    try:
        budgeting.spread_line(
            db, tenant_id=p.tenant_id, version_id=version_id,
            code_combination_id=payload.code_combination_id, annual_amount=payload.annual_amount,
            method=payload.method, per_period=payload.per_period, created_by=p.user.id)
    except BudgetError as exc:
        _err(exc)
    return db.get(BudgetVersion, version_id)


@router.post("/versions/{version_id}/submit", response_model=VersionOut)
def submit(version_id: uuid.UUID, db: Session = Depends(get_db),
           p: Principal = Depends(require_permission("budget.manage"))):
    try:
        v = budgeting.submit_version(db, version_id, p.tenant_id)
    except BudgetError as exc:
        _err(exc)
    audit.record(db, action="SUBMIT", entity_type="BudgetVersion", entity_id=v.id)
    return v


@router.post("/versions/{version_id}/approve", response_model=VersionOut)
def approve(version_id: uuid.UUID, payload: ApproveIn, db: Session = Depends(get_db),
            p: Principal = Depends(require_permission("budget.approve"))):
    try:
        v = budgeting.approve_version(db, version_id, p.tenant_id, approve=payload.approve,
                                      make_controlling=payload.make_controlling, user_id=p.user.id)
    except BudgetError as exc:
        _err(exc)
    audit.record(db, action="APPROVE" if payload.approve else "REJECT",
                 entity_type="BudgetVersion", entity_id=v.id)
    return v


@router.get("/versions/{version_id}/vs-actual", response_model=list[BvARow])
def vs_actual(version_id: uuid.UUID, db: Session = Depends(get_db),
              p: Principal = Depends(require_permission("report.read"))):
    try:
        return budgeting.budget_vs_actual(db, p.tenant_id, version_id)
    except BudgetError as exc:
        _err(exc)


# --- Budgetary control -----------------------------------------------------
@router.get("/control", response_model=ControlOut)
def get_control(db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("budget.approve"))):
    return budgeting.get_control(db, p.tenant_id)


@router.put("/control", response_model=ControlOut)
def set_control(payload: ControlIn, db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("budget.approve"))):
    s = db.execute(select(BudgetControlSettings).where(
        BudgetControlSettings.tenant_id == p.tenant_id)).scalar_one_or_none()
    if s is None:
        s = BudgetControlSettings(tenant_id=p.tenant_id, created_by=p.user.id, updated_by=p.user.id)
        db.add(s)
    s.mode = payload.mode
    s.controlling_version_id = payload.controlling_version_id
    db.flush()
    audit.record(db, action="UPDATE", entity_type="BudgetControlSettings", entity_id=s.id,
                 after={"mode": s.mode})
    return s


# --- Reports ---------------------------------------------------------------
def _tname(db, tid):
    t = db.get(Tenant, tid)
    return t.name if t else "HOA"


@router.get("/versions/{version_id}/vs-actual/export")
def export_vs_actual(version_id: uuid.UUID, db: Session = Depends(get_db),
                     p: Principal = Depends(require_permission("report.read"))):
    content = reports.build_budget_vs_actual_v2_workbook(db, p.tenant_id, version_id, _tname(db, p.tenant_id))
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="budget_vs_actual.xlsx"'})


@router.get("/versions/{version_id}/spread/export")
def export_spread(version_id: uuid.UUID, db: Session = Depends(get_db),
                  p: Principal = Depends(require_permission("report.read"))):
    content = reports.build_budget_spread_workbook(db, p.tenant_id, version_id, _tname(db, p.tenant_id))
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="budget_spread.xlsx"'})
