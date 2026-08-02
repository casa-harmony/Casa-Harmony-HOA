"""Accounting periods + close status (≈ Oracle GL_PERIOD_STATUSES).

A single ledger per tenant; periods are monthly (period_name like ``FEB-2026``).
Status: FUTURE (future-enterable), OPEN (transactable + postable), CLOSED
(locked — no posting/back-posting). Absence of a row means the period has never
been opened and is treated as OPEN for backward compatibility (only an explicit
CLOSED row locks a period).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Date, DateTime, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk

PERIOD_STATUSES = ("FUTURE", "OPEN", "CLOSED")


class AccountingPeriod(Base, TenantMixin, TimestampMixin):
    __tablename__ = "accounting_periods"
    __table_args__ = (
        UniqueConstraint("tenant_id", "period_name", name="uq_accounting_period"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    period_name: Mapped[str] = mapped_column(String(15), nullable=False, index=True)
    period_year: Mapped[int] = mapped_column(Integer, nullable=False)
    period_num: Mapped[int] = mapped_column(Integer, nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(10), default="OPEN", nullable=False)
    closed_by: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
