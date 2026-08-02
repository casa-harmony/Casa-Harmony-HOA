"""AR statement batch runs + per-homeowner delivery tracking.

A StatementRun generates statements for all (or filtered) homeowners as of a date;
each StatementDelivery records the outcome (sent / skipped / failed) for audit and
delivery reporting. Homeowner opt-out is honored.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk

_AMOUNT = Numeric(18, 2)


class StatementRun(Base, TenantMixin, TimestampMixin):
    __tablename__ = "statement_runs"

    id: Mapped[uuid.UUID] = uuid_pk()
    run_number: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    as_of_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="COMPLETED", nullable=False)
    generated: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    sent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skipped: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    failed: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    deliveries: Mapped[list["StatementDelivery"]] = relationship(
        back_populates="run", cascade="all, delete-orphan")


class StatementDelivery(Base, TenantMixin, TimestampMixin):
    __tablename__ = "statement_deliveries"

    id: Mapped[uuid.UUID] = uuid_pk()
    run_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("statement_runs.id", ondelete="CASCADE"), index=True)
    homeowner_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ar_homeowners.id", ondelete="CASCADE"), index=True)
    email: Mapped[str | None] = mapped_column(String(255))
    balance: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="GENERATED", nullable=False)
    # GENERATED|SENT|SKIPPED_OPTOUT|NO_EMAIL|FAILED
    attached: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    run: Mapped["StatementRun"] = relationship(back_populates="deliveries")
