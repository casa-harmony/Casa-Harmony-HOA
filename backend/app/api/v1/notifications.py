from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant
from app.models.identity import Membership, Role
from app.models.notifications import Notification
from app.schemas.notifications import NotificationOut
from app.services import notifications as notif_svc

router = APIRouter(
    prefix="/notifications", tags=["notifications"], dependencies=[Depends(require_active_tenant)]
)


def _role_codes(db: Session, principal: Principal) -> list[str]:
    if principal.is_superadmin:
        return ["SUPERADMIN"]
    return db.execute(
        select(Role.code).join(Membership, Membership.role_id == Role.id)
        .where(Membership.user_id == principal.user.id,
               Membership.tenant_id == principal.tenant_id,
               Membership.is_active.is_(True))
    ).scalars().all()


@router.get("", response_model=list[NotificationOut])
def my_notifications(unread_only: bool = False, db: Session = Depends(get_db),
                     principal: Principal = Depends(require_active_tenant)):
    return notif_svc.list_for_user(
        db, principal.tenant_id, principal.user.id, _role_codes(db, principal),
        unread_only=unread_only)


@router.get("/unread-count")
def unread_count(db: Session = Depends(get_db),
                 principal: Principal = Depends(require_active_tenant)):
    rows = notif_svc.list_for_user(
        db, principal.tenant_id, principal.user.id, _role_codes(db, principal), unread_only=True)
    return {"count": len(rows)}


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: uuid.UUID, db: Session = Depends(get_db),
              principal: Principal = Depends(require_active_tenant)):
    n = db.get(Notification, notification_id)
    if n is None or n.tenant_id != principal.tenant_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    n.is_read = True
    db.flush()
    return n
