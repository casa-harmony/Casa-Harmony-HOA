"""Load realistic demo transactions into Maple Grove HOA (the review 'guinea pig').

Idempotent guard: if Maple Grove already has GL batches, it exits without
re-loading. Creates:
  * standard COA combinations, a vendor, a bank
  * ~20 homeowners/units
  * POs -> AP invoices -> approved -> Subledger Accounting -> posted GL batches
  * monthly assessments (one past-due run for aging, one current) -> posted
  * receipts/collections (some full, some partial)
  * GL budgets (for Budget vs Actual)
  * service tickets (one converted to a PO)
  * a few PENDING items: one AP invoice awaiting approval, one APPROVED-but-
    unposted GL batch  (so the dashboards/approval screens have live work)

Run:  python -m scripts.seed && python -m scripts.seed_demo && python -m scripts.seed_maple_transactions
"""
from __future__ import annotations

import sys
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import select

from app.core.database import session_for
from app.models.banking import ApBank, ApBankAccount
from app.models.budget import GlBudget
from app.models.gl import GlJeBatch
from app.models.identity import Role, Tenant, User
from app.models.kff import GlCodeCombination, KffStructure
from app.models.masters import ApSupplier
from app.models.procurement import PoHeader
from app.models.service_desk import ServiceTicket
from app.models.subledger import ArHomeowner, ArInvoice, ArReceipt
from app.models.workflow import ApprovalHierarchy, ApprovalRule
from app.services import approvals
from app.services.ap_service import create_invoice
from app.services.gl_batch import approve_batch, post_batch, submit_batch
from app.services.kff import create_combination
from app.services.po_service import create_po
from app.services.subledger_accounting import (
    create_accounting_for_ap_invoice,
    create_accounting_for_ar_invoices_bulk,
    create_accounting_for_ar_receipt,
)

STANDARD = [
    {1: "0100", 2: "OPER", 3: "000", 4: "1000", 5: "0000", 6: "NONE"},  # cash
    {1: "0100", 2: "RESV", 3: "000", 4: "1010", 5: "0000", 6: "NONE"},  # reserve cash
    {1: "0100", 2: "OPER", 3: "000", 4: "1100", 5: "0000", 6: "NONE"},  # AR
    {1: "0100", 2: "OPER", 3: "000", 4: "2000", 5: "0000", 6: "NONE"},  # AP oper
    {1: "0100", 2: "RESV", 3: "000", 4: "2000", 5: "0000", 6: "NONE"},  # AP resv
    {1: "0100", 2: "OPER", 3: "000", 4: "4000", 5: "0000", 6: "NONE"},  # income
    {1: "0100", 2: "OPER", 3: "100", 4: "5000", 5: "0000", 6: "NONE"},  # landscaping
    {1: "0100", 2: "OPER", 3: "200", 4: "5100", 5: "0000", 6: "NONE"},  # utilities
    {1: "0100", 2: "RESV", 3: "000", 4: "6000", 5: "0000", 6: "NONE"},  # reserve funding
]


