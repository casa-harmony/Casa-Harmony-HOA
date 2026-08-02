from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class DocumentOut(BaseModel):
    id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    filename: str
    content_type: str
    size_bytes: int
    notes: str | None
    homeowner_id: uuid.UUID | None
    created_at: datetime
    model_config = {"from_attributes": True}
