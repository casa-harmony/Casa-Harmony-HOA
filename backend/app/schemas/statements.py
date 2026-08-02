from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


class StatementRunIn(BaseModel):
    as_of: date
    send_email: bool = True
    homeowner_ids: list[uuid.UUID] | None = None


class StatementRunOut(BaseModel):
    id: uuid.UUID
    run_number: str
    as_of_date: date
    status: str
    generated: int
    sent: int
    skipped: int
    failed: int
    created_at: datetime
    model_config = {"from_attributes": True}


class DeliveryOut(BaseModel):
    id: uuid.UUID
    homeowner_id: uuid.UUID
    email: str | None
    balance: Decimal
    status: str
    attached: bool
    error: str | None
    sent_at: datetime | None
    model_config = {"from_attributes": True}


class OptOutIn(BaseModel):
    homeowner_id: uuid.UUID
    opt_out: bool
