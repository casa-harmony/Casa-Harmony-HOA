"""Supplier master extensions: sites, contacts, bank accounts, edit, import/export."""
from __future__ import annotations

import io
import os
import uuid

from fastapi.testclient import TestClient
from openpyxl import Workbook

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


def test_supplier_sites_contacts_banks_and_edit():
    token, tid = _ctx()
    sfx = uuid.uuid4().hex[:5]
    v = client.post("/api/v1/vendors", headers=_h(token, tid),
                    json={"vendor_number": f"SX-{sfx}", "name": "SiteCo"}).json()
    vid = v["id"]

    # Edit
    upd = client.patch(f"/api/v1/vendors/{vid}", headers=_h(token, tid),
                       json={"email": "ap@siteco.example", "is_1099": True})
    assert upd.status_code == 200 and upd.json()["is_1099"] is True

    # Site (+ duplicate code rejected)
    s1 = client.post(f"/api/v1/vendors/{vid}/sites", headers=_h(token, tid),
                     json={"site_code": "MAIN", "city": "Austin", "pay_site": True})
    assert s1.status_code == 201, s1.text
    dup = client.post(f"/api/v1/vendors/{vid}/sites", headers=_h(token, tid),
                      json={"site_code": "MAIN"})
    assert dup.status_code == 409

    # Contact
    c = client.post(f"/api/v1/vendors/{vid}/contacts", headers=_h(token, tid),
                    json={"first_name": "Pat", "last_name": "Vendor", "email": "pat@siteco.example"})
    assert c.status_code == 201

    # Supplier bank account → masked, no PAN leak
    b = client.post(f"/api/v1/vendors/{vid}/bank-accounts", headers=_h(token, tid),
                    json={"bank_name": "First National", "routing_number": "111000025",
                          "account_number": "55557777", "is_primary": True})
    assert b.status_code == 201 and b.json()["account_number_masked"] == "****7777"
    assert "account_number" not in b.json()

    assert len(client.get(f"/api/v1/vendors/{vid}/sites", headers=_h(token, tid)).json()) == 1
    assert len(client.get(f"/api/v1/vendors/{vid}/bank-accounts", headers=_h(token, tid)).json()) == 1


def test_supplier_export_and_import_roundtrip():
    token, tid = _ctx()
    sfx = uuid.uuid4().hex[:5]
    # Export current suppliers (xlsx).
    exp = client.get("/api/v1/vendors/export/xlsx", headers=_h(token, tid))
    assert exp.status_code == 200 and exp.content[:2] == b"PK"

    # Build a small import workbook with the expected header.
    wb = Workbook(); ws = wb.active
    ws.append(["vendor_number", "name", "tax_id", "email", "phone", "is_1099", "income_tax_type"])
    ws.append([f"IMP-{sfx}-1", "Imported One", "11-1111111", "one@imp.example", "", "Y", "1099-NEC"])
    ws.append([f"IMP-{sfx}-2", "Imported Two", "", "two@imp.example", "", "N", ""])
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)

    r = client.post("/api/v1/vendors/import/xlsx", headers=_h(token, tid),
                    files={"file": ("suppliers.xlsx", buf.getvalue(),
                                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code == 200, r.text
    assert r.json()["created"] == 2

    # Re-import the same file → both skipped (duplicate vendor numbers).
    buf.seek(0)
    r2 = client.post("/api/v1/vendors/import/xlsx", headers=_h(token, tid),
                     files={"file": ("suppliers.xlsx", buf.getvalue(),
                                     "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r2.json()["created"] == 0 and r2.json()["skipped"] == 2
