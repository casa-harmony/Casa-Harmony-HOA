"""P12: differentiated approval, cancellation+reversal, PO lifecycle, budget sweep."""
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
        "lines": [{"item_description": "Svc", "quantity": "1", "unit_price": str(line_amount),
                   "distributions": [{"code_combination_id": cc["id"], "amount": str(line_amount)}]}],
    }).json()
    client.post(f"/api/v1/purchasing/{po['id']}/submit", headers=_h(token, tid))
    po = client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()
    if po["status"] != "APPROVED":
        client.post(f"/api/v1/purchasing/{po['id']}/approve", headers=_h(token, tid), json={"approve": True})
        po = client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()
    return po


def _matched_invoice(token, tid, po, amount, sfx):
    return client.post("/api/v1/payables", headers=_h(token, tid), json={
        "vendor_id": po["vendor_id"], "invoice_number": f"INT-{sfx}",
        "invoice_date": "2026-03-01", "gl_date": "2026-03-01", "po_header_id": po["id"],
        "lines": [{"amount": amount, "po_line_id": po["lines"][0]["id"]}]}).json()


def test_matched_invoice_is_fast_tracked():
    token, tid, cc = _ctx()
    sfx = uuid.uuid4().hex[:6]
    po = _approved_po(token, tid, cc, limit=50000, line_amount=50000)
    inv = _matched_invoice(token, tid, po, "10000.00", sfx)
    # Submit a MATCHED invoice → auto-approved (no manual approval needed).
    r = client.post(f"/api/v1/payables/{inv['id']}/submit", headers=_h(token, tid))
    assert r.status_code == 200, r.text
    assert r.json()["approval_status"] == "APPROVED"
    assert r.json()["status"] in ("APPROVED", "ACCOUNTED")
    po2 = client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()
    assert float(po2["billed_amount"]) == 10000.0


def test_cancel_reverses_po_billing():
    token, tid, cc = _ctx()
    sfx = uuid.uuid4().hex[:6]
    po = _approved_po(token, tid, cc, limit=50000, line_amount=50000)
    inv = _matched_invoice(token, tid, po, "15000.00", sfx)
    client.post(f"/api/v1/payables/{inv['id']}/submit", headers=_h(token, tid))
    assert float(client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()["billed_amount"]) == 15000.0

    # Cancel → PO billing reversed, PO re-billable.
    c = client.post(f"/api/v1/payables/{inv['id']}/cancel", headers=_h(token, tid))
    assert c.status_code == 200 and c.json()["status"] == "CANCELLED"
    po2 = client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()
    assert float(po2["billed_amount"]) == 0.0
    assert po2["status"] == "APPROVED"


def test_po_close_and_filters():
    token, tid, cc = _ctx()
    po = _approved_po(token, tid, cc, limit=1000, line_amount=1000)
    # Timeframe + remaining filters.
    active = client.get("/api/v1/purchasing", headers=_h(token, tid),
                        params={"active_on": "2026-06-01", "min_remaining": "500"}).json()
    assert any(p["id"] == po["id"] for p in active)
    # Close.
    r = client.post(f"/api/v1/purchasing/{po['id']}/close", headers=_h(token, tid))
    assert r.status_code == 200 and r.json()["status"] == "CLOSED"


def test_budget_sweep_and_contract_utilization():
    token, tid, cc = _ctx()
    sfx = uuid.uuid4().hex[:6]
    # Bill a contract to 100% then run the sweep → alert raised.
    po = _approved_po(token, tid, cc, limit=2000, line_amount=2000)
    inv = _matched_invoice(token, tid, po, "2000.00", sfx)
    client.post(f"/api/v1/payables/{inv['id']}/submit", headers=_h(token, tid))
    r = client.post("/api/v1/purchasing/run-budget-checks", headers=_h(token, tid))
    assert r.status_code == 200 and r.json()["alerts_raised"] >= 1
    rep = client.get("/api/v1/purchasing/reports/contract-utilization", headers=_h(token, tid))
    assert rep.status_code == 200 and rep.content[:2] == b"PK"
