"""Payables (≈ AP_INVOICES_ALL / AP_INVOICE_LINES_ALL / AP_INVOICE_DISTRIBUTIONS_ALL).

Supports PO matching: an invoice may reference a PO (header/line) and is checked
against PO amounts (2-way match). Fund segment mandatory on distributions.
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


class ApInvoice(Base, TenantMixin, TimestampMixin):
    __tablename__ = "ap_invoices"
    __table_args__ = (
        UniqueConstraint("tenant_id", "vendor_id", "invoice_number", name="uq_ap_invoice_number"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    invoice_number: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_suppliers.id", ondelete="RESTRICT"), index=True
    )
    po_header_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("po_headers.id", ondelete="SET NULL"), index=True
    )
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    gl_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date)  # derived from the vendor's payment term
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    invoice_type: Mapped[str] = mapped_column(String(20), default="STANDARD", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="DRAFT", nullable=False)
    # DRAFT|SUBMITTED|APPROVED|REJECTED|CANCELLED|POSTED|PAID
    approval_status: Mapped[str] = mapped_column(String(20), default="DRAFT", nullable=False)
    match_status: Mapped[str] = mapped_column(String(20), default="NOT_MATCHED", nullable=False)
    # NOT_MATCHED|MATCHED|MATCH_EXCEPTION
    # Hold management: an invoice on hold cannot be submitted/approved/paid.
    on_hold: Mapped[bool] = mapped_column(default=False, nullable=False)
    hold_reason: Mapped[str | None] = mapped_column(String(240))
    approved_by: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    gl_je_header_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))

    lines: Mapped[list["ApInvoiceLine"]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan", order_by="ApInvoiceLine.line_num"
    )


class ApInvoiceLine(Base, TenantMixin, TimestampMixin):
    __tablename__ = "ap_invoice_lines"
    __table_args__ = (
        UniqueConstraint("invoice_id", "line_num", name="uq_ap_line_num"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_invoices.id", ondelete="CASCADE"), index=True
    )
    line_num: Mapped[int] = mapped_column(Integer, nullable=False)
    po_line_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("po_lines.id", ondelete="SET NULL")
    )
    description: Mapped[str | None] = mapped_column(String(240))
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)

    invoice: Mapped["ApInvoice"] = relationship(back_populates="lines")
    distributions: Mapped[list["ApInvoiceDistribution"]] = relationship(
        back_populates="line", cascade="all, delete-orphan"
    )


class ApInvoiceDistribution(Base, TenantMixin, TimestampMixin):
    __tablename__ = "ap_invoice_distributions"

    id: Mapped[uuid.UUID] = uuid_pk()
    invoice_line_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_invoice_lines.id", ondelete="CASCADE"), index=True
    )
    distribution_num: Mapped[int] = mapped_column(Integer, nullable=False)
    code_combination_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="RESTRICT"), index=True
    )
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)
    fund_value: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    # When matched to a PO, links back to the PO distribution it bills against
    # (KFF strings match exactly) so cancellation can reverse the billed amounts.
    po_distribution_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("po_distributions.id", ondelete="SET NULL"), index=True
    )

    line: Mapped["ApInvoiceLine"] = relationship(back_populates="distributions")
