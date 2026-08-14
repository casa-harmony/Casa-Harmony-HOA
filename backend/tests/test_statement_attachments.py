"""P29: PDF attachments on statements + signed-link fallback + scheduler toggles."""
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


def _homeowner(token, tid, income):
    sfx = uuid.uuid4().hex[:6]
    ho = client.post("/api/v1/subledger/homeowners", headers=_h(token, tid), json={
        "account_number": f"AT-{sfx}", "first_name": "Att", "last_name": "Ach",
        "property_unit": f"A{sfx[:3]}", "email": "att@example.com"}).json()
    plan = client.post("/api/v1/ar-billing/plans", headers=_h(token, tid), json={
        "name": f"AT {sfx}", "lines": [{"income_combination_id": income, "amount": "120.00"}]}).json()
    client.post(f"/api/v1/ar-billing/plans/{plan['id']}/run", headers=_h(token, tid),
                json={"invoice_date": "2025-01-01", "due_days": 30, "homeowner_ids": [ho["id"]]})
    return ho


def test_statement_email_attaches_pdf():
    token, tid, income = _ctx()
    ho = _homeowner(token, tid, income)
    run = client.post("/api/v1/statements/run", headers=_h(token, tid),
                      json={"as_of": "2025-06-30", "send_email": True, "homeowner_ids": [ho["id"]]}).json()
    deliv = client.get(f"/api/v1/statements/runs/{run['id']}/deliveries", headers=_h(token, tid)).json()
    assert deliv[0]["status"] == "SENT" and deliv[0]["attached"] is True
    rep = client.get(f"/api/v1/statements/runs/{run['id']}/report/export", headers=_h(token, tid))
    assert rep.status_code == 200 and rep.content[:2] == b"PK"


def test_signed_statement_link():
    from app.services.statements import make_statement_link
    token, tid, income = _ctx()
    ho = _homeowner(token, tid, income)
    link = make_statement_link(tid, ho["id"])
    path = link.split("/api/v1")[1]  # strip host
    ok = client.get(f"/api/v1{path}")
    assert ok.status_code == 200 and ok.content[:4] == b"%PDF"
    # Tampered signature is rejected.
    bad = client.get(f"/api/v1{path[:-4]}beef")
    assert bad.status_code == 403


def test_scheduler_attachment_toggles_persist():
    token, tid, income = _ctx()
    saved = client.put("/api/v1/scheduler/config", headers=_h(token, tid), json={
        "monthly_statements_enabled": True, "board_packet_enabled": True, "day_of_month": 1,
        "attach_statement_pdf": False, "attach_board_pdf": True}).json()
    assert saved["attach_statement_pdf"] is False and saved["attach_board_pdf"] is True
