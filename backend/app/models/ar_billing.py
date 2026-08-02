"""AR depth: billing plans (monthly HOA fees / special assessments), late-fee rules.

A BillingPlan has one or more lines, each crediting a revenue account (KFF, Fund +
Cost Center embedded) — so a single monthly charge spreads across operating and
reserve funds per "department". A billing run generates AR invoices (one per
homeowner) and posts a balanced GL journal (Dr AR per fund / Cr each line's income).
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk

_AMOUNT = Numeric(18, 2)


class BillingPlan(Base, TenantMixin, TimestampMixin):
    __tablename__ = "billing_plans"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_billing_plan_name"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    plan_type: Mapped[str] = mapped_column(String(20), default="MONTHLY_FEE", nullable=False)
    # MONTHLY_FEE|SPECIAL_ASSESSMENT
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    lines: Mapped[list["BillingPlanLine"]] = relationship(
        back_populates="plan", cascade="all, delete-orphan")


class BillingPlanLine(Base, TenantMixin, TimestampMixin):
    __tablename__ = "billing_plan_lines"

    id: Mapped[uuid.UUID] = uuid_pk()
    plan_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("billing_plans.id", ondelete="CASCADE"), index=True)
    department: Mapped[str | None] = mapped_column(String(80))
    income_combination_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="RESTRICT"))
    fund_value: Mapped[str] = mapped_column(String(60), nullable=False)
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)

    plan: Mapped["BillingPlan"] = relationship(back_populates="lines")


class LateFeeRule(Base, TenantMixin, TimestampMixin):
    """Per-tenant late-fee policy (one row per tenant)."""

    __tablename__ = "late_fee_rules"

    id: Mapped[uuid.UUID] = uuid_pk()
    active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    grace_days: Mapped[int] = mapped_column(Integer, default=10, nullable=False)
    fee_type: Mapped[str] = mapped_column(String(10), default="FLAT", nullable=False)  # FLAT|PERCENT
    flat_amount: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    percent: Mapped[Decimal] = mapped_column(Numeric(6, 3), default=0, nullable=False)
    fund_value: Mapped[str] = mapped_column(String(60), default="OPER", nullable=False)
    income_combination_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="SET NULL"))
