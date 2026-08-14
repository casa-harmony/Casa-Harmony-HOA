"""P21: AR billing plans, special assessments, late fees, document attachments."""
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
    income = next(c["id"] for c in client.get(f"/api/v1/coa/structures/{sid}/combinations", headers=_h(token, tid)).json()
                  if c["natural_account_value"] == "4000" and c["fund_value"] == "OPER")
    return token, tid, income


def _homeowner(token, tid):
    sfx = uuid.uuid4().hex[:6]
    return client.post("/api/v1/subledger/homeowners", headers=_h(token, tid), json={
        "account_number": f"H-{sfx}", "first_name": "Pat", "last_name": "Owner",
        "property_unit": f"U{sfx[:3]}"}).json()


def test_monthly_billing_run_posts_invoices():
    token, tid, income = _ctx()
    h = _homeowner(token, tid)
    plan = client.post("/api/v1/ar-billing/plans", headers=_h(token, tid), json={
        "name": f"Monthly {uuid.uuid4().hex[:5]}", "plan_type": "MONTHLY_FEE",
        "lines": [{"income_combination_id": income, "amount": "300.00", "department": "Operating"}]}).json()
    run = client.post(f"/api/v1/ar-billing/plans/{plan['id']}/run", headers=_h(token, tid),
                      json={"invoice_date": "2025-01-01", "due_days": 30,
                            "homeowner_ids": [h["id"]]})
    assert run.status_code == 200, run.text
    assert run.json()["invoices_created"] == 1 and float(run.json()["total_billed"]) == 300.0
    invs = [i for i in client.get("/api/v1/subledger/invoices", headers=_h(token, tid)).json()
            if i["homeowner_id"] == h["id"]]
    assert any(i["status"] == "POSTED" and float(i["amount"]) == 300.0 for i in invs)


def test_special_assessment_installments():
    token, tid, income = _ctx()
    h = _homeowner(token, tid)
    plan = client.post("/api/v1/ar-billing/plans", headers=_h(token, tid), json={
        "name": f"Roof Assessment {uuid.uuid4().hex[:5]}", "plan_type": "SPECIAL_ASSESSMENT",
        "lines": [{"income_combination_id": income, "amount": "300.00"}]}).json()
    run = client.post(f"/api/v1/ar-billing/plans/{plan['id']}/run", headers=_h(token, tid),
                      json={"invoice_date": "2025-02-01", "installments": 3, "homeowner_ids": [h["id"]]})
    assert run.json()["invoices_created"] == 3
    assert float(run.json()["total_billed"]) == 300.0


def test_late_fee_application():
    token, tid, income = _ctx()
    h = _homeowner(token, tid)
    plan = client.post("/api/v1/ar-billing/plans", headers=_h(token, tid), json={
        "name": f"Dues {uuid.uuid4().hex[:5]}",
        "lines": [{"income_combination_id": income, "amount": "100.00"}]}).json()
    client.post(f"/api/v1/ar-billing/plans/{plan['id']}/run", headers=_h(token, tid),
                json={"invoice_date": "2025-01-01", "due_days": 30, "homeowner_ids": [h["id"]]})
    # Configure + run late fees as of a much later date.
    client.put("/api/v1/ar-billing/late-fee-rule", headers=_h(token, tid), json={
        "active": True, "grace_days": 10, "fee_type": "FLAT", "flat_amount": "25.00",
        "fund_value": "OPER", "income_combination_id": income})
    res = client.post("/api/v1/ar-billing/late-fees/run?as_of=2025-06-30", headers=_h(token, tid))
    assert res.status_code == 200 and res.json()["late_fees_charged"] >= 1


def test_document_upload_list_download():
    token, tid, income = _ctx()
    entity_id = str(uuid.uuid4())
    data = b"%PDF-1.4 fake invoice scan"
    up = client.post("/api/v1/documents", headers=_h(token, tid),
                     data={"entity_type": "AR_INVOICE", "entity_id": entity_id, "notes": "scan"},
                     files={"file": ("invoice.pdf", io.BytesIO(data), "application/pdf")})
    assert up.status_code == 201, up.text
    doc_id = up.json()["id"]
    listed = client.get(f"/api/v1/documents?entity_type=AR_INVOICE&entity_id={entity_id}",
                        headers=_h(token, tid)).json()
    assert any(d["id"] == doc_id for d in listed)
    dl = client.get(f"/api/v1/documents/{doc_id}/download", headers=_h(token, tid))
    assert dl.status_code == 200 and dl.content == data


def test_late_fee_rule_default_serializes():
    """A tenant with no saved rule must still serialize (transient defaults set)."""
    from app.models.ar_billing import LateFeeRule
    from app.schemas.ar_billing import LateFeeRuleOut
    transient = LateFeeRule(active=False, grace_days=10, fee_type="FLAT",
                            flat_amount=__import__("decimal").Decimal("0"),
                            percent=__import__("decimal").Decimal("0"), fund_value="OPER")
    out = LateFeeRuleOut.model_validate(transient)
    assert out.active is False and str(out.flat_amount) == "0"


def test_ar_reports_export():
    token, tid, income = _ctx()
    for path in ("/api/v1/ar-billing/register/export?start=2025-01-01&end=2025-12-31",
                 "/api/v1/documents/index/export"):
        r = client.get(path, headers=_h(token, tid))
        assert r.status_code == 200 and r.content[:2] == b"PK", path
