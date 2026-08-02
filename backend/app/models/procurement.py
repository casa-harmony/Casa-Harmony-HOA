"""Purchasing / Contracts (≈ Oracle PO_HEADERS_ALL / PO_LINES_ALL / PO_DISTRIBUTIONS_ALL).

Distributions carry the KFF account (``code_combination_id``). The **Fund** segment
is mandatory on every distribution (enforced in services) for HOA fund accounting.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
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


class PoHeader(Base, TenantMixin, TimestampMixin):
    __tablename__ = "po_headers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "po_number", name="uq_po_number"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    po_number: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_suppliers.id", ondelete="RESTRICT"), index=True
    )
    description: Mapped[str | None] = mapped_column(Text)
    document_type: Mapped[str] = mapped_column(String(20), default="STANDARD", nullable=False)  # STANDARD|CONTRACT
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Contract timeframe (esp. CONTRACT type — e.g. landscape contract over 6 months).
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)  # derived from lines
    # Total committed dollar limit (the billing cap; defaults to the line total).
    amount_limit: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    # Cumulative amount billed against this PO/contract (maintained by AP matching).
    billed_amount: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    # Lifecycle + approval (Oracle authorization_status / closed_code).
    status: Mapped[str] = mapped_column(String(20), default="INCOMPLETE", nullable=False)
    # INCOMPLETE|SUBMITTED|APPROVED|REJECTED|CANCELLED|PARTIALLY_BILLED|FULLY_BILLED|CLOSED
    approval_status: Mapped[str] = mapped_column(String(20), default="DRAFT", nullable=False)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lines: Mapped[list["PoLine"]] = relationship(
        back_populates="header", cascade="all, delete-orphan", order_by="PoLine.line_num"
    )


class PoLine(Base, TenantMixin, TimestampMixin):
    __tablename__ = "po_lines"
    __table_args__ = (
        UniqueConstraint("po_header_id", "line_num", name="uq_po_line_num"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    po_header_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("po_headers.id", ondelete="CASCADE"), index=True
    )
    line_num: Mapped[int] = mapped_column(Integer, nullable=False)
    item_description: Mapped[str] = mapped_column(String(240), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=1, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    line_amount: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)

    header: Mapped["PoHeader"] = relationship(back_populates="lines")
    distributions: Mapped[list["PoDistribution"]] = relationship(
        back_populates="line", cascade="all, delete-orphan"
    )


class PoDistribution(Base, TenantMixin, TimestampMixin):
    __tablename__ = "po_distributions"

    id: Mapped[uuid.UUID] = uuid_pk()
    po_line_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("po_lines.id", ondelete="CASCADE"), index=True
    )
    distribution_num: Mapped[int] = mapped_column(Integer, nullable=False)
    code_combination_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="RESTRICT"), index=True
    )
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)
    # Denormalized mandatory fund segment for fund accounting / reporting.
    fund_value: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    # Quantity + billing tracking (Oracle PO_DISTRIBUTIONS quantity_ordered/billed).
    quantity_ordered: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=0, nullable=False)
    quantity_received: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=0, nullable=False)
    quantity_billed: Mapped[Decimal] = mapped_column(Numeric(18, 4), default=0, nullable=False)
    amount_billed: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)

    line: Mapped["PoLine"] = relationship(back_populates="distributions")
