"""Subledger foundation: General Ledger journals + Accounts Receivable.

Demonstrates the modular subledger pattern the platform will extend (AP, Cash,
Fixed Assets, etc.). Each subledger transaction posts a *balanced* GL journal
that references validated ``gl_code_combinations`` — the same double-entry model
Oracle EBS uses (GL_JE_HEADERS / GL_JE_LINES → GL_CODE_COMBINATIONS).

AR here models HOA assessment billing: an invoice debits Assessments Receivable
and credits Assessment Income, posted to the GL.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.crypto_types import EncryptedString
from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk

# Single functional currency (USD): amounts are plain numerics, no currency code.
_AMOUNT = Numeric(18, 2)


class GlJournal(Base, TenantMixin, TimestampMixin):
    __tablename__ = "gl_journals"

    id: Mapped[uuid.UUID] = uuid_pk()
    structure_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("kff_structures.id", ondelete="RESTRICT"), index=True
    )
    journal_number: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(20), default="Manual", nullable=False)  # Manual|AR|AP
    status: Mapped[str] = mapped_column(String(10), default="DRAFT", nullable=False)   # DRAFT|POSTED
    accounting_date: Mapped[date] = mapped_column(Date, nullable=False)
    posted_at: Mapped[date | None] = mapped_column(Date)

    lines: Mapped[list["GlJournalLine"]] = relationship(
        back_populates="journal", cascade="all, delete-orphan",
        order_by="GlJournalLine.line_number",
    )


class GlJournalLine(Base, TenantMixin, TimestampMixin):
    __tablename__ = "gl_journal_lines"

    id: Mapped[uuid.UUID] = uuid_pk()
    journal_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_journals.id", ondelete="CASCADE"), index=True
    )
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    code_combination_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="RESTRICT")
    )
    debit: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    credit: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    description: Mapped[str | None] = mapped_column(String(240))

    journal: Mapped["GlJournal"] = relationship(back_populates="lines")


class ArHomeowner(Base, TenantMixin, TimestampMixin):
    """A homeowner / unit account in the AR subledger."""

    __tablename__ = "ar_homeowners"

    id: Mapped[uuid.UUID] = uuid_pk()
    account_number: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    first_name: Mapped[str] = mapped_column(String(80), nullable=False)
    last_name: Mapped[str] = mapped_column(String(80), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255))
    property_unit: Mapped[str | None] = mapped_column(String(40))
    # Sensitive PII — encrypted at rest.
    bank_account: Mapped[str | None] = mapped_column(EncryptedString(255))
    status: Mapped[str] = mapped_column(String(20), default="active", nullable=False)
    # P25: homeowner opted out of emailed statements.
    statement_opt_out: Mapped[bool] = mapped_column(default=False, nullable=False)


class ArInvoice(Base, TenantMixin, TimestampMixin):
    """An HOA assessment invoice that posts to the GL when issued."""

    __tablename__ = "ar_invoices"

    id: Mapped[uuid.UUID] = uuid_pk()
    homeowner_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ar_homeowners.id", ondelete="RESTRICT"), index=True
    )
    invoice_number: Mapped[str] = mapped_column(String(40), nullable=False)
    description: Mapped[str | None] = mapped_column(String(240))
    # Bill type for HOA receivables: monthly assessment, late fee, special assessment, other.
    invoice_type: Mapped[str] = mapped_column(String(20), default="ASSESSMENT", nullable=False)
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    invoice_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(15), default="DRAFT", nullable=False)
    # DRAFT|ACCOUNTED|POSTED|PAID
    # KFF: fund + income account this assessment credits (receivable derived per fund).
    fund: Mapped[str] = mapped_column(String(60), default="OPER", nullable=False)
    income_combination_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="SET NULL")
    )
    gl_journal_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_journals.id", ondelete="SET NULL")
    )
    gl_je_header_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    # AR depth (P21): a late fee has been charged on this invoice (dedup guard).
    late_fee_applied: Mapped[bool] = mapped_column(default=False, nullable=False)


class ArReceipt(Base, TenantMixin, TimestampMixin):
    """Homeowner payment (≈ AR_CASH_RECEIPTS_ALL). Posts Dr Cash / Cr Receivable."""

    __tablename__ = "ar_receipts"

    id: Mapped[uuid.UUID] = uuid_pk()
    homeowner_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ar_homeowners.id", ondelete="RESTRICT"), index=True
    )
    applied_invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ar_invoices.id", ondelete="SET NULL")
    )
    receipt_number: Mapped[str] = mapped_column(String(40), nullable=False)
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)
    receipt_date: Mapped[date] = mapped_column(Date, nullable=False)
    payment_method: Mapped[str] = mapped_column(String(20), default="CHECK", nullable=False)  # CHECK|ACH|CARD
    status: Mapped[str] = mapped_column(String(15), default="APPLIED", nullable=False)  # APPLIED|POSTED|REVERSED
    # Note: receipts post through the GL *batch* path (GlJeBatch → GlBalance),
    # never a GlJournal, so there is no gl_journal_id column here.
