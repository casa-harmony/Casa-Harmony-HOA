from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class NotificationOut(BaseModel):
    id: uuid.UUID
    category: str
    message: str
    entity_type: str | None
    entity_id: uuid.UUID | None
    is_read: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class ToleranceIn(BaseModel):
    amount_tolerance_pct: Decimal = Field(default=Decimal("0"), ge=0, le=100)
    quantity_tolerance_pct: Decimal = Field(default=Decimal("0"), ge=0, le=100)
    require_receipt: bool = False


class ToleranceOut(ToleranceIn):
    id: uuid.UUID | None = None
    model_config = {"from_attributes": True}
