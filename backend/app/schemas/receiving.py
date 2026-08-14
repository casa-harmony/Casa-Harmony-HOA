from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class ReceiptLineIn(BaseModel):
    po_line_id: uuid.UUID
    quantity: Decimal = Field(gt=0)
    amount: Decimal | None = Field(default=None, ge=0)


class ReceiptCreate(BaseModel):
    model_config = {"extra": "forbid"}

    po_header_id: uuid.UUID
    received_date: date
    needs_inspection: bool = False
    packing_slip: str | None = None
    notes: str | None = None
    lines: list[ReceiptLineIn] = Field(min_length=1)


class RcvTxnOut(BaseModel):
    id: uuid.UUID
    po_distribution_id: uuid.UUID
    txn_type: str
    quantity: Decimal
    amount: Decimal
    fund_value: str
    accepted: bool
    model_config = {"from_attributes": True}


class RcvLineOut(BaseModel):
    id: uuid.UUID
    line_num: int
    po_line_id: uuid.UUID
    quantity_received: Decimal
    amount_received: Decimal
    accepted: bool
    transactions: list[RcvTxnOut] = Field(default_factory=list)
    model_config = {"from_attributes": True}


class ReceiptOut(BaseModel):
    id: uuid.UUID
    receipt_number: str
    po_header_id: uuid.UUID
    received_date: date
    packing_slip: str | None
    notes: str | None
    needs_inspection: bool
    status: str
    inspected_at: datetime | None
    model_config = {"from_attributes": True}


class ReceiptDetail(ReceiptOut):
    lines: list[RcvLineOut] = Field(default_factory=list)
