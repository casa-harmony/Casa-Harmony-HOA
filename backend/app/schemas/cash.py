from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class BankAccountCreate(BaseModel):
    model_config = {"extra": "forbid"}

    account_code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=120)
    fund_value: str = Field(default="OPER", max_length=60)
    bank_name: str | None = None
    account_number: str | None = None
    routing_number: str | None = Field(default=None, max_length=9)
    gl_cash_combination_id: uuid.UUID | None = None


class BankAccountOut(BaseModel):
    id: uuid.UUID
    account_code: str
    name: str
    fund_value: str
    bank_name: str | None
    routing_number: str | None
    gl_cash_combination_id: uuid.UUID | None
    currency: str
    active: bool
    # Aliases the Payments screen's bank-position card reads directly.
    bank: str | None = None
    fund: str | None = None
    masked: str | None = None
    model_config = {"from_attributes": True}


class StatementLineIn(BaseModel):
    line_date: date | None = None
    description: str | None = None
    reference: str | None = None
    amount: Decimal


class StatementCreate(BaseModel):
    model_config = {"extra": "forbid"}

    ce_bank_account_id: uuid.UUID
    statement_date: date
    opening_balance: Decimal = Decimal("0")
    closing_balance: Decimal = Decimal("0")
    lines: list[StatementLineIn] = Field(default_factory=list)


class StatementLineOut(BaseModel):
    id: uuid.UUID
    line_num: int
    line_date: date | None
    description: str | None
    reference: str | None
    amount: Decimal
    reconciled: bool
    match_type: str | None
    matched_payment_id: uuid.UUID | None
    matched_receipt_id: uuid.UUID | None
    model_config = {"from_attributes": True}


class StatementOut(BaseModel):
    id: uuid.UUID
    ce_bank_account_id: uuid.UUID
    statement_date: date
    opening_balance: Decimal
    closing_balance: Decimal
    status: str
    reconciled_at: datetime | None
    model_config = {"from_attributes": True}


class StatementDetail(StatementOut):
    lines: list[StatementLineOut] = Field(default_factory=list)


class MatchIn(BaseModel):
    payment_id: uuid.UUID | None = None
    receipt_id: uuid.UUID | None = None


class AdjustIn(BaseModel):
    offset_combination_id: uuid.UUID
    gl_date: date
    description: str | None = None


class CashPositionOut(BaseModel):
    bank_account_id: uuid.UUID
    account_code: str
    name: str
    fund_value: str
    closing_balance: Decimal
    deposits: Decimal
    withdrawals: Decimal
    open_items: int
    statement_date: date | None
