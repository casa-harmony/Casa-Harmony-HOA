from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class TicketCreate(BaseModel):
    model_config = {"extra": "forbid"}

    subject: str = Field(min_length=1, max_length=200)
    description: str | None = None
    category: str = Field(default="MAINTENANCE", pattern=r"^(MAINTENANCE|COMPLAINT|REQUEST|VIOLATION)$")
    priority: str = Field(default="MEDIUM", pattern=r"^(LOW|MEDIUM|HIGH)$")
    homeowner_id: uuid.UUID | None = None
    vendor_id: uuid.UUID | None = None
    estimated_cost: Decimal | None = Field(default=None, ge=0)


class TicketUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    status: str | None = Field(default=None, pattern=r"^(OPEN|IN_PROGRESS|RESOLVED|CLOSED)$")
    priority: str | None = Field(default=None, pattern=r"^(LOW|MEDIUM|HIGH)$")
    assigned_to: uuid.UUID | None = None
    vendor_id: uuid.UUID | None = None
    estimated_cost: Decimal | None = Field(default=None, ge=0)


class TicketOut(BaseModel):
    id: uuid.UUID
    ticket_number: str
    subject: str
    description: str | None
    category: str
    priority: str
    status: str
    homeowner_id: uuid.UUID | None
    vendor_id: uuid.UUID | None
    estimated_cost: Decimal | None
    po_header_id: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TicketToPo(BaseModel):
    """Integration hook: spawn a PO from a ticket's estimated cost."""
    code_combination_id: uuid.UUID  # expense account (Fund mandatory)
    item_description: str | None = None


class TicketCommentIn(BaseModel):
    body: str = Field(min_length=1)

class TicketCommentOut(BaseModel):
    id: uuid.UUID
    author: str
    role: str
    at: datetime
    body: str

    model_config = {"from_attributes": True}

