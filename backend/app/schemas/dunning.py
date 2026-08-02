from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class DunningRuleIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    days_past_due: int = Field(ge=1)
    action: str = Field(default="REMINDER", pattern=r"^(REMINDER|ESCALATE)$")
    escalate_to_stage: str | None = Field(default=None, pattern=r"^(NOTICE|PAYMENT_PLAN|LIEN)$")
    attach_statement: bool = True
    message: str | None = None
    active: bool = True


class DunningRuleOut(DunningRuleIn):
    id: uuid.UUID
    model_config = {"from_attributes": True}


class DunningLogOut(BaseModel):
    id: uuid.UUID
    homeowner_id: uuid.UUID
    rule_id: uuid.UUID | None
    days_past_due: int
    action: str
    status: str
    balance: int
    detail: str | None
    sent_at: datetime | None
    created_at: datetime
    model_config = {"from_attributes": True}


class DunningRunResult(BaseModel):
    reminders_sent: int
    escalations: int
    skipped: int
