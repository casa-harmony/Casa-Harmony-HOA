"""Per-tenant scheduled-run configuration + an execution log for automated jobs
(monthly AR statements, board packets). Drives the scheduler dashboard.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class SchedulerConfig(Base, TenantMixin, TimestampMixin):
    """One row per tenant — which monthly jobs are enabled and on which day."""

    __tablename__ = "scheduler_config"

    id: Mapped[uuid.UUID] = uuid_pk()
    monthly_statements_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    board_packet_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    day_of_month: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    # P29: attach full PDFs to the emails (vs link-only).
    attach_statement_pdf: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    attach_board_pdf: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # P30: daily dunning sweep.
    dunning_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class ScheduledJobRun(Base, TenantMixin, TimestampMixin):
    """Log of automated/manual job executions for the monitor dashboard."""

    __tablename__ = "scheduled_job_runs"

    id: Mapped[uuid.UUID] = uuid_pk()
    job_name: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    trigger: Mapped[str] = mapped_column(String(10), default="MANUAL", nullable=False)  # MANUAL|CRON
    status: Mapped[str] = mapped_column(String(10), default="SUCCESS", nullable=False)  # SUCCESS|FAILED
    summary: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
