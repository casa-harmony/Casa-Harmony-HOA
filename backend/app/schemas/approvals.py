from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel, Field


class RuleIn(BaseModel):
    level_num: int = Field(ge=1)
    min_amount: Decimal = Field(default=Decimal("0"), ge=0)
    max_amount: Decimal | None = None
    approver_role_id: uuid.UUID


class HierarchyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    document_type: str = Field(pattern=r"^(PO|AP_INVOICE|CONTRACT|GL_BATCH|WORK_ORDER)$")
    rules: list[RuleIn] = Field(min_length=1)


class RuleOut(RuleIn):
    id: uuid.UUID

    model_config = {"from_attributes": True}


class HierarchyOut(BaseModel):
    id: uuid.UUID
    name: str
    document_type: str
    enabled: bool
    rules: list[RuleOut] = []

    model_config = {"from_attributes": True}


class ApprovalRequestOut(BaseModel):
    id: uuid.UUID
    document_type: str
    document_id: uuid.UUID
    amount: Decimal
    status: str
    current_level: int
    required_levels: int

    model_config = {"from_attributes": True}


class ActIn(BaseModel):
    approve: bool
    comments: str | None = None
