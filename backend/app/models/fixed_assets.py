"""Fixed Assets + Reserve Studies (≈ Oracle FA_ASSETS / FA_DEPRECIATION).

Assets carry KFF accounts (cost, accumulated depreciation, depreciation expense),
each embedding the Fund + Cost Center. Straight-line depreciation posts Dr expense /
Cr accumulated per Fund through the GL batch engine. Reserve study components plan
replacement spend by category/Fund/year for reserve-vs-actual tracking.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import (
    Date,
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


class FaAsset(Base, TenantMixin, TimestampMixin):
    __tablename__ = "fa_assets"
    __table_args__ = (
        UniqueConstraint("tenant_id", "asset_number", name="uq_fa_asset_number"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    asset_number: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    category: Mapped[str | None] = mapped_column(String(60))
    fund_value: Mapped[str] = mapped_column(String(60), nullable=False, default="RESV")
    cost_center_value: Mapped[str | None] = mapped_column(String(60))
    # KFF accounts.
    asset_combination_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="RESTRICT"))
    accum_depr_combination_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="SET NULL"))
    depr_expense_combination_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="SET NULL"))
    # Costing + depreciation.
    cost: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)
    salvage_value: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    in_service_date: Mapped[date] = mapped_column(Date, nullable=False)
    life_months: Mapped[int] = mapped_column(Integer, nullable=False)
    method: Mapped[str] = mapped_column(String(20), default="STRAIGHT_LINE", nullable=False)
    accumulated_depreciation: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", nullable=False)
    # ACTIVE|FULLY_DEPRECIATED|DISPOSED
    disposal_date: Mapped[date | None] = mapped_column(Date)
    disposal_proceeds: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)

    @property
    def net_book_value(self) -> Decimal:
        return self.cost - self.accumulated_depreciation


class FaDepreciationEntry(Base, TenantMixin, TimestampMixin):
    __tablename__ = "fa_depreciation"
    __table_args__ = (
        UniqueConstraint("asset_id", "period_name", name="uq_fa_depr_period"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    asset_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("fa_assets.id", ondelete="CASCADE"), index=True)
    period_name: Mapped[str] = mapped_column(String(15), nullable=False)
    period_year: Mapped[int] = mapped_column(Integer, nullable=False)
    period_num: Mapped[int] = mapped_column(Integer, nullable=False)
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)
    je_header_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))


class ReserveStudy(Base, TenantMixin, TimestampMixin):
    __tablename__ = "reserve_studies"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    study_year: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="ACTIVE", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)

    components: Mapped[list["ReserveComponent"]] = relationship(
        back_populates="study", cascade="all, delete-orphan")


class ReserveComponent(Base, TenantMixin, TimestampMixin):
    __tablename__ = "reserve_components"

    id: Mapped[uuid.UUID] = uuid_pk()
    study_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("reserve_studies.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str | None] = mapped_column(String(60))
    fund_value: Mapped[str] = mapped_column(String(60), default="RESV", nullable=False)
    asset_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("fa_assets.id", ondelete="SET NULL"))
    useful_life_years: Mapped[int | None] = mapped_column(Integer)
    remaining_life_years: Mapped[int | None] = mapped_column(Integer)
    replacement_cost: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    planned_year: Mapped[int | None] = mapped_column(Integer)
    planned_amount: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)

    study: Mapped["ReserveStudy"] = relationship(back_populates="components")
