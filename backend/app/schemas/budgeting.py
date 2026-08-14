from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class VersionCreate(BaseModel):
    model_config = {"extra": "forbid"}

    name: str = Field(min_length=1, max_length=120)
    fiscal_year: int
    version_type: str = Field(default="ORIGINAL", pattern=r"^(ORIGINAL|REVISED|RESERVE|SPECIAL|FORECAST)$")


class VersionOut(BaseModel):
    id: uuid.UUID
    name: str
    fiscal_year: int
    version_type: str
    status: str
    is_controlling: bool
    approved_at: datetime | None
    model_config = {"from_attributes": True}


class BudgetLineOut(BaseModel):
    id: uuid.UUID
    code_combination_id: uuid.UUID
    fund_value: str
    cost_center_value: str | None
    period_num: int
    amount: Decimal
    model_config = {"from_attributes": True}


class VersionDetail(VersionOut):
    lines: list[BudgetLineOut] = Field(default_factory=list)


class SpreadIn(BaseModel):
    code_combination_id: uuid.UUID
    annual_amount: Decimal = Field(default=Decimal("0"), ge=0)
    method: str = Field(default="EVEN", pattern=r"^(EVEN|MANUAL)$")
    per_period: list[Decimal] | None = None


class ApproveIn(BaseModel):
    approve: bool = True
    make_controlling: bool = False


class ControlIn(BaseModel):
    mode: str = Field(pattern=r"^(NONE|ADVISORY|ABSOLUTE)$")
    controlling_version_id: uuid.UUID | None = None


class ControlOut(BaseModel):
    id: uuid.UUID | None = None
    mode: str
    controlling_version_id: uuid.UUID | None = None
    model_config = {"from_attributes": True}


class BvARow(BaseModel):
    code_combination_id: uuid.UUID
    account: str
    fund_value: str
    cost_center: str
    budget: Decimal
    actual: Decimal
    variance: Decimal