def main() -> int:
    db = session_for(tenant_id=None, is_superadmin=True)
    try:
        maple = db.execute(select(Tenant).where(Tenant.slug == "maple-grove")).scalar_one()
        su = db.execute(select(User).where(User.is_superadmin.is_(True))).scalars().first()
        structure = db.execute(
            select(KffStructure).where(KffStructure.tenant_id == maple.id)
        ).scalars().first()

        if db.execute(select(GlJeBatch).where(GlJeBatch.tenant_id == maple.id)).first():
            print("Maple Grove already has transactions — nothing to do.")
            return 0

        # --- Standard COA combinations ---
        for seg in STANDARD:
            try:
                create_combination(db, structure, maple.id, seg, created_by=su.id)
            except Exception:
                pass
        db.flush()

        def combo(natural, fund):
            return db.execute(select(GlCodeCombination).where(
                GlCodeCombination.tenant_id == maple.id,
                GlCodeCombination.natural_account_value == natural,
                GlCodeCombination.fund_value == fund,
            )).scalars().first()

        exp_land, exp_util = combo("5000", "OPER"), combo("5100", "OPER")

        # --- Vendor + bank ---
        vendor = ApSupplier(tenant_id=maple.id, vendor_number="MG-V001",
                            name="EverGreen Grounds LLC", payment_terms="NET30",
                            email="ar@evergreen.example", created_by=su.id, updated_by=su.id)
        db.add(vendor)
        bank = ApBank(tenant_id=maple.id, bank_name="Frost Bank", routing_number="114000093",
                      city="Austin", state="TX", created_by=su.id, updated_by=su.id)
        db.add(bank)
        db.flush()
        db.add(ApBankAccount(tenant_id=maple.id, bank_id=bank.id, account_name="Operating",
                             account_number="9087654321", account_type="CHECKING",
                             created_by=su.id, updated_by=su.id))

        # --- Homeowners (top up to 20 units) ---
        existing = {h.account_number for h in db.execute(
            select(ArHomeowner).where(ArHomeowner.tenant_id == maple.id)).scalars()}
        for i in range(101, 121):
            acct = f"MG-{i}"
            if acct not in existing:
                db.add(ArHomeowner(tenant_id=maple.id, account_number=acct, property_unit=str(i),
                                   first_name="Unit", last_name=str(i),
                                   email=f"unit{i}@maple.example", created_by=su.id, updated_by=su.id))
        db.flush()
        homeowners = db.execute(select(ArHomeowner).where(
            ArHomeowner.tenant_id == maple.id).order_by(ArHomeowner.account_number)).scalars().all()

        # --- AP_INVOICE approval hierarchy (for the pending item) ---
        sysadmin_role = db.execute(select(Role).where(Role.code == "SYSADMIN")).scalar_one()
        if not db.execute(select(ApprovalHierarchy).where(
            ApprovalHierarchy.tenant_id == maple.id,
            ApprovalHierarchy.document_type == "AP_INVOICE")).scalar_one_or_none():
            h = ApprovalHierarchy(tenant_id=maple.id, name="AP Invoice Approvals",
                                  document_type="AP_INVOICE", created_by=su.id, updated_by=su.id)
            db.add(h)
            db.flush()
            db.add(ApprovalRule(tenant_id=maple.id, hierarchy_id=h.id, level_num=1,
                                min_amount=0, max_amount=None, approver_role_id=sysadmin_role.id,
                                created_by=su.id, updated_by=su.id))

        def post_fully(batch):
            submit_batch(db, batch)
            approve_batch(db, batch, su.id)
            post_batch(db, batch)

        def approve_po(po):
            po.status = "APPROVED"
            po.approval_status = "APPROVED"
            po.approved_by = su.id
            po.approved_at = datetime.now(timezone.utc)

        # --- Procure-to-Pay: 2 POs -> AP invoices -> posted ---
        po1 = create_po(db, tenant_id=maple.id, vendor_id=vendor.id, order_date=date(2026, 5, 1),
                        description="May landscaping",
                        lines=[{"item_description": "Landscaping - May", "quantity": 1,
                                "unit_price": "2400.00",
                                "distributions": [{"code_combination_id": exp_land.id, "amount": "2400.00"}]}],
                        created_by=su.id)
        approve_po(po1)
        inv1 = create_invoice(db, tenant_id=maple.id, vendor_id=vendor.id, invoice_number="MG-INV-1001",
                              invoice_date=date(2026, 5, 8), gl_date=date(2026, 5, 10), po_header_id=po1.id,
                              lines=[{"amount": "2400.00",
                                      "distributions": [{"code_combination_id": exp_land.id, "amount": "2400.00"}]}],
                              created_by=su.id)
        inv1.status = "APPROVED"; inv1.approval_status = "APPROVED"
        post_fully(create_accounting_for_ap_invoice(db, inv1, created_by=su.id))

        po2 = create_po(db, tenant_id=maple.id, vendor_id=vendor.id, order_date=date(2026, 5, 1),
                        description="May utilities",
                        lines=[{"item_description": "Common-area utilities", "quantity": 1,
                                "unit_price": "1850.00",
                                "distributions": [{"code_combination_id": exp_util.id, "amount": "1850.00"}]}],
                        created_by=su.id)
        approve_po(po2)
        inv2 = create_invoice(db, tenant_id=maple.id, vendor_id=vendor.id, invoice_number="MG-INV-1002",
                              invoice_date=date(2026, 5, 9), gl_date=date(2026, 5, 10),
                              lines=[{"amount": "1850.00",
                                      "distributions": [{"code_combination_id": exp_util.id, "amount": "1850.00"}]}],
                              created_by=su.id)
        inv2.status = "APPROVED"; inv2.approval_status = "APPROVED"
        post_fully(create_accounting_for_ap_invoice(db, inv2, created_by=su.id))

        # AP invoice left PENDING approval (shows on approvals dashboard).
        inv3 = create_invoice(db, tenant_id=maple.id, vendor_id=vendor.id, invoice_number="MG-INV-1003",
                              invoice_date=date(2026, 5, 15), gl_date=date(2026, 5, 15),
                              lines=[{"amount": "640.00",
                                      "distributions": [{"code_combination_id": exp_util.id, "amount": "640.00"}]}],
                              created_by=su.id)
        inv3.status = "SUBMITTED"; inv3.approval_status = "PENDING"
        approvals.submit(db, tenant_id=maple.id, document_type="AP_INVOICE",
                         document_id=inv3.id, amount=Decimal("640.00"), submitted_by=su.id)

        # AP invoice ACCOUNTED but its batch left APPROVED-not-posted (unposted KPI).
        inv4 = create_invoice(db, tenant_id=maple.id, vendor_id=vendor.id, invoice_number="MG-INV-1004",
                              invoice_date=date(2026, 5, 18), gl_date=date(2026, 5, 18),
                              lines=[{"amount": "320.00",
                                      "distributions": [{"code_combination_id": exp_util.id, "amount": "320.00"}]}],
                              created_by=su.id)
        inv4.status = "APPROVED"; inv4.approval_status = "APPROVED"
        b4 = create_accounting_for_ap_invoice(db, inv4, created_by=su.id)
        submit_batch(db, b4)
        approve_batch(db, b4, su.id)  # left APPROVED, NOT posted

        # --- Order-to-Cash: assessments (delinquent + current) ---
        def assess(num_prefix, inv_date, due, amount):
            seq = 0
            for ho in homeowners:
                seq += 1
                db.add(ArInvoice(tenant_id=maple.id, homeowner_id=ho.id,
                                 invoice_number=f"{num_prefix}-{seq:03d}", invoice_type="ASSESSMENT",
                                 amount=Decimal(amount), invoice_date=inv_date, due_date=due, fund="OPER",
                                 status="DRAFT", created_by=su.id, updated_by=su.id))
            db.flush()
            post_fully(create_accounting_for_ar_invoices_bulk(db, maple.id, inv_date, created_by=su.id))

        assess("ASMT-FEB", date(2026, 2, 1), date(2026, 2, 15), "350.00")   # past due -> aging
        assess("ASMT-MAY", date(2026, 5, 1), date(2026, 5, 15), "350.00")   # current

        # --- Receipts / collections (pay May for the first 13 homeowners) ---
        may_invoices = db.execute(select(ArInvoice).where(
            ArInvoice.tenant_id == maple.id, ArInvoice.invoice_number.like("ASMT-MAY-%"))
        ).scalars().all()
        rseq = 0
        for inv in may_invoices[:13]:
            rseq += 1
            pay = inv.amount if rseq % 4 else (inv.amount / 2)  # every 4th pays half
            receipt = ArReceipt(tenant_id=maple.id, homeowner_id=inv.homeowner_id,
                                applied_invoice_id=inv.id, receipt_number=f"MG-RCPT-{rseq:03d}",
                                amount=Decimal(pay), receipt_date=date(2026, 5, 20),
                                payment_method="ACH" if rseq % 2 else "CARD", status="APPLIED",
                                created_by=su.id, updated_by=su.id)
            db.add(receipt)
            db.flush()
            inv.amount_paid = (inv.amount_paid or Decimal("0")) + Decimal(pay)
            if inv.amount_paid >= inv.amount:
                inv.status = "PAID"
            post_fully(create_accounting_for_ar_receipt(db, receipt, fund="OPER", created_by=su.id))

        # --- Budgets (MAY-2026) for Budget vs Actual ---
        for cc, amt in [(combo("4000", "OPER"), "8000.00"), (exp_land, "2500.00"),
                        (exp_util, "2000.00")]:
            db.add(GlBudget(tenant_id=maple.id, code_combination_id=cc.id, period_name="MAY-2026",
                            fund_value="OPER", amount=Decimal(amt), budget_name="ANNUAL",
                            created_by=su.id, updated_by=su.id))

        # --- Service tickets ---
        tickets = [
            ("Pool pump making noise", "MAINTENANCE", "HIGH", "OPEN", None),
            ("Gate remote not working", "MAINTENANCE", "MEDIUM", "IN_PROGRESS", "150.00"),
            ("Noise complaint - unit 112", "COMPLAINT", "LOW", "OPEN", None),
            ("Parking violation - unit 108", "VIOLATION", "MEDIUM", "RESOLVED", None),
            ("Request tree trimming", "REQUEST", "LOW", "OPEN", "900.00"),
        ]
        tseq = 0
        for subj, cat, pri, st, cost in tickets:
            tseq += 1
            db.add(ServiceTicket(tenant_id=maple.id, ticket_number=f"MG-TKT-{tseq:03d}", subject=subj,
                                 category=cat, priority=pri, status=st,
                                 vendor_id=vendor.id if cost else None,
                                 estimated_cost=Decimal(cost) if cost else None,
                                 created_by=su.id, updated_by=su.id))
        db.flush()
        # Convert the tree-trimming ticket into a PO.
        tkt = db.execute(select(ServiceTicket).where(
            ServiceTicket.tenant_id == maple.id, ServiceTicket.subject.like("Request tree%"))
        ).scalar_one()
        po3 = create_po(db, tenant_id=maple.id, vendor_id=vendor.id, order_date=date(2026, 5, 20),
                        description=f"From ticket {tkt.ticket_number}",
                        lines=[{"item_description": "Tree trimming", "quantity": 1, "unit_price": "900.00",
                                "distributions": [{"code_combination_id": exp_land.id, "amount": "900.00"}]}],
                        created_by=su.id)
        tkt.po_header_id = po3.id
        tkt.status = "IN_PROGRESS"

        # Summary counts (computed before commit, while the RLS context is active).
        from sqlalchemy import func
        def count(model):
            return db.execute(select(func.count()).select_from(model).where(
                model.tenant_id == maple.id)).scalar_one()
        counts = (count(PoHeader), count(ArInvoice), count(ArReceipt),
                  count(GlJeBatch), count(ServiceTicket))

        db.commit()

        print("✅ Maple Grove transactions loaded:")
        print(f"   POs={counts[0]}  AR invoices={counts[1]}  receipts={counts[2]}")
        print(f"   GL batches={counts[3]}  tickets={counts[4]}")
        print("   Reports/period to view: MAY-2026 (and FEB-2026 for aging).")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
