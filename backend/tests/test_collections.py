"""P23: collections — aging, cases/escalation, payment plans, liens, write-off, reports."""
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
    combos = client.get(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)).json()
    income = next(c["id"] for c in combos if c["natural_account_value"] == "4000" and c["fund_value"] == "OPER")
    expense = next(c["id"] for c in combos if c["natural_account_value"] == "5000" and c["fund_value"] == "OPER")
    return token, tid, income, expense


def _delinquent_homeowner(token, tid, income, amount="150.00"):
    sfx = uuid.uuid4().hex[:6]
    ho = client.post("/api/v1/subledger/homeowners", headers=_h(token, tid), json={
        "account_number": f"COL-{sfx}", "first_name": "Del", "last_name": "Inquent",
        "property_unit": f"D{sfx[:3]}"}).json()
    plan = client.post("/api/v1/ar-billing/plans", headers=_h(token, tid), json={
        "name": f"Col Plan {sfx}", "lines": [{"income_combination_id": income, "amount": amount}]}).json()
    client.post(f"/api/v1/ar-billing/plans/{plan['id']}/run", headers=_h(token, tid),
                json={"invoice_date": "2025-01-01", "due_days": 30, "homeowner_ids": [ho["id"]]})
    return ho


def test_aging_and_escalation():
    token, tid, income, expense = _ctx()
    ho = _delinquent_homeowner(token, tid, income)
    aging = client.get("/api/v1/collections/aging?as_of=2025-06-30", headers=_h(token, tid)).json()
    row = next(r for r in aging if r["homeowner_id"] == ho["id"])
    assert float(row["buckets"]["90+"]) == 150.0 and float(row["total"]) == 150.0

    case = client.post("/api/v1/collections/cases", headers=_h(token, tid),
                       json={"homeowner_id": ho["id"], "as_of": "2025-06-30"}).json()
    assert case["stage"] == "NOTICE"
    client.post(f"/api/v1/collections/cases/{ho['id']}/notice", headers=_h(token, tid))
    esc = client.post(f"/api/v1/collections/cases/{ho['id']}/escalate", headers=_h(token, tid),
                      json={"to_stage": "PAYMENT_PLAN"}).json()
    assert esc["stage"] == "PAYMENT_PLAN"
    client.post(f"/api/v1/collections/cases/{ho['id']}/escalate", headers=_h(token, tid), json={"to_stage": "LIEN"})
    # Cannot move backward.
    back = client.post(f"/api/v1/collections/cases/{ho['id']}/escalate", headers=_h(token, tid),
                       json={"to_stage": "NOTICE"})
    assert back.status_code == 422


def test_payment_plan_and_lien():
    token, tid, income, expense = _ctx()
    ho = _delinquent_homeowner(token, tid, income)
    plan = client.post("/api/v1/collections/payment-plans", headers=_h(token, tid), json={
        "homeowner_id": ho["id"], "total_amount": "300.00", "installments": 3,
        "start_date": "2025-03-01", "frequency_days": 30}).json()
    assert len(plan["schedule"]) == 3
    assert sum(float(s["amount"]) for s in plan["schedule"]) == 300.0
    paid = client.post(f"/api/v1/collections/payment-plans/installments/{plan['schedule'][0]['id']}/pay",
                       headers=_h(token, tid), json={}).json()
    assert any(s["status"] == "PAID" for s in paid["schedule"])

    lien = client.post("/api/v1/collections/liens", headers=_h(token, tid),
                       json={"homeowner_id": ho["id"], "amount": "150.00", "reference": "REC-1"}).json()
    assert lien["status"] == "DRAFT"
    filed = client.post(f"/api/v1/collections/liens/{lien['id']}/status", headers=_h(token, tid),
                        json={"status": "FILED", "on_date": "2025-07-01"}).json()
    assert filed["status"] == "FILED" and filed["filed_date"] == "2025-07-01"


def test_write_off_clears_balance():
    token, tid, income, expense = _ctx()
    ho = _delinquent_homeowner(token, tid, income, amount="80.00")
    inv = next(i for i in client.get("/api/v1/subledger/invoices", headers=_h(token, tid)).json()
               if i["homeowner_id"] == ho["id"])
    r = client.post("/api/v1/collections/write-off", headers=_h(token, tid), json={
        "invoice_id": inv["id"], "expense_combination_id": expense, "gl_date": "2025-07-01"})
    assert r.status_code == 200 and r.json()["batch_id"]
    # No longer in aging (balance cleared).
    aging = client.get("/api/v1/collections/aging?as_of=2025-07-31", headers=_h(token, tid)).json()
    assert not any(row["homeowner_id"] == ho["id"] for row in aging)


def test_collection_reports():
    token, tid, income, expense = _ctx()
    eff = client.get("/api/v1/collections/effectiveness?start=2025-01-01&end=2025-12-31",
                     headers=_h(token, tid))
    assert eff.status_code == 200 and "rate_pct" in eff.json()
    for path in ("aging/export?as_of=2025-06-30", "effectiveness/export?start=2025-01-01&end=2025-12-31"):
        rr = client.get(f"/api/v1/collections/{path}", headers=_h(token, tid))
        assert rr.status_code == 200 and rr.content[:2] == b"PK", path
