"""GL balance period roll-forward (service-level, isolated via rollback)."""
from __future__ import annotations

import os
from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.core.database import session_for
from app.models.gl import GlBalance, GlJeBatch, GlJeHeader, GlJeLine
from app.models.identity import Tenant, User
from app.models.kff import GlCodeCombination, KffStructure
from app.services import gl_batch

os.environ.setdefault("SECRET_KEY", "dev_test_secret_key_123")


def _demo():
    db = session_for(tenant_id=None, is_superadmin=True)
    tid = db.execute(select(Tenant).where(Tenant.slug == "casa-harmony")).scalar_one().id
    su_id = db.execute(select(User).where(User.is_superadmin.is_(True))).scalars().first().id
    db.close()
    return tid, su_id


def _combo(db, tid, su_id, structure_id, tag, account_type):
    cc = GlCodeCombination(
        tenant_id=tid, structure_id=structure_id,
        concatenated_segments=f"0100-OPER-000-{tag}-0000-NONE",
        natural_account_value=tag, fund_value="OPER", account_type=account_type,
        enabled=True, allow_posting=True, created_by=su_id, updated_by=su_id,
    )
    db.add(cc)
    db.flush()
    return cc


def _posted_batch(db, tid, su_id, structure_id, acct_dr, acct_cr, amount, d):
    from app.services.periods import period_name
    batch = GlJeBatch(tenant_id=tid, batch_name=f"RF-{d.isoformat()}", source="Manual",
                      accounting_date=d, period_name=period_name(d), status="DRAFT",
                      created_by=su_id, updated_by=su_id)
    db.add(batch)
    db.flush()
    header = GlJeHeader(tenant_id=tid, batch_id=batch.id, structure_id=structure_id,
                        je_name="RF", je_category="Manual", je_source="Manual",
                        accounting_date=d, period_name=period_name(d), status="DRAFT",
                        created_by=su_id, updated_by=su_id)
    db.add(header)
    db.flush()
    db.add(GlJeLine(tenant_id=tid, header_id=header.id, line_num=1,
                    code_combination_id=acct_dr.id, entered_dr=amount, entered_cr=0,
                    fund_value="OPER", created_by=su_id, updated_by=su_id))
    db.add(GlJeLine(tenant_id=tid, header_id=header.id, line_num=2,
                    code_combination_id=acct_cr.id, entered_dr=0, entered_cr=amount,
                    fund_value="OPER", created_by=su_id, updated_by=su_id))
    db.flush()
    db.refresh(batch)
    gl_batch.submit_batch(db, batch)
    gl_batch.approve_batch(db, batch, su_id)
    gl_batch.post_batch(db, batch)
    return batch


def test_balance_rolls_forward_across_periods():
    tid, su_id = _demo()
    db = session_for(tenant_id=tid, is_superadmin=True)
    try:
        structure_id = db.execute(
            select(KffStructure).where(KffStructure.tenant_id == tid)
        ).scalars().first().id
        # Unique in-transaction accounts so committed balances never collide.
        acct_dr = _combo(db, tid, su_id, structure_id, "9990", "A")
        acct_cr = _combo(db, tid, su_id, structure_id, "9991", "L")

        _posted_batch(db, tid, su_id, structure_id, acct_dr, acct_cr, Decimal("100"), date(2026, 1, 15))
        _posted_batch(db, tid, su_id, structure_id, acct_dr, acct_cr, Decimal("50"), date(2026, 2, 15))

        def bal(period):
            return db.execute(
                select(GlBalance).where(
                    GlBalance.tenant_id == tid,
                    GlBalance.code_combination_id == acct_dr.id,
                    GlBalance.period_name == period,
                )
            ).scalar_one()

        jan = bal("JAN-2026")
        feb = bal("FEB-2026")
        assert jan.begin_balance == Decimal("0")
        assert jan.end_balance == Decimal("100")
        # February opens with January's ending balance (roll-forward).
        assert feb.begin_balance == Decimal("100")
        assert feb.end_balance == Decimal("150")
        db.rollback()
    finally:
        db.close()
