"""P34: legacy data migration — templates, dry-run, commit, idempotency, rollback,
validation."""
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
    tid = next(t for t in client.get("/api/v1/tenants?include_demo=true",
               headers={"Authorization": f"Bearer {token}"}).json()
               if t["slug"] == "casa-harmony")["id"]
    return {"Authorization": f"Bearer {token}", "X-Tenant-Id": tid}


def _run(h, entity, csv_text, dry_run, mode="ADD"):
    return client.post("/api/v1/migration/run",
                       data={"entity_type": entity, "dry_run": str(dry_run).lower(), "mode": mode},
                       files={"file": ("data.csv", csv_text.encode(), "text/csv")}, headers=h)


def test_template_and_entities():
    h = _ctx()
    cat = client.get("/api/v1/migration/entities", headers=h).json()
    ents = {e["entity_type"] for e in cat}
    assert {"HOMEOWNER", "VENDOR", "AR_OPENING"} <= ents
    # NetSuite-style catalog carries load order + modes + kind.
    homeowner = next(e for e in cat if e["entity_type"] == "HOMEOWNER")
    assert homeowner["kind"] == "MASTER" and "UPSERT" in homeowner["modes"]
    # Entities are returned in load order (masters before open transactions).
    orders = [e["load_order"] for e in cat]
    assert orders == sorted(orders)
    r = client.get("/api/v1/migration/template/HOMEOWNER", headers=h)
    assert r.status_code == 200 and r.content[:2] == b"PK"


def test_field_mapping_renames_source_headers():
    h = _ctx()
    sfx = uuid.uuid4().hex[:8]
    # Source file uses NON-canonical headers; explicit mapping + auto-match resolve them.
    csv = f'"Acct #","First Name","Last Name","E-mail"\nACC-{sfx},Jane,Doe,jane@x.com\n'
    mapping = '{"Acct #": "account_number"}'
    res = client.post("/api/v1/migration/run",
                      data={"entity_type": "HOMEOWNER", "dry_run": "false", "mode": "ADD", "mapping": mapping},
                      files={"file": ("legacy.csv", csv.encode(), "text/csv")}, headers=h).json()
    assert res["created"] == 1 and res["errors"] == 0


def test_preview_suggests_mapping():
    h = _ctx()
    csv = '"Vendor No","Name"\nV-1,Acme\n'
    res = client.post("/api/v1/migration/preview",
                      data={"entity_type": "VENDOR"},
                      files={"file": ("v.csv", csv.encode(), "text/csv")}, headers=h).json()
    assert res["row_count"] == 1
    # Headers are normalized to lowercase by the parser; auto-match maps "name" -> name.
    assert res["suggested_mapping"].get("name") == "name"
    assert "vendor_number" in res["canonical_columns"]


def test_upsert_updates_existing_master():
    h = _ctx()
    sfx = uuid.uuid4().hex[:8]
    vno = f"V-UP-{sfx}"
    _run(h, "VENDOR", f"vendor_number,name\n{vno},Original Name\n", False).json()
    # UPSERT with a new name updates the existing vendor.
    res = _run(h, "VENDOR", f"vendor_number,name,email\n{vno},New Name,new@x.com\n", False, mode="UPSERT").json()
    assert res["updated"] == 1 and res["created"] == 0
    # UPDATE mode on a non-existent vendor errors.
    miss = _run(h, "VENDOR", f"vendor_number,name\nV-MISS-{sfx},X\n", False, mode="UPDATE").json()
    assert miss["errors"] == 1 and miss["updated"] == 0


def test_homeowner_dry_run_then_commit_idempotent_then_rollback():
    h = _ctx()
    sfx = uuid.uuid4().hex[:8]
    a1, a2 = f"ACC-{sfx}-1", f"ACC-{sfx}-2"
    csv = ("account_number,first_name,last_name,email\n"
           f"{a1},Jane,Doe,jane@example.com\n"
           f"{a2},John,Roe,\n"
           ",Missing,Acct,\n")  # third row invalid (no account_number)

    dry = _run(h, "HOMEOWNER", csv, True).json()
    assert dry["status"] == "DRY_RUN" and dry["created"] == 2 and dry["errors"] == 1

    committed = _run(h, "HOMEOWNER", csv, False).json()
    assert committed["status"] == "COMMITTED" and committed["created"] == 2 and committed["errors"] == 1

    again = _run(h, "HOMEOWNER", csv, False).json()
    assert again["created"] == 0 and again["skipped"] == 2  # idempotent

    rolled = client.post(f"/api/v1/migration/batches/{committed['id']}/rollback", headers=h).json()
    assert rolled["status"] == "ROLLED_BACK"
    # After rollback the two homeowners are gone → re-commit creates them again.
    recommit = _run(h, "HOMEOWNER", csv, False).json()
    assert recommit["created"] == 2


def test_ar_opening_validates_missing_homeowner():
    h = _ctx()
    sfx = uuid.uuid4().hex[:8]
    csv = (f"account_number,amount,income_account,fund\n"
           f"NOPE-{sfx},100.00,01-000-4000-OPER-00,OPER\n")
    res = _run(h, "AR_OPENING", csv, True).json()
    assert res["errors"] == 1 and res["created"] == 0
    recs = client.get(f"/api/v1/migration/batches/{res['id']}/records", headers=h).json()
    assert any("not found" in (r["message"] or "") for r in recs)


ACCT_OPER = "0100-OPER-000-1000-0000-NONE"
ACCT_RESV = "0100-RESV-000-1010-0000-NONE"


