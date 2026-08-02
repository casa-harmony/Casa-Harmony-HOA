"""Collections & delinquency: delinquency cases (escalation: notice -> payment plan
-> lien), payment plans with installments, and liens. Aging is computed from open
AR invoice balances; these tables track the workflow + arrangements on top of AR.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk

_AMOUNT = Numeric(18, 2)

# Escalation ladder.
STAGES = ("NONE", "NOTICE", "PAYMENT_PLAN", "LIEN", "RESOLVED")


class DelinquencyCase(Base, TenantMixin, TimestampMixin):
    __tablename__ = "delinquency_cases"
    __table_args__ = (
        UniqueConstraint("tenant_id", "homeowner_id", name="uq_delinquency_homeowner"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    homeowner_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ar_homeowners.id", ondelete="CASCADE"), index=True)
    stage: Mapped[str] = mapped_column(String(20), default="NOTICE", nullable=False)
    opened_date: Mapped[date] = mapped_column(Date, nullable=False)
    balance_at_open: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    last_notice_date: Mapped[date | None] = mapped_column(Date)
    notice_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class PaymentPlan(Base, TenantMixin, TimestampMixin):
    __tablename__ = "payment_plans"
    __table_args__ = (
        UniqueConstraint("tenant_id", "plan_number", name="uq_payment_plan_number"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    plan_number: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    homeowner_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ar_homeowners.id", ondelete="CASCADE"), index=True)
    total_amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)
    installments: Mapped[int] = mapped_column(Integer, nullable=False)
    frequency_days: Mapped[int] = mapped_column(Integer, default=30, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(15), default="ACTIVE", nullable=False)
    # ACTIVE|COMPLETED|DEFAULTED|CANCELLED
    notes: Mapped[str | None] = mapped_column(Text)

    schedule: Mapped[list["PaymentPlanInstallment"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", order_by="PaymentPlanInstallment.seq")


class PaymentPlanInstallment(Base, TenantMixin, TimestampMixin):
    __tablename__ = "payment_plan_installments"

    id: Mapped[uuid.UUID] = uuid_pk()
    plan_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("payment_plans.id", ondelete="CASCADE"), index=True)
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(10), default="PENDING", nullable=False)  # PENDING|PAID

    plan: Mapped["PaymentPlan"] = relationship(back_populates="schedule")


class Lien(Base, TenantMixin, TimestampMixin):
    __tablename__ = "liens"
    __table_args__ = (UniqueConstraint("tenant_id", "lien_number", name="uq_lien_number"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    lien_number: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    homeowner_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ar_homeowners.id", ondelete="CASCADE"), index=True)
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)
    status: Mapped[str] = mapped_column(String(15), default="DRAFT", nullable=False)  # DRAFT|FILED|RELEASED
    filed_date: Mapped[date | None] = mapped_column(Date)
    released_date: Mapped[date | None] = mapped_column(Date)
    reference: Mapped[str | None] = mapped_column(String(80))
    notes: Mapped[str | None] = mapped_column(Text)
