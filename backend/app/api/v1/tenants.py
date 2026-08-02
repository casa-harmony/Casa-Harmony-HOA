from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, get_principal, require_permission, require_superadmin
from app.models.identity import Tenant
from app.schemas.tenant import TenantCreate, TenantOut, TenantUpdate
from app.services import audit
from app.services.coa_bootstrap import provision_default_coa

router = APIRouter(prefix="/tenants", tags=["tenants"])


@router.get("", response_model=list[TenantOut])
def list_tenants(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_principal),
):
    """SUPERADMIN sees all HOAs; others see only HOAs they are a member of."""
    if principal.is_superadmin:
        rows = db.execute(select(Tenant).order_by(Tenant.name)).scalars().all()
        return rows
    # Non-superadmin: restrict to memberships.
    from app.models.identity import Membership

    rows = db.execute(
        select(Tenant)
        .join(Membership, Membership.tenant_id == Tenant.id)
        .where(Membership.user_id == principal.user.id, Membership.is_active.is_(True))
        .order_by(Tenant.name)
    ).scalars().unique().all()
    return rows


@router.post("", response_model=TenantOut, status_code=status.HTTP_201_CREATED)
def create_tenant(
    payload: TenantCreate,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_superadmin),
):
    if db.execute(select(Tenant).where(Tenant.slug == payload.slug)).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, f"Slug '{payload.slug}' already in use")

    tenant = Tenant(
        **payload.model_dump(exclude={"create_default_coa"}),
        created_by=principal.user.id,
        updated_by=principal.user.id,
    )
    db.add(tenant)
    db.flush()

    if payload.create_default_coa:
        provision_default_coa(db, tenant.id, principal.user.id)

    audit.record(
        db,
        action="CREATE",
        entity_type="Tenant",
        entity_id=tenant.id,
        after={"name": tenant.name, "slug": tenant.slug},
        tenant_id=tenant.id,
        ip_address=getattr(request.state, "client_ip", None),
    )
    return tenant


@router.get("/{tenant_id}", response_model=TenantOut)
def get_tenant(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("tenant.read")),
):
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
    if not principal.is_superadmin and principal.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this HOA")
    return tenant


@router.patch("/{tenant_id}", response_model=TenantOut)
def update_tenant(
    tenant_id: uuid.UUID,
    payload: TenantUpdate,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("tenant.update")),
):
    tenant = db.get(Tenant, tenant_id)
    if tenant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
    if not principal.is_superadmin and principal.tenant_id != tenant_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this HOA")

    before = {"name": tenant.name, "status": tenant.status}
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(tenant, k, v)
    tenant.updated_by = principal.user.id
    audit.record(
        db, action="UPDATE", entity_type="Tenant", entity_id=tenant.id,
        before=before, after=payload.model_dump(exclude_unset=True), tenant_id=tenant.id,
        ip_address=getattr(request.state, "client_ip", None),
    )
    return tenant
