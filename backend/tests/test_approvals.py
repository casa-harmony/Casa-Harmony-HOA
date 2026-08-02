"""Service-level tests: multi-level approval escalation + fund-mandatory rule.

These exercise the engine directly (no HTTP) to keep them isolated from the
shared document state used by the API tests.
"""
from __future__ import annotations

import os
import uuid
from decimal import Decimal

import pytest
from sqlalchemy import select

from app.core.database import session_for
from app.models.identity import Role, Tenant, User
from app.models.kff import GlCodeCombination, KffStructure
from app.models.workflow import ApprovalHierarchy, ApprovalRequest, ApprovalRule
from app.services import approvals
from app.services.distributions import DistributionError, resolve_combination

os.environ.setdefault("SECRET_KEY", "dev_test_secret_key_123")


def _demo():
    db = session_for(tenant_id=None, is_superadmin=True)
    tenant = db.execute(select(Tenant).where(Tenant.slug == "casa-harmony")).scalar_one()
    su = db.execute(select(User).where(User.is_superadmin.is_(True))).scalars().first()
    role = db.execute(select(Role).where(Role.code == "SYSADMIN")).scalar_one()
    tid, sid_role = tenant.id, role.id
    su_id = su.id
    db.close()
    return tid, sid_role, su_id


def test_multi_level_approval_escalation():
    tid, role_id, su_id = _demo()
    db = session_for(tenant_id=tid, is_superadmin=True)
    try:
        # Fresh CONTRACT hierarchy with two amount-banded levels.
        existing = db.execute(
            select(ApprovalHierarchy).where(
                ApprovalHierarchy.tenant_id == tid,
                ApprovalHierarchy.document_type == "CONTRACT",
            )
        ).scalar_one_or_none()
        if existing is None:
            h = ApprovalHierarchy(tenant_id=tid, name="Contract Approvals",
                                  document_type="CONTRACT", created_by=su_id, updated_by=su_id)
            db.add(h)
            db.flush()
            db.add(ApprovalRule(tenant_id=tid, hierarchy_id=h.id, level_num=1,
                                min_amount=Decimal("0"), max_amount=None, approver_role_id=role_id,
                                created_by=su_id, updated_by=su_id))
            db.add(ApprovalRule(tenant_id=tid, hierarchy_id=h.id, level_num=2,
                                min_amount=Decimal("1000"), max_amount=None, approver_role_id=role_id,
                                created_by=su_id, updated_by=su_id))
            db.flush()

        # A $1,500 contract needs both levels.
        doc_id = uuid.uuid4()
        assert approvals.required_levels(db, tid, "CONTRACT", Decimal("1500")) == 2
        req = approvals.submit(db, tenant_id=tid, document_type="CONTRACT",
                               document_id=doc_id, amount=Decimal("1500"), submitted_by=su_id)
        assert req.status == "PENDING" and req.current_level == 1

        approvals.act(db, request=req, approver_id=su_id, approve=True)
        assert req.status == "PENDING" and req.current_level == 2  # escalated, not done

        approvals.act(db, request=req, approver_id=su_id, approve=True)
        assert req.status == "APPROVED"

        # A $500 contract only needs level 1.
        assert approvals.required_levels(db, tid, "CONTRACT", Decimal("500")) == 1
        db.rollback()  # don't persist test fixtures
    finally:
        db.close()


def test_fund_is_mandatory_on_distributions():
    tid, _, su_id = _demo()
    db = session_for(tenant_id=tid, is_superadmin=True)
    try:
        structure = db.execute(
            select(KffStructure).where(KffStructure.tenant_id == tid)
        ).scalars().first()
        # A code combination with NO fund value must be rejected as a distribution.
        cc = GlCodeCombination(
            tenant_id=tid, structure_id=structure.id,
            concatenated_segments="0100-XXXX-000-5000-0000-NONE",
            natural_account_value="5000", fund_value=None, account_type="E",
            enabled=True, allow_posting=True, created_by=su_id, updated_by=su_id,
        )
        db.add(cc)
        db.flush()
        with pytest.raises(DistributionError):
            resolve_combination(db, tid, cc.id)
        db.rollback()
    finally:
        db.close()
