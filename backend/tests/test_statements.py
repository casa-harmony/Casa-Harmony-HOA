"""P25: AR statement batch run + delivery tracking + opt-out."""
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
    income = next(c["id"] for c in client.get(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)).json()
                  if c["natural_account_value"] == "4000" and c["fund_value"] == "OPER")
    return token, tid, income


def _homeowner(token, tid, income, email):
    sfx = uuid.uuid4().hex[:6]
    ho = client.post("/api/v1/subledger/homeowners", headers=_h(token, tid), json={
        "account_number": f"ST-{sfx}", "first_name": "State", "last_name": "Ment",
        "property_unit": f"S{sfx[:3]}", "email": email}).json()
    plan = client.post("/api/v1/ar-billing/plans", headers=_h(token, tid), json={
        "name": f"ST {sfx}", "lines": [{"income_combination_id": income, "amount": "90.00"}]}).json()
    client.post(f"/api/v1/ar-billing/plans/{plan['id']}/run", headers=_h(token, tid),
                json={"invoice_date": "2025-01-01", "due_days": 30, "homeowner_ids": [ho["id"]]})
    return ho


def test_statement_run_emails_and_tracks():
    token, tid, income = _ctx()
    ho = _homeowner(token, tid, income, "owner@example.com")
    run = client.post("/api/v1/statements/run", headers=_h(token, tid),
                      json={"as_of": "2025-06-30", "send_email": True, "homeowner_ids": [ho["id"]]})
    assert run.status_code == 201, run.text
    body = run.json()
    assert body["generated"] == 1 and body["sent"] == 1
    deliv = client.get(f"/api/v1/statements/runs/{body['id']}/deliveries", headers=_h(token, tid)).json()
    assert deliv[0]["status"] == "SENT" and float(deliv[0]["balance"]) == 90.0
    rep = client.get(f"/api/v1/statements/runs/{body['id']}/report/export", headers=_h(token, tid))
    assert rep.status_code == 200 and rep.content[:2] == b"PK"


def test_opt_out_skips():
    token, tid, income = _ctx()
    ho = _homeowner(token, tid, income, "skip@example.com")
    client.post("/api/v1/statements/opt-out", headers=_h(token, tid),
                json={"homeowner_id": ho["id"], "opt_out": True})
    run = client.post("/api/v1/statements/run", headers=_h(token, tid),
                      json={"as_of": "2025-06-30", "send_email": True, "homeowner_ids": [ho["id"]]}).json()
    assert run["skipped"] == 1 and run["sent"] == 0
    deliv = client.get(f"/api/v1/statements/runs/{run['id']}/deliveries", headers=_h(token, tid)).json()
    assert deliv[0]["status"] == "SKIPPED_OPTOUT"


def test_no_email_recorded():
    token, tid, income = _ctx()
    ho = _homeowner(token, tid, income, None)
    run = client.post("/api/v1/statements/run", headers=_h(token, tid),
                      json={"as_of": "2025-06-30", "send_email": True, "homeowner_ids": [ho["id"]]}).json()
    deliv = client.get(f"/api/v1/statements/runs/{run['id']}/deliveries", headers=_h(token, tid)).json()
    assert deliv[0]["status"] == "NO_EMAIL"
