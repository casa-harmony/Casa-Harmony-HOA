"""Receivables depth: AR accounting → GL, aging/delinquency, payments, reports."""
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
    return token, tid


def test_assessment_account_run_posts_to_gl():
    token, tid = _ctx()
    # Bill all homeowners, then account all drafts into one AR batch.
    client.post("/api/v1/subledger/assessment-run", headers=_h(token, tid), json={
        "invoice_date": "2026-04-01", "due_date": "2026-04-15", "amount": "300.00",
        "invoice_type": "ASSESSMENT",
    })
    run = client.post("/api/v1/subledger/invoices/account-run", headers=_h(token, tid))
    assert run.status_code == 200, run.text
    batch_id = run.json()["batch_id"]
    assert batch_id is not None
    # Submit → approve → post the AR assessment batch.
    assert client.post(f"/api/v1/gl/batches/{batch_id}/submit", headers=_h(token, tid)).json()["status"] == "SUBMITTED"
    assert client.post(f"/api/v1/gl/batches/{batch_id}/approve", headers=_h(token, tid)).json()["status"] == "APPROVED"
    assert client.post(f"/api/v1/gl/batches/{batch_id}/post", headers=_h(token, tid)).json()["status"] == "POSTED"


def test_aging_reflects_past_due_and_exports():
    token, tid = _ctx()
    # Bill with a due date far in the past so it ages into 90+.
    client.post("/api/v1/subledger/assessment-run", headers=_h(token, tid), json={
        "invoice_date": "2025-01-01", "due_date": "2025-01-15", "amount": "200.00",
        "invoice_type": "ASSESSMENT", "number_prefix": "OLD",
    })
    aging = client.get("/api/v1/subledger/aging", headers=_h(token, tid),
                       params={"as_of": "2025-06-01"})
    assert aging.status_code == 200, aging.text
    body = aging.json()
    assert body["grand_total"] > 0
    assert body["totals"]["90+"] > 0  # Jan 2025 due is >90 days before Jun 2025

    for path in ("ar-aging/export?as_of=2025-06-01", "ar-summary/export?as_of=2025-06-01",
                 "collections/export?start=2026-02-01&end=2026-12-31"):
        r = client.get(f"/api/v1/subledger/{path}", headers=_h(token, tid))
        assert r.status_code == 200 and r.content[:2] == b"PK", path


def test_pay_invoice_records_receipt_and_marks_paid():
    token, tid = _ctx()
    sfx = uuid.uuid4().hex[:5]
    # Create a billing run so there is a DRAFT invoice to pay.
    client.post("/api/v1/subledger/assessment-run", headers=_h(token, tid), json={
        "invoice_date": "2026-05-01", "due_date": "2026-05-15", "amount": "175.00",
        "invoice_type": "ASSESSMENT", "number_prefix": f"PAY{sfx}",
    })
    inv = next(i for i in client.get("/api/v1/subledger/invoices", headers=_h(token, tid)).json()
               if i["invoice_number"].startswith(f"PAY{sfx}"))
    pay = client.post(f"/api/v1/subledger/invoices/{inv['id']}/pay", headers=_h(token, tid),
                      json={"amount": "175.00", "payment_method": "CARD", "fund": "OPER"})
    assert pay.status_code == 201, pay.text
    updated = next(i for i in client.get("/api/v1/subledger/invoices", headers=_h(token, tid)).json()
                   if i["id"] == inv["id"])
    assert updated["status"] == "PAID"
