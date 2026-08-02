"""Financial close & reporting: budgets, Budget vs Actual, board PDF, compliance PDF."""
from __future__ import annotations

import os

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
    return token, tid, sid


def test_budget_vs_actual():
    token, tid, sid = _ctx()
    exp = next(c["id"] for c in client.get(f"/api/v1/coa/structures/{sid}/combinations",
               headers=_h(token, tid)).json()
               if c["natural_account_value"] == "5000" and c["fund_value"] == "OPER")
    # Set a budget for the expense account.
    r = client.post("/api/v1/gl/budgets", headers=_h(token, tid),
                    json={"code_combination_id": exp, "period_name": "FEB-2026", "amount": "1000.00"})
    assert r.status_code == 201, r.text
    # Upsert (same key) should not error.
    r2 = client.post("/api/v1/gl/budgets", headers=_h(token, tid),
                     json={"code_combination_id": exp, "period_name": "FEB-2026", "amount": "1200.00"})
    assert r2.status_code == 201

    bva = client.get("/api/v1/gl/budget-vs-actual", headers=_h(token, tid),
                     params={"period": "FEB-2026"}).json()
    row = next(r for r in bva if r["account"].endswith("5000-0000-NONE"))
    assert float(row["budget"]) == 1200.0
    assert "variance" in row

    x = client.get("/api/v1/gl/budget-vs-actual/export", headers=_h(token, tid),
                   params={"period": "FEB-2026"})
    assert x.status_code == 200 and x.content[:2] == b"PK"


def test_board_report_pdf():
    token, tid, sid = _ctx()
    r = client.get("/api/v1/gl/board-report/export", headers=_h(token, tid),
                   params={"period": "FEB-2026"})
    assert r.status_code == 200
    assert r.content[:4] == b"%PDF"


def test_compliance_report_pdf():
    token, tid, sid = _ctx()
    r = client.get("/api/v1/privacy/compliance-report/export", headers=_h(token, tid))
    assert r.status_code == 200
    assert r.content[:4] == b"%PDF"
