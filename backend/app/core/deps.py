"""FastAPI dependencies: current user, active-tenant principal, RBAC guards."""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.context import get_context
from app.core.database import get_db
from app.models.identity import Membership, Role, User
from app.models.resident import Resident

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class Principal:
    user: User
    tenant_id: uuid.UUID | None
    is_superadmin: bool
    permissions: frozenset[str] = field(default_factory=frozenset)

    def has(self, perm: str) -> bool:
        return self.is_superadmin or perm in self.permissions


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    ctx = get_context()
    if ctx.user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid authentication token")
    user = db.get(User, ctx.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    return user


def get_current_resident(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Resident:
    """Authenticate a resident-portal token (scope='resident'). Staff tokens are rejected."""
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    ctx = get_context()
    if ctx.scope != "resident" or ctx.user_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Resident authentication required")
    resident = db.get(Resident, ctx.user_id)
    if resident is None or not resident.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Resident not found or inactive")
    # Defense in depth: the resident's HOA must match the RLS-bound tenant.
    if resident.tenant_id != ctx.tenant_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tenant mismatch")
    return resident


def get_principal(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
) -> Principal:
    """Resolve the caller's effective permissions within the active tenant."""
    tenant_id: uuid.UUID | None = None
    if x_tenant_id:
        try:
            tenant_id = uuid.UUID(x_tenant_id)
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid X-Tenant-Id") from exc

    if user.is_superadmin:
        if tenant_id is not None:
            from app.models.identity import Tenant
            tenant = db.get(Tenant, tenant_id)
            if not tenant:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Tenant not found")
            
            # Record audit event if first time in this session (since last login)
            if user.last_login_at:
                from app.models.audit import AuditLog
                recent = db.execute(
                    select(AuditLog).where(
                        AuditLog.actor_id == user.id,
                        AuditLog.action == "PLATFORM_TENANT_ACCESS",
                        AuditLog.tenant_id == tenant_id,
                        AuditLog.created_at >= user.last_login_at
                    )
                ).first()
                if not recent:
                    from app.services import audit
                    audit.record(
                        db,
                        action="PLATFORM_TENANT_ACCESS",
                        entity_type="Tenant",
                        entity_id=str(tenant_id),
                        tenant_id=tenant_id
                    )

        # SUPERADMIN holds every permission across all tenants.
        return Principal(user=user, tenant_id=tenant_id, is_superadmin=True, permissions=frozenset())

    perms: set[str] = set()
    if tenant_id is not None:
        rows = db.execute(
            select(Role)
            .join(Membership, Membership.role_id == Role.id)
            .where(
                Membership.user_id == user.id,
                Membership.tenant_id == tenant_id,
                Membership.is_active.is_(True),
            )
        ).scalars().all()
        if not rows:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "No active membership in the selected HOA"
            )
        for role in rows:
            perms.update(p.code for p in role.permissions)

    return Principal(
        user=user, tenant_id=tenant_id, is_superadmin=False, permissions=frozenset(perms)
    )


def require_permission(perm: str):
    """Dependency factory enforcing a single permission code."""

    def _checker(principal: Principal = Depends(get_principal)) -> Principal:
        if not principal.has(perm):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, f"Missing required permission: {perm}"
            )
        return principal

    return _checker


def require_superadmin(principal: Principal = Depends(get_principal)) -> Principal:
    if not principal.is_superadmin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "SUPERADMIN privilege required")
    return principal


def require_active_tenant(principal: Principal = Depends(get_principal)) -> Principal:
    if principal.tenant_id is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "X-Tenant-Id header is required for this operation"
        )
    return principal
