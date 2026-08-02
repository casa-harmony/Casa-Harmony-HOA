"""Audit logging service (SOC 2 / ISO 27001 evidence trail)."""
from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.core.context import get_context
from app.models.audit import AuditLog


def record(
    db: Session,
    *,
    action: str,
    entity_type: str,
    entity_id: str | uuid.UUID | None = None,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
    tenant_id: uuid.UUID | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> AuditLog:
    """Append an immutable audit row. Caller's transaction commits it."""
    ctx = get_context()
    changes: dict[str, Any] | None = None
    if before is not None or after is not None:
        changes = {"before": before, "after": after}

    log = AuditLog(
        tenant_id=tenant_id if tenant_id is not None else ctx.tenant_id,
        actor_id=ctx.user_id,
        actor_email=ctx.email,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        changes=changes,
        ip_address=ip_address,
        user_agent=user_agent,
    )
    db.add(log)
    return log
