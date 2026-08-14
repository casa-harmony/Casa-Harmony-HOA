"""AP Payments: methods, payable selection, create, void, batch, reports, 1099 basis."""
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
    tid = next(t for t in client.get("/api/v1/tenants?include_demo=true",
               headers={"Authorization": f"Bearer {token}"}).json()
               if t["slug"] == "casa-harmony")["id"]
    sid = client.get("/api/v1/coa/structures", headers=_h(token, tid)).json()[0]["id"]
    return token, tid, sid


def _expense(token, tid, sid):
    return next(c["id"] for c in client.get(f"/api/v1/coa/structures/{sid}/combinations",
               headers=_h(token, tid)).json()
               if c["natural_account_value"] == "5000" and c["fund_value"] == "OPER")


def _approved_invoice(token, tid, exp, vendor_id, amount, sfx):
    """Create → submit → approve an AP invoice so it becomes ACCOUNTED (payable)."""
    inv = client.post("/api/v1/payables", headers=_h(token, tid), json={
        "vendor_id": vendor_id, "invoice_number": f"PAYINV-{sfx}",
        "invoice_date": "2026-05-01", "gl_date": "2026-05-01",
        "lines": [{"amount": amount, "distributions": [{"code_combination_id": exp, "amount": amount}]}],
    }).json()
    client.post(f"/api/v1/payables/{inv['id']}/submit", headers=_h(token, tid))
    client.post(f"/api/v1/payables/{inv['id']}/approve", headers=_h(token, tid), json={"approve": True})
    return inv["id"]


def test_payment_create_void_and_payable_selection():
    token, tid, sid = _ctx()
    exp = _expense(token, tid, sid)
    sfx = uuid.uuid4().hex[:6]
    vendor = client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"]
    method = client.post("/api/v1/ap-config/payment-methods", headers=_h(token, tid),
                         json={"code": f"CHK-{sfx}", "name": "Check", "method_type": "CHECK"}).json()
    inv_id = _approved_invoice(token, tid, exp, vendor, "500.00", sfx)

    # Payable selection lists the accounted invoice.
    payable = client.get("/api/v1/ap-payments/payable", headers=_h(token, tid),
                         params={"vendor_id": vendor}).json()
    assert any(p["invoice_id"] == inv_id and float(p["amount_remaining"]) == 500.0 for p in payable)

    # Create the payment (full).
    pay = client.post("/api/v1/ap-payments", headers=_h(token, tid), json={
        "vendor_id": vendor, "payment_method_id": method["id"], "payment_date": "2026-05-20",
        "reference": "1001", "applications": [{"invoice_id": inv_id, "amount": "500.00"}]})
    assert pay.status_code == 201, pay.text
    assert pay.json()["status"] == "CREATED" and pay.json()["gl_je_header_id"]
    pid = pay.json()["id"]

    # No longer payable; invoice is PAID.
    payable2 = client.get("/api/v1/ap-payments/payable", headers=_h(token, tid),
                          params={"vendor_id": vendor}).json()
    assert not any(p["invoice_id"] == inv_id for p in payable2)
    inv = next(i for i in client.get("/api/v1/payables", headers=_h(token, tid)).json() if i["id"] == inv_id)
    assert inv["status"] == "PAID"

    # Void → reopens the payable, invoice back to ACCOUNTED.
    v = client.post(f"/api/v1/ap-payments/{pid}/void", headers=_h(token, tid))
    assert v.status_code == 200 and v.json()["status"] == "VOID"
    payable3 = client.get("/api/v1/ap-payments/payable", headers=_h(token, tid),
                          params={"vendor_id": vendor}).json()
    assert any(p["invoice_id"] == inv_id for p in payable3)


def test_overpay_rejected():
    token, tid, sid = _ctx()
    exp = _expense(token, tid, sid)
    sfx = uuid.uuid4().hex[:6]
    vendor = client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"]
    inv_id = _approved_invoice(token, tid, exp, vendor, "200.00", sfx)
    r = client.post("/api/v1/ap-payments", headers=_h(token, tid), json={
        "vendor_id": vendor, "payment_date": "2026-05-20",
        "applications": [{"invoice_id": inv_id, "amount": "999.00"}]})
    assert r.status_code == 422


def test_payment_reports_export():
    token, tid, sid = _ctx()
    for path in ("register/export?start=2026-01-01&end=2026-12-31",
                 "aged-payables/export", "cash-requirements/export"):
        r = client.get(f"/api/v1/ap-payments/{path}", headers=_h(token, tid))
        assert r.status_code == 200 and r.content[:2] == b"PK", path


def test_1099_is_payment_basis():
    token, tid, sid = _ctx()
    exp = _expense(token, tid, sid)
    sfx = uuid.uuid4().hex[:6]
    # A 1099 vendor, invoice, approve, then pay in 2026.
    v = client.post("/api/v1/vendors", headers=_h(token, tid), json={
        "vendor_number": f"T99-{sfx}", "name": "Niner Vendor", "tax_id": "99-9999999",
        "is_1099": True, "income_tax_type": "1099-NEC"}).json()
    inv_id = _approved_invoice(token, tid, exp, v["id"], "750.00", sfx)
    client.post("/api/v1/ap-payments", headers=_h(token, tid), json={
        "vendor_id": v["id"], "payment_date": "2026-06-01",
        "applications": [{"invoice_id": inv_id, "amount": "750.00"}]})
    r = client.get("/api/v1/ap-config/1099/export", headers=_h(token, tid), params={"year": 2026})
    assert r.status_code == 200 and r.content[:2] == b"PK"
