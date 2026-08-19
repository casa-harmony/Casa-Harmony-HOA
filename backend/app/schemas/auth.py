from __future__ import annotations

import uuid

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)
    mfa_code: str | None = None  # required when the account has MFA enabled


class MfaEnrollResponse(BaseModel):
    secret: str
    otpauth_uri: str


class MfaVerifyRequest(BaseModel):
    code: str = Field(min_length=6, max_length=10)


class TenantMembershipOut(BaseModel):
    tenant_id: uuid.UUID
    tenant_name: str
    tenant_slug: str
    role_code: str | None
    role_name: str | None
    scope: str
    is_demo: bool
    is_sandbox: bool = False


class LoginResponse(BaseModel):
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int
    user_id: uuid.UUID
    email: str
    full_name: str | None
    is_superadmin: bool
    # True when this login lives in the developer sandbox. The UI uses it to
    # make the environment unmistakable; the actual isolation is enforced by RLS.
    is_sandbox: bool = False
    must_change_password: bool = False
    memberships: list[TenantMembershipOut]


class MeResponse(BaseModel):
    user_id: uuid.UUID
    email: str
    full_name: str | None
    is_superadmin: bool
    is_sandbox: bool = False
    must_change_password: bool = False
    active_tenant_id: uuid.UUID | None
    scope: str
    permissions: list[str]


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8, max_length=128)


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)
