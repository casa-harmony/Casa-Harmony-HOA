"""P10: Contracts/PO timeframe + amount limit, detail with distributions, import/export."""
from __future__ import annotations

import io
import os
import uuid

from fastapi.testclient import TestClient
from openpyxl import Workbook, load_workbook

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
    cc = next(c for c in combos if c["natural_account_value"] == "5000" and c["fund_value"] == "OPER")
    return token, tid, cc


def test_contract_po_with_timeframe_and_limit():
    token, tid, cc = _ctx()
    vendor = client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"]
    # Landscape contract: $100k cap over 6 months, first line $20k.
    po = client.post("/api/v1/purchasing", headers=_h(token, tid), json={
        "vendor_id": vendor, "order_date": "2026-01-01", "document_type": "CONTRACT",
        "start_date": "2026-01-01", "end_date": "2026-06-30", "amount_limit": "100000.00",
        "description": "Landscape contract",
        "lines": [{"item_description": "Monthly landscaping", "quantity": "1", "unit_price": "20000.00",
                   "distributions": [{"code_combination_id": cc["id"], "amount": "20000.00"}]}],
    })
    assert po.status_code == 201, po.text
    body = po.json()
    assert body["document_type"] == "CONTRACT" and body["amount_limit"] == "100000.00"
    assert body["amount"] == "20000.00" and float(body["billed_amount"]) == 0.0

    # Detail carries lines + distributions with quantity_ordered.
    detail = client.get(f"/api/v1/purchasing/{body['id']}", headers=_h(token, tid)).json()
    assert detail["lines"][0]["distributions"][0]["quantity_ordered"] == "1.0000"


def test_timeframe_and_limit_validation():
    token, tid, cc = _ctx()
    vendor = client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"]
    # end before start
    r1 = client.post("/api/v1/purchasing", headers=_h(token, tid), json={
        "vendor_id": vendor, "order_date": "2026-01-01", "start_date": "2026-06-30",
        "end_date": "2026-01-01",
        "lines": [{"item_description": "x", "quantity": "1", "unit_price": "10.00",
                   "distributions": [{"code_combination_id": cc["id"], "amount": "10.00"}]}]})
    assert r1.status_code == 422
    # amount_limit below line total
    r2 = client.post("/api/v1/purchasing", headers=_h(token, tid), json={
        "vendor_id": vendor, "order_date": "2026-01-01", "amount_limit": "5.00",
        "lines": [{"item_description": "x", "quantity": "1", "unit_price": "10.00",
                   "distributions": [{"code_combination_id": cc["id"], "amount": "10.00"}]}]})
    assert r2.status_code == 422


def test_po_export_and_import():
    token, tid, cc = _ctx()
    vno = client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["vendor_number"]
    # Export works.
    exp = client.get("/api/v1/purchasing/export/xlsx", headers=_h(token, tid))
    assert exp.status_code == 200 and exp.content[:2] == b"PK"

    # Import a one-line PO.
    wb = Workbook(); ws = wb.active
    ws.append(["ref", "vendor_number", "document_type", "order_date", "amount_limit",
               "item_description", "quantity", "unit_price", "account"])
    ws.append([f"R{uuid.uuid4().hex[:5]}", vno, "STANDARD", "2026-02-01", "500.00",
               "Imported item", 1, 500, cc["concatenated_segments"]])
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    r = client.post("/api/v1/purchasing/import/xlsx", headers=_h(token, tid),
                    files={"file": ("po.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code == 200 and r.json()["created"] == 1, r.text
