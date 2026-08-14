"""End-to-end financial flow: PO → AP → approval → SLA → GL post → balances."""
from __future__ import annotations

import os
import uuid

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
SUPERADMIN = os.getenv("SUPERADMIN_EMAIL", "superadmin@casaharmony.ai")
SUPERADMIN_PW = os.getenv("SUPERADMIN_PASSWORD", "ChangeMe!Superadmin1")


def _token():
    r = client.post("/api/v1/auth/login", json={"email": SUPERADMIN, "password": SUPERADMIN_PW})
    return r.json()["access_token"]


def _h(token, tid):
    return {"Authorization": f"Bearer {token}", "X-Tenant-Id": tid}


def _ctx():
    token = _token()
    tid = next(t for t in client.get("/api/v1/tenants?include_demo=true",
               headers={"Authorization": f"Bearer {token}"}).json()
               if t["slug"] == "casa-harmony")["id"]
    sid = client.get("/api/v1/coa/structures", headers=_h(token, tid)).json()[0]["id"]
    return token, tid, sid


def _combo(token, tid, sid, natural, fund):
    combos = client.get(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)).json()
    return next(c["id"] for c in combos
               if c["natural_account_value"] == natural and c["fund_value"] == fund)


def _vendor(token, tid):
    return client.get("/api/v1/vendors", headers=_h(token, tid)).json()[0]["id"]


def test_full_po_to_gl_balance_flow():
    token, tid, sid = _ctx()
    vendor = _vendor(token, tid)
    exp = _combo(token, tid, sid, "5000", "OPER")  # Landscaping expense
    sfx = uuid.uuid4().hex[:6]

    # 1) PO with KFF distribution (fund mandatory, derived from the combination).
    po = client.post("/api/v1/purchasing", headers=_h(token, tid), json={
        "vendor_id": vendor, "order_date": "2026-02-01",
        "lines": [{"item_description": "Monthly landscaping", "quantity": 1,
                   "unit_price": "500.00", "distributions": [{"code_combination_id": exp, "amount": "500.00"}]}],
    })
    assert po.status_code == 201, po.text
    po_id = po.json()["id"]
    # No PO hierarchy seeded → submit auto-approves.
    sub = client.post(f"/api/v1/purchasing/{po_id}/submit", headers=_h(token, tid))
    assert sub.status_code == 200 and sub.json()["status"] == "APPROVED", sub.text

    # 2) AP invoice matched to the PO.
    inv = client.post("/api/v1/payables", headers=_h(token, tid), json={
        "vendor_id": vendor, "invoice_number": f"INV-{sfx}", "invoice_date": "2026-02-10",
        "gl_date": "2026-02-15", "po_header_id": po_id,
        "lines": [{"amount": "500.00", "distributions": [{"code_combination_id": exp, "amount": "500.00"}]}],
    })
    assert inv.status_code == 201, inv.text
    inv_id = inv.json()["id"]
    assert inv.json()["match_status"] == "MATCHED"

    # 3) Submit → a clean PO match is fast-tracked (auto-approved) → ACCOUNTED + draft GL batch.
    s = client.post(f"/api/v1/payables/{inv_id}/submit", headers=_h(token, tid))
    assert s.status_code == 200, s.text
    assert s.json()["status"] == "ACCOUNTED"
    assert s.json()["approval_status"] == "APPROVED"
    assert s.json()["gl_je_header_id"] is not None

    # 4) Find the draft AP batch, submit → approve → post.
    batches = client.get("/api/v1/gl/batches", headers=_h(token, tid)).json()
    batch = next(b for b in batches if b["batch_name"] == f"AP INV-{sfx}")
    assert batch["status"] == "DRAFT"
    assert client.post(f"/api/v1/gl/batches/{batch['id']}/submit", headers=_h(token, tid)).json()["status"] == "SUBMITTED"
    assert client.post(f"/api/v1/gl/batches/{batch['id']}/approve", headers=_h(token, tid)).json()["status"] == "APPROVED"
    posted = client.post(f"/api/v1/gl/batches/{batch['id']}/post", headers=_h(token, tid))
    assert posted.status_code == 200 and posted.json()["status"] == "POSTED"

    # 5) GL balances for the period must be balanced (Σ dr == Σ cr).
    bals = client.get("/api/v1/gl/balances", headers=_h(token, tid), params={"period": "FEB-2026"}).json()
    total_dr = sum(float(b["period_net_dr"]) for b in bals)
    total_cr = sum(float(b["period_net_cr"]) for b in bals)
    assert total_dr == total_cr and total_dr >= 500.0

    # 6) Trial balance + batch summary exports.
    tb = client.get("/api/v1/gl/trial-balance/export", headers=_h(token, tid), params={"period": "FEB-2026"})
    assert tb.status_code == 200 and tb.content[:2] == b"PK"
    bx = client.get(f"/api/v1/gl/batches/{batch['id']}/export", headers=_h(token, tid))
    assert bx.status_code == 200 and bx.content[:2] == b"PK"

    # 7) Fund-based financial statements (xlsx + docx are both zip → "PK").
    fx = client.get("/api/v1/gl/financial-statements/export", headers=_h(token, tid),
                    params={"period": "FEB-2026"})
    assert fx.status_code == 200 and fx.content[:2] == b"PK"
    fd = client.get("/api/v1/gl/financial-statements/export", headers=_h(token, tid),
                    params={"period": "FEB-2026", "fmt": "docx"})
    assert fd.status_code == 200 and fd.content[:2] == b"PK"


