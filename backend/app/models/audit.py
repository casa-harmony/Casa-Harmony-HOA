"""Immutable audit trail (SOC 2 / ISO 27001 full-history logging).

Captures every mutating action with the acting principal, target entity, and a
JSON before/after diff. ``tenant_id`` is nullable for platform-level actions
(e.g. SUPERADMIN creating a tenant).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, uuid_pk


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(PGUUID(as_uuid=True), index=True)
    actor_email: Mapped[str | None] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(80), nullable=False)          # CREATE/UPDATE/DELETE/LOGIN
    entity_type: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(80))
    changes: Mapped[dict | None] = mapped_column(JSONB)                       # {"before": {...}, "after": {...}}
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(Text)
    # Client-side default (not server_default) so INSERTs need no RETURNING —
    # RETURNING would re-read the row under the SELECT policy and fail for
    # principals with no active tenant (e.g. during MFA enrollment).
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
        index=True,
    )
