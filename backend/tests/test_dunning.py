"""P30: dunning rules, reminder + escalation run, effectiveness."""
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


def _overdue_homeowner(token, tid, income, email):
    sfx = uuid.uuid4().hex[:6]
    ho = client.post("/api/v1/subledger/homeowners", headers=_h(token, tid), json={
        "account_number": f"DN-{sfx}", "first_name": "Dun", "last_name": "Ning",
        "property_unit": f"D{sfx[:3]}", "email": email}).json()
    plan = client.post("/api/v1/ar-billing/plans", headers=_h(token, tid), json={
        "name": f"DN {sfx}", "lines": [{"income_combination_id": income, "amount": "200.00"}]}).json()
    # Invoice dated early 2025, due 2025-01-31 → very overdue by mid-2025.
    client.post(f"/api/v1/ar-billing/plans/{plan['id']}/run", headers=_h(token, tid),
                json={"invoice_date": "2025-01-01", "due_days": 30, "homeowner_ids": [ho["id"]]})
    return ho


def test_dunning_reminder_and_escalation():
    token, tid, income = _ctx()
    ho = _overdue_homeowner(token, tid, income, "dun@example.com")
    # A reminder rule at 30 dpd and an escalation rule at 90 dpd.
    client.post("/api/v1/dunning/rules", headers=_h(token, tid), json={
        "name": "First reminder", "days_past_due": 30, "action": "REMINDER", "attach_statement": True})
    client.post("/api/v1/dunning/rules", headers=_h(token, tid), json={
        "name": "Escalate to plan", "days_past_due": 90, "action": "ESCALATE",
        "escalate_to_stage": "PAYMENT_PLAN"})

    # As of mid-2025 the account is >90 dpd → fires the escalation rule.
    res = client.post("/api/v1/dunning/run", headers=_h(token, tid),
                      json={"as_of": "2025-06-30", "homeowner_ids": [ho["id"]]})
    assert res.status_code == 200, res.text
    assert res.json()["escalations"] == 1

    logs = client.get("/api/v1/dunning/logs", headers=_h(token, tid)).json()
    assert any(l["homeowner_id"] == ho["id"] and l["status"] == "ESCALATED" for l in logs)


def test_dunning_reminder_only_window():
    token, tid, income = _ctx()
    ho = _overdue_homeowner(token, tid, income, "dun2@example.com")
    client.post("/api/v1/dunning/rules", headers=_h(token, tid), json={
        "name": "Reminder 30", "days_past_due": 30, "action": "REMINDER", "attach_statement": False})
    # ~45 days past due (due 2025-01-31, as_of 2025-03-15) → reminder, no escalation.
    res = client.post("/api/v1/dunning/run", headers=_h(token, tid),
                      json={"as_of": "2025-03-15", "homeowner_ids": [ho["id"]]}).json()
    assert res["reminders_sent"] == 1
    # Re-run same cycle → deduped (no new reminder).
    client.post("/api/v1/dunning/run", headers=_h(token, tid),
                json={"as_of": "2025-03-16", "homeowner_ids": [ho["id"]]})
    logs = [l for l in client.get("/api/v1/dunning/logs", headers=_h(token, tid)).json()
            if l["homeowner_id"] == ho["id"]]
    assert len([l for l in logs if l["status"] == "SENT"]) == 1


def test_effectiveness_export():
    token, tid, income = _ctx()
    r = client.get("/api/v1/dunning/effectiveness/export?start=2025-01-01&end=2025-12-31", headers=_h(token, tid))
    assert r.status_code == 200 and r.content[:2] == b"PK"
