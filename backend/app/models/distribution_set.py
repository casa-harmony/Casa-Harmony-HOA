"""Distribution Sets (≈ Oracle AP_DISTRIBUTION_SETS / _LINES).

A reusable, named set of GL account splits expressed as percentages that sum to
100. Define once (e.g. "Monthly Landscaping" split across cost centers), then
apply it to a PO, PO line, AP invoice, or invoice line to auto-generate the
distributions for any amount.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class DistributionSet(Base, TenantMixin, TimestampMixin):
    __tablename__ = "distribution_sets"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_distribution_set_name"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str | None] = mapped_column(String(240))
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    lines: Mapped[list["DistributionSetLine"]] = relationship(
        back_populates="dist_set", cascade="all, delete-orphan",
        order_by="DistributionSetLine.line_num",
    )


class DistributionSetLine(Base, TenantMixin, TimestampMixin):
    __tablename__ = "distribution_set_lines"
    __table_args__ = (
        UniqueConstraint("distribution_set_id", "line_num", name="uq_dist_set_line_num"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    distribution_set_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("distribution_sets.id", ondelete="CASCADE"), index=True
    )
    line_num: Mapped[int] = mapped_column(Integer, nullable=False)
    code_combination_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="RESTRICT")
    )
    percent: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False)  # e.g. 33.3333
    fund_value: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[str | None] = mapped_column(String(160))

    dist_set: Mapped["DistributionSet"] = relationship(back_populates="lines")
