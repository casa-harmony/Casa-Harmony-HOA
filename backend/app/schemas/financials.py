from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


# --- Vendors ---------------------------------------------------------------
class VendorCreate(BaseModel):
    model_config = {"extra": "forbid"}

    vendor_number: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=200)
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


class VendorUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    name: str | None = None
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


class VendorOut(BaseModel):
    id: uuid.UUID
    vendor_number: str
    name: str
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
