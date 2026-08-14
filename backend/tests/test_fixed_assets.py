"""P18: Fixed Assets — depreciation, disposal, forecast, reserve studies."""
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
    oper = [c["id"] for c in combos if c["fund_value"] == "OPER" and c["allow_posting"]]
    assert len(oper) >= 3, "need 3 postable OPER combinations"
    return token, tid, oper


def _asset(token, tid, oper, cost="1200.00", months=12):
    return client.post("/api/v1/fixed-assets/assets", headers=_h(token, tid), json={
        "name": f"Pump {uuid.uuid4().hex[:5]}", "cost": cost, "in_service_date": "2026-01-01",
        "life_months": months, "fund_value": "OPER",
        "asset_combination_id": oper[0], "accum_depr_combination_id": oper[1],
        "depr_expense_combination_id": oper[2]}).json()


def test_asset_forecast_and_depreciation_run():
    token, tid, oper = _ctx()
    a = _asset(token, tid, oper, "1200.00", 12)
    assert a["net_book_value"] == "1200.00"

    fc = client.get(f"/api/v1/fixed-assets/assets/{a['id']}/forecast", headers=_h(token, tid)).json()
    assert len(fc) == 12 and float(fc[0]["amount"]) == 100.0

    run = client.post("/api/v1/fixed-assets/depreciation/run", headers=_h(token, tid),
                      json={"period_name": "JAN-2026"})
    assert run.status_code == 200 and run.json()["batch_id"]
    # Idempotent: a second run for the same period adds nothing for this asset.
    again = client.post("/api/v1/fixed-assets/depreciation/run", headers=_h(token, tid),
                        json={"period_name": "JAN-2026"}).json()
    a2 = next(x for x in client.get("/api/v1/fixed-assets/assets", headers=_h(token, tid)).json()
              if x["id"] == a["id"])
    assert float(a2["accumulated_depreciation"]) == 100.0
    assert float(a2["net_book_value"]) == 1100.0


def test_dispose_with_loss():
    token, tid, oper = _ctx()
    a = _asset(token, tid, oper, "600.00", 12)
    client.post("/api/v1/fixed-assets/depreciation/run", headers=_h(token, tid), json={"period_name": "JAN-2026"})
    # Dispose with no proceeds → loss = remaining NBV; needs a gain/loss account.
    d = client.post(f"/api/v1/fixed-assets/assets/{a['id']}/dispose", headers=_h(token, tid), json={
        "disposal_date": "2026-06-30", "proceeds": "0",
        "gain_loss_combination_id": oper[2]})
    assert d.status_code == 200 and d.json()["status"] == "DISPOSED"
    # Disposing again is rejected.
    again = client.post(f"/api/v1/fixed-assets/assets/{a['id']}/dispose", headers=_h(token, tid), json={
        "disposal_date": "2026-06-30", "gain_loss_combination_id": oper[2]})
    assert again.status_code == 422


def test_reserve_study_and_reports():
    token, tid, oper = _ctx()
    _asset(token, tid, oper, "5000.00", 60)  # an OPER 2026 asset (counts as actual)
    study = client.post("/api/v1/fixed-assets/reserve-studies", headers=_h(token, tid),
                        json={"name": f"Study {uuid.uuid4().hex[:5]}", "study_year": 2026}).json()
    client.post(f"/api/v1/fixed-assets/reserve-studies/{study['id']}/components", headers=_h(token, tid),
                json={"name": "Roof", "category": "Building", "fund_value": "OPER",
                      "planned_year": 2026, "planned_amount": "100000.00"})
    rows = client.get(f"/api/v1/fixed-assets/reserve-studies/{study['id']}/vs-actual",
                      headers=_h(token, tid)).json()
    roof = next(r for r in rows if r["component"] == "Roof")
    assert float(roof["planned_amount"]) == 100000.0 and float(roof["actual"]) >= 5000.0

    for path in ("reports/register/export", "reports/depreciation-forecast/export",
                 f"reserve-studies/{study['id']}/utilization/export"):
        r = client.get(f"/api/v1/fixed-assets/{path}", headers=_h(token, tid))
        assert r.status_code == 200 and r.content[:2] == b"PK", path
