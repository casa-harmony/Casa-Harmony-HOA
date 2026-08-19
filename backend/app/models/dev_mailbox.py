"""Captured outbound mail — an in-app inbox for testing.

Invite links, password resets and OTP codes are only useful if you can read
them, and during development nobody wants to own a real mailbox for every test
resident. Every message the application tries to send is recorded here, whether
it actually went out, was suppressed because the caller is in the sandbox, or
was only logged because no provider is configured.

This table holds live secrets by design — reset tokens and one-time codes are
in the body verbatim. That is the entire point, and also why it is superadmin-
only, off in production by default (``DEV_MAILBOX_ENABLED``), split across the
sandbox partition like ``tenants`` and ``users``, and capped so old tokens do
not accumulate forever.
"""
from __future__ import annotations

import uuid

from sqlalchemy import Boolean, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin, uuid_pk

# What happened to the message when the application tried to send it.
STATUS_SENT = "SENT"                    # handed to a real provider
STATUS_SUPPRESSED = "SUPPRESSED"        # sandbox caller — deliberately not sent
STATUS_NO_PROVIDER = "NO_PROVIDER"      # no SendGrid/Twilio configured; logged only
STATUS_FAILED = "FAILED"                # provider rejected it


class CapturedMessage(Base, TimestampMixin):
    """One outbound email or SMS, captured for inspection in the UI."""

    __tablename__ = "dev_mailbox"

    id: Mapped[uuid.UUID] = uuid_pk()
    channel: Mapped[str] = mapped_column(String(10), nullable=False, index=True)  # EMAIL|SMS
    to_address: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    subject: Mapped[str | None] = mapped_column(String(500))  # null for SMS
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    # Provider error text when status is FAILED; otherwise null.
    detail: Mapped[str | None] = mapped_column(Text)
    # Nullable: password invites and resets are platform-level, not tenant data.
    tenant_id: Mapped[uuid.UUID | None] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    # Which side of the sandbox partition captured it. Carried on the row rather
    # than derived from tenant_id, because the most useful messages to read back
    # (invites, resets) have no tenant at all.
    is_sandbox: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
