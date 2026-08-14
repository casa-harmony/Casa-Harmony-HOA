from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db, get_elevated_db
from app.core.deps import get_current_user, get_principal, Principal
from app.core.security import (
    create_access_token,
    create_password_reset_token,
    decode_token,
    hash_password,
    password_version,
    verify_password,
)
from app.models.identity import Membership, Role, Tenant, User
from app.schemas.auth import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    LoginResponse,
    MeResponse,
    MfaEnrollResponse,
    MfaVerifyRequest,
    ResetPasswordRequest,
    TenantMembershipOut,
)
from app.services import audit, mfa, notifications

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_elevated_db)):
    user = db.execute(
        select(User).where(User.email == payload.email.lower())
    ).scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is disabled")

    # Second factor (TOTP) enforcement.
    if user.mfa_enabled:
        if not payload.mfa_code:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "MFA code required")
        if not mfa.verify_code(user.mfa_secret or "", payload.mfa_code):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid MFA code")

    # Memberships are read with superadmin scope so SYSADMINs see all their HOAs.
    rows = db.execute(
        select(Membership, Tenant, Role)
        .join(Tenant, Tenant.id == Membership.tenant_id)
        .join(Role, Role.id == Membership.role_id)
        .where(Membership.user_id == user.id, Membership.is_active.is_(True))
    ).all()
    memberships = [
        TenantMembershipOut(
            tenant_id=t.id,
            tenant_name=t.name,
            tenant_slug=t.slug,
            role_code=r.code,
            role_name=r.name,
            scope="tenant",
            is_demo=t.is_demo,
        )
        for (_m, t, r) in rows
    ]

    token = create_access_token(
        subject=str(user.id),
        extra_claims={"email": user.email, "is_superadmin": user.is_superadmin},
    )
    user.last_login_at = datetime.now(timezone.utc)
    audit.record(
        db,
        action="LOGIN",
        entity_type="User",
        entity_id=user.id,
        ip_address=getattr(request.state, "client_ip", None),
        user_agent=getattr(request.state, "user_agent", None),
    )
    return LoginResponse(
        access_token=token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user_id=user.id,
        email=user.email,
        full_name=user.full_name,
        is_superadmin=user.is_superadmin,
        must_change_password=user.must_change_password,
        memberships=memberships,
    )


@router.post("/mfa/enroll", response_model=MfaEnrollResponse)
def mfa_enroll(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Generate a TOTP secret. MFA is not active until /mfa/verify succeeds."""
    secret = mfa.generate_secret()
    user.mfa_secret = secret  # stored encrypted at rest (EncryptedString)
    user.mfa_enabled = False
    return MfaEnrollResponse(
        secret=secret, otpauth_uri=mfa.provisioning_uri(secret, user.email)
    )


@router.post("/mfa/verify")
def mfa_verify(
    payload: MfaVerifyRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Confirm enrollment by verifying a code; activates MFA on success."""
    if not user.mfa_secret:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No pending MFA enrollment")
    if not mfa.verify_code(user.mfa_secret, payload.code):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid MFA code")
    user.mfa_enabled = True
    audit.record(
        db, action="MFA_ENABLED", entity_type="User", entity_id=user.id,
        ip_address=getattr(request.state, "client_ip", None),
    )
    return {"mfa_enabled": True}


@router.get("/me", response_model=MeResponse)
def me(principal: Principal = Depends(get_principal)):
    return MeResponse(
        user_id=principal.user.id,
        email=principal.user.email,
        full_name=principal.user.full_name,
        is_superadmin=principal.is_superadmin,
        must_change_password=principal.user.must_change_password,
        active_tenant_id=principal.tenant_id,
        scope="platform" if principal.is_superadmin else "tenant",
        permissions=sorted(principal.permissions) if not principal.is_superadmin else ["*"],
    )


@router.get("/tenants", response_model=list[TenantMembershipOut])
def get_tenants(
    include_demo: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_elevated_db),
):
    if user.is_superadmin:
        query = select(Tenant).where(Tenant.status != "suspended")
        if not include_demo:
            query = query.where(Tenant.is_demo.is_(False))
        tenants = db.execute(query).scalars().all()
        return [
            TenantMembershipOut(
                tenant_id=t.id,
                tenant_name=t.name,
                tenant_slug=t.slug,
                role_code=None,
                role_name=None,
                scope="platform",
                is_demo=t.is_demo,
            )
            for t in tenants
        ]
    else:
        rows = db.execute(
            select(Membership, Tenant, Role)
            .join(Tenant, Tenant.id == Membership.tenant_id)
            .join(Role, Role.id == Membership.role_id)
            .where(Membership.user_id == user.id, Membership.is_active.is_(True))
        ).all()
        return [
            TenantMembershipOut(
                tenant_id=t.id,
                tenant_name=t.name,
                tenant_slug=t.slug,
                role_code=r.code,
                role_name=r.name,
                scope="tenant",
                is_demo=t.is_demo,
            )
            for (_m, t, r) in rows
        ]


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Authenticated password change (also clears the first-login flag)."""
    if not verify_password(payload.current_password, user.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    if verify_password(payload.new_password, user.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "New password must differ from the current one")
    user.hashed_password = hash_password(payload.new_password)
    user.must_change_password = False
    audit.record(db, action="PASSWORD_CHANGE", entity_type="User", entity_id=user.id,
                 ip_address=getattr(request.state, "client_ip", None))
    return {"status": "ok"}


@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_elevated_db)):
    """Email a password-reset link. Always returns 200 (no account enumeration)."""
    user = db.execute(
        select(User).where(User.email == payload.email.lower())
    ).scalar_one_or_none()
    generic = {"status": "If the email exists, a reset link has been sent."}
    if user is None or not user.is_active:
        return generic
    token = create_password_reset_token(user.id, user.hashed_password)
    reset_url = f"{settings.FRONTEND_BASE_URL}/reset-password?token={token}"
    notifications._send_email(
        user.email, "Reset your Casa Harmony password",
        f"Use this link to reset your password (valid 30 minutes): {reset_url}\n"
        "If you did not request this, ignore this email.",
    )
    audit.record(db, action="PASSWORD_RESET_REQUEST", entity_type="User", entity_id=user.id)
    # Development convenience (no mail provider): expose the token for testing.
    if settings.ENVIRONMENT == "development":
        return {**generic, "dev_reset_token": token}
    return generic


@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_elevated_db)):
    """Complete a reset using the emailed token (single-use via password version)."""
    try:
        claims = decode_token(payload.token)
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired reset link")
    if claims.get("scope") != "pwreset":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid reset link")
    user = db.get(User, uuid.UUID(claims["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or expired reset link")
    # Bind to the current password hash → token stops working once used/changed.
    if claims.get("pv") != password_version(user.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link has already been used")
    user.hashed_password = hash_password(payload.new_password)
    user.must_change_password = False
    audit.record(db, action="PASSWORD_RESET", entity_type="User", entity_id=user.id)
    return {"status": "ok"}
