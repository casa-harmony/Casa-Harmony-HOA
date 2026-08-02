from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


class GlLineOut(BaseModel):
    line_num: int
    code_combination_id: uuid.UUID
    entered_dr: Decimal
    entered_cr: Decimal
    fund_value: str
    description: str | None

    model_config = {"from_attributes": True}


class GlHeaderOut(BaseModel):
    id: uuid.UUID
    je_name: str
    je_category: str
    je_source: str
    accounting_date: date
    status: str
    source_doc_type: str | None
    source_doc_id: uuid.UUID | None
    lines: list[GlLineOut] = []

    model_config = {"from_attributes": True}


class GlBatchOut(BaseModel):
    id: uuid.UUID
    batch_name: str
    description: str | None
    source: str
    accounting_date: date
    period_name: str
    status: str
    control_total_dr: Decimal
    control_total_cr: Decimal
    approved_by: uuid.UUID | None
    posted_at: datetime | None

    model_config = {"from_attributes": True}


class GlBatchDetailOut(GlBatchOut):
    headers: list[GlHeaderOut] = []


class GlBalanceOut(BaseModel):
    code_combination_id: uuid.UUID
    period_name: str
    fund_value: str | None
    period_net_dr: Decimal
    period_net_cr: Decimal

    model_config = {"from_attributes": True}


class PostingRunOut(BaseModel):
    posted_batch_ids: list[uuid.UUID]
    count: int


class BudgetCreate(BaseModel):
    code_combination_id: uuid.UUID
    period_name: str
    amount: Decimal
    budget_name: str = "ANNUAL"


class BudgetOut(BaseModel):
    id: uuid.UUID
    code_combination_id: uuid.UUID
    period_name: str
    fund_value: str | None
    amount: Decimal

    model_config = {"from_attributes": True}


class BudgetVsActualRow(BaseModel):
    account: str
    fund: str
    type: str
    budget: Decimal
    actual: Decimal
    variance: Decimal
