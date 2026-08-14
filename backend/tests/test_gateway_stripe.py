"""P28: Stripe adapter — signature verification, webhook dispatch, key guard."""
from __future__ import annotations

import json
import os
import uuid

from fastapi.testclient import TestClient

from app.main import app
from app.services import gateway_providers as gp

client = TestClient(app)
SUPERADMIN = os.getenv("SUPERADMIN_EMAIL", "superadmin@casaharmony.ai")
SUPERADMIN_PW = os.getenv("SUPERADMIN_PASSWORD", "ChangeMe!Superadmin1")


def _h(token, tid):
    return {"Authorization": f"Bearer {token}", "X-Tenant-Id": tid}


def _ctx():
    token = client.post("/api/v1/auth/login",
                        json={"email": SUPERADMIN, "password": SUPERADMIN_PW}).json()["access_token"]
    tid = next(t for t in client.get("/api/v1/tenants?include_demo=true",
               headers={"Authorization": f"Bearer {token}"}).json()
               if t["slug"] == "casa-harmony")["id"]
    sid = client.get("/api/v1/coa/structures", headers=_h(token, tid)).json()[0]["id"]
    income = next(c["id"] for c in client.get(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)).json()
                  if c["natural_account_value"] == "4000" and c["fund_value"] == "OPER")
    return token, tid, income


def _invoice(token, tid, income):
    sfx = uuid.uuid4().hex[:6]
    ho = client.post("/api/v1/subledger/homeowners", headers=_h(token, tid), json={
        "account_number": f"ST-{sfx}", "first_name": "Str", "last_name": "Ipe", "property_unit": f"S{sfx[:3]}"}).json()
    plan = client.post("/api/v1/ar-billing/plans", headers=_h(token, tid), json={
        "name": f"ST {sfx}", "lines": [{"income_combination_id": income, "amount": "75.00"}]}).json()
    client.post(f"/api/v1/ar-billing/plans/{plan['id']}/run", headers=_h(token, tid),
                json={"invoice_date": "2025-01-01", "due_days": 30, "homeowner_ids": [ho["id"]]})
    return next(i for i in client.get("/api/v1/subledger/invoices", headers=_h(token, tid)).json()
                if i["homeowner_id"] == ho["id"])


def test_stripe_signature_verification():
    secret = "whsec_unit"
    body = json.dumps({"type": "checkout.session.completed", "data": {"object": {"id": "cs_test_1"}}}).encode()
    sig = gp.sign_payload_for_test(secret, body)
    assert gp.stripe_verify_signature(webhook_secret=secret, payload=body, sig_header=sig) is True
    assert gp.stripe_verify_signature(webhook_secret="wrong", payload=body, sig_header=sig) is False
    assert gp.stripe_verify_signature(webhook_secret=secret, payload=body + b"x", sig_header=sig) is False
    et, ref = gp.parse_stripe_event(body)
    assert et == "checkout.session.completed" and ref == "cs_test_1"


def test_stripe_active_requires_keys():
    token, tid, income = _ctx()
    inv = _invoice(token, tid, income)
    client.put("/api/v1/gateway/config", headers=_h(token, tid), json={
        "provider": "STRIPE", "active": True, "secret_key": "", "webhook_secret": ""})
    r = client.post("/api/v1/gateway/checkout", headers=_h(token, tid),
                    json={"invoice_id": inv["id"], "amount": "75.00"})
    assert r.status_code == 422  # Stripe active but no secret key
    # Go-live validation flags it too.
    v = client.post("/api/v1/compliance/go-live/validate", headers=_h(token, tid)).json()
    gwcheck = next(c for c in v["checks"] if c["check"] == "Payment gateway configuration")
    assert gwcheck["ok"] is False


def test_stripe_webhook_confirms_via_hmac():
    token, tid, income = _ctx()
    inv = _invoice(token, tid, income)
    # Create a PENDING txn under MOCK, then switch to STRIPE for a signed webhook.
    client.put("/api/v1/gateway/config", headers=_h(token, tid), json={"provider": "MOCK", "active": True, "webhook_secret": "mock"})
    ref = client.post("/api/v1/gateway/checkout", headers=_h(token, tid),
                      json={"invoice_id": inv["id"], "amount": "75.00"}).json()["txn_ref"]
    client.put("/api/v1/gateway/config", headers=_h(token, tid), json={
        "provider": "STRIPE", "active": True, "secret_key": "sk_test_x", "webhook_secret": "whsec_live"})

    body = json.dumps({"type": "checkout.session.completed", "data": {"object": {"id": ref}}}).encode()
    sig = gp.sign_payload_for_test("whsec_live", body)
    bad = client.post(f"/api/v1/gateway/webhook/{tid}", content=body,
                      headers={"Stripe-Signature": "t=1,v1=deadbeef", "Content-Type": "application/json"})
    assert bad.status_code == 400
    ok = client.post(f"/api/v1/gateway/webhook/{tid}", content=body,
                     headers={"Stripe-Signature": sig, "Content-Type": "application/json"})
    assert ok.status_code == 200 and ok.json()["handled"] is True
    inv2 = next(i for i in client.get("/api/v1/subledger/invoices", headers=_h(token, tid)).json() if i["id"] == inv["id"])
    assert inv2["status"] == "PAID"
    # Reset to MOCK so other suites are unaffected.
    client.put("/api/v1/gateway/config", headers=_h(token, tid), json={"provider": "MOCK", "active": True, "webhook_secret": "mock"})
