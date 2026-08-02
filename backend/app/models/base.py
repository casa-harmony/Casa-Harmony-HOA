"""Declarative base and shared column mixins.

* :class:`TimestampMixin` / who-columns – the standard Oracle EBS audit columns
  (CREATED_BY, CREATION_DATE, LAST_UPDATED_BY, LAST_UPDATE_DATE) implemented as
  ``created_by`` / ``created_at`` / ``updated_by`` / ``updated_at``.
* :class:`TenantMixin` – the mandatory ``tenant_id`` present on every
  tenant-scoped table, backed by PostgreSQL Row-Level Security.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class TimestampMixin:
    """Oracle-style 'Who' columns for full audit attribution."""

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))
    updated_by: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True))


class TenantMixin:
    """Adds the mandatory tenant discriminator. RLS keys off this column."""

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
