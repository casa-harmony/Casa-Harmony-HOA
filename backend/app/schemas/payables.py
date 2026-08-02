from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.procurement import DistIn


class ApLineIn(BaseModel):
    description: str | None = None
    amount: Decimal = Field(gt=0)
    po_line_id: uuid.UUID | None = None
    # Provide explicit distributions OR a distribution_set_id to auto-split.
    distributions: list[DistIn] = Field(default_factory=list)
    distribution_set_id: uuid.UUID | None = None


class ApInvoiceCreate(BaseModel):
    vendor_id: uuid.UUID
    invoice_number: str = Field(min_length=1, max_length=50)
    invoice_date: date
    gl_date: date
    po_header_id: uuid.UUID | None = None
    description: str | None = None
    tax_amount: Decimal = Field(default=Decimal("0"), ge=0)
    lines: list[ApLineIn] = Field(min_length=1)


class ApInvoiceOut(BaseModel):
    id: uuid.UUID
    invoice_number: str
    vendor_id: uuid.UUID
    po_header_id: uuid.UUID | None
    invoice_date: date
    gl_date: date
    due_date: date | None
    amount: Decimal
    tax_amount: Decimal
    status: str
    approval_status: str
    match_status: str
    on_hold: bool
    hold_reason: str | None
    gl_je_header_id: uuid.UUID | None

    model_config = {"from_attributes": True}


class HoldIn(BaseModel):
    reason: str = Field(min_length=1, max_length=240)
