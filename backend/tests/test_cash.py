"""P14: Cash Management & Bank Reconciliation."""
from __future__ import annotations

import io
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
    cash = next(c["id"] for c in combos if c["natural_account_value"] == "1000" and c["fund_value"] == "OPER")
    exp = next(c["id"] for c in combos if c["natural_account_value"] == "5000" and c["fund_value"] == "OPER")
    return token, tid, cash, exp


def _bank_account(token, tid, cash):
    sfx = uuid.uuid4().hex[:5]
    return client.post("/api/v1/cash/bank-accounts", headers=_h(token, tid), json={
        "account_code": f"OPER-{sfx}", "name": "Operating Checking", "fund_value": "OPER",
        "bank_name": "First Bank", "account_number": "123456789", "routing_number": "111000025",
        "gl_cash_combination_id": cash}).json()


def test_bank_account_statement_adjust_reconcile():
    token, tid, cash, exp = _ctx()
    acct = _bank_account(token, tid, cash)
    assert acct["account_code"].startswith("OPER-")

    stmt = client.post("/api/v1/cash/statements", headers=_h(token, tid), json={
        "ce_bank_account_id": acct["id"], "statement_date": "2026-03-31",
        "opening_balance": "1000.00", "closing_balance": "970.00",
        "lines": [{"line_date": "2026-03-15", "description": "Bank fee", "amount": "-30.00"}]}).json()
    line_id = stmt["lines"][0]["id"]

    # Cannot reconcile while a line is open.
    bad = client.post(f"/api/v1/cash/statements/{stmt['id']}/reconcile", headers=_h(token, tid))
    assert bad.status_code == 422

    # Adjust the fee → posts a GL draft batch and reconciles the line.
    adj = client.post(f"/api/v1/cash/statements/lines/{line_id}/adjust", headers=_h(token, tid),
                      json={"offset_combination_id": exp, "gl_date": "2026-03-31", "description": "Bank fee"})
    assert adj.status_code == 200, adj.text
    assert adj.json()["lines"][0]["reconciled"] is True
    assert adj.json()["lines"][0]["match_type"] == "ADJUSTMENT"

    # Now the statement reconciles.
    rec = client.post(f"/api/v1/cash/statements/{stmt['id']}/reconcile", headers=_h(token, tid))
    assert rec.status_code == 200 and rec.json()["status"] == "RECONCILED"

    # Cash position lists the account.
    pos = client.get("/api/v1/cash/position", headers=_h(token, tid)).json()
    assert any(p["bank_account_id"] == acct["id"] and p["fund_value"] == "OPER" for p in pos)


def test_statement_csv_import():
    token, tid, cash, exp = _ctx()
    acct = _bank_account(token, tid, cash)
    csv_data = ("date,description,reference,amount\n"
                "2026-04-01,Deposit,DEP1,500.00\n"
                "2026-04-03,Service charge,FEE1,-12.50\n")
    r = client.post("/api/v1/cash/statements/import", headers=_h(token, tid),
                    data={"ce_bank_account_id": acct["id"], "statement_date": "2026-04-30",
                          "opening_balance": "0", "closing_balance": "487.50"},
                    files={"file": ("stmt.csv", io.BytesIO(csv_data.encode()), "text/csv")})
    assert r.status_code == 201, r.text
    assert len(r.json()["lines"]) == 2


def test_match_line_to_payment():
    token, tid, cash, exp = _ctx()
    acct = _bank_account(token, tid, cash)
    vendor = client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"]
    sfx = uuid.uuid4().hex[:6]
    inv = client.post("/api/v1/payables", headers=_h(token, tid), json={
        "vendor_id": vendor, "invoice_number": f"CASH-{sfx}", "invoice_date": "2026-04-01",
        "gl_date": "2026-04-01",
        "lines": [{"amount": "200.00", "distributions": [{"code_combination_id": exp, "amount": "200.00"}]}]}).json()
    client.post(f"/api/v1/payables/{inv['id']}/submit", headers=_h(token, tid))
    client.post(f"/api/v1/payables/{inv['id']}/approve", headers=_h(token, tid), json={"approve": True})
    pay = client.post("/api/v1/ap-payments", headers=_h(token, tid), json={
        "vendor_id": vendor, "payment_date": "2026-04-05",
        "applications": [{"invoice_id": inv["id"], "amount": "200.00"}]}).json()

    stmt = client.post("/api/v1/cash/statements", headers=_h(token, tid), json={
        "ce_bank_account_id": acct["id"], "statement_date": "2026-04-30",
        "lines": [{"description": "Check cleared", "amount": "-200.00"}]}).json()
    line_id = stmt["lines"][0]["id"]
    m = client.post(f"/api/v1/cash/statements/lines/{line_id}/match", headers=_h(token, tid),
                    json={"payment_id": pay["id"]})
    assert m.status_code == 200
    ln = m.json()["lines"][0]
    assert ln["reconciled"] is True and ln["match_type"] == "PAYMENT"


def test_cash_reports_export():
    token, tid, cash, exp = _ctx()
    _bank_account(token, tid, cash)
    for path in ("reports/bank-rec/export", "reports/cash-flow/export?start=2026-01-01&end=2026-12-31"):
        r = client.get(f"/api/v1/cash/{path}", headers=_h(token, tid))
        assert r.status_code == 200 and r.content[:2] == b"PK", path
