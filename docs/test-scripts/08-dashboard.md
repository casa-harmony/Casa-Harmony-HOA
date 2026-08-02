# Test Scripts — 8. Dashboard

The landing dashboard: COA statistics, the **Finance at a glance** KPIs, and the
compliance-posture panel. KPIs are computed from live data and must reflect actions
taken elsewhere in the app.

Pre (all): demo HOA active; some configuration and transactions exist. On **Dashboard**.

---

## TC-DSH-01 · COA statistic cards · P2
- **Steps:** Load the dashboard.
- **Expected:** Cards show **COA Structures**, **Segments (primary)**, **Code Combinations**, **Value Sets** with counts matching the Chart of Accounts (e.g., 6 segments by default).

## TC-DSH-02 · Finance KPIs reflect live data · P1
- **Steps:** Note the **Finance at a glance** values. Then: submit a PO/AP awaiting approval, leave a GL batch unposted, open a service ticket, create a PO. Reload the dashboard.
- **Expected:** **Pending Approvals**, **Unposted GL Batches**, **Open Service Tickets**, and **Purchase Orders** update to match. Unposted = batches not in POSTED status; open tickets = OPEN or IN_PROGRESS.

## TC-DSH-03 · KPIs are tenant-scoped · P1
- **Steps:** Switch between HOA A and HOA B.
- **Expected:** All KPI counts change to the active HOA's data only (RLS); no cross-tenant totals.

## TC-DSH-04 · Graceful KPI degradation by permission · P3
- **Steps:** Log in as a limited role (e.g., VIEWER) lacking some finance read permissions.
- **Expected:** The dashboard still loads; KPIs the user can't read show a neutral placeholder ("—") rather than erroring the whole page.

## TC-DSH-05 · Compliance posture panel · P3
- **Steps:** View the compliance panel.
- **Expected:** Lists SOC 2 Type II, PCI DSS, ISO 27001, CCPA with the control summary and the "AICPA-ready controls" badge.

## TC-DSH-06 · Empty-state for a fresh HOA · P2
- **Steps:** Create a brand-new HOA and open its dashboard before any transactions.
- **Expected:** COA cards show the seeded defaults; finance KPIs show 0; no errors.

## TC-DSH-07 · Tenant/currency header · P3
- **Steps:** Observe the header.
- **Expected:** Shows the active HOA name and **Functional currency: USD**.
