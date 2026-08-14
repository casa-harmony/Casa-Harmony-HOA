"""Admin: manage resident portal logins (owners & renters) and their unit links."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.core.security import hash_password
from app.models.resident import Resident, ResidentUnit
from app.models.subledger import ArHomeowner
from app.schemas.resident import (
    ResidentCreate,
    ResidentOut,
    ResidentUpdate,
    ResidentUnitLink,
    ResidentUnitOut,
)
from app.services import audit

router = APIRouter(
    prefix="/residents", tags=["residents"], dependencies=[Depends(require_active_tenant)]
)


def _out(db: Session, r: Resident) -> ResidentOut:
    count = db.execute(
        select(func.count(ResidentUnit.id)).where(ResidentUnit.resident_id == r.id)
    ).scalar_one()
    return ResidentOut(
        id=r.id, username=r.username, full_name=r.full_name, resident_type=r.resident_type,
        email=r.email, is_active=r.is_active, unit_count=count,
    )


@router.get("", response_model=list[ResidentOut])
def list_residents(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("resident.manage")),
):
    rows = db.execute(
        select(Resident).where(Resident.tenant_id == principal.tenant_id)
        .order_by(Resident.username)
    ).scalars().all()
    return [_out(db, r) for r in rows]


@router.post("", response_model=ResidentOut, status_code=status.HTTP_201_CREATED)
def create_resident(
    payload: ResidentCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("resident.manage")),
):
    exists = db.execute(
        select(Resident).where(
            Resident.tenant_id == principal.tenant_id,
            func.lower(Resident.username) == payload.username.lower(),
        )
    ).scalar_one_or_none()
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "Username already exists in this HOA")
    if payload.mfa_channel == "SMS" and not payload.phone:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "A phone number is required for SMS verification")
    if payload.mfa_channel == "EMAIL" and not payload.email:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY,
                            "An email is required for email verification")
    r = Resident(
        tenant_id=principal.tenant_id, username=payload.username.lower(),
        password_hash=hash_password(payload.password), resident_type=payload.resident_type,
        full_name=payload.full_name, email=payload.email, phone=payload.phone,
        mfa_channel=payload.mfa_channel,
        created_by=principal.user.id, updated_by=principal.user.id,
    )
    db.add(r)
    db.flush()
    audit.record(db, action="CREATE", entity_type="Resident", entity_id=r.id,
                 after={"username": r.username, "type": r.resident_type})
    return _out(db, r)


@router.patch("/{resident_id}", response_model=ResidentOut)
def update_resident(
    resident_id: uuid.UUID,
    payload: ResidentUpdate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("resident.manage")),
):
    r = db.execute(
        select(Resident).where(
            Resident.id == resident_id, Resident.tenant_id == principal.tenant_id
        )
    ).scalar_one_or_none()
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resident not found")
    
    if payload.is_active is not None:
        r.is_active = payload.is_active
    db.commit()
    return _out(db, r)


@router.get("/{resident_id}/units", response_model=list[ResidentUnitOut])
def list_units(
    resident_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("resident.manage")),
):
    return db.execute(
        select(ResidentUnit).where(
            ResidentUnit.tenant_id == principal.tenant_id,
            ResidentUnit.resident_id == resident_id,
        )
    ).scalars().all()


@router.post("/{resident_id}/units", response_model=ResidentUnitOut, status_code=status.HTTP_201_CREATED)
def link_unit(
    resident_id: uuid.UUID,
    payload: ResidentUnitLink,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("resident.manage")),
):
    resident = db.get(Resident, resident_id)
    if resident is None or resident.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resident not found")
    homeowner = db.get(ArHomeowner, payload.homeowner_id)
    if homeowner is None or homeowner.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unit (homeowner account) not found")
    unit_number = payload.unit_number or homeowner.property_unit or homeowner.account_number
    dup = db.execute(
        select(ResidentUnit).where(
            ResidentUnit.tenant_id == principal.tenant_id,
            ResidentUnit.resident_id == resident_id,
            ResidentUnit.unit_number == unit_number,
        )
    ).scalar_one_or_none()
    if dup:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "This resident is already linked to that unit")
    link = ResidentUnit(
        tenant_id=principal.tenant_id, resident_id=resident_id,
        homeowner_id=payload.homeowner_id, unit_number=unit_number,
        is_primary=payload.is_primary, created_by=principal.user.id, updated_by=principal.user.id,
    )
    db.add(link)
    db.flush()
    audit.record(db, action="LINK_UNIT", entity_type="Resident", entity_id=resident_id,
                 after={"unit": unit_number})
    return link
