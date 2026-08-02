# Test Scripts — 1. Configuration

Configuring the system from scratch: tenants (HOAs), users & roles (RBAC), the Key
Flexfield Chart of Accounts, approval hierarchies, and master data (vendors, banks,
homeowners). Run as **SUPERADMIN** unless noted. UI paths assume the sidebar nav.

Legend — Priority: P1 critical · P2 high · P3 medium.

---

## TC-CFG-01 · Provision a new HOA (tenant) · P1
- **Role:** SUPERADMIN
- **Pre:** Logged in; on **HOAs (Tenants)**.
- **Steps:**
  1. Click **+ New HOA**, enter name "Sunset Ridge HOA", slug `sunset-ridge`, save.
  2. Open the tenant switcher (top bar) and select Sunset Ridge.
  3. Go to **Chart of Accounts**.
- **Expected:** Tenant created; switcher lists it; a **default 6-segment COA** (Association, Fund, Cost Center, Natural Account, Sub-Account, Project) is auto-provisioned with the OPER/RESV/SPEC fund value set. Functional currency shows **USD**.
- **Automated:** `tests/test_api.py` (tenant provisioning + default COA).

## TC-CFG-02 · Single functional currency is USD · P2
- **Steps:** Inspect dashboard header and any amount field across the app.
- **Expected:** Currency is USD everywhere; **no multi-currency selector** exists.

## TC-CFG-03 · Create a custom role with scoped permissions · P1
- **Role:** SUPERADMIN or HOA_ADMIN
- **Pre:** A tenant is active; on **Users & Roles**.
- **Steps:**
  1. Create role "AP Clerk" with permissions `ap.manage`, `vendor.manage`, `coa.read`.
  2. Save and reopen the role.
- **Expected:** Role persists with exactly those permissions. System roles (SUPERADMIN, SYSADMIN, HOA_ADMIN, ACCOUNTANT, VIEWER) are present and not editable away.

## TC-CFG-04 · Create a user and grant a membership · P1
- **Steps:**
  1. Create user `clerk@sunset.example`.
  2. Grant a membership: user = clerk, tenant = Sunset Ridge, role = AP Clerk.
  3. Log out; log in as the clerk.
- **Expected:** Clerk sees only Sunset Ridge; nav shows only permitted areas (Payables, Vendors, COA read). Attempting a disallowed area (e.g., GL approve) is blocked (403).
- **Automated:** RBAC enforcement in `tests/test_api.py`.

## TC-CFG-05 · SYSADMIN manages multiple HOAs · P2
- **Pre:** SYSADMIN has memberships in ≥2 HOAs.
- **Steps:** Log in as SYSADMIN; use the tenant switcher to move between HOAs.
- **Expected:** Switching changes the active HOA; data shown is scoped to the selected HOA only.

## TC-CFG-06 · Add a COA segment · P2
- **Role:** ACCOUNTANT / HOA_ADMIN; on **Chart of Accounts → (structure)**.
- **Steps:** Add a 7th segment "Program" with a value set and qualifier `secondary_tracking`; save.
- **Expected:** Segment appears with its qualifier badge; segment count increments (supports up to 15).

## TC-CFG-07 · Create a value set and values · P2
- **Steps:** On **Value Sets**, create value set "PROGRAMS" (INDEPENDENT, CHAR); add values `POOL`, `GATE`.
- **Expected:** Value set and values persist and are selectable when building combinations.

## TC-CFG-08 · Cross-validation rule blocks an invalid combination · P1
- **Steps:**
  1. Create a cross-validation rule that **excludes** Fund `RESV` with Natural Account `4000` (income).
  2. Attempt to build code combination `0100-RESV-000-4000-0000-NONE`.
- **Expected:** Build is **rejected (422)** with a clear message citing the rule. A valid combination (e.g., `0100-OPER-000-4000-...`) succeeds.
- **Automated:** KFF validation in `tests/test_api.py`.

## TC-CFG-09 · Create a postable code combination & qualifier derivation · P1
- **Steps:** Build `0100-OPER-100-5000-0000-NONE`; open it.
- **Expected:** Combination saved with concatenated string; **account type derived = E (Expense)**; fund_value = OPER; balancing/cost-center/natural-account qualifier values populated from segments.

## TC-CFG-10 · Configure a multi-level approval hierarchy · P1
- **Role:** SYSADMIN/HOA_ADMIN (`approval.config`); on **Approvals**.
- **Steps:**
  1. **+ New Hierarchy**, document type **PO**, name "PO Approvals".
  2. Level 1: min 0, max 5000, role = ACCOUNTANT. Add Level 2: min 5000, max blank (∞), role = SYSADMIN. Save.
- **Expected:** Hierarchy listed with both bands. (Effect verified in script 03: a PO ≤ $5k needs 1 approval; > $5k needs 2.)
- **Automated:** `tests/test_approvals.py::test_multi_level_approval_escalation`.

## TC-CFG-11 · Create a vendor (Tax ID encrypted) · P2
- **Role:** `vendor.manage`; on **Vendors**.
- **Steps:** Create vendor "BluePool Services", number V-0002, Tax ID `12-3456789`.
- **Expected:** Vendor listed. (DB check: `ap_suppliers.tax_id` stored as ciphertext — see TC-SEC-07.)

## TC-CFG-12 · Create a bank with routing-number enrichment · P3
- **Role:** `bank.manage`; on **Vendors → Banks** (or Banks area).
- **Steps:** Enter routing number `021000021`; trigger lookup.
- **Expected:** If online, bank name/city/state auto-fill (JPMorgan Chase, New York, NY); if offline, the field is editable and save still works once a name is entered.

## TC-CFG-13 · Create a bank account (number masked/encrypted) · P2
- **Steps:** Add account "Operating Account", number `1234567890`, type CHECKING, use AP_DISBURSEMENT.
- **Expected:** List shows masked `****7890`; full number never returned by the API. (DB: `ap_bank_accounts.account_number` is ciphertext.)

## TC-CFG-14 · Create homeowners · P2
- **Role:** `ar.manage`; on **Receivables**.
- **Steps:** Add homeowner account H-0004, unit "04B".
- **Expected:** Homeowner listed and available for assessments/receipts.
