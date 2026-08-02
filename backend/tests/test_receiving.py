"""P13: Receiving module + true 3-way matching activation (2-way preserved)."""
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
    cc = next(c for c in client.get(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)).json()
              if c["natural_account_value"] == "5000" and c["fund_value"] == "OPER")
    return token, tid, cc


def _approved_po(token, tid, cc, qty, price):
    po = client.post("/api/v1/purchasing", headers=_h(token, tid), json={
        "vendor_id": client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"],
        "order_date": "2026-01-01",
        "lines": [{"item_description": "Widgets", "quantity": str(qty), "unit_price": str(price),
                   "distributions": [{"code_combination_id": cc["id"], "amount": str(qty * price)}]}],
    }).json()
    client.post(f"/api/v1/purchasing/{po['id']}/submit", headers=_h(token, tid))
    client.post(f"/api/v1/purchasing/{po['id']}/approve", headers=_h(token, tid), json={"approve": True})
    return client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()


def _set_require_receipt(token, tid, flag):
    client.put("/api/v1/ap-config/match-tolerance", headers=_h(token, tid),
               json={"amount_tolerance_pct": "0", "quantity_tolerance_pct": "0", "require_receipt": flag})


def test_receipt_updates_quantity_received():
    token, tid, cc = _ctx()
    po = _approved_po(token, tid, cc, 10, 100)  # 10 @ $100 = $1000
    line = po["lines"][0]
    rc = client.post("/api/v1/receiving", headers=_h(token, tid), json={
        "po_header_id": po["id"], "received_date": "2026-02-01",
        "lines": [{"po_line_id": line["id"], "quantity": "4"}]})
    assert rc.status_code == 201, rc.text
    assert rc.json()["status"] == "ACCEPTED"
    detail = client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()
    assert detail["lines"][0]["distributions"][0]["quantity_received"] == "4.0000"


def test_inspection_gates_credit():
    token, tid, cc = _ctx()
    po = _approved_po(token, tid, cc, 5, 50)
    line = po["lines"][0]
    rc = client.post("/api/v1/receiving", headers=_h(token, tid), json={
        "po_header_id": po["id"], "received_date": "2026-02-01", "needs_inspection": True,
        "lines": [{"po_line_id": line["id"], "quantity": "5"}]}).json()
    assert rc["status"] == "PENDING_INSPECTION"
    # Not credited yet.
    d1 = client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()
    assert d1["lines"][0]["distributions"][0]["quantity_received"] == "0.0000"
    # Accept → credited.
    client.post(f"/api/v1/receiving/{rc['id']}/accept", headers=_h(token, tid))
    d2 = client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()
    assert d2["lines"][0]["distributions"][0]["quantity_received"] == "5.0000"


def test_three_way_matching_blocks_then_allows():
    token, tid, cc = _ctx()
    _set_require_receipt(token, tid, True)
    try:
        po = _approved_po(token, tid, cc, 10, 100)  # $1000 PO
        line = po["lines"][0]
        vendor = po["vendor_id"]
        sfx = uuid.uuid4().hex[:6]
        # No receipt yet → invoice matched to PO should be held (match exception).
        inv = client.post("/api/v1/payables", headers=_h(token, tid), json={
            "vendor_id": vendor, "invoice_number": f"3W-{sfx}", "invoice_date": "2026-02-10",
            "gl_date": "2026-02-10", "po_header_id": po["id"],
            "lines": [{"amount": "300.00", "po_line_id": line["id"]}]}).json()
        assert inv["match_status"] == "MATCH_EXCEPTION" and inv["on_hold"] is True

        # Receive $400 worth → a $300 invoice now matches.
        client.post("/api/v1/receiving", headers=_h(token, tid), json={
            "po_header_id": po["id"], "received_date": "2026-02-05",
            "lines": [{"po_line_id": line["id"], "quantity": "4"}]})
        inv2 = client.post("/api/v1/payables", headers=_h(token, tid), json={
            "vendor_id": vendor, "invoice_number": f"3Wb-{sfx}", "invoice_date": "2026-02-10",
            "gl_date": "2026-02-10", "po_header_id": po["id"],
            "lines": [{"amount": "300.00", "po_line_id": line["id"]}]}).json()
        assert inv2["match_status"] == "MATCHED" and inv2["on_hold"] is False
    finally:
        _set_require_receipt(token, tid, False)


def test_two_way_unaffected_when_receipt_not_required():
    token, tid, cc = _ctx()
    _set_require_receipt(token, tid, False)
    po = _approved_po(token, tid, cc, 10, 100)
    line = po["lines"][0]
    sfx = uuid.uuid4().hex[:6]
    inv = client.post("/api/v1/payables", headers=_h(token, tid), json={
        "vendor_id": po["vendor_id"], "invoice_number": f"2W-{sfx}", "invoice_date": "2026-02-10",
        "gl_date": "2026-02-10", "po_header_id": po["id"],
        "lines": [{"amount": "300.00", "po_line_id": line["id"]}]}).json()
    assert inv["match_status"] == "MATCHED" and inv["on_hold"] is False


def test_receiving_register_export():
    token, tid, cc = _ctx()
    r = client.get("/api/v1/receiving/register/export?start=2026-01-01&end=2026-12-31",
                   headers=_h(token, tid))
    assert r.status_code == 200 and r.content[:2] == b"PK"
