"""AP configuration: payment terms, vendor types, distribution sets, 1099."""
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


def _combo(token, tid, sid, natural, fund="OPER"):
    return next(c["id"] for c in client.get(f"/api/v1/coa/structures/{sid}/combinations",
               headers=_h(token, tid)).json()
               if c["natural_account_value"] == natural and c["fund_value"] == fund)


def test_payment_terms_and_vendor_types_and_1099_vendor():
    token, tid, sid = _ctx()
    sfx = uuid.uuid4().hex[:5]
    term = client.post("/api/v1/ap-config/payment-terms", headers=_h(token, tid),
                       json={"name": f"NET45-{sfx}", "due_days": 45})
    assert term.status_code == 201, term.text
    vt = client.post("/api/v1/ap-config/vendor-types", headers=_h(token, tid),
                     json={"code": f"SNOW-{sfx}", "name": "Contracted Snow"})
    assert vt.status_code == 201, vt.text

    # Vendor with term, type, 1099 + tax id.
    v = client.post("/api/v1/vendors", headers=_h(token, tid), json={
        "vendor_number": f"V1099-{sfx}", "name": "Frosty Snow Removal",
        "tax_id": "12-3456789", "payment_term_id": term.json()["id"],
        "vendor_type_id": vt.json()["id"], "is_1099": True, "income_tax_type": "1099-NEC",
        "state_reportable": True, "tax_reporting_name": "Frosty Snow LLC",
    })
    assert v.status_code == 201, v.text
    assert v.json()["is_1099"] is True and v.json()["payment_term_id"] == term.json()["id"]


def test_distribution_set_validation_and_use_on_invoice():
    token, tid, sid = _ctx()
    sfx = uuid.uuid4().hex[:5]
    exp1, exp2 = _combo(token, tid, sid, "5000"), _combo(token, tid, sid, "5100")

    # Percentages must total 100.
    bad = client.post("/api/v1/ap-config/distribution-sets", headers=_h(token, tid), json={
        "name": f"BAD-{sfx}",
        "lines": [{"code_combination_id": exp1, "percent": "60"},
                  {"code_combination_id": exp2, "percent": "30"}]})
    assert bad.status_code == 422

    dset = client.post("/api/v1/ap-config/distribution-sets", headers=_h(token, tid), json={
        "name": f"Landscaping-{sfx}", "description": "Split across cost centers",
        "lines": [{"code_combination_id": exp1, "percent": "60"},
                  {"code_combination_id": exp2, "percent": "40"}]})
    assert dset.status_code == 201, dset.text

    # Term so the invoice due date is derived; vendor uses it.
    term = client.post("/api/v1/ap-config/payment-terms", headers=_h(token, tid),
                       json={"name": f"NET30-{sfx}", "due_days": 30}).json()
    vendor = client.post("/api/v1/vendors", headers=_h(token, tid), json={
        "vendor_number": f"VDS-{sfx}", "name": "GreenScape", "payment_term_id": term["id"]}).json()

    # Invoice line uses the distribution set (no explicit distributions).
    inv = client.post("/api/v1/payables", headers=_h(token, tid), json={
        "vendor_id": vendor["id"], "invoice_number": f"DS-{sfx}",
        "invoice_date": "2026-05-01", "gl_date": "2026-05-01",
        "lines": [{"amount": "1000.00", "distribution_set_id": dset.json()["id"]}]})
    assert inv.status_code == 201, inv.text          # 600/400 split summed to 1000
    assert inv.json()["due_date"] == "2026-05-31"     # invoice_date + 30 days


def test_1099_report_export():
    token, tid, sid = _ctx()
    r = client.get("/api/v1/ap-config/1099/export", headers=_h(token, tid), params={"year": 2026})
    assert r.status_code == 200 and r.content[:2] == b"PK"
