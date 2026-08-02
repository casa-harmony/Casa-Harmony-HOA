"""Outbound notifications (email / SMS) for resident one-time codes.

Pluggable: if a provider is configured via env (SendGrid for email, Twilio for SMS)
it is used; otherwise the message is logged so dev/UAT works without a provider.
The OTP itself is passed here only to be delivered — it is never persisted in
plaintext anywhere (only its hash is stored on the challenge).
"""
from __future__ import annotations

import logging

from app.core.config import settings

logger = logging.getLogger("casa-harmony.notify")


def _send_email(to: str, subject: str, body: str, attachments: list[tuple] | None = None) -> None:
    """Send an email. ``attachments`` is a list of (filename, bytes, mime_type)."""
    if settings.SENDGRID_API_KEY:
        try:
            import base64
            import httpx

            payload = {
                "personalizations": [{"to": [{"email": to}]}],
                "from": {"email": settings.MAIL_FROM},
                "subject": subject,
                "content": [{"type": "text/plain", "value": body}],
            }
            if attachments:
                payload["attachments"] = [
                    {"content": base64.b64encode(data).decode(), "filename": fn,
                     "type": mime, "disposition": "attachment"}
                    for fn, data, mime in attachments
                ]
            httpx.post(
                "https://api.sendgrid.com/v3/mail/send",
                headers={"Authorization": f"Bearer {settings.SENDGRID_API_KEY}"},
                json=payload, timeout=12.0,
            )
            return
        except Exception:  # pragma: no cover - provider/network issues
            logger.exception("SendGrid send failed; falling back to log")
    att = ", ".join(fn for fn, _, _ in (attachments or []))
    logger.info("[DEV EMAIL] to=%s subject=%s attachments=[%s] body=%s", to, subject, att, body)


def _send_sms(to: str, body: str) -> None:
    if settings.TWILIO_ACCOUNT_SID and settings.TWILIO_AUTH_TOKEN:
        try:
            import httpx

            httpx.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{settings.TWILIO_ACCOUNT_SID}/Messages.json",
                auth=(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN),
                data={"From": settings.TWILIO_FROM_NUMBER, "To": to, "Body": body},
                timeout=8.0,
            )
            return
        except Exception:  # pragma: no cover
            logger.exception("Twilio send failed; falling back to log")
    logger.info("[DEV SMS] to=%s body=%s", to, body)


def send_otp(channel: str, destination: str, code: str) -> None:
    body = (
        f"Your Casa Harmony verification code is {code}. "
        f"It expires in {settings.OTP_TTL_MINUTES} minutes. "
        "Do not share this code with anyone."
    )
    if channel == "SMS":
        _send_sms(destination, body)
    else:
        _send_email(destination, "Your Casa Harmony verification code", body)


# --- In-app notifications + budget-overrun alerts --------------------------
import uuid  # noqa: E402

from sqlalchemy import select  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.models.identity import Membership, Role, User  # noqa: E402
from app.models.notifications import Notification  # noqa: E402


def create_notification(
    db: Session, *, tenant_id: uuid.UUID, category: str, message: str,
    entity_type: str | None = None, entity_id: uuid.UUID | None = None,
    recipient_user_id: uuid.UUID | None = None, recipient_role_code: str | None = None,
) -> Notification:
    n = Notification(
        tenant_id=tenant_id, category=category, message=message,
        entity_type=entity_type, entity_id=entity_id,
        recipient_user_id=recipient_user_id, recipient_role_code=recipient_role_code,
    )
    db.add(n)
    db.flush()
    return n


def _users_with_role(db: Session, tenant_id: uuid.UUID, role_code: str) -> list[User]:
    return db.execute(
        select(User).join(Membership, Membership.user_id == User.id)
        .join(Role, Role.id == Membership.role_id)
        .where(Membership.tenant_id == tenant_id, Role.code == role_code)
    ).scalars().all()


def notify_budget_overrun(db: Session, *, tenant_id, invoice, po, staff_user_id=None) -> None:
    """Alert assigned staff (in-app) and the Board (in-app + best-effort email)."""
    msg = (
        f"Invoice {invoice.invoice_number} (${invoice.amount}) exceeds the limit on "
        f"PO {po.po_number} (cap ${po.amount_limit}, billed ${po.billed_amount}). "
        "Invoice placed on hold pending review."
    )
    create_notification(db, tenant_id=tenant_id, category="BUDGET_OVERRUN", message=msg,
                        entity_type="ApInvoice", entity_id=invoice.id,
                        recipient_role_code="BOARD_MEMBER")
    if staff_user_id:
        create_notification(db, tenant_id=tenant_id, category="BUDGET_OVERRUN", message=msg,
                            entity_type="ApInvoice", entity_id=invoice.id,
                            recipient_user_id=staff_user_id)
    for u in _users_with_role(db, tenant_id, "BOARD_MEMBER"):
        if u.email and not u.email.endswith("@anonymized.invalid"):
            _send_email(u.email, "Casa Harmony — PO budget overrun alert", msg)


def list_for_user(db: Session, tenant_id, user_id, role_codes, unread_only=False):
    conds = [Notification.recipient_user_id == user_id]
    if role_codes:
        conds.append(Notification.recipient_role_code.in_(list(role_codes)))
    stmt = select(Notification).where(
        Notification.tenant_id == tenant_id,
        (Notification.recipient_user_id == user_id)
        | (Notification.recipient_role_code.in_(list(role_codes)) if role_codes else False),
    )
    if unread_only:
        stmt = stmt.where(Notification.is_read.is_(False))
    return db.execute(stmt.order_by(Notification.created_at.desc())).scalars().all()
