"""P32: transient-default hydration helper + singleton serialization safety."""
from __future__ import annotations

import uuid

from app.core.model_defaults import hydrate_defaults, make_default


def test_make_default_hydrates_all_column_defaults():
    from app.models.scheduling import SchedulerConfig
    c = make_default(SchedulerConfig, tenant_id=uuid.uuid4())
    # Every default-bearing column is populated (not None), even unsaved.
    assert c.monthly_statements_enabled is False
    assert c.attach_statement_pdf is True and c.attach_board_pdf is True
    assert c.dunning_enabled is False and c.day_of_month == 1


def test_singleton_transients_serialize_through_schemas():
    from decimal import Decimal
    from app.models.ar_billing import LateFeeRule
    from app.models.notifications import ApMatchTolerance
    from app.models.encumbrance import EncumbranceSettings
    from app.models.payment_gateway import GatewayConfig

    lfr = make_default(LateFeeRule, tenant_id=uuid.uuid4())
    assert lfr.active is False and Decimal(lfr.flat_amount) == 0 and lfr.fee_type == "FLAT"

    tol = make_default(ApMatchTolerance, tenant_id=uuid.uuid4())
    assert tol.require_receipt is False and Decimal(tol.amount_tolerance_pct) == 0

    enc = make_default(EncumbranceSettings, tenant_id=uuid.uuid4())
    assert enc.enabled is False

    gw = make_default(GatewayConfig, tenant_id=uuid.uuid4())
    assert gw.provider == "MOCK" and gw.active is False

    # Validate one through its from_attributes schema (the real failure path).
    from app.schemas.scheduling import SchedulerConfigOut
    from app.models.scheduling import SchedulerConfig
    out = SchedulerConfigOut.model_validate(make_default(SchedulerConfig, tenant_id=uuid.uuid4()))
    assert out.dunning_enabled is False


def test_hydrate_skips_primary_key_and_keeps_overrides():
    from app.models.scheduling import SchedulerConfig
    c = SchedulerConfig(tenant_id=uuid.uuid4(), day_of_month=15)
    hydrate_defaults(c)
    assert c.id is None  # primary key left unset
    assert c.day_of_month == 15  # explicit value preserved
    assert c.dunning_enabled is False  # default filled
