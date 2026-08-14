from __future__ import annotations

import uuid

from pydantic import BaseModel, Field


# --- Sites -----------------------------------------------------------------
class SiteCreate(BaseModel):
    model_config = {"extra": "forbid"}

    site_code: str = Field(min_length=1, max_length=40)
    site_name: str | None = None
    pay_site: bool = True
    purchasing_site: bool = True
    address_line1: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    payment_term_id: uuid.UUID | None = None
    active: bool = True


class SiteOut(SiteCreate):
    id: uuid.UUID
    model_config = {"from_attributes": True}


# --- Contacts --------------------------------------------------------------
class ContactCreate(BaseModel):
    model_config = {"extra": "forbid"}

    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    title: str | None = None
    email: str | None = None
    phone: str | None = None
    site_id: uuid.UUID | None = None
    active: bool = True


class ContactOut(ContactCreate):
    id: uuid.UUID
    model_config = {"from_attributes": True}


# --- Supplier bank accounts (we pay into these) ----------------------------
class SupplierBankCreate(BaseModel):
    model_config = {"extra": "forbid"}

    bank_name: str = Field(min_length=1, max_length=200)
    routing_number: str | None = Field(default=None, max_length=9)
    account_number: str = Field(min_length=4, max_length=34)
    account_type: str = Field(default="CHECKING", pattern=r"^(CHECKING|SAVINGS)$")
    is_primary: bool = False


class SupplierBankOut(BaseModel):
    id: uuid.UUID
    bank_name: str
    routing_number: str | None
    account_number_masked: str | None = None
    account_type: str
    is_primary: bool
    active: bool
    model_config = {"from_attributes": True}


class ImportResult(BaseModel):
    created: int
    skipped: int
    errors: list[str] = []
