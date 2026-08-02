# Test Scripts — 6. Service Desk

The Service Desk ticketing module and its **integration hook** into Procurement —
a ticket with a vendor + estimated cost spawns a Purchase Order, driving the expense
through the standard PO → AP → approval → GL pipeline.

Pre (all): demo HOA active; vendor V-0001 exists; expense account `5000-OPER` exists.
Role: `ticket.manage` (create/manage); `po.manage` (create-PO hook). On **Service Desk**.

---

## TC-SD-01 · Create a service ticket · P2
- **Steps:** New ticket → subject "Broken irrigation pump", category MAINTENANCE, priority HIGH.
- **Expected:** Ticket created with auto number `TKT-000001`, status **OPEN**.

## TC-SD-02 · Ticket categories & priorities validated · P3
- **Steps:** Create tickets with each category (MAINTENANCE/COMPLAINT/REQUEST/VIOLATION) and priority (LOW/MEDIUM/HIGH).
- **Expected:** Accepted values only; invalid values rejected (422).

## TC-SD-03 · Update ticket status · P3
- **Steps:** `PATCH` a ticket to IN_PROGRESS, then RESOLVED, then CLOSED.
- **Expected:** Status transitions persist; updated_by/at recorded.

## TC-SD-04 · Ticket → PO expense hook · P1
- **Pre:** Create a ticket with **vendor V-0001** and **estimated_cost 750.00**.
- **Steps:** On the ticket, **→ Create PO**, choosing an expense account (`5000-OPER`).
- **Expected:** A PO for **$750.00** is created from the ticket; the ticket links `po_header_id` and moves to **IN_PROGRESS**. The PO then flows through normal approval/AP/GL.
- **Automated:** `tests/test_service_desk.py::test_ticket_drives_expense_via_po`.

## TC-SD-05 · Hook requires vendor + cost · P2
- **Steps:** Create a ticket with **no vendor/cost**; attempt **Create PO**.
- **Expected:** **422** — "Ticket needs a vendor and an estimated cost to create a PO." The UI hides/disables the action until both are present.
- **Automated:** `tests/test_service_desk.py::test_ticket_without_vendor_cannot_create_po`.

## TC-SD-06 · No duplicate PO from one ticket · P2
- **Steps:** Create a PO from a ticket (TC-SD-04); attempt to create a PO again.
- **Expected:** **409 Conflict** — "Ticket already has a PO."

## TC-SD-07 · Cross-tenant isolation · P2
- **Steps:** As HOA A, list/open tickets.
- **Expected:** Only HOA A tickets visible (RLS).
