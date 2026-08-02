"""P24: board/exec reporting — delinquency packet PDF, cash-flow forecast, dashboard."""
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
    income = next(c["id"] for c in client.get(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)).json()
                  if c["natural_account_value"] == "4000" and c["fund_value"] == "OPER")
    return token, tid, income


def _bill(token, tid, income):
    sfx = uuid.uuid4().hex[:6]
    ho = client.post("/api/v1/subledger/homeowners", headers=_h(token, tid), json={
        "account_number": f"BR-{sfx}", "first_name": "Bo", "last_name": "Ard", "property_unit": f"B{sfx[:3]}"}).json()
    plan = client.post("/api/v1/ar-billing/plans", headers=_h(token, tid), json={
        "name": f"BR {sfx}", "lines": [{"income_combination_id": income, "amount": "120.00"}]}).json()
    client.post(f"/api/v1/ar-billing/plans/{plan['id']}/run", headers=_h(token, tid),
                json={"invoice_date": "2025-01-01", "due_days": 30, "homeowner_ids": [ho["id"]]})
    return ho


def test_exec_dashboard():
    token, tid, income = _ctx()
    _bill(token, tid, income)
    d = client.get("/api/v1/board/exec-dashboard", headers=_h(token, tid))
    assert d.status_code == 200
    body = d.json()
    assert "funds" in body and "delinquent_total" in body and "open_cases" in body


def test_cash_flow_forecast():
    token, tid, income = _ctx()
    _bill(token, tid, income)
    r = client.get("/api/v1/board/cash-flow-forecast?start=2025-01-01&months=6", headers=_h(token, tid))
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) >= 6 and all({"period", "fund", "opening", "ending"} <= set(x) for x in rows)
    exp = client.get("/api/v1/board/cash-flow-forecast/export?start=2025-01-01&months=6", headers=_h(token, tid))
    assert exp.status_code == 200 and exp.content[:2] == b"PK"


def test_delinquency_packet_pdf():
    token, tid, income = _ctx()
    _bill(token, tid, income)
    r = client.get("/api/v1/board/delinquency-packet/export?as_of=2025-06-30", headers=_h(token, tid))
    assert r.status_code == 200 and r.content[:4] == b"%PDF"
