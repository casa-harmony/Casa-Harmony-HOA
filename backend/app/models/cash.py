"""Cash Management & Bank Reconciliation (≈ Oracle CE_BANK_ACCOUNTS,
CE_STATEMENT_HEADERS / CE_STATEMENT_LINES + reconciliation).

A cash-management bank account is tied to a **Fund** (HOA fund segregation) and to
a GL cash code-combination, so reconciliation adjustments post to the right cash
account. Statement lines are matched to payments/receipts or cleared via an
adjustment (which generates a draft GL batch).
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
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.crypto_types import EncryptedString
from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk

_AMOUNT = Numeric(18, 2)


class CeBankAccount(Base, TenantMixin, TimestampMixin):
    __tablename__ = "ce_bank_accounts"
    __table_args__ = (
        UniqueConstraint("tenant_id", "account_code", name="uq_ce_account_code"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    account_code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    bank_name: Mapped[str | None] = mapped_column(String(200))
    account_number: Mapped[str | None] = mapped_column(EncryptedString(255))
    routing_number: Mapped[str | None] = mapped_column(String(9))
    # Fund segregation + the GL cash account this bank maps to.
    fund_value: Mapped[str] = mapped_column(String(60), nullable=False, default="OPER")
    gl_cash_combination_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="SET NULL")
    )
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class CeStatementHeader(Base, TenantMixin, TimestampMixin):
    __tablename__ = "ce_statement_headers"

    id: Mapped[uuid.UUID] = uuid_pk()
    ce_bank_account_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ce_bank_accounts.id", ondelete="CASCADE"), index=True
    )
    statement_date: Mapped[date] = mapped_column(Date, nullable=False)
    opening_balance: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    closing_balance: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="OPEN", nullable=False)  # OPEN|RECONCILED
    reconciled_by: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    reconciled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lines: Mapped[list["CeStatementLine"]] = relationship(
        back_populates="header", cascade="all, delete-orphan", order_by="CeStatementLine.line_num"
    )


class CeStatementLine(Base, TenantMixin, TimestampMixin):
    __tablename__ = "ce_statement_lines"

    id: Mapped[uuid.UUID] = uuid_pk()
    header_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ce_statement_headers.id", ondelete="CASCADE"), index=True
    )
    line_num: Mapped[int] = mapped_column(Numeric(10, 0), nullable=False)
    line_date: Mapped[date | None] = mapped_column(Date)
    description: Mapped[str | None] = mapped_column(String(240))
    reference: Mapped[str | None] = mapped_column(String(60))
    # Signed: positive = deposit/credit to the account, negative = withdrawal/debit.
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)
    reconciled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    match_type: Mapped[str | None] = mapped_column(String(12))  # PAYMENT|RECEIPT|ADJUSTMENT
    matched_payment_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    matched_receipt_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    adjustment_je_header_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    notes: Mapped[str | None] = mapped_column(Text)

    header: Mapped["CeStatementHeader"] = relationship(back_populates="lines")
