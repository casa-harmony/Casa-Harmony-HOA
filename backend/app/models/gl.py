"""General Ledger (≈ GL_JE_BATCHES / GL_JE_HEADERS / GL_JE_LINES / GL_BALANCES).

Subledgers (AP, AR, PO) create draft JE batches via Subledger Accounting; a GL
accountant reviews control totals and approves; a nightly job posts approved
batches into GL_BALANCES by period and code combination.

Fund accounting: every line carries the fund segment value; balances are tracked
per code combination (which embeds the fund), so fund balances are always derivable.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Date,
    DateTime,
    ForeignKey,
    Index,
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


class GlJeBatch(Base, TenantMixin, TimestampMixin):
    __tablename__ = "gl_je_batches"
    __table_args__ = (
        UniqueConstraint("tenant_id", "batch_name", name="uq_je_batch_name"),
        Index("ix_je_batch_status", "tenant_id", "status"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    batch_name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(20), default="Manual", nullable=False)  # AR|AP|PO|Manual
    accounting_date: Mapped[date] = mapped_column(Date, nullable=False)
    period_name: Mapped[str] = mapped_column(String(15), nullable=False)  # e.g. JAN-2026
    status: Mapped[str] = mapped_column(String(15), default="DRAFT", nullable=False)
    # DRAFT|SUBMITTED|APPROVED|POSTED|REJECTED
    # Control totals (entered by preparer; validated against line sums).
    control_total_dr: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    control_total_cr: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    headers: Mapped[list["GlJeHeader"]] = relationship(
        back_populates="batch", cascade="all, delete-orphan"
    )


class GlJeHeader(Base, TenantMixin, TimestampMixin):
    __tablename__ = "gl_je_headers"

    id: Mapped[uuid.UUID] = uuid_pk()
    batch_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_je_batches.id", ondelete="CASCADE"), index=True
    )
    structure_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("kff_structures.id", ondelete="RESTRICT")
    )
    je_name: Mapped[str] = mapped_column(String(100), nullable=False)
    je_category: Mapped[str] = mapped_column(String(30), default="Manual", nullable=False)
    je_source: Mapped[str] = mapped_column(String(20), default="Manual", nullable=False)
    accounting_date: Mapped[date] = mapped_column(Date, nullable=False)
    period_name: Mapped[str] = mapped_column(String(15), nullable=False)
    status: Mapped[str] = mapped_column(String(15), default="DRAFT", nullable=False)
    # Subledger document this journal originated from (audit lineage).
    source_doc_type: Mapped[str | None] = mapped_column(String(20))
    source_doc_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)

    batch: Mapped["GlJeBatch"] = relationship(back_populates="headers")
    lines: Mapped[list["GlJeLine"]] = relationship(
        back_populates="header", cascade="all, delete-orphan", order_by="GlJeLine.line_num"
    )


class GlJeLine(Base, TenantMixin, TimestampMixin):
    __tablename__ = "gl_je_lines"
    __table_args__ = (
        UniqueConstraint("header_id", "line_num", name="uq_je_line_num"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    header_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_je_headers.id", ondelete="CASCADE"), index=True
    )
    line_num: Mapped[int] = mapped_column(Integer, nullable=False)
    code_combination_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="RESTRICT"), index=True
    )
    entered_dr: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    entered_cr: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    fund_value: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(String(240))

    header: Mapped["GlJeHeader"] = relationship(back_populates="lines")


class GlBalance(Base, TenantMixin, TimestampMixin):
    """Period balances per code combination (≈ GL_BALANCES)."""

    __tablename__ = "gl_balances"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id", "code_combination_id", "period_name", name="uq_gl_balance"
        ),
        Index("ix_gl_balance_fund", "tenant_id", "fund_value", "period_name"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    code_combination_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="RESTRICT"), index=True
    )
    period_name: Mapped[str] = mapped_column(String(15), nullable=False)
    period_year: Mapped[int] = mapped_column(Integer, nullable=False)
    period_num: Mapped[int] = mapped_column(Integer, nullable=False)
    fund_value: Mapped[str | None] = mapped_column(String(60), index=True)
    begin_balance: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    period_net_dr: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    period_net_cr: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)

    @property
    def end_balance(self) -> Decimal:
        return self.begin_balance + self.period_net_dr - self.period_net_cr
