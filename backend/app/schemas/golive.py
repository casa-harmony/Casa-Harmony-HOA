from __future__ import annotations

from pydantic import BaseModel, Field


class ItemUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    status: str = Field(pattern=r"^(PENDING|DONE|NA)$")
    notes: str | None = None
