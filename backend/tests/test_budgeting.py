"""P17: Budget versions, spread, approval, Budget-vs-Actual, budgetary control."""
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
    exp = next(c for c in client.get(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)).json()
               if c["natural_account_value"] == "5000" and c["fund_value"] == "OPER")
    return token, tid, exp


def _approved_version(token, tid, exp, annual, controlling=True):
    sfx = uuid.uuid4().hex[:6]
    v = client.post("/api/v1/budgeting/versions", headers=_h(token, tid), json={
        "name": f"FY26 {sfx}", "fiscal_year": 2026, "version_type": "ORIGINAL"}).json()
    client.post(f"/api/v1/budgeting/versions/{v['id']}/spread", headers=_h(token, tid),
                json={"code_combination_id": exp["id"], "annual_amount": annual, "method": "EVEN"})
    client.post(f"/api/v1/budgeting/versions/{v['id']}/submit", headers=_h(token, tid))
    client.post(f"/api/v1/budgeting/versions/{v['id']}/approve", headers=_h(token, tid),
                json={"approve": True, "make_controlling": controlling})
    return v


def test_version_spread_and_approve():
    token, tid, exp = _ctx()
    v = client.post("/api/v1/budgeting/versions", headers=_h(token, tid), json={
        "name": f"Budget {uuid.uuid4().hex[:6]}", "fiscal_year": 2026}).json()
    sp = client.post(f"/api/v1/budgeting/versions/{v['id']}/spread", headers=_h(token, tid),
                     json={"code_combination_id": exp["id"], "annual_amount": "1200.00", "method": "EVEN"})
    assert sp.status_code == 200
    detail = client.get(f"/api/v1/budgeting/versions/{v['id']}", headers=_h(token, tid)).json()
    assert len(detail["lines"]) == 12
    assert sum(float(l["amount"]) for l in detail["lines"]) == 1200.0

    client.post(f"/api/v1/budgeting/versions/{v['id']}/submit", headers=_h(token, tid))
    ap = client.post(f"/api/v1/budgeting/versions/{v['id']}/approve", headers=_h(token, tid),
                     json={"approve": True, "make_controlling": True})
    assert ap.status_code == 200 and ap.json()["status"] == "APPROVED" and ap.json()["is_controlling"]

    # Approved versions are locked for spread edits.
    locked = client.post(f"/api/v1/budgeting/versions/{v['id']}/spread", headers=_h(token, tid),
                         json={"code_combination_id": exp["id"], "annual_amount": "5.00"})
    assert locked.status_code == 422


def test_budget_vs_actual_and_exports():
    token, tid, exp = _ctx()
    v = _approved_version(token, tid, exp, "1200.00", controlling=False)
    rows = client.get(f"/api/v1/budgeting/versions/{v['id']}/vs-actual", headers=_h(token, tid)).json()
    mine = next(r for r in rows if r["code_combination_id"] == exp["id"])
    assert float(mine["budget"]) == 1200.0
    for path in ("vs-actual/export", "spread/export"):
        r = client.get(f"/api/v1/budgeting/versions/{v['id']}/{path}", headers=_h(token, tid))
        assert r.status_code == 200 and r.content[:2] == b"PK", path


def test_absolute_budget_control_blocks_over_budget_po():
    token, tid, exp = _ctx()
    v = _approved_version(token, tid, exp, "1000.00", controlling=True)
    client.put("/api/v1/budgeting/control", headers=_h(token, tid),
               json={"mode": "ABSOLUTE", "controlling_version_id": v["id"]})
    try:
        vendor = client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"]
        # A $5,000 PO on the budgeted account far exceeds the $1,000 budget.
        po = client.post("/api/v1/purchasing", headers=_h(token, tid), json={
            "vendor_id": vendor, "order_date": "2026-01-01",
            "lines": [{"item_description": "Over", "quantity": "1", "unit_price": "5000.00",
                       "distributions": [{"code_combination_id": exp["id"], "amount": "5000.00"}]}]}).json()
        # No PO hierarchy → submit auto-approves and runs the budget check, which blocks.
        sub = client.post(f"/api/v1/purchasing/{po['id']}/submit", headers=_h(token, tid))
        assert sub.status_code == 422 and "budget" in sub.json()["detail"].lower()
        # PO did not become APPROVED.
        cur = client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()
        assert cur["status"] != "APPROVED"
    finally:
        client.put("/api/v1/budgeting/control", headers=_h(token, tid),
                   json={"mode": "NONE", "controlling_version_id": None})


def test_advisory_mode_allows_but_flags():
    token, tid, exp = _ctx()
    v = _approved_version(token, tid, exp, "1000.00", controlling=True)
    client.put("/api/v1/budgeting/control", headers=_h(token, tid),
               json={"mode": "ADVISORY", "controlling_version_id": v["id"]})
    try:
        vendor = client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"]
        po = client.post("/api/v1/purchasing", headers=_h(token, tid), json={
            "vendor_id": vendor, "order_date": "2026-01-01",
            "lines": [{"item_description": "Over", "quantity": "1", "unit_price": "9000.00",
                       "distributions": [{"code_combination_id": exp["id"], "amount": "9000.00"}]}]}).json()
        sub = client.post(f"/api/v1/purchasing/{po['id']}/submit", headers=_h(token, tid))
        assert sub.status_code == 200  # advisory: allowed (Board flagged via notification)
        cur = client.get(f"/api/v1/purchasing/{po['id']}", headers=_h(token, tid)).json()
        assert cur["status"] == "APPROVED"
    finally:
        client.put("/api/v1/budgeting/control", headers=_h(token, tid),
                   json={"mode": "NONE", "controlling_version_id": None})
