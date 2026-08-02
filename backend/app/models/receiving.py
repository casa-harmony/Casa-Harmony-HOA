"""Receiving (≈ Oracle RCV_SHIPMENT_HEADERS / RCV_SHIPMENT_LINES / RCV_TRANSACTIONS).

Receipts are recorded against PO lines; each receipt line fans out to one
transaction per PO distribution (so received quantity/amount roll up to
``po_distributions``). An optional inspection/acceptance step gates whether a
receipt counts toward 3-way matching: only **accepted** transactions credit
``quantity_received`` and the PO's received amount.
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
_QTY = Numeric(18, 4)


class RcvShipmentHeader(Base, TenantMixin, TimestampMixin):
    __tablename__ = "rcv_shipment_headers"
    __table_args__ = (
        UniqueConstraint("tenant_id", "receipt_number", name="uq_rcv_receipt_number"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    receipt_number: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    po_header_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("po_headers.id", ondelete="RESTRICT"), index=True
    )
    received_date: Mapped[date] = mapped_column(Date, nullable=False)
    packing_slip: Mapped[str | None] = mapped_column(String(60))
    notes: Mapped[str | None] = mapped_column(Text)
    needs_inspection: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="ACCEPTED", nullable=False)
    # PENDING_INSPECTION|ACCEPTED|REJECTED
    inspected_by: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    inspected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lines: Mapped[list["RcvShipmentLine"]] = relationship(
        back_populates="header", cascade="all, delete-orphan", order_by="RcvShipmentLine.line_num"
    )


class RcvShipmentLine(Base, TenantMixin, TimestampMixin):
    __tablename__ = "rcv_shipment_lines"

    id: Mapped[uuid.UUID] = uuid_pk()
    header_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("rcv_shipment_headers.id", ondelete="CASCADE"), index=True
    )
    line_num: Mapped[int] = mapped_column(Integer, nullable=False)
    po_line_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("po_lines.id", ondelete="RESTRICT"), index=True
    )
    quantity_received: Mapped[Decimal] = mapped_column(_QTY, default=0, nullable=False)
    amount_received: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    accepted: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    header: Mapped["RcvShipmentHeader"] = relationship(back_populates="lines")
    transactions: Mapped[list["RcvTransaction"]] = relationship(
        back_populates="line", cascade="all, delete-orphan"
    )


class RcvTransaction(Base, TenantMixin, TimestampMixin):
    """One transaction per PO distribution under a receipt line."""

    __tablename__ = "rcv_transactions"

    id: Mapped[uuid.UUID] = uuid_pk()
    shipment_line_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("rcv_shipment_lines.id", ondelete="CASCADE"), index=True
    )
    po_distribution_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("po_distributions.id", ondelete="RESTRICT"), index=True
    )
    txn_type: Mapped[str] = mapped_column(String(12), default="RECEIVE", nullable=False)  # RECEIVE|RETURN
    quantity: Mapped[Decimal] = mapped_column(_QTY, default=0, nullable=False)
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    fund_value: Mapped[str] = mapped_column(String(60), nullable=False)
    accepted: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    line: Mapped["RcvShipmentLine"] = relationship(back_populates="transactions")
