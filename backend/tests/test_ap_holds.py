"""P8: AP invoice holds, basic tax, invoice register + distribution reports."""
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
    exp = next(c["id"] for c in client.get(f"/api/v1/coa/structures/{sid}/combinations",
              headers=_h(token, tid)).json()
              if c["natural_account_value"] == "5000" and c["fund_value"] == "OPER")
    return token, tid, exp


def test_tax_hold_and_release():
    token, tid, exp = _ctx()
    sfx = uuid.uuid4().hex[:6]
    vendor = client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"]
    inv = client.post("/api/v1/payables", headers=_h(token, tid), json={
        "vendor_id": vendor, "invoice_number": f"HOLD-{sfx}",
        "invoice_date": "2026-05-01", "gl_date": "2026-05-01", "tax_amount": "8.50",
        "lines": [{"amount": "100.00", "distributions": [{"code_combination_id": exp, "amount": "100.00"}]}],
    }).json()
    assert inv["tax_amount"] == "8.50" and inv["on_hold"] is False
    iid = inv["id"]

    # Place hold → submit blocked.
    h = client.post(f"/api/v1/payables/{iid}/hold", headers=_h(token, tid), json={"reason": "Awaiting W-9"})
    assert h.status_code == 200 and h.json()["on_hold"] is True
    blocked = client.post(f"/api/v1/payables/{iid}/submit", headers=_h(token, tid))
    assert blocked.status_code == 422

    # Release → submit allowed.
    r = client.post(f"/api/v1/payables/{iid}/release-hold", headers=_h(token, tid))
    assert r.status_code == 200 and r.json()["on_hold"] is False
    s = client.post(f"/api/v1/payables/{iid}/submit", headers=_h(token, tid))
    assert s.status_code == 200


def test_ap_invoice_reports():
    token, tid, _ = _ctx()
    for path in ("register/export?start=2026-01-01&end=2026-12-31",
                 "distributions/export?start=2026-01-01&end=2026-12-31"):
        r = client.get(f"/api/v1/payables/{path}", headers=_h(token, tid))
        assert r.status_code == 200 and r.content[:2] == b"PK", path
