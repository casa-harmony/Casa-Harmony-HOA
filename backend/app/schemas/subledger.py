from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, EmailStr, Field


# --- AR Homeowners ---------------------------------------------------------
class HomeownerCreate(BaseModel):
    model_config = {"extra": "forbid"}

    account_number: str = Field(min_length=1, max_length=40)
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    email: EmailStr | None = None
    property_unit: str | None = None
    bank_account: str | None = None  # encrypted at rest


class HomeownerOut(BaseModel):
    id: uuid.UUID
    account_number: str
    first_name: str
    last_name: str
    email: str | None
    property_unit: str | None
    bank_account_masked: str | None = None
    status: str

    model_config = {"from_attributes": True}


# --- AR Invoices -----------------------------------------------------------
class InvoiceCreate(BaseModel):
    model_config = {"extra": "forbid"}

    homeowner_id: uuid.UUID
    invoice_number: str = Field(min_length=1, max_length=40)
    description: str | None = None
    amount: Decimal = Field(gt=0)
    invoice_date: date
    due_date: date | None = None
    # GL accounts to post against (must be enabled, postable combinations).
    receivable_combination_id: uuid.UUID
    income_combination_id: uuid.UUID
    structure_id: uuid.UUID


class InvoiceOut(BaseModel):
    id: uuid.UUID
    homeowner_id: uuid.UUID
    invoice_number: str
    description: str | None
    amount: Decimal
    amount_paid: Decimal
    invoice_date: date
    due_date: date | None
    status: str
    # Two independent GL posting paths write these: gl_journal_id comes from
    # the direct-create/plan-run path (services/gl_posting.py, services/ar_billing.py);
    # gl_je_header_id comes from the accounting-cycle path — assessment-run
    # then /invoices/{id}/account or /invoices/account-run
    # (services/subledger_accounting.py). An invoice posted through one path
    # legitimately has null in the other; only one is ever set.
    gl_journal_id: uuid.UUID | None
    gl_je_header_id: uuid.UUID | None = None

    model_config = {"from_attributes": True}


# --- GL Journals -----------------------------------------------------------
class JournalLineIn(BaseModel):
    code_combination_id: uuid.UUID
    debit: Decimal = Field(default=Decimal("0"), ge=0)
    credit: Decimal = Field(default=Decimal("0"), ge=0)
    description: str | None = None


class JournalCreate(BaseModel):
    model_config = {"extra": "forbid"}

    structure_id: uuid.UUID
    accounting_date: date
    description: str | None = None
    lines: list[JournalLineIn] = Field(min_length=2)


class JournalLineOut(BaseModel):
    line_number: int
    code_combination_id: uuid.UUID
    debit: Decimal
    credit: Decimal
    description: str | None

    model_config = {"from_attributes": True}


class JournalOut(BaseModel):
    id: uuid.UUID
    journal_number: str
    description: str | None
    source: str
    status: str
    accounting_date: date
    lines: list[JournalLineOut] = []

    model_config = {"from_attributes": True}


# --- AR Receipts -----------------------------------------------------------
class ReceiptCreate(BaseModel):
    model_config = {"extra": "forbid"}

    homeowner_id: uuid.UUID
    receipt_number: str = Field(min_length=1, max_length=40)
    amount: Decimal = Field(gt=0)
    receipt_date: date
    payment_method: str = Field(default="CHECK", pattern=r"^(CHECK|ACH|CARD)$")
    applied_invoice_id: uuid.UUID | None = None
    fund: str = "OPER"


class ReceiptOut(BaseModel):
    id: uuid.UUID
    homeowner_id: uuid.UUID
    receipt_number: str
    amount: Decimal
    receipt_date: date
    payment_method: str
    status: str

    model_config = {"from_attributes": True}


# --- Bulk assessment billing ----------------------------------------------
class AssessmentRunIn(BaseModel):
    invoice_date: date
    due_date: date | None = None
    amount: Decimal = Field(gt=0)
    invoice_type: str = Field(default="ASSESSMENT", pattern=r"^(ASSESSMENT|LATE_FEE|SPECIAL)$")
    number_prefix: str = "ASMT"


class AssessmentRunOut(BaseModel):
    invoices_created: int
    total_billed: Decimal


class PayInvoiceIn(BaseModel):
    amount: Decimal = Field(gt=0)
    payment_method: str = Field(default="CARD", pattern=r"^(CHECK|ACH|CARD)$")
    payment_token_id: uuid.UUID | None = None  # tokenized card (PCI) when method=CARD
    receipt_number: str | None = None
    fund: str = "OPER"


class AgingRowOut(BaseModel):
    account_number: str
    name: str
    buckets: dict[str, float]
    total: float


class AgingOut(BaseModel):
    as_of: date
    totals: dict[str, float]
    grand_total: float
    rows: list[AgingRowOut]
