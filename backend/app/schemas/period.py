from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


class PeriodOut(BaseModel):
    id: uuid.UUID
    period_name: str
    period_year: int
    period_num: int
    start_date: date | None
    end_date: date | None
    status: str
    closed_at: datetime | None
    model_config = {"from_attributes": True}


class RollForwardOut(BaseModel):
    batch_id: uuid.UUID
    batch_name: str
    control_total_dr: Decimal
    control_total_cr: Decimal
