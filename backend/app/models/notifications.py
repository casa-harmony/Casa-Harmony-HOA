"""In-app notifications + AP matching tolerance configuration.

Notifications target either a specific user or a role (e.g. BOARD_MEMBER) so that
budget-overrun alerts reach assigned staff and Board members. Tolerances configure
how much an invoice may deviate from its PO before a match exception/hold.
"""
from __future__ import annotations

import uuid
from decimal import Decimal

from sqlalchemy import Boolean, Numeric, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class Notification(Base, TenantMixin, TimestampMixin):
    __tablename__ = "notifications"

    id: Mapped[uuid.UUID] = uuid_pk()
    # Either a direct user recipient or a role-wide recipient (or both null = broadcast).
    recipient_user_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    recipient_role_code: Mapped[str | None] = mapped_column(String(40), index=True)
    category: Mapped[str] = mapped_column(String(40), nullable=False)  # BUDGET_OVERRUN|HOLD|INFO
    message: Mapped[str] = mapped_column(String(500), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(40))
    entity_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class ApMatchTolerance(Base, TenantMixin, TimestampMixin):
    """Per-tenant matching tolerances (one row per tenant)."""

    __tablename__ = "ap_match_tolerances"

    id: Mapped[uuid.UUID] = uuid_pk()
    amount_tolerance_pct: Mapped[Decimal] = mapped_column(Numeric(6, 3), default=0, nullable=False)
    quantity_tolerance_pct: Mapped[Decimal] = mapped_column(Numeric(6, 3), default=0, nullable=False)
    require_receipt: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # 3-way if true
