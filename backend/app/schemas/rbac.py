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
    code: str = Field(min_length=2, max_length=60, pattern=r"^[A-Z0-9_]+$")
    name: str = Field(min_length=2, max_length=120)
    description: str | None = None
    permission_codes: list[str] = []


class UserCreate(BaseModel):
    email: EmailStr
    full_name: str | None = None
    password: str = Field(min_length=8, max_length=128)
    is_superadmin: bool = False


class UserOut(BaseModel):
    id: uuid.UUID
    # Plain str (not EmailStr): output must serialize already-stored values,
    # including anonymized addresses (e.g. ...@anonymized.invalid from CCPA erasure).
    email: str
    full_name: str | None
    is_superadmin: bool
    is_active: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class MembershipCreate(BaseModel):
    user_id: uuid.UUID
    role_id: uuid.UUID


class MembershipOut(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    tenant_id: uuid.UUID
    role_id: uuid.UUID
    is_active: bool

    model_config = {"from_attributes": True}
