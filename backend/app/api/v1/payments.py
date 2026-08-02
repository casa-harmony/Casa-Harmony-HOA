from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.compliance import PaymentToken
from app.schemas.security_ext import PaymentMethodCreate, PaymentMethodOut
from app.services import audit
from app.services.tokenization import CardValidationError, tokenize_card

router = APIRouter(
    prefix="/payments", tags=["payments"], dependencies=[Depends(require_active_tenant)]
)


@router.get("/methods", response_model=list[PaymentMethodOut])
def list_methods(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("payment.manage")),
):
    return db.execute(
        select(PaymentToken).where(PaymentToken.tenant_id == principal.tenant_id)
        .order_by(PaymentToken.created_at.desc())
    ).scalars().all()


@router.post("/methods", response_model=PaymentMethodOut, status_code=status.HTTP_201_CREATED)
def add_method(
    payload: PaymentMethodCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_permission("payment.manage")),
):
    """PCI DSS: tokenize the card; the PAN is never stored or logged."""
    try:
        vault = tokenize_card(payload.card_number, payload.exp_month, payload.exp_year)
    except CardValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))

    token = PaymentToken(
        tenant_id=principal.tenant_id,
        homeowner_id=payload.homeowner_id,
        holder_name=payload.holder_name,
        created_by=principal.user.id,
        updated_by=principal.user.id,
        **vault,
    )
    db.add(token)
    db.flush()
    # Audit records only the token + last four — never the PAN.
    audit.record(
        db, action="CREATE", entity_type="PaymentToken", entity_id=token.id,
        after={"vault_token": token.vault_token, "last_four": token.last_four},
    )
    return token
