from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, field_validator


# --- Vendors ---------------------------------------------------------------
class VendorCreate(BaseModel):
    model_config = {"extra": "forbid"}

    # Omit to auto-generate (V-000001, V-000002, …) — the UI's Add Vendor
    # form doesn't collect one, and there is no reason to make staff invent
    # a vendor number by hand.
    vendor_number: str | None = Field(default=None, min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
    category: str | None = Field(default=None, max_length=80)
    tax_id: str | None = None
    payment_terms: str = "NET30"
    payment_term_id: uuid.UUID | None = None
    vendor_type_id: uuid.UUID | None = None
    default_distribution_set_id: uuid.UUID | None = None
    default_expense_combination_id: uuid.UUID | None = None
    email: str | None = None
    phone: str | None = None
    # 1099 / tax reporting
    is_1099: bool = False
    income_tax_type: str | None = Field(default=None, max_length=20)
    state_reportable: bool = False
    tax_reporting_name: str | None = None
    w9_on_file: bool = False


class VendorUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    name: str | None = None
    category: str | None = None
    tax_id: str | None = None
    payment_term_id: uuid.UUID | None = None
    vendor_type_id: uuid.UUID | None = None
    default_distribution_set_id: uuid.UUID | None = None
    default_expense_combination_id: uuid.UUID | None = None
    email: str | None = None
    phone: str | None = None
    status: str | None = None
    is_1099: bool | None = None
    income_tax_type: str | None = None
    state_reportable: bool | None = None
    tax_reporting_name: str | None = None
    w9_on_file: bool | None = None

    @field_validator("status")
    @classmethod
    def _status_upper(cls, v: str | None) -> str | None:
        # Every status field elsewhere in this codebase is upper-case
        # (PoHeader, ApInvoice, …); normalise here so a client can't drift a
        # row into lower-case and break every `status === "ACTIVE"` check.
        return v.upper() if v else v


class VendorOut(BaseModel):
    id: uuid.UUID
    vendor_number: str
    name: str
    category: str | None
    payment_terms: str
    payment_term_id: uuid.UUID | None
    vendor_type_id: uuid.UUID | None
    default_distribution_set_id: uuid.UUID | None
    default_expense_combination_id: uuid.UUID | None
    email: str | None
    phone: str | None
    status: str
    is_1099: bool
    income_tax_type: str | None
    state_reportable: bool
    tax_reporting_name: str | None
    w9_on_file: bool
    # Computed by the vendors endpoint, not stored — see list_vendors/get_vendor.
    ytd_spend: Decimal = Decimal("0")
    open_pos: int = 0

    model_config = {"from_attributes": True}


# --- Banks -----------------------------------------------------------------
class BankCreate(BaseModel):
    model_config = {"extra": "forbid"}

    routing_number: str = Field(min_length=9, max_length=9)
    bank_name: str | None = None  # auto-filled from routing lookup if omitted
    branch_name: str | None = None


class BankOut(BaseModel):
    id: uuid.UUID
    bank_name: str
    routing_number: str
    branch_name: str | None
    city: str | None
    state: str | None
    status: str

    model_config = {"from_attributes": True}


class BankAccountCreate(BaseModel):
    model_config = {"extra": "forbid"}

    bank_id: uuid.UUID
    account_name: str = Field(min_length=1, max_length=120)
    account_number: str = Field(min_length=4, max_length=34)
    account_type: str = Field(default="CHECKING", pattern=r"^(CHECKING|SAVINGS)$")
    cash_combination_id: uuid.UUID | None = None
    use_type: str = Field(default="AP_DISBURSEMENT")


class BankAccountOut(BaseModel):
    id: uuid.UUID
    bank_id: uuid.UUID
    account_name: str
    account_number_masked: str | None = None
    account_type: str
    currency: str
    status: str

    model_config = {"from_attributes": True}


class RoutingLookupOut(BaseModel):
    bank_name: str | None
    routing_number: str
    city: str | None = None
    state: str | None = None
    found: bool
