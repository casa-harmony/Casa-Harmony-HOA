from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class TenantBase(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9-]+$")
    legal_name: str | None = None
    num_units: int | None = Field(default=None, ge=0)
    timezone: str = "America/New_York"
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None


class TenantCreate(TenantBase):
    # Optionally bootstrap a default COA structure on creation.
    create_default_coa: bool = True
    is_demo: bool = False


class TenantUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    legal_name: str | None = None
    status: str | None = Field(default=None, pattern=r"^(active|suspended)$")
    num_units: int | None = Field(default=None, ge=0)
    timezone: str | None = None
    address_line1: str | None = None
    address_line2: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    is_demo: bool | None = None


class TenantOut(TenantBase):
    id: uuid.UUID
    status: str
    functional_currency: str
    is_demo: bool
    created_at: datetime

    model_config = {"from_attributes": True}
