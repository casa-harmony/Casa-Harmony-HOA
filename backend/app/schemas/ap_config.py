from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field


# --- Payment terms ---------------------------------------------------------
class PaymentTermCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    description: str | None = None
    due_days: int = Field(default=30, ge=0, le=365)
    discount_percent: Decimal = Field(default=Decimal("0"), ge=0, le=100)
    discount_days: int = Field(default=0, ge=0, le=365)
    active: bool = True


class PaymentTermOut(PaymentTermCreate):
    id: uuid.UUID
    model_config = {"from_attributes": True}


# --- Vendor types ----------------------------------------------------------
class VendorTypeCreate(BaseModel):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    active: bool = True


class VendorTypeOut(VendorTypeCreate):
    id: uuid.UUID
    model_config = {"from_attributes": True}


# --- Distribution sets -----------------------------------------------------
class DistSetLineIn(BaseModel):
    code_combination_id: uuid.UUID
    percent: Decimal = Field(gt=0, le=100)
    description: str | None = None


class DistributionSetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = None
    active: bool = True
    lines: list[DistSetLineIn] = Field(min_length=1)


class DistSetLineOut(BaseModel):
    line_num: int
    code_combination_id: uuid.UUID
    percent: Decimal
    fund_value: str
    description: str | None
    model_config = {"from_attributes": True}


class DistributionSetOut(BaseModel):
    id: uuid.UUID
    name: str
    description: str | None
    active: bool
    lines: list[DistSetLineOut] = []
    model_config = {"from_attributes": True}
