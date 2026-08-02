from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class AgingRow(BaseModel):
    homeowner_id: uuid.UUID
    account_number: str
    name: str
    buckets: dict[str, Decimal]
    total: Decimal


class CaseOut(BaseModel):
    id: uuid.UUID
    homeowner_id: uuid.UUID
    stage: str
    opened_date: date
    balance_at_open: Decimal
    last_notice_date: date | None
    notice_count: int
    notes: str | None
    model_config = {"from_attributes": True}


class OpenCaseIn(BaseModel):
    homeowner_id: uuid.UUID
    as_of: date
    notes: str | None = None


class EscalateIn(BaseModel):
    to_stage: str = Field(pattern=r"^(NOTICE|PAYMENT_PLAN|LIEN|RESOLVED)$")


class InstallmentOut(BaseModel):
    id: uuid.UUID
    seq: int
    due_date: date
    amount: Decimal
    amount_paid: Decimal
    status: str
    model_config = {"from_attributes": True}


class PlanCreate(BaseModel):
    homeowner_id: uuid.UUID
    total_amount: Decimal = Field(gt=0)
    installments: int = Field(gt=0, le=60)
    start_date: date
    frequency_days: int = 30
    notes: str | None = None


class PlanOut(BaseModel):
    id: uuid.UUID
    plan_number: str
    homeowner_id: uuid.UUID
    total_amount: Decimal
    installments: int
    frequency_days: int
    start_date: date
    status: str
    model_config = {"from_attributes": True}


class PlanDetail(PlanOut):
    schedule: list[InstallmentOut] = []


class PayInstallmentIn(BaseModel):
    amount: Decimal | None = None


class LienCreate(BaseModel):
    homeowner_id: uuid.UUID
    amount: Decimal = Field(gt=0)
    reference: str | None = None
    notes: str | None = None


class LienOut(BaseModel):
    id: uuid.UUID
    lien_number: str
    homeowner_id: uuid.UUID
    amount: Decimal
    status: str
    filed_date: date | None
    released_date: date | None
    reference: str | None
    model_config = {"from_attributes": True}


class LienStatusIn(BaseModel):
    status: str = Field(pattern=r"^(FILED|RELEASED)$")
    on_date: date


class WriteOffIn(BaseModel):
    invoice_id: uuid.UUID
    expense_combination_id: uuid.UUID
    gl_date: date


class EffectivenessOut(BaseModel):
    billed: Decimal
    collected: Decimal
    rate_pct: Decimal
