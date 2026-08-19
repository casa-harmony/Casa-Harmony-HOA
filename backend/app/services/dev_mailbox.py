"""Capture outbound mail into the in-app inbox.

Writes go through their own short-lived session rather than the caller's: a
message the application *tried* to send is worth seeing even when the request
that triggered it later rolls back, and capture must never be the reason a send
fails. Every failure here is swallowed and logged.
"""
from __future__ import annotations

import logging

from sqlalchemy import select

from app.core.config import settings
from app.core.context import get_context
from app.core.database import session_for
from app.models.dev_mailbox import CapturedMessage

logger = logging.getLogger("casa-harmony.notify")


def capture(
    *, channel: str, to: str, subject: str | None, body: str,
    status: str, detail: str | None = None,
) -> None:
    """Record one outbound message. Never raises."""
    if not settings.dev_mailbox_enabled:
        return

    ctx = get_context()
    try:
        # Superadmin scope: the inbox is platform-level, and many captured
        # messages (invites, password resets) have no tenant at all.
        db = session_for(tenant_id=None, is_superadmin=True, sandbox=ctx.is_sandbox)
        try:
            db.add(CapturedMessage(
                channel=channel,
                to_address=to[:320],
                subject=subject[:500] if subject else None,
                body=body,
                status=status,
                detail=detail,
                tenant_id=ctx.tenant_id,
                is_sandbox=ctx.is_sandbox,
            ))
            _prune(db, ctx.is_sandbox)
            db.commit()
        finally:
            db.close()
    except Exception:  # pragma: no cover - capture must never break a send
        logger.exception("dev mailbox capture failed (message was still sent/logged)")


def _prune(db, is_sandbox: bool) -> None:
    """Keep only the most recent N messages on this side of the partition.

    Captured bodies contain live reset tokens, so an unbounded table is a
    growing pile of credentials. Pruning on write keeps it self-limiting
    without needing a scheduled job.
    """
    cap = settings.DEV_MAILBOX_MAX_MESSAGES
    stale = db.execute(
        select(CapturedMessage.id)
        .where(CapturedMessage.is_sandbox.is_(is_sandbox))
        .order_by(CapturedMessage.created_at.desc())
        .offset(cap)
    ).scalars().all()
    for mid in stale:
        db.delete(db.get(CapturedMessage, mid))
