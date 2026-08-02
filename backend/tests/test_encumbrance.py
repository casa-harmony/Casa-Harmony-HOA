"""P15: Encumbrance / Commitment accounting — encumber on approval, liquidate on bill."""
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
    combos = client.get(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)).json()
    exp = next(c for c in combos if c["natural_account_value"] == "5000" and c["fund_value"] == "OPER")
    ap = next(c for c in combos if c["natural_account_value"] == "2000" and c["fund_value"] == "OPER")
    return token, tid, exp, ap


def _approved_po(token, tid, exp, amount):
    vendor = client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"]
    po = client.post("/api/v1/purchasing", headers=_h(token, tid), json={
        "vendor_id": vendor, "order_date": "2026-01-01",
        "lines": [{"item_description": "Svc", "quantity": "1", "unit_price": str(amount),
                   "distributions": [{"code_combination_id": exp["id"], "amount": str(amount)}]}]}).json()
    client.post(f"/api/v1/purchasing/{po['id']}/submit", headers=_h(token, tid))
    client.post(f"/api/v1/purchasing/{po['id']}/approve", headers=_h(token, tid), json={"approve": True})
    return po, vendor


def test_encumber_on_approval_and_liquidate_on_billing():
    token, tid, exp, ap = _ctx()
    # Enable encumbrance GL with two existing accounts.
    client.put("/api/v1/encumbrance/settings", headers=_h(token, tid), json={
        "enabled": True, "encumbrance_combination_id": exp["id"], "reserve_combination_id": ap["id"]})

    po, vendor = _approved_po(token, tid, exp, "1000.00")
    encs = client.get("/api/v1/encumbrance", headers=_h(token, tid)).json()
    mine = next(e for e in encs if e["po_header_id"] == po["id"])
    assert float(mine["encumbered_amount"]) == 1000.0
    assert float(mine["open_commitment"]) == 1000.0

    # Bill $300 against the PO → encumbrance liquidates by 300.
    sfx = uuid.uuid4().hex[:6]
    inv = client.post("/api/v1/payables", headers=_h(token, tid), json={
        "vendor_id": vendor, "invoice_number": f"ENC-{sfx}", "invoice_date": "2026-02-01",
        "gl_date": "2026-02-01", "po_header_id": po["id"],
        "lines": [{"amount": "300.00", "po_line_id": po and client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()["lines"][0]["id"]}]}).json()
    client.post(f"/api/v1/payables/{inv['id']}/submit", headers=_h(token, tid))
    client.post(f"/api/v1/payables/{inv['id']}/approve", headers=_h(token, tid), json={"approve": True})

    encs2 = client.get("/api/v1/encumbrance", headers=_h(token, tid)).json()
    mine2 = next(e for e in encs2 if e["po_header_id"] == po["id"])
    assert float(mine2["liquidated_amount"]) == 300.0
    assert float(mine2["open_commitment"]) == 700.0


def test_commitments_and_register():
    token, tid, exp, ap = _ctx()
    _approved_po(token, tid, exp, "500.00")
    rows = client.get("/api/v1/encumbrance/commitments", headers=_h(token, tid)).json()
    assert any(r["fund_value"] == "OPER" for r in rows)
    r = client.get("/api/v1/encumbrance/register/export", headers=_h(token, tid))
    assert r.status_code == 200 and r.content[:2] == b"PK"


def test_disabled_by_default_tracks_without_gl():
    token, tid, exp, ap = _ctx()
    # Reset to disabled — encumbrance ledger still records, no GL needed.
    client.put("/api/v1/encumbrance/settings", headers=_h(token, tid), json={"enabled": False})
    po, _ = _approved_po(token, tid, exp, "250.00")
    encs = client.get("/api/v1/encumbrance", headers=_h(token, tid)).json()
    mine = next(e for e in encs if e["po_header_id"] == po["id"])
    assert float(mine["encumbered_amount"]) == 250.0 and mine["status"] == "OPEN"
