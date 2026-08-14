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
    RoleOut,
    UserCreate,
    UserUpdate,
    UserOut,
    MembershipUpdate,
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
    tenant_id = request.headers.get("X-Tenant-Id")
    if principal.is_superadmin and not tenant_id:
        # Platform-wide listing (explicitly requested by omitting the header)
        return db.execute(select(User).order_by(User.email)).scalars().all()
    
    # Scoped to active tenant
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
        job_title=payload.job_title,
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

@router.get("/users/{user_id}", response_model=UserOut)
def get_user(
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("user.manage")),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
        
    # Tenant boundary: if not superadmin, ensure user is in the active tenant
    if not principal.is_superadmin:
        has_access = any(m.tenant_id == principal.tenant_id for m in user.memberships)
        if not has_access:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
            
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: uuid.UUID,
    payload: UserUpdate,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("user.manage")),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
        
    if not principal.is_superadmin:
        has_access = any(m.tenant_id == principal.tenant_id for m in user.memberships)
        if not has_access:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
            
    if payload.is_superadmin is not None:
        if not principal.is_superadmin:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only SUPERADMIN can modify SUPERADMIN status")
        user.is_superadmin = payload.is_superadmin
        
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.job_title is not None:
        user.job_title = payload.job_title
    if payload.is_active is not None:
        user.is_active = payload.is_active
        
    db.flush()
    audit.record(
        db, action="UPDATE", entity_type="User", entity_id=user.id,
        after={"email": user.email, "is_active": user.is_active}, tenant_id=principal.tenant_id,
        ip_address=getattr(request.state, "client_ip", None),
    )
    return user


@router.post("/users/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_user_password(
    user_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("user.manage")),
):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
        
    if not principal.is_superadmin:
        has_access = any(m.tenant_id == principal.tenant_id for m in user.memberships)
        if not has_access:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
            
    # Set must_change_password to True. In a real system, send email here.
    user.must_change_password = True
    db.flush()
    audit.record(
        db, action="UPDATE", entity_type="User", entity_id=user.id,
        after={"must_change_password": True}, tenant_id=principal.tenant_id,
        ip_address=getattr(request.state, "client_ip", None),
    )


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

@router.get("/memberships", response_model=list[MembershipOut])
def list_memberships(
    user_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("membership.manage")),
    _tenant: Principal = Depends(require_active_tenant),
):
    stmt = select(Membership).where(Membership.tenant_id == principal.tenant_id)
    if user_id:
        stmt = stmt.where(Membership.user_id == user_id)
    return db.execute(stmt).scalars().all()


@router.patch("/memberships/{membership_id}", response_model=MembershipOut)
def update_membership(
    membership_id: uuid.UUID,
    payload: MembershipUpdate,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("membership.manage")),
    _tenant: Principal = Depends(require_active_tenant),
):
    m = db.get(Membership, membership_id)
    if not m or m.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membership not found")
        
    if payload.role_id is not None:
        role = db.get(Role, payload.role_id)
        if role is None or (role.tenant_id is not None and role.tenant_id != principal.tenant_id):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid role for this HOA")
        m.role_id = payload.role_id
        
    if payload.is_active is not None:
        m.is_active = payload.is_active
        
    db.flush()
    audit.record(
        db, action="UPDATE", entity_type="Membership", entity_id=m.id,
        after={"role_id": str(m.role_id), "is_active": m.is_active}, tenant_id=principal.tenant_id,
        ip_address=getattr(request.state, "client_ip", None),
    )
    return m


@router.delete("/memberships/{membership_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_membership(
    membership_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("membership.manage")),
    _tenant: Principal = Depends(require_active_tenant),
):
    m = db.get(Membership, membership_id)
    if not m or m.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membership not found")
        
    db.delete(m)
    db.flush()
    audit.record(
        db, action="DELETE", entity_type="Membership", entity_id=m.id,
        after={}, tenant_id=principal.tenant_id,
        ip_address=getattr(request.state, "client_ip", None),
    )
