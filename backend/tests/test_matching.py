"""P11: matching engine — distribution inheritance, billing rollup, budget overrun hold."""
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


def _approved_po(token, tid, cc, *, limit, line_amount):
    po = client.post("/api/v1/purchasing", headers=_h(token, tid), json={
        "vendor_id": client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"],
        "order_date": "2026-01-01", "document_type": "CONTRACT",
        "start_date": "2026-01-01", "end_date": "2026-12-31", "amount_limit": str(limit),
        "lines": [{"item_description": "Service", "quantity": "1", "unit_price": str(line_amount),
                   "distributions": [{"code_combination_id": cc["id"], "amount": str(line_amount)}]}],
    }).json()
    client.post(f"/api/v1/purchasing/{po['id']}/submit", headers=_h(token, tid))
    po = client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()
    if po["status"] != "APPROVED":
        client.post(f"/api/v1/purchasing/{po['id']}/approve", headers=_h(token, tid), json={"approve": True})
        po = client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()
    return po


def _invoice_matched(token, tid, po, amount, sfx, *, inherit=True):
    line = {"amount": amount, "po_line_id": po["lines"][0]["id"]}
    if not inherit:
        cc_id = po["lines"][0]["distributions"][0]["code_combination_id"]
        line["distributions"] = [{"code_combination_id": cc_id, "amount": amount}]
    return client.post("/api/v1/payables", headers=_h(token, tid), json={
        "vendor_id": po["vendor_id"], "invoice_number": f"MINV-{sfx}",
        "invoice_date": "2026-03-01", "gl_date": "2026-03-01", "po_header_id": po["id"],
        "lines": [line]})


def test_match_inherit_and_billing_rollup():
    token, tid, cc = _ctx()
    sfx = uuid.uuid4().hex[:6]
    po = _approved_po(token, tid, cc, limit=100000, line_amount=100000)
    # Matched invoice inheriting PO distributions.
    r = _invoice_matched(token, tid, po, "20000.00", sfx)
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["match_status"] == "MATCHED" and inv["on_hold"] is False
    # Approve → bills the PO.
    client.post(f"/api/v1/payables/{inv['id']}/submit", headers=_h(token, tid))
    client.post(f"/api/v1/payables/{inv['id']}/approve", headers=_h(token, tid), json={"approve": True})
    after = client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()
    assert float(after["billed_amount"]) == 20000.0
    assert after["status"] == "PARTIALLY_BILLED"
    assert float(after["lines"][0]["distributions"][0]["amount_billed"]) == 20000.0


def test_budget_overrun_puts_invoice_on_hold():
    token, tid, cc = _ctx()
    sfx = uuid.uuid4().hex[:6]
    po = _approved_po(token, tid, cc, limit=5000, line_amount=5000)
    # Invoice exceeds the remaining limit → exception + hold.
    r = _invoice_matched(token, tid, po, "9000.00", sfx, inherit=False)
    assert r.status_code == 201, r.text
    inv = r.json()
    assert inv["match_status"] == "MATCH_EXCEPTION" and inv["on_hold"] is True
    # Held invoice cannot be submitted.
    blocked = client.post(f"/api/v1/payables/{inv['id']}/submit", headers=_h(token, tid))
    assert blocked.status_code == 422


def test_tolerance_allows_small_overage():
    token, tid, cc = _ctx()
    sfx = uuid.uuid4().hex[:6]
    # Allow 10% amount tolerance.
    client.put("/api/v1/ap-config/match-tolerance", headers=_h(token, tid),
               json={"amount_tolerance_pct": "10", "quantity_tolerance_pct": "0", "require_receipt": False})
    po = _approved_po(token, tid, cc, limit=1000, line_amount=1000)
    r = _invoice_matched(token, tid, po, "1050.00", sfx, inherit=False)  # 5% over, within 10%
    assert r.status_code == 201 and r.json()["match_status"] == "MATCHED"
    # Reset tolerance to 0 so other tests are unaffected.
    client.put("/api/v1/ap-config/match-tolerance", headers=_h(token, tid),
               json={"amount_tolerance_pct": "0", "quantity_tolerance_pct": "0", "require_receipt": False})


def test_po_reports_and_notifications_endpoints():
    token, tid, _ = _ctx()
    for path in ("commitment-register", "variance-by-contract", "cost-center-utilization",
                 "matched-summary", "activity-log"):
        r = client.get(f"/api/v1/purchasing/reports/{path}", headers=_h(token, tid))
        assert r.status_code == 200 and r.content[:2] == b"PK", path
    n = client.get("/api/v1/notifications", headers=_h(token, tid))
    assert n.status_code == 200
