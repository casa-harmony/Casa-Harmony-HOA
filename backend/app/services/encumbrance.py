"""Encumbrance / commitment accounting service.

Encumber a PO's committed dollar amount on approval; liquidate it proportionally as
invoices bill against the PO; re-encumber on cancellation. GL batches (Dr
encumbrance / Cr reserve, reversed on liquidation) are posted only when configured;
the ``po_encumbrances`` ledger is always maintained for commitment reporting.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.encumbrance import EncumbranceSettings, PoEncumbrance
from app.models.gl import GlJeBatch, GlJeLine
from app.models.kff import GlCodeCombination
from app.models.procurement import PoHeader
from app.services import subledger_accounting as sla

CENT = Decimal("0.01")


def get_settings(db: Session, tenant_id: uuid.UUID) -> EncumbranceSettings:
    s = db.execute(
        select(EncumbranceSettings).where(EncumbranceSettings.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if s is None:
        from app.core.model_defaults import make_default
        s = make_default(EncumbranceSettings, tenant_id=tenant_id)
    return s


def _active(settings: EncumbranceSettings) -> bool:
    return bool(settings.enabled and settings.encumbrance_combination_id
                and settings.reserve_combination_id)


def _next_name(db: Session, tenant_id: uuid.UUID) -> str:
    n = db.execute(
        select(func.count(GlJeBatch.id)).where(
            GlJeBatch.tenant_id == tenant_id, GlJeBatch.source == "ENC")
    ).scalar_one()
    return f"ENC-{n + 1:06d}"


def _post_je(db, tenant_id, settings, po, amount: Decimal, *, liquidate: bool,
             gl_date: date, created_by) -> uuid.UUID:
    """Dr encumbrance / Cr reserve (encumber), or the reverse (liquidate)."""
    structure = sla.get_primary_structure(db, tenant_id)
    enc = db.get(GlCodeCombination, settings.encumbrance_combination_id)
    res = db.get(GlCodeCombination, settings.reserve_combination_id)
    name = _next_name(db, tenant_id)
    batch = sla._new_batch(db, tenant_id, "ENC", gl_date, name, created_by)
    header = sla._add_header(db, batch, structure.id, "Encumbrance", "Encumbrance",
                             gl_date, "PO_ENCUMBRANCE", po.id, f"{name} {po.po_number}", created_by)
    mag = abs(Decimal(amount)).quantize(CENT)
    # Encumber: Dr encumbrance / Cr reserve. Liquidate: Dr reserve / Cr encumbrance.
    enc_dr, enc_cr = (Decimal("0"), mag) if liquidate else (mag, Decimal("0"))
    res_dr, res_cr = (mag, Decimal("0")) if liquidate else (Decimal("0"), mag)
    db.add(GlJeLine(tenant_id=tenant_id, header_id=header.id, line_num=1,
                    code_combination_id=enc.id, entered_dr=enc_dr, entered_cr=enc_cr,
                    fund_value=enc.fund_value, description="Encumbrance",
                    created_by=created_by, updated_by=created_by))
    db.add(GlJeLine(tenant_id=tenant_id, header_id=header.id, line_num=2,
                    code_combination_id=res.id, entered_dr=res_dr, entered_cr=res_cr,
                    fund_value=res.fund_value, description="Reserve for encumbrance",
                    created_by=created_by, updated_by=created_by))
    db.flush()
    db.refresh(batch)
    sla._set_control_totals(batch)
    db.flush()
    return header.id


def encumber_po(db: Session, po: PoHeader, created_by=None) -> PoEncumbrance | None:
    """On PO approval: record the commitment and (if configured) post the encumbrance JE."""
    existing = db.execute(
        select(PoEncumbrance).where(PoEncumbrance.po_header_id == po.id)
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    committed = Decimal(po.amount_limit or po.amount)
    enc = PoEncumbrance(tenant_id=po.tenant_id, po_header_id=po.id,
                        encumbered_amount=committed, liquidated_amount=Decimal("0"),
                        status="OPEN", created_by=created_by, updated_by=created_by)
    db.add(enc)
    db.flush()
    settings = get_settings(db, po.tenant_id)
    if _active(settings) and committed > 0:
        enc.je_header_id = _post_je(db, po.tenant_id, settings, po, committed,
                                    liquidate=False, gl_date=po.order_date, created_by=created_by)
    db.flush()
    return enc


def _enc_for(db, po) -> PoEncumbrance | None:
    return db.execute(
        select(PoEncumbrance).where(PoEncumbrance.po_header_id == po.id)
    ).scalar_one_or_none()


def liquidate(db: Session, po: PoHeader, amount: Decimal, created_by=None) -> None:
    """Liquidate (relieve) encumbrance as the PO is billed."""
    enc = _enc_for(db, po)
    if enc is None or amount <= 0:
        return
    amt = min(Decimal(amount), enc.open_commitment)
    if amt <= 0:
        return
    enc.liquidated_amount = (Decimal(enc.liquidated_amount) + amt).quantize(CENT)
    if enc.open_commitment <= 0:
        enc.status = "LIQUIDATED"
    settings = get_settings(db, po.tenant_id)
    if _active(settings):
        _post_je(db, po.tenant_id, settings, po, amt, liquidate=True,
                 gl_date=po.order_date, created_by=created_by)
    db.flush()


def reverse_liquidation(db: Session, po: PoHeader, amount: Decimal, created_by=None) -> None:
    """Re-encumber when billing is reversed (invoice cancellation)."""
    enc = _enc_for(db, po)
    if enc is None or amount <= 0:
        return
    amt = min(Decimal(amount), Decimal(enc.liquidated_amount))
    if amt <= 0:
        return
    enc.liquidated_amount = (Decimal(enc.liquidated_amount) - amt).quantize(CENT)
    enc.status = "OPEN"
    settings = get_settings(db, po.tenant_id)
    if _active(settings):
        _post_je(db, po.tenant_id, settings, po, amt, liquidate=False,
                 gl_date=po.order_date, created_by=created_by)
    db.flush()
