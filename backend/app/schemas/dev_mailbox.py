"""Schemas for the in-app inbox."""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class CapturedMessageOut(BaseModel):
    """List row — no body, so the list view never ships tokens it won't show."""

    id: uuid.UUID
    channel: str
    to_address: str
    subject: str | None
    status: str
    tenant_id: uuid.UUID | None
    is_sandbox: bool
    created_at: datetime
    preview: str

    model_config = {"from_attributes": True}


class CapturedMessageDetail(CapturedMessageOut):
    body: str
    detail: str | None
    # Pulled out of the body so the UI can offer one-click copy of the thing the
    # tester actually needs — the invite link or the OTP.
    links: list[str]
    codes: list[str]
