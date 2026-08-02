"""Payment-gateway provider adapters behind a uniform interface.

MOCK: synthetic checkout + shared-secret webhook (for dev/testing).
STRIPE: real hosted Checkout Session (via httpx) + Stripe-Signature HMAC webhook
verification. Signature verification and event parsing are pure functions (unit
tested); only session creation performs network I/O.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import time
from decimal import Decimal

from app.core.config import settings


class ProviderError(ValueError):
    pass


# --- MOCK ------------------------------------------------------------------
def mock_checkout(txn_ref: str, amount: Decimal) -> dict:
    return {"txn_ref": txn_ref,
            "checkout_url": f"https://checkout.example/mock/{txn_ref}",
            "client_secret": txn_ref, "status": "PENDING", "amount": str(amount)}


# --- STRIPE ----------------------------------------------------------------
def stripe_create_checkout(*, secret_key: str, amount: Decimal, description: str,
                           success_url: str, cancel_url: str, metadata: dict | None = None) -> dict:
    """Create a Stripe Checkout Session. Returns {txn_ref(session id), checkout_url}."""
    if not secret_key:
        raise ProviderError("Stripe secret key is not configured")
    import httpx

    cents = int((Decimal(amount) * 100).quantize(Decimal("1")))
    form = {
        "mode": "payment",
        "success_url": success_url,
        "cancel_url": cancel_url,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": str(cents),
        "line_items[0][price_data][product_data][name]": description[:120] or "HOA payment",
    }
    for k, v in (metadata or {}).items():
        form[f"metadata[{k}]"] = str(v)
    try:
        resp = httpx.post("https://api.stripe.com/v1/checkout/sessions", data=form,
                          auth=(secret_key, ""), timeout=20.0)
    except Exception as exc:  # pragma: no cover - network failure path
        raise ProviderError(f"Stripe request failed: {exc}")
    if resp.status_code >= 300:
        raise ProviderError(f"Stripe error {resp.status_code}: {resp.text[:200]}")
    data = resp.json()
    return {"txn_ref": data["id"], "checkout_url": data.get("url"),
            "client_secret": data.get("client_secret"), "status": "PENDING", "amount": str(amount)}


def stripe_verify_signature(*, webhook_secret: str, payload: bytes, sig_header: str,
                            tolerance: int = 300) -> bool:
    """Verify a Stripe webhook signature header (t=...,v1=...) via HMAC-SHA256."""
    if not webhook_secret or not sig_header:
        return False
    parts = dict(p.split("=", 1) for p in sig_header.split(",") if "=" in p)
    ts, v1 = parts.get("t"), parts.get("v1")
    if not ts or not v1:
        return False
    if tolerance and abs(time.time() - int(ts)) > tolerance:
        return False
    signed = f"{ts}.".encode() + payload
    expected = hmac.new(webhook_secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)


def parse_stripe_event(payload: bytes) -> tuple[str, str | None]:
    """Return (event_type, txn_ref) from a Stripe event body. txn_ref = the object id."""
    body = json.loads(payload.decode("utf-8"))
    event_type = body.get("type", "")
    obj = (body.get("data") or {}).get("object") or {}
    # checkout.session → id is the session id we stored as txn_ref; refunds carry
    # the payment_intent/charge — fall back to metadata.txn_ref when present.
    txn_ref = obj.get("id") or (obj.get("metadata") or {}).get("txn_ref")
    return event_type, txn_ref


def sign_payload_for_test(webhook_secret: str, payload: bytes, ts: int | None = None) -> str:
    """Helper to build a valid Stripe-Signature header (used by tests/integrations)."""
    ts = ts or int(time.time())
    signed = f"{ts}.".encode() + payload
    v1 = hmac.new(webhook_secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={ts},v1={v1}"
