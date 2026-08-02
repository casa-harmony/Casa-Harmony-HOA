from __future__ import annotations

from pydantic import BaseModel, Field


class ItemUpdate(BaseModel):
    status: str = Field(pattern=r"^(PENDING|DONE|NA)$")
    notes: str | None = None
