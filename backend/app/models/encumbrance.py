"""Encumbrance / Commitment accounting.

When a PO/contract is approved, its committed amount is **encumbered**: a draft GL
batch debits an encumbrance account and credits a reserve-for-encumbrance account
(budgetary memo entries). As invoices bill against the PO, the encumbrance is
**liquidated** proportionally (reversing entry). Open commitment = encumbered −
liquidated. GL posting is optional (config-driven); the subledger always tracks it.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Numeric, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk

_AMOUNT = Numeric(18, 2)


class EncumbranceSettings(Base, TenantMixin, TimestampMixin):
    """Per-tenant encumbrance GL configuration (one row per tenant)."""

    __tablename__ = "encumbrance_settings"

    id: Mapped[uuid.UUID] = uuid_pk()
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    encumbrance_combination_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="SET NULL")
    )
    reserve_combination_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("gl_code_combinations.id", ondelete="SET NULL")
    )


class PoEncumbrance(Base, TenantMixin, TimestampMixin):
    """Open commitment ledger for a PO (encumbered vs liquidated)."""

    __tablename__ = "po_encumbrances"
    __table_args__ = (
        UniqueConstraint("tenant_id", "po_header_id", name="uq_po_encumbrance"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    po_header_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("po_headers.id", ondelete="CASCADE"), index=True
    )
    encumbered_amount: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    liquidated_amount: Mapped[Decimal] = mapped_column(_AMOUNT, default=0, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="OPEN", nullable=False)  # OPEN|LIQUIDATED
    je_header_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))

    @property
    def open_commitment(self) -> Decimal:
        return self.encumbered_amount - self.liquidated_amount
