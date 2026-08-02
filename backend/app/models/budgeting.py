"""Budget depth: versions, KFF lines (period spread), and budgetary control.

A BudgetVersion (ORIGINAL / REVISED / RESERVE / SPECIAL) holds per-period budget
lines keyed by KFF code combination (Fund + Cost Center embedded). One approved
version per tenant can be marked controlling; budgetary control then checks PO
commitments + actuals against it (advisory or absolute).
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk

_AMOUNT = Numeric(18, 2)
VERSION_TYPES = ("ORIGINAL", "REVISED", "RESERVE", "SPECIAL", "FORECAST")


class BudgetVersion(Base, TenantMixin, TimestampMixin):
    __tablename__ = "budget_versions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_budget_version_name"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    fiscal_year: Mapped[int] = mapped_column(Integer, nullable=False)
    version_type: Mapped[str] = mapped_column(String(12), default="ORIGINAL", nullable=False)
    status: Mapped[str] = mapped_column(String(12), default="DRAFT", nullable=False)
    # DRAFT|SUBMITTED|APPROVED|REJECTED
    is_controlling: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lines: Mapped[list["BudgetLine"]] = relationship(
        back_populates="version", cascade="all, delete-orphan"
    )


class BudgetLine(Base, TenantMixin, TimestampMixin):
    __tablename__ = "budget_lines"
    __table_args__ = (
        UniqueConstraint("version_id", "code_combination_id", "period_num",
                         name="uq_budget_line"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    version_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("budget_versions.id", ondelete="CASCADE"), index=True
    )
    code_combination_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="RESTRICT"), index=True
    )
    fund_value: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    cost_center_value: Mapped[str | None] = mapped_column(String(60))
    period_num: Mapped[int] = mapped_column(Integer, nullable=False)  # 1-12
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)

    version: Mapped["BudgetVersion"] = relationship(back_populates="lines")


class BudgetControlSettings(Base, TenantMixin, TimestampMixin):
    """Per-tenant budgetary control configuration (one row per tenant)."""

    __tablename__ = "budget_control_settings"

    id: Mapped[uuid.UUID] = uuid_pk()
    mode: Mapped[str] = mapped_column(String(10), default="NONE", nullable=False)
    # NONE|ADVISORY|ABSOLUTE
    controlling_version_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("budget_versions.id", ondelete="SET NULL")
    )
