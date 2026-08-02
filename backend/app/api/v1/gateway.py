from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db, get_elevated_db
from app.core.deps import Principal, require_active_tenant, require_permission
from app.models.identity import Tenant
from app.models.payment_gateway import GatewayConfig, GatewayTransaction
from app.schemas.gateway import (
    CheckoutIn,
    GatewayConfigIn,
    GatewayConfigOut,
    TxnOut,
    WebhookIn,
)
from app.services import audit, gateway
from app.services.gateway import GatewayError

router = APIRouter(prefix="/gateway", tags=["gateway"])
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _cfg_out(c: GatewayConfig) -> GatewayConfigOut:
    return GatewayConfigOut(id=getattr(c, "id", None), provider=c.provider,
                            publishable_key=c.publishable_key, secret_key_set=bool(c.secret_key),
                            webhook_secret_set=bool(c.webhook_secret), active=c.active)


@router.get("/config", response_model=GatewayConfigOut, dependencies=[Depends(require_active_tenant)])
def get_config(db: Session = Depends(get_db),
               p: Principal = Depends(require_permission("payment.manage"))):
    return _cfg_out(gateway.get_config(db, p.tenant_id))


@router.put("/config", response_model=GatewayConfigOut, dependencies=[Depends(require_active_tenant)])
def put_config(payload: GatewayConfigIn, db: Session = Depends(get_db),
               p: Principal = Depends(require_permission("payment.manage"))):
    c = db.execute(select(GatewayConfig).where(GatewayConfig.tenant_id == p.tenant_id)).scalar_one_or_none()
    if c is None:
        c = GatewayConfig(tenant_id=p.tenant_id, created_by=p.user.id, updated_by=p.user.id)
        db.add(c)
    c.provider = payload.provider
    c.publishable_key = payload.publishable_key
    if payload.secret_key is not None:
        c.secret_key = payload.secret_key or None
    if payload.webhook_secret is not None:
        c.webhook_secret = payload.webhook_secret or None
    c.active = payload.active
    db.flush()
    audit.record(db, action="UPDATE", entity_type="GatewayConfig", entity_id=c.id,
                 after={"provider": c.provider, "active": c.active})
    return _cfg_out(c)


@router.get("/transactions", response_model=list[TxnOut], dependencies=[Depends(require_active_tenant)])
def list_transactions(db: Session = Depends(get_db),
                      p: Principal = Depends(require_permission("payment.manage"))):
    return db.execute(select(GatewayTransaction).where(GatewayTransaction.tenant_id == p.tenant_id)
                      .order_by(GatewayTransaction.created_at.desc())).scalars().all()


@router.post("/checkout", dependencies=[Depends(require_active_tenant)])
def checkout(payload: CheckoutIn, db: Session = Depends(get_db),
             p: Principal = Depends(require_permission("ar.receipt.manage"))):
    try:
        return gateway.create_checkout(db, tenant_id=p.tenant_id, invoice_id=payload.invoice_id,
                                       amount=payload.amount, homeowner_id=payload.homeowner_id,
                                       created_by=p.user.id)
    except GatewayError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))


@router.post("/transactions/{txn_id}/refund", response_model=TxnOut,
             dependencies=[Depends(require_active_tenant)])
def refund(txn_id: uuid.UUID, db: Session = Depends(get_db),
           p: Principal = Depends(require_permission("payment.manage"))):
    try:
        txn = gateway.refund(db, tenant_id=p.tenant_id, txn_id=txn_id, created_by=p.user.id)
    except GatewayError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    audit.record(db, action="REFUND", entity_type="GatewayTransaction", entity_id=txn.id,
                 after={"amount": str(txn.amount)})
    return txn


@router.get("/reconciliation/export", dependencies=[Depends(require_active_tenant)])
def reconciliation_export(db: Session = Depends(get_db),
                          p: Principal = Depends(require_permission("report.read"))):
    t = db.get(Tenant, p.tenant_id)
    content = gateway.build_reconciliation_workbook(db, p.tenant_id, t.name if t else "HOA")
    return Response(content=content, media_type=XLSX,
                    headers={"Content-Disposition": 'attachment; filename="gateway_reconciliation.xlsx"'})


# --- Async webhook (unauthenticated; signature-verified) -------------------
@router.post("/webhook/{tenant_id}")
async def webhook(tenant_id: uuid.UUID, request: Request,
                  stripe_signature: str | None = Header(default=None, alias="Stripe-Signature"),
                  x_webhook_signature: str | None = Header(default=None),
                  db: Session = Depends(get_elevated_db)):
    """Provider callback. Tenant in the path; Stripe verifies the HMAC over the raw
    body, MOCK uses a shared secret. Reads the raw body so signatures stay valid."""
    raw = await request.body()
    sig = stripe_signature or x_webhook_signature
    try:
        result = gateway.handle_webhook_raw(db, tenant_id, raw_body=raw, sig_header=sig)
    except GatewayError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc))
    audit.record(db, action="WEBHOOK", entity_type="GatewayTransaction",
                 after={"result": str(result)[:120]})
    return result
