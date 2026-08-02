from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class DistIn(BaseModel):
    code_combination_id: uuid.UUID
    amount: Decimal = Field(gt=0)


class PoLineIn(BaseModel):
    item_description: str = Field(min_length=1, max_length=240)
    quantity: Decimal = Field(default=Decimal("1"), gt=0)
    unit_price: Decimal = Field(ge=0)
    # Provide explicit distributions OR a distribution_set_id to auto-split.
    distributions: list[DistIn] = Field(default_factory=list)
    distribution_set_id: uuid.UUID | None = None


class PoCreate(BaseModel):
    vendor_id: uuid.UUID
    order_date: date
    description: str | None = None
    document_type: str = Field(default="STANDARD", pattern=r"^(STANDARD|CONTRACT)$")
    start_date: date | None = None
    end_date: date | None = None
    amount_limit: Decimal | None = Field(default=None, ge=0)
    lines: list[PoLineIn] = Field(min_length=1)


class PoOut(BaseModel):
    id: uuid.UUID
    po_number: str
    vendor_id: uuid.UUID
    description: str | None
    document_type: str
    order_date: date
    start_date: date | None
    end_date: date | None
    amount: Decimal
    amount_limit: Decimal
    billed_amount: Decimal
    status: str
    approval_status: str

    model_config = {"from_attributes": True}


class PoDistOut(BaseModel):
    id: uuid.UUID
    distribution_num: int
    code_combination_id: uuid.UUID
    amount: Decimal
    fund_value: str
    quantity_ordered: Decimal
    quantity_received: Decimal
    quantity_billed: Decimal
    amount_billed: Decimal

    model_config = {"from_attributes": True}


class PoLineOut(BaseModel):
    id: uuid.UUID
    line_num: int
    item_description: str
    quantity: Decimal
    unit_price: Decimal
    line_amount: Decimal
    distributions: list[PoDistOut] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class PoDetailOut(PoOut):
    lines: list[PoLineOut] = Field(default_factory=list)