def test_ap_open_invoice_header_and_lines():
    h = _ctx()
    sfx = uuid.uuid4().hex[:8]
    vno = f"V-AP-{sfx}"
    _run(h, "VENDOR", f"vendor_number,name\n{vno},Landscaping LLC\n", False)
    ext = f"INV-{sfx}"
    # Two line rows share one external_id -> one invoice document with two lines.
    csv = ("external_id,vendor_number,invoice_number,invoice_date,description,line_description,account,fund,amount\n"
           f"{ext},{vno},{ext},2026-01-15,Jan service,Mowing,{ACCT_OPER},OPER,300.00\n"
           f"{ext},{vno},{ext},2026-01-15,Jan service,Reserve repair,{ACCT_RESV},RESV,200.00\n")
    res = _run(h, "AP_OPEN_INVOICE", csv, False).json()
    assert res["created"] == 1 and res["errors"] == 0
    recs = client.get(f"/api/v1/migration/batches/{res['id']}/records", headers=h).json()
    assert "2 line" in (recs[0]["message"] or "")
    # Re-running the same external id is idempotent.
    again = _run(h, "AP_OPEN_INVOICE", csv, False).json()
    assert again["created"] == 0 and again["skipped"] == 1


def test_ap_open_invoice_unknown_vendor_errors():
    h = _ctx()
    sfx = uuid.uuid4().hex[:8]
    csv = ("external_id,vendor_number,invoice_date,line_description,account,fund,amount\n"
           f"INV-{sfx},NOVENDOR-{sfx},2026-01-15,x,{ACCT_OPER},OPER,100.00\n")
    res = _run(h, "AP_OPEN_INVOICE", csv, True).json()
    assert res["errors"] == 1 and res["created"] == 0


def test_po_header_and_lines():
    h = _ctx()
    sfx = uuid.uuid4().hex[:8]
    vno = f"V-PO-{sfx}"
    _run(h, "VENDOR", f"vendor_number,name\n{vno},Pool Service Co\n", False)
    ext = f"PO-{sfx}"
    csv = ("external_id,vendor_number,po_number,order_date,description,item_description,quantity,unit_price,account,fund,amount\n"
           f"{ext},{vno},{ext},2026-02-01,Annual pool,Weekly cleaning,12,100.00,{ACCT_OPER},OPER,1200.00\n")
    res = _run(h, "PO_OPEN", csv, False).json()
    assert res["created"] == 1 and res["errors"] == 0


def test_ar_receipt_and_ap_payment_and_delinquency():
    h = _ctx()
    sfx = uuid.uuid4().hex[:8]
    acct, vno = f"H-{sfx}", f"V-H-{sfx}"
    _run(h, "HOMEOWNER", f"account_number,first_name,last_name\n{acct},Pat,Smith\n", False)
    _run(h, "VENDOR", f"vendor_number,name\n{vno},Utility Co\n", False)

    rcpt = _run(h, "AR_RECEIPT",
                f"external_id,account_number,receipt_number,amount,receipt_date,payment_method\n"
                f"RCPT-{sfx},{acct},RCPT-{sfx},250.00,2026-01-10,CHECK\n", False).json()
    assert rcpt["created"] == 1 and rcpt["errors"] == 0

    pay = _run(h, "AP_PAYMENT",
               f"external_id,vendor_number,payment_number,amount,payment_date,reference\n"
               f"PMT-{sfx},{vno},PMT-{sfx},1800.00,2026-01-12,CHK1099\n", False).json()
    assert pay["created"] == 1 and pay["errors"] == 0

    case = _run(h, "DELINQUENCY_CASE",
                f"account_number,stage,opened_date,balance\n{acct},NOTICE,2026-02-01,450.00\n", False).json()
    assert case["created"] == 1
    # Idempotent: one case per homeowner.
    again = _run(h, "DELINQUENCY_CASE",
                 f"account_number,stage,opened_date,balance\n{acct},NOTICE,2026-02-01,450.00\n", False).json()
    assert again["skipped"] == 1 and again["created"] == 0


def test_ar_receipt_unknown_homeowner_errors():
    h = _ctx()
    sfx = uuid.uuid4().hex[:8]
    res = _run(h, "AR_RECEIPT",
               f"external_id,account_number,amount,receipt_date\nR-{sfx},NOPE-{sfx},10.00,2026-01-01\n",
               True).json()
    assert res["errors"] == 1 and res["created"] == 0


def test_vendor_bank_tokenized():
    h = _ctx()
    sfx = uuid.uuid4().hex[:8]
    vno = f"V-BANK-{sfx}"
    _run(h, "VENDOR", f"vendor_number,name\n{vno},Roofing Inc\n", False)
    res = _run(h, "VENDOR_BANK",
               f"external_id,vendor_number,bank_name,routing_number,account_number,account_type,is_primary\n"
               f"BANK-{sfx},{vno},First National,021000021,123456789,CHECKING,yes\n", False).json()
    assert res["created"] == 1 and res["errors"] == 0
    miss = _run(h, "VENDOR_BANK",
                f"external_id,vendor_number,bank_name\nB2-{sfx},NOPE-{sfx},X Bank\n", True).json()
    assert miss["errors"] == 1


def test_migration_report_export():
    h = _ctx()
    csv = "vendor_number,name\nV-RPT-1,Acme Co\n"
    batch = _run(h, "VENDOR", csv, True).json()
    r = client.get(f"/api/v1/migration/batches/{batch['id']}/report", headers=h)
    assert r.status_code == 200 and r.content[:2] == b"PK"
