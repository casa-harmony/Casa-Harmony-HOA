"""Dunning automation: a ladder of rules (by days past due) that send reminder
emails (with statement PDF) or escalate a delinquency case, plus a per-action log
for history + effectiveness reporting.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class DunningRule(Base, TenantMixin, TimestampMixin):
    __tablename__ = "dunning_rules"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    days_past_due: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(12), default="REMINDER", nullable=False)  # REMINDER|ESCALATE
    escalate_to_stage: Mapped[str | None] = mapped_column(String(20))  # for ESCALATE: PAYMENT_PLAN|LIEN
    attach_statement: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    message: Mapped[str | None] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class DunningLog(Base, TenantMixin, TimestampMixin):
    __tablename__ = "dunning_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    homeowner_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ar_homeowners.id", ondelete="CASCADE"), index=True)
    rule_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("dunning_rules.id", ondelete="SET NULL"))
    days_past_due: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    action: Mapped[str] = mapped_column(String(12), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="SENT", nullable=False)
    # SENT|ESCALATED|SKIPPED_OPTOUT|NO_EMAIL|FAILED
    balance: Mapped[int] = mapped_column(Integer, default=0, nullable=False)  # dollars (rounded) at send
    detail: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
