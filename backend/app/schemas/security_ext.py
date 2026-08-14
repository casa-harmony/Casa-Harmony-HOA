"""Schemas for PCI payment tokenization and CCPA privacy requests."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


# --- Payments (PCI) --------------------------------------------------------
class PaymentMethodCreate(BaseModel):
    model_config = {"extra": "forbid"}

    card_number: str = Field(min_length=12, max_length=24)
    exp_month: int = Field(ge=1, le=12)
    exp_year: int = Field(ge=2024, le=2100)
    holder_name: str | None = None
    homeowner_id: uuid.UUID | None = None


class PaymentMethodOut(BaseModel):
    id: uuid.UUID
    vault_token: str
    card_brand: str | None
    last_four: str | None
    exp_month: int | None
    exp_year: int | None
    holder_name: str | None
    status: str

    model_config = {"from_attributes": True}


# --- Privacy (CCPA) --------------------------------------------------------
class DataSubjectRequestCreate(BaseModel):
    model_config = {"extra": "forbid"}

    request_type: str = Field(pattern=r"^(ACCESS|PORTABILITY|ERASURE)$")
    subject_email: EmailStr
    notes: str | None = None


class DataSubjectRequestOut(BaseModel):
    id: uuid.UUID
    request_type: str
    subject_user_id: uuid.UUID | None
    subject_email: str | None
    status: str
    notes: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
