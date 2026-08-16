"""Payment gateway integration (provider-abstracted).

GatewayConfig holds per-tenant provider credentials (secret + webhook secret are
encrypted at rest). GatewayTransaction tracks the lifecycle of an online payment
(checkout → webhook confirmation → AR receipt) plus refunds/chargebacks. The
provider is abstracted (MOCK default; a real Stripe-like adapter slots in) so the
flow — checkout, async webhook, receipt + GL, refund draft batch — is uniform.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Numeric, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.crypto_types import EncryptedString
from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk

_AMOUNT = Numeric(18, 2)


class GatewayConfig(Base, TenantMixin, TimestampMixin):
    """Per-tenant payment-gateway configuration (one row per tenant)."""

    __tablename__ = "gateway_configs"

    id: Mapped[uuid.UUID] = uuid_pk()
    provider: Mapped[str] = mapped_column(String(20), default="MOCK", nullable=False)  # MOCK|STRIPE
    publishable_key: Mapped[str | None] = mapped_column(String(255))
    secret_key: Mapped[str | None] = mapped_column(EncryptedString(255))
    webhook_secret: Mapped[str | None] = mapped_column(EncryptedString(255))
    # `active` gates whether checkout can actually run (go-live switch); the
    # Gateway screen displays it as "Live mode"/"Test mode".
    active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    card_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    ach_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    card_fee_pct: Mapped[Decimal] = mapped_column(Numeric(5, 2), default=Decimal("2.90"), nullable=False)
    card_fee_flat: Mapped[Decimal] = mapped_column(_AMOUNT, default=Decimal("0.30"), nullable=False)
    ach_fee_flat: Mapped[Decimal] = mapped_column(_AMOUNT, default=Decimal("1.50"), nullable=False)
    # False = the community absorbs processing fees; True = passed to the resident.
    pass_fees_to_resident: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class GatewayTransaction(Base, TenantMixin, TimestampMixin):
    __tablename__ = "gateway_transactions"

    id: Mapped[uuid.UUID] = uuid_pk()
    txn_ref: Mapped[str] = mapped_column(String(80), nullable=False, index=True)  # provider id
    provider: Mapped[str] = mapped_column(String(20), default="MOCK", nullable=False)
    homeowner_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ar_homeowners.id", ondelete="SET NULL"), index=True)
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("ar_invoices.id", ondelete="SET NULL"))
    amount: Mapped[Decimal] = mapped_column(_AMOUNT, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="USD", nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="PENDING", nullable=False)
    # PENDING|SUCCEEDED|FAILED|REFUNDED|CHARGEBACK
    receipt_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    refund_of_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    gl_je_header_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw: Mapped[str | None] = mapped_column(Text)
