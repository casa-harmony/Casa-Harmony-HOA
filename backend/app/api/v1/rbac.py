from __future__ import annotations

import secrets
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
from app.core.security import create_password_reset_token, hash_password
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
from app.services import audit, notifications

router = APIRouter(tags=["rbac"])


def _user_out(user: User) -> UserOut:
    """Serialize a user with the derived fields the admin screens render.

    role_code / tenant_ids are computed from the user's active memberships —
    the server decides what the UI may show, and a user with several grants
    keeps every tenant on the listing while role_code reflects the first.
    """
    active = [m for m in user.memberships if m.is_active]
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        job_title=user.job_title,
        is_superadmin=user.is_superadmin,
        is_active=user.is_active,
        created_at=user.created_at,
        memberships=[
            MembershipOut(
                id=m.id, user_id=m.user_id, tenant_id=m.tenant_id, role_id=m.role_id,
                is_active=m.is_active, role_code=m.role.code if m.role else None,
            )
            for m in user.memberships
        ],
        role_code=active[0].role.code if active and active[0].role else None,
        tenant_ids=[m.tenant_id for m in active],
    )


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
    # principal.tenant_id is derived from X-Tenant-Id upstream (get_principal), so
    # a SUPERADMIN listing without the header gets the platform-wide view.
    if principal.is_superadmin and principal.tenant_id is None:
        rows = db.execute(select(User).order_by(User.email)).scalars().all()
    else:
        rows = db.execute(
            select(User)
            .join(Membership, Membership.user_id == User.id)
            .where(Membership.tenant_id == principal.tenant_id)
            .order_by(User.email)
        ).scalars().unique().all()
    return [_user_out(u) for u in rows]


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

    if not payload.password and not payload.send_invite:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Provide a password or set send_invite to email a set-password link",
        )
    # An invited user gets an unusable random hash; the emailed reset token is
    # bound to its password version, so it dies the moment they set a password.
    hashed = (
        hash_password(payload.password)
        if payload.password
        else hash_password(secrets.token_urlsafe(32))
    )
    user = User(
        email=payload.email.lower(),
        full_name=payload.full_name,
        job_title=payload.job_title,
        hashed_password=hashed,
        is_superadmin=payload.is_superadmin,
        must_change_password=True,  # temp password → force change on first login
        created_by=principal.user.id,
        updated_by=principal.user.id,
    )
    db.add(user)
    db.flush()

    # Grant the requested community role in the same call, so the UI's
    # "create user + assign role + assign community" form produces an account
    # that can actually sign in somewhere instead of a zero-membership ghost.
    if not payload.is_superadmin and payload.role_code:
        tenant_id = payload.tenant_id or principal.tenant_id
        if tenant_id is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "role_code was given but no tenant — pick a community to grant access to",
            )
        if not principal.is_superadmin and tenant_id != principal.tenant_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Cannot grant membership outside your HOA"
            )
        role = db.execute(
            select(Role).where(
                Role.code == payload.role_code,
                (Role.tenant_id == tenant_id) | (Role.tenant_id.is_(None)),
            )
        ).scalars().first()
        if role is None:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"Role '{payload.role_code}' not found"
            )
        existing = db.execute(
            select(Membership).where(
                Membership.user_id == user.id,
                Membership.tenant_id == tenant_id,
                Membership.role_id == role.id,
            )
        ).scalar_one_or_none()
        if existing is None:
            db.add(Membership(
                tenant_id=tenant_id, user_id=user.id, role_id=role.id,
                is_active=True, created_by=principal.user.id, updated_by=principal.user.id,
            ))
            db.flush()

    audit.record(
        db, action="CREATE", entity_type="User", entity_id=user.id,
        after={"email": user.email}, tenant_id=principal.tenant_id,
        ip_address=getattr(request.state, "client_ip", None),
    )

    if payload.send_invite and not payload.password:
        token = create_password_reset_token(user.id, user.hashed_password)
        notifications.send_password_invite(user.email, token)

    return _user_out(user)

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
            
    return _user_out(user)


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
    return _user_out(user)


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
