"""Accounts Payable payments (≈ AP_PAYMENTS / AP_CHECKS, AP_PAYMENT_SCHEDULES,
AP_INVOICE_PAYMENTS) and configurable payment methods.

A payment disburses one or more approved invoices: it books Dr Accounts Payable /
Cr Cash **per fund** (mirroring the invoice's distributions) through the Subledger
Accounting → GL batch pipeline. Void/stop reverse that accounting.
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
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk

_AMOUNT = Numeric(18, 2)
PAYMENT_METHOD_TYPES = ("CHECK", "ACH", "WIRE", "CARD")


class PaymentMethod(Base, TenantMixin, TimestampMixin):
    __tablename__ = "ap_payment_methods"
    __table_args__ = (
        UniqueConstraint("tenant_id", "code", name="uq_payment_method_code"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    method_type: Mapped[str] = mapped_column(String(10), nullable=False)  # CHECK|ACH|WIRE|CARD
    # The HOA bank account funds are disbursed from.
    bank_account_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_bank_accounts.id", ondelete="SET NULL")
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ApPaymentSchedule(Base, TenantMixin, TimestampMixin):
    """Open payable per invoice (≈ AP_PAYMENT_SCHEDULES_ALL)."""

    __tablename__ = "ap_payment_schedules"

    id: Mapped[uuid.UUID] = uuid_pk()
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_invoices.id", ondelete="CASCADE"), index=True
    )
    due_date: Mapped[date | None] = mapped_column(Date)
    gross_amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(10), default="UNPAID", nullable=False)
    # UNPAID|PARTIAL|PAID|HOLD

    @property
    def amount_remaining(self) -> Decimal:
        return self.gross_amount - self.amount_paid


class ApPayment(Base, TenantMixin, TimestampMixin):
    __tablename__ = "ap_payments"
    __table_args__ = (
        UniqueConstraint("tenant_id", "payment_number", name="uq_payment_number"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    payment_number: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    vendor_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_suppliers.id", ondelete="RESTRICT"), index=True
    )
    payment_method_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_payment_methods.id", ondelete="SET NULL")
    )
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)
    reference: Mapped[str | None] = mapped_column(String(60))  # check #, ACH trace, etc.
    memo: Mapped[str | None] = mapped_column(String(240))
    status: Mapped[str] = mapped_column(String(10), default="CREATED", nullable=False)
    # CREATED|VOID|STOPPED
    gl_je_header_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    void_je_header_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    applications: Mapped[list["ApInvoicePayment"]] = relationship(
        back_populates="payment", cascade="all, delete-orphan"
    )


class ApInvoicePayment(Base, TenantMixin, TimestampMixin):
    """Links a payment to an invoice with the applied amount (≈ AP_INVOICE_PAYMENTS)."""

    __tablename__ = "ap_invoice_payments"

    id: Mapped[uuid.UUID] = uuid_pk()
    payment_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_payments.id", ondelete="CASCADE"), index=True
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ap_invoices.id", ondelete="RESTRICT"), index=True
    )
    amount_applied: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)

    payment: Mapped["ApPayment"] = relationship(back_populates="applications")
