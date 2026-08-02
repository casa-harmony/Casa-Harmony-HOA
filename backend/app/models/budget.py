"""GL budgets for Budget vs Actual reporting (≈ GL_BUDGETS / GL_BUDGET_AMOUNTS).

A budget amount is set per code combination per period, so Budget vs Actual is a
straight join against GL_BALANCES with full KFF (incl. Fund) segmentation.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class GlBudget(Base, TenantMixin, TimestampMixin):
    __tablename__ = "gl_budgets"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code_combination_id", "period_name", name="uq_budget"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    budget_name: Mapped[str] = mapped_column(String(60), default="ANNUAL", nullable=False)
    code_combination_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="RESTRICT"), index=True
    )
    period_name: Mapped[str] = mapped_column(String(15), nullable=False)
    fund_value: Mapped[str | None] = mapped_column(String(60), index=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=0, nullable=False)
