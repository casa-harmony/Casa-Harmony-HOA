"""P27: payment gateway — config, checkout, webhook confirm (idempotent), refund."""
from __future__ import annotations

import os
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
SUPERADMIN = os.getenv("SUPERADMIN_EMAIL", "superadmin@casaharmony.ai")
SUPERADMIN_PW = os.getenv("SUPERADMIN_PASSWORD", "ChangeMe!Superadmin1")


def _h(token, tid):
    return {"Authorization": f"Bearer {token}", "X-Tenant-Id": tid}


def _ctx():
    token = client.post("/api/v1/auth/login",
                        json={"email": SUPERADMIN, "password": SUPERADMIN_PW}).json()["access_token"]
    tid = next(t for t in client.get("/api/v1/tenants",
               headers={"Authorization": f"Bearer {token}"}).json()
               if t["slug"] == "casa-harmony")["id"]
    sid = client.get("/api/v1/coa/structures", headers=_h(token, tid)).json()[0]["id"]
    income = next(c["id"] for c in client.get(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)).json()
                  if c["natural_account_value"] == "4000" and c["fund_value"] == "OPER")
    return token, tid, income


def _invoice(token, tid, income):
    sfx = uuid.uuid4().hex[:6]
    ho = client.post("/api/v1/subledger/homeowners", headers=_h(token, tid), json={
        "account_number": f"GW-{sfx}", "first_name": "Gate", "last_name": "Way",
        "property_unit": f"G{sfx[:3]}"}).json()
    plan = client.post("/api/v1/ar-billing/plans", headers=_h(token, tid), json={
        "name": f"GW {sfx}", "lines": [{"income_combination_id": income, "amount": "90.00"}]}).json()
    client.post(f"/api/v1/ar-billing/plans/{plan['id']}/run", headers=_h(token, tid),
                json={"invoice_date": "2025-01-01", "due_days": 30, "homeowner_ids": [ho["id"]]})
    inv = next(i for i in client.get("/api/v1/subledger/invoices", headers=_h(token, tid)).json()
               if i["homeowner_id"] == ho["id"])
    return inv


def _enable(token, tid):
    client.put("/api/v1/gateway/config", headers=_h(token, tid), json={
        "provider": "MOCK", "active": True, "webhook_secret": "whsec_test"})


def test_checkout_webhook_confirms_and_is_idempotent():
    token, tid, income = _ctx()
    _enable(token, tid)
    cfg = client.get("/api/v1/gateway/config", headers=_h(token, tid)).json()
    assert cfg["active"] is True and cfg["webhook_secret_set"] is True
    inv = _invoice(token, tid, income)

    co = client.post("/api/v1/gateway/checkout", headers=_h(token, tid),
                     json={"invoice_id": inv["id"], "amount": "90.00"})
    assert co.status_code == 200, co.text
    ref = co.json()["txn_ref"]

    # Bad signature rejected.
    bad = client.post(f"/api/v1/gateway/webhook/{tid}",
                      json={"event_type": "payment_succeeded", "txn_ref": ref, "signature": "wrong"})
    assert bad.status_code == 400

    # Valid webhook confirms → invoice PAID, receipt created.
    ok = client.post(f"/api/v1/gateway/webhook/{tid}",
                     json={"event_type": "payment_succeeded", "txn_ref": ref, "signature": "whsec_test"})
    assert ok.status_code == 200 and ok.json()["status"] == "SUCCEEDED"
    inv2 = next(i for i in client.get("/api/v1/subledger/invoices", headers=_h(token, tid)).json() if i["id"] == inv["id"])
    assert inv2["status"] == "PAID" and float(inv2["amount_paid"]) == 90.0

    # Idempotent: replay does not double-apply.
    client.post(f"/api/v1/gateway/webhook/{tid}",
                json={"event_type": "payment_succeeded", "txn_ref": ref, "signature": "whsec_test"})
    inv3 = next(i for i in client.get("/api/v1/subledger/invoices", headers=_h(token, tid)).json() if i["id"] == inv["id"])
    assert float(inv3["amount_paid"]) == 90.0


def test_refund_restores_balance():
    token, tid, income = _ctx()
    _enable(token, tid)
    inv = _invoice(token, tid, income)
    ref = client.post("/api/v1/gateway/checkout", headers=_h(token, tid),
                      json={"invoice_id": inv["id"], "amount": "90.00"}).json()["txn_ref"]
    client.post(f"/api/v1/gateway/webhook/{tid}",
                json={"event_type": "payment_succeeded", "txn_ref": ref, "signature": "whsec_test"})
    txn = next(t for t in client.get("/api/v1/gateway/transactions", headers=_h(token, tid)).json()
               if t["txn_ref"] == ref)
    rf = client.post(f"/api/v1/gateway/transactions/{txn['id']}/refund", headers=_h(token, tid))
    assert rf.status_code == 200 and rf.json()["status"] == "REFUNDED"
    inv2 = next(i for i in client.get("/api/v1/subledger/invoices", headers=_h(token, tid)).json() if i["id"] == inv["id"])
    assert float(inv2["amount_paid"]) == 0.0 and inv2["status"] != "PAID"


def test_reconciliation_export():
    token, tid, income = _ctx()
    r = client.get("/api/v1/gateway/reconciliation/export", headers=_h(token, tid))
    assert r.status_code == 200 and r.content[:2] == b"PK"
