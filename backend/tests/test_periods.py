"""P16: Period close, GL lock-down, year-end roll-forward."""
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
    exp = next(c for c in client.get(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)).json()
               if c["natural_account_value"] == "5000" and c["fund_value"] == "OPER")
    return token, tid, exp


def _accounted_invoice(token, tid, exp, gl_date, sfx):
    """Create + approve an AP invoice → produces an APPROVED GL batch in the period."""
    vendor = client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"]
    inv = client.post("/api/v1/payables", headers=_h(token, tid), json={
        "vendor_id": vendor, "invoice_number": f"PER-{sfx}", "invoice_date": gl_date,
        "gl_date": gl_date,
        "lines": [{"amount": "100.00", "distributions": [{"code_combination_id": exp["id"], "amount": "100.00"}]}]}).json()
    client.post(f"/api/v1/payables/{inv['id']}/submit", headers=_h(token, tid))
    client.post(f"/api/v1/payables/{inv['id']}/approve", headers=_h(token, tid), json={"approve": True})
    return inv


def test_close_empty_period_and_block_when_open_batch_exists():
    token, tid, exp = _ctx()
    sfx = uuid.uuid4().hex[:6]
    # An empty period closes cleanly.
    empty = client.post("/api/v1/periods/SEP-2026/close", headers=_h(token, tid))
    assert empty.status_code == 200 and empty.json()["status"] == "CLOSED"

    # An accounted invoice leaves a DRAFT GL batch in OCT-2026 → close is blocked.
    _accounted_invoice(token, tid, exp, "2026-10-15", sfx)
    blocked = client.post("/api/v1/periods/OCT-2026/close", headers=_h(token, tid))
    assert blocked.status_code == 422
    assert "draft" in blocked.json()["detail"].lower()


def test_lockdown_blocks_accounting_into_closed_period():
    token, tid, exp = _ctx()
    sfx = uuid.uuid4().hex[:6]
    # Use a unique far-future period so cross-run DB state can't leave a draft batch
    # behind that would block the close and invalidate the test.
    year = 2100 + (int(uuid.uuid4().hex[:3], 16) % 800)
    period, gl_date = f"JAN-{year}", f"{year}-01-10"
    closed = client.post(f"/api/v1/periods/{period}/close", headers=_h(token, tid))
    assert closed.status_code == 200 and closed.json()["status"] == "CLOSED"

    vendor = client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"]
    inv = client.post("/api/v1/payables", headers=_h(token, tid), json={
        "vendor_id": vendor, "invoice_number": f"LOCK-{sfx}", "invoice_date": gl_date,
        "gl_date": gl_date,
        "lines": [{"amount": "50.00", "distributions": [{"code_combination_id": exp["id"], "amount": "50.00"}]}]}).json()
    client.post(f"/api/v1/payables/{inv['id']}/submit", headers=_h(token, tid))
    appr = client.post(f"/api/v1/payables/{inv['id']}/approve", headers=_h(token, tid), json={"approve": True})
    assert appr.status_code == 422  # accounting blocked: period closed

    # Reopen → accounting now succeeds.
    client.post(f"/api/v1/periods/{period}/reopen", headers=_h(token, tid))
    appr2 = client.post(f"/api/v1/payables/{inv['id']}/approve", headers=_h(token, tid), json={"approve": True})
    assert appr2.status_code == 200


def test_periods_list_and_checklist_export():
    token, tid, exp = _ctx()
    client.post("/api/v1/periods/JAN-2027/open", headers=_h(token, tid))
    periods = client.get("/api/v1/periods", headers=_h(token, tid)).json()
    assert any(p["period_name"] == "JAN-2027" for p in periods)
    r = client.get("/api/v1/periods/checklist/export", headers=_h(token, tid))
    assert r.status_code == 200 and r.content[:2] == b"PK"


def test_year_end_close_needs_retained_earnings_account():
    token, tid, exp = _ctx()
    # No 3000/OPER account is seeded → year-end close returns a clear error.
    r = client.post("/api/v1/periods/year-end-close?year=2026", headers=_h(token, tid))
    assert r.status_code == 422
    assert "Retained Earnings" in r.json()["detail"] or "income/expense" in r.json()["detail"]
