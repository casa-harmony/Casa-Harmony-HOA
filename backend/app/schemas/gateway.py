from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, Field


class GatewayConfigIn(BaseModel):
    provider: str = Field(default="MOCK", pattern=r"^(MOCK|STRIPE)$")
    publishable_key: str | None = None
    secret_key: str | None = None
    webhook_secret: str | None = None
    active: bool = False
    card_enabled: bool = True
    ach_enabled: bool = True
    card_fee_pct: Decimal = Decimal("2.90")
    card_fee_flat: Decimal = Decimal("0.30")
    ach_fee_flat: Decimal = Decimal("1.50")
    pass_fees_to_resident: bool = False


class GatewayConfigOut(BaseModel):
    id: uuid.UUID | None = None
    provider: str
    publishable_key: str | None
    secret_key_set: bool
    webhook_secret_set: bool
    active: bool
    # "LIVE" once switched on, "TEST" otherwise — same signal as `active`,
    # named the way the Gateway screen's "Test mode"/"Live mode" badge reads it.
    mode: str
    card_enabled: bool
    ach_enabled: bool
    card_fee_pct: Decimal
    card_fee_flat: Decimal
    ach_fee_flat: Decimal
    pass_fees_to_resident: bool


class CheckoutIn(BaseModel):
    invoice_id: uuid.UUID
    amount: Decimal = Field(gt=0)
    homeowner_id: uuid.UUID | None = None


class WebhookIn(BaseModel):
    event_type: str
    txn_ref: str
    signature: str | None = None


class TxnOut(BaseModel):
    id: uuid.UUID
    txn_ref: str
    provider: str
    homeowner_id: uuid.UUID | None
    invoice_id: uuid.UUID | None
    amount: Decimal
    status: str
    receipt_id: uuid.UUID | None
    refund_of_id: uuid.UUID | None
    confirmed_at: datetime | None
    created_at: datetime
    model_config = {"from_attributes": True}
