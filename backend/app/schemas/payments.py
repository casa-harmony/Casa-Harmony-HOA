from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class PaymentMethodCreate(BaseModel):
    model_config = {"extra": "forbid"}

    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    method_type: str = Field(pattern=r"^(CHECK|ACH|WIRE|CARD)$")
    bank_account_id: uuid.UUID | None = None
    active: bool = True


class PaymentMethodOut(PaymentMethodCreate):
    id: uuid.UUID
    model_config = {"from_attributes": True}


class PayableOut(BaseModel):
    invoice_id: uuid.UUID
    invoice_number: str
    vendor_id: uuid.UUID
    vendor_name: str
    due_date: date | None
    gross_amount: Decimal
    amount_remaining: Decimal


class PaymentApplyIn(BaseModel):
    invoice_id: uuid.UUID
    amount: Decimal = Field(gt=0)


class PaymentCreate(BaseModel):
    model_config = {"extra": "forbid"}

    vendor_id: uuid.UUID
    payment_method_id: uuid.UUID | None = None
    payment_date: date
    reference: str | None = None
    memo: str | None = None
    applications: list[PaymentApplyIn] = Field(min_length=1)


class PaymentOut(BaseModel):
    id: uuid.UUID
    payment_number: str
    vendor_id: uuid.UUID
    payment_method_id: uuid.UUID | None
    payment_date: date
    amount: Decimal
    reference: str | None
    status: str
    gl_je_header_id: uuid.UUID | None

    model_config = {"from_attributes": True}


class BatchPayIn(BaseModel):
    payment_method_id: uuid.UUID | None = None
    payment_date: date
    due_before: date


class BatchPayOut(BaseModel):
    payments_created: int
    total_paid: Decimal
    payment_ids: list[uuid.UUID]
