from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class SchedulerConfigIn(BaseModel):
    monthly_statements_enabled: bool = False
    board_packet_enabled: bool = False
    day_of_month: int = Field(default=1, ge=1, le=28)
    attach_statement_pdf: bool = True
    attach_board_pdf: bool = True
    dunning_enabled: bool = False


class SchedulerConfigOut(SchedulerConfigIn):
    id: uuid.UUID | None = None
    model_config = {"from_attributes": True}


class JobRunOut(BaseModel):
    id: uuid.UUID
    job_name: str
    trigger: str
    status: str
    summary: str | None
    started_at: datetime | None
    finished_at: datetime | None
    model_config = {"from_attributes": True}
