from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import (
    Principal,
    get_principal,
    require_active_tenant,
    require_permission,
)
from app.core.security import hash_password
from app.models.identity import (
    Membership,
    Permission,
    Role,
    RolePermission,
    User,
)
from app.schemas.rbac import (
    MembershipCreate,
    MembershipOut,
    PermissionOut,
    RoleCreate,
    RoleOut,
    UserCreate,
    UserOut,
)
from app.services import audit

router = APIRouter(tags=["rbac"])


def _role_out(role: Role) -> RoleOut:
    return RoleOut(
        id=role.id,
        tenant_id=role.tenant_id,
        code=role.code,
        name=role.name,
        description=role.description,
        is_system=role.is_system,
        permissions=sorted(p.code for p in role.permissions),
    )


# --- Permissions -----------------------------------------------------------
@router.get("/permissions", response_model=list[PermissionOut])
def list_permissions(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("role.manage")),
):
    return db.execute(select(Permission).order_by(Permission.category, Permission.code)).scalars().all()


# --- Roles -----------------------------------------------------------------
@router.get("/roles", response_model=list[RoleOut])
def list_roles(
    db: Session = Depends(get_db),
    principal: Principal = Depends(get_principal),
):
    """System roles (tenant_id NULL) plus the active tenant's custom roles.

    Always scoped to the active HOA — even for SUPERADMIN — so a tenant-scoped
    custom role (e.g. BOARD_MEMBER) from another HOA never appears as a duplicate.
    """
    stmt = select(Role).where(
        (Role.tenant_id.is_(None)) | (Role.tenant_id == principal.tenant_id)
    )
    return [_role_out(r) for r in db.execute(stmt.order_by(Role.code)).scalars().all()]


@router.post("/roles", response_model=RoleOut, status_code=status.HTTP_201_CREATED)
def create_role(
    payload: RoleCreate,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("role.manage")),
):
    tenant_id = principal.tenant_id
    if tenant_id is None and not principal.is_superadmin:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Select an HOA to create roles in")

    role = Role(
        tenant_id=tenant_id,
        code=payload.code,
        name=payload.name,
        description=payload.description,
        is_system=False,
        created_by=principal.user.id,
        updated_by=principal.user.id,
    )
    db.add(role)
    db.flush()
    if payload.permission_codes:
        perms = db.execute(
            select(Permission).where(Permission.code.in_(payload.permission_codes))
        ).scalars().all()
        for p in perms:
            db.add(RolePermission(role_id=role.id, permission_id=p.id))
    db.flush()
    db.refresh(role)
    audit.record(
        db, action="CREATE", entity_type="Role", entity_id=role.id,
        after={"code": role.code}, tenant_id=tenant_id,
        ip_address=getattr(request.state, "client_ip", None),
    )
    return _role_out(role)


# --- Users -----------------------------------------------------------------
@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("user.manage")),
):
    if principal.is_superadmin:
        return db.execute(select(User).order_by(User.email)).scalars().all()
    # Tenant admins see users who are members of the active HOA.
    return db.execute(
        select(User)
        .join(Membership, Membership.user_id == User.id)
        .where(Membership.tenant_id == principal.tenant_id)
        .order_by(User.email)
    ).scalars().unique().all()


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("user.manage")),
):
    if payload.is_superadmin and not principal.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only SUPERADMIN can create SUPERADMINs")
    if db.execute(select(User).where(User.email == payload.email.lower())).scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "Email already registered")

    user = User(
        email=payload.email.lower(),
        full_name=payload.full_name,
        hashed_password=hash_password(payload.password),
        is_superadmin=payload.is_superadmin,
        must_change_password=True,  # temp password → force change on first login
        created_by=principal.user.id,
        updated_by=principal.user.id,
    )
    db.add(user)
    db.flush()
    audit.record(
        db, action="CREATE", entity_type="User", entity_id=user.id,
        after={"email": user.email}, tenant_id=principal.tenant_id,
        ip_address=getattr(request.state, "client_ip", None),
    )
    return user


# --- Memberships -----------------------------------------------------------
@router.post("/memberships", response_model=MembershipOut, status_code=status.HTTP_201_CREATED)
def grant_membership(
    payload: MembershipCreate,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("membership.manage")),
    _tenant: Principal = Depends(require_active_tenant),
):
    tenant_id = principal.tenant_id
    if db.get(User, payload.user_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    role = db.get(Role, payload.role_id)
    if role is None or (role.tenant_id is not None and role.tenant_id != tenant_id):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid role for this HOA")

    existing = db.execute(
        select(Membership).where(
            Membership.user_id == payload.user_id,
            Membership.tenant_id == tenant_id,
            Membership.role_id == payload.role_id,
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, "Membership already exists")

    m = Membership(
        tenant_id=tenant_id,
        user_id=payload.user_id,
        role_id=payload.role_id,
        created_by=principal.user.id,
        updated_by=principal.user.id,
    )
    db.add(m)
    db.flush()
    audit.record(
        db, action="CREATE", entity_type="Membership", entity_id=m.id,
        after={"user_id": str(payload.user_id), "role_id": str(payload.role_id)},
        tenant_id=tenant_id, ip_address=getattr(request.state, "client_ip", None),
    )
    return m
