"""The in-app inbox: read back what the application tried to send.

Exists so testing an invite or an OTP does not need a real mailbox. Every
outbound email and SMS is captured (see app/services/dev_mailbox.py) and read
back here, newest first, with the tokens and codes intact.

Guarded three ways, because those bodies are live credentials: the feature is
off in production unless ``DEV_MAILBOX_ENABLED`` says otherwise, every route is
SUPERADMIN-only, and RLS keeps sandbox and live messages apart so a developer
never reads a real resident's reset token.
"""
from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import Principal, require_superadmin
from app.models.dev_mailbox import CapturedMessage
from app.schemas.dev_mailbox import CapturedMessageDetail, CapturedMessageOut
from app.services import audit

router = APIRouter(prefix="/dev-mailbox", tags=["dev-mailbox"])

# Links and codes are what anyone opens this screen for, so they are pulled out
# of the body server-side rather than left for the UI to re-derive.
_LINK_RE = re.compile(r"https?://\S+")
_CODE_RE = re.compile(r"\b(\d{6,10})\b")


def _enabled() -> None:
    if not settings.dev_mailbox_enabled:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "The in-app inbox is disabled. Set DEV_MAILBOX_ENABLED=true to turn it on.",
        )


def _summary(m: CapturedMessage) -> CapturedMessageOut:
    return CapturedMessageOut(
        id=m.id,
        channel=m.channel,
        to_address=m.to_address,
        subject=m.subject,
        status=m.status,
        tenant_id=m.tenant_id,
        is_sandbox=m.is_sandbox,
        created_at=m.created_at,
        preview=" ".join(m.body.split())[:160],
    )


@router.get("", response_model=list[CapturedMessageOut])
def list_messages(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_superadmin),
    channel: str | None = Query(default=None, pattern="^(EMAIL|SMS)$"),
    to: str | None = Query(default=None, description="filter by recipient (substring)"),
    limit: int = Query(default=100, ge=1, le=500),
):
    """List captured messages, newest first. Bodies are omitted — see the detail route."""
    _enabled()
    stmt = select(CapturedMessage).order_by(CapturedMessage.created_at.desc())
    if channel:
        stmt = stmt.where(CapturedMessage.channel == channel)
    if to:
        stmt = stmt.where(CapturedMessage.to_address.ilike(f"%{to}%"))
    rows = db.execute(stmt.limit(limit)).scalars().all()
    return [_summary(m) for m in rows]


@router.get("/{message_id}", response_model=CapturedMessageDetail)
def get_message(
    message_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_superadmin),
):
    """One message with its full body, plus any links and codes found in it.

    Reading a body exposes whatever token it carries, so this is the one route
    that writes an audit entry.
    """
    _enabled()
    m = db.get(CapturedMessage, message_id)
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")

    audit.record(
        db,
        action="DEV_MAILBOX_READ",
        entity_type="CapturedMessage",
        entity_id=m.id,
        tenant_id=m.tenant_id,
    )

    base = _summary(m)
    return CapturedMessageDetail(
        **base.model_dump(),
        body=m.body,
        detail=m.detail,
        links=_LINK_RE.findall(m.body),
        codes=_CODE_RE.findall(m.body),
    )


@router.delete("/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_message(
    message_id: uuid.UUID,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_superadmin),
):
    _enabled()
    m = db.get(CapturedMessage, message_id)
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    db.delete(m)


@router.post("/clear", status_code=status.HTTP_204_NO_CONTENT)
def clear_inbox(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_superadmin),
):
    """Empty the inbox.

    Only this side of the sandbox partition is affected — RLS scopes the DELETE
    the same way it scopes the reads, so clearing the sandbox cannot wipe the
    live capture and vice versa.
    """
    _enabled()
    db.execute(delete(CapturedMessage))
