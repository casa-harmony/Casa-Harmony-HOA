from __future__ import annotations

import uuid
from decimal import Decimal

from pydantic import BaseModel


class EncumbranceSettingsIn(BaseModel):
    enabled: bool = False
    encumbrance_combination_id: uuid.UUID | None = None
    reserve_combination_id: uuid.UUID | None = None


class EncumbranceSettingsOut(EncumbranceSettingsIn):
    id: uuid.UUID | None = None
    model_config = {"from_attributes": True}


class EncumbranceOut(BaseModel):
    id: uuid.UUID
    po_header_id: uuid.UUID
    po_number: str
    vendor_id: uuid.UUID
    encumbered_amount: Decimal
    liquidated_amount: Decimal
    open_commitment: Decimal
    status: str


class CommitmentRow(BaseModel):
    cost_center: str
    fund_value: str
    committed: Decimal
    billed: Decimal
    available: Decimal
