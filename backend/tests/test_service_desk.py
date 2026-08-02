"""Service Desk → Procurement integration hook."""
from __future__ import annotations

import os
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
SUPERADMIN = os.getenv("SUPERADMIN_EMAIL", "superadmin@casaharmony.ai")
SUPERADMIN_PW = os.getenv("SUPERADMIN_PASSWORD", "ChangeMe!Superadmin1")


def _ctx():
    token = client.post("/api/v1/auth/login",
                        json={"email": SUPERADMIN, "password": SUPERADMIN_PW}).json()["access_token"]
    tid = next(t for t in client.get("/api/v1/tenants",
               headers={"Authorization": f"Bearer {token}"}).json()
               if t["slug"] == "casa-harmony")["id"]
    sid = client.get("/api/v1/coa/structures",
                     headers={"Authorization": f"Bearer {token}", "X-Tenant-Id": tid}).json()[0]["id"]
    return token, tid, sid


def _h(token, tid):
    return {"Authorization": f"Bearer {token}", "X-Tenant-Id": tid}


def test_ticket_drives_expense_via_po():
    token, tid, sid = _ctx()
    vendor = client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"]
    exp = next(c["id"] for c in client.get(f"/api/v1/coa/structures/{sid}/combinations",
               headers=_h(token, tid)).json()
               if c["natural_account_value"] == "5000" and c["fund_value"] == "OPER")

    ticket = client.post("/api/v1/service-desk/tickets", headers=_h(token, tid), json={
        "subject": "Broken irrigation pump", "category": "MAINTENANCE", "priority": "HIGH",
        "vendor_id": vendor, "estimated_cost": "750.00",
    })
    assert ticket.status_code == 201, ticket.text
    tkt_id = ticket.json()["id"]

    po = client.post(f"/api/v1/service-desk/tickets/{tkt_id}/create-po", headers=_h(token, tid),
                     json={"code_combination_id": exp})
    assert po.status_code == 201, po.text
    assert float(po.json()["amount"]) == 750.0

    # Ticket now references the PO and is in progress.
    got = next(t for t in client.get("/api/v1/service-desk/tickets", headers=_h(token, tid)).json()
               if t["id"] == tkt_id)
    assert got["po_header_id"] == po.json()["id"]
    assert got["status"] == "IN_PROGRESS"


def test_ticket_without_vendor_cannot_create_po():
    token, tid, sid = _ctx()
    exp = next(c["id"] for c in client.get(f"/api/v1/coa/structures/{sid}/combinations",
               headers=_h(token, tid)).json() if c["fund_value"] == "OPER")
    ticket = client.post("/api/v1/service-desk/tickets", headers=_h(token, tid),
                         json={"subject": "General question", "category": "REQUEST"}).json()
    r = client.post(f"/api/v1/service-desk/tickets/{ticket['id']}/create-po",
                    headers=_h(token, tid), json={"code_combination_id": exp})
    assert r.status_code == 422


def _ensure_work_order_hierarchy(token, tid):
    # High-value threshold: only work orders >= $1,000 need approval.
    role_id = next(r["id"] for r in client.get("/api/v1/roles", headers=_h(token, tid)).json()
                   if r["code"] == "SYSADMIN")
    client.post("/api/v1/approvals/hierarchies", headers=_h(token, tid), json={
        "name": "Work Order Approvals", "document_type": "WORK_ORDER",
        "rules": [{"level_num": 1, "min_amount": "1000", "max_amount": None,
                   "approver_role_id": role_id}],
    })  # 201 first time, 409 thereafter — both fine


def test_high_value_work_order_requires_approval():
    token, tid, sid = _ctx()
    _ensure_work_order_hierarchy(token, tid)
    vendor = client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"]
    exp = next(c["id"] for c in client.get(f"/api/v1/coa/structures/{sid}/combinations",
               headers=_h(token, tid)).json()
               if c["natural_account_value"] == "5000" and c["fund_value"] == "OPER")
    ticket = client.post("/api/v1/service-desk/tickets", headers=_h(token, tid), json={
        "subject": "Roof replacement", "category": "MAINTENANCE", "priority": "HIGH",
        "vendor_id": vendor, "estimated_cost": "5000.00",
    }).json()
    # Above threshold → cannot create PO until approved.
    blocked = client.post(f"/api/v1/service-desk/tickets/{ticket['id']}/create-po",
                          headers=_h(token, tid), json={"code_combination_id": exp})
    assert blocked.status_code == 422
    sub = client.post(f"/api/v1/service-desk/tickets/{ticket['id']}/submit-for-approval",
                      headers=_h(token, tid))
    assert sub.status_code == 200 and sub.json()["status"] == "PENDING"
    appr = client.post(f"/api/v1/service-desk/tickets/{ticket['id']}/approve",
                       headers=_h(token, tid), json={"approve": True})
    assert appr.json()["status"] == "APPROVED"
    po = client.post(f"/api/v1/service-desk/tickets/{ticket['id']}/create-po",
                     headers=_h(token, tid), json={"code_combination_id": exp})
    assert po.status_code == 201, po.text
    assert float(po.json()["amount"]) == 5000.0


def test_cost_summary_export():
    token, tid, sid = _ctx()
    r = client.get("/api/v1/service-desk/cost-summary/export", headers=_h(token, tid))
    assert r.status_code == 200 and r.content[:2] == b"PK"
