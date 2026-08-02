from __future__ import annotations

import uuid
from datetime import date

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.encumbrance import EncumbranceSettings, PoEncumbrance
from app.models.identity import Tenant
from app.models.procurement import PoHeader
from app.schemas.encumbrance import (
    CommitmentRow,
    EncumbranceOut,
    EncumbranceSettingsIn,
    EncumbranceSettingsOut,
)
from app.services import audit, encumbrance, po_reports

router = APIRouter(
    prefix="/encumbrance", tags=["encumbrance"], dependencies=[Depends(require_active_tenant)]
)
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@router.get("/settings", response_model=EncumbranceSettingsOut)
def get_settings(db: Session = Depends(get_db),
                 p: Principal = Depends(require_permission("gl.batch.manage"))):
    return encumbrance.get_settings(db, p.tenant_id)


@router.put("/settings", response_model=EncumbranceSettingsOut)
def put_settings(payload: EncumbranceSettingsIn, db: Session = Depends(get_db),
                 p: Principal = Depends(require_permission("gl.batch.manage"))):
    s = db.execute(select(EncumbranceSettings).where(
        EncumbranceSettings.tenant_id == p.tenant_id)).scalar_one_or_none()
    if s is None:
        s = EncumbranceSettings(tenant_id=p.tenant_id, created_by=p.user.id, updated_by=p.user.id)
        db.add(s)
    s.enabled = payload.enabled
    s.encumbrance_combination_id = payload.encumbrance_combination_id
    s.reserve_combination_id = payload.reserve_combination_id
    db.flush()
    audit.record(db, action="UPDATE", entity_type="EncumbranceSettings", entity_id=s.id,
                 after={"enabled": s.enabled})
    return s


@router.get("", response_model=list[EncumbranceOut])
def list_encumbrances(db: Session = Depends(get_db),
                      p: Principal = Depends(require_permission("po.manage"))):
    rows = db.execute(
        select(PoEncumbrance, PoHeader)
        .join(PoHeader, PoHeader.id == PoEncumbrance.po_header_id)
        .where(PoEncumbrance.tenant_id == p.tenant_id)
        .order_by(PoHeader.po_number)
    ).all()
    return [EncumbranceOut(
        id=e.id, po_header_id=e.po_header_id, po_number=po.po_number, vendor_id=po.vendor_id,
        encumbered_amount=e.encumbered_amount, liquidated_amount=e.liquidated_amount,
        open_commitment=e.open_commitment, status=e.status) for e, po in rows]


@router.get("/commitments", response_model=list[CommitmentRow])
def commitments(db: Session = Depends(get_db),
                p: Principal = Depends(require_permission("po.manage"))):
    return po_reports.commitment_balances(db, p.tenant_id)


@router.get("/register/export")
def export_register(db: Session = Depends(get_db),
                    p: Principal = Depends(require_permission("report.read"))):
    t = db.get(Tenant, p.tenant_id)
    content = po_reports.build_encumbrance_register(db, p.tenant_id, t.name if t else "HOA")
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="encumbrance_register.xlsx"'})