def test_idempotent_posting_run():
    token, tid, sid = _ctx()
    # Posting run with nothing approved returns a count without error.
    r = client.post("/api/v1/gl/posting-runs", headers=_h(token, tid))
    assert r.status_code == 200
    assert "count" in r.json()


def test_po_match_exception_blocks_submit():
    token, tid, sid = _ctx()
    vendor = _vendor(token, tid)
    exp = _combo(token, tid, sid, "5000", "OPER")
    sfx = uuid.uuid4().hex[:6]
    po = client.post("/api/v1/purchasing", headers=_h(token, tid), json={
        "vendor_id": vendor, "order_date": "2026-02-01",
        "lines": [{"item_description": "Small job", "quantity": 1, "unit_price": "100.00",
                   "distributions": [{"code_combination_id": exp, "amount": "100.00"}]}],
    }).json()
    client.post(f"/api/v1/purchasing/{po['id']}/submit", headers=_h(token, tid))
    # Invoice for MORE than the PO → match exception → submit rejected.
    inv = client.post("/api/v1/payables", headers=_h(token, tid), json={
        "vendor_id": vendor, "invoice_number": f"OVER-{sfx}", "invoice_date": "2026-02-10",
        "gl_date": "2026-02-15", "po_header_id": po["id"],
        "lines": [{"amount": "999.00", "distributions": [{"code_combination_id": exp, "amount": "999.00"}]}],
    }).json()
    assert inv["match_status"] == "MATCH_EXCEPTION"
    s = client.post(f"/api/v1/payables/{inv['id']}/submit", headers=_h(token, tid))
    assert s.status_code == 422


def test_ar_receipt_posts_and_ledger_exports():
    token, tid, sid = _ctx()
    homeowner = client.get("/api/v1/subledger/homeowners", headers=_h(token, tid)).json()[0]["id"]
    sfx = uuid.uuid4().hex[:6]
    rec = client.post("/api/v1/subledger/receipts", headers=_h(token, tid), json={
        "homeowner_id": homeowner, "receipt_number": f"RCPT-{sfx}", "amount": "100.00",
        "receipt_date": "2026-02-20", "payment_method": "ACH", "fund": "OPER",
    })
    assert rec.status_code == 201, rec.text
    batch = next(b for b in client.get("/api/v1/gl/batches", headers=_h(token, tid)).json()
                 if b["batch_name"] == f"AR Receipt RCPT-{sfx}")
    client.post(f"/api/v1/gl/batches/{batch['id']}/submit", headers=_h(token, tid))
    client.post(f"/api/v1/gl/batches/{batch['id']}/approve", headers=_h(token, tid))
    assert client.post(f"/api/v1/gl/batches/{batch['id']}/post", headers=_h(token, tid)).json()["status"] == "POSTED"

    led = client.get(f"/api/v1/subledger/homeowners/{homeowner}/ledger/export", headers=_h(token, tid))
    assert led.status_code == 200 and led.content[:2] == b"PK"


def test_bulk_assessment_run():
    token, tid, sid = _ctx()
    r = client.post("/api/v1/subledger/assessment-run", headers=_h(token, tid), json={
        "invoice_date": "2026-03-01", "due_date": "2026-03-15", "amount": "250.00",
        "invoice_type": "ASSESSMENT",
    })
    assert r.status_code == 200, r.text
    assert r.json()["invoices_created"] >= 3  # seeded homeowners
