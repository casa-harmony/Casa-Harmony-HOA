from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class PermissionOut(BaseModel):
    code: str
    description: str | None
    category: str | None

    model_config = {"from_attributes": True}


class RoleOut(BaseModel):
    id: uuid.UUID
    tenant_id: uuid.UUID | None
    code: str
    name: str
    description: str | None
    is_system: bool
    permissions: list[str] = []

    model_config = {"from_attributes": True}


class RoleCreate(BaseModel):
    model_config = {"extra": "forbid"}

    code: str = Field(min_length=2, max_length=60, pattern=r"^[A-Z0-9_]+$")
    name: str = Field(min_length=2, max_length=120)
    description: str | None = None
    permission_codes: list[str] = []


class UserCreate(BaseModel):
    model_config = {"extra": "forbid"}

    email: EmailStr
    full_name: str | None = None
    job_title: str | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)
    is_superadmin: bool = False
    # Grant the first community role in the same call (matches the admin UI).
    role_code: str | None = None
    tenant_id: uuid.UUID | None = None
    # Invite instead of a typed password: email a one-time set-password link.
    send_invite: bool = False

class UserUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    full_name: str | None = None
    job_title: str | None = None
    is_active: bool | None = None
    is_superadmin: bool | None = None


class UserOut(BaseModel):
    id: uuid.UUID
    # Plain str (not EmailStr): output must serialize already-stored values,
    # including anonymized addresses (e.g. ...@anonymized.invalid from CCPA erasure).
    email: str
    full_name: str | None = None
    job_title: str | None = None
    is_superadmin: bool
    is_active: bool
    created_at: datetime
    
    # We will expand memberships for GET /users/{id}
    memberships: list["MembershipOut"] = []

    # Derived view fields for the admin screens (populated by _user_out; the
    # server decides them from the user's active memberships).
    role_code: str | None = None
    tenant_ids: list[uuid.UUID] = []

    model_config = {"from_attributes": True}


class MembershipCreate(BaseModel):
    model_config = {"extra": "forbid"}

    user_id: uuid.UUID
    role_id: uuid.UUID

class MembershipUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    role_id: uuid.UUID | None = None
    is_active: bool | None = None


class MembershipOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    role_id: uuid.UUID
    is_active: bool = True
    role_code: str | None = None  # populated by _user_out; None for ORM serialization
    is_active: bool

    model_config = {"from_attributes": True}
