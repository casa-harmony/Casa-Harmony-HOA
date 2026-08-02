"""One-time-passcode challenges for resident MFA (email/SMS).

The code itself is NEVER stored — only a salted HMAC-SHA256 hash. Challenges are
single-use, short-lived, and attempt-capped. Verification is constant-time.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TenantMixin, TimestampMixin, uuid_pk


class ResidentOtpChallenge(Base, TenantMixin, TimestampMixin):
    __tablename__ = "resident_otp_challenges"

    id: Mapped[uuid.UUID] = uuid_pk()
    resident_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("residents.id", ondelete="CASCADE"), index=True
    )
    code_hash: Mapped[str] = mapped_column(String(128), nullable=False)  # HMAC-SHA256 hex
    channel: Mapped[str] = mapped_column(String(10), nullable=False)     # EMAIL|SMS
    destination_masked: Mapped[str] = mapped_column(String(120), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
