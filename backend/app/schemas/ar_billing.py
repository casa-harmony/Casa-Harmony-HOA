from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class PlanLineIn(BaseModel):
    income_combination_id: uuid.UUID
    amount: Decimal = Field(gt=0)
    department: str | None = None


class PlanLineOut(BaseModel):
    id: uuid.UUID
    department: str | None
    income_combination_id: uuid.UUID
    fund_value: str
    amount: Decimal
    model_config = {"from_attributes": True}


class PlanCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    plan_type: str = Field(default="MONTHLY_FEE", pattern=r"^(MONTHLY_FEE|SPECIAL_ASSESSMENT)$")
    lines: list[PlanLineIn] = Field(default_factory=list)


class PlanOut(BaseModel):
    id: uuid.UUID
    name: str
    plan_type: str
    active: bool
    model_config = {"from_attributes": True}


class PlanDetail(PlanOut):
    lines: list[PlanLineOut] = Field(default_factory=list)


class RunBillingIn(BaseModel):
    invoice_date: date
    due_days: int = 30
    installments: int = Field(default=1, ge=1, le=60)
    homeowner_ids: list[uuid.UUID] | None = None


class LateFeeRuleIn(BaseModel):
    active: bool = False
    grace_days: int = Field(default=10, ge=0)
    fee_type: str = Field(default="FLAT", pattern=r"^(FLAT|PERCENT)$")
    flat_amount: Decimal = Field(default=Decimal("0"), ge=0)
    percent: Decimal = Field(default=Decimal("0"), ge=0)
    fund_value: str = "OPER"
    income_combination_id: uuid.UUID | None = None


class LateFeeRuleOut(LateFeeRuleIn):
    id: uuid.UUID | None = None
    model_config = {"from_attributes": True}


class RunResult(BaseModel):
    invoices_created: int = 0
    total_billed: Decimal = Decimal("0")
    late_fees_charged: int = 0
    total: Decimal = Decimal("0")
