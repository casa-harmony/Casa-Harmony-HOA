"""Nightly GL posting job.

Posts every APPROVED GL journal batch for every tenant into GL_BALANCES, then
reports per-tenant counts. Designed to be idempotent (already-POSTED batches are
skipped) so it is safe to re-run.

Schedule options (see docs/SCHEDULING.md):
* cron:      0 2 * * *  cd backend && python -m scripts.run_nightly_posting
* Celery:    wrap ``post_for_tenant`` in a beat-scheduled task.

Runs each tenant under its own RLS-scoped, elevated session and commits per
tenant so one tenant's failure does not roll back the others.
"""
from __future__ import annotations

import sys

from sqlalchemy import select

from app.core.database import session_for
from app.models.identity import Tenant
from app.services.gl_batch import post_all_approved


def post_for_tenant(tenant_id) -> int:
    db = session_for(tenant_id=tenant_id, is_superadmin=True)
    try:
        posted = post_all_approved(db, tenant_id)
        db.commit()
        return len(posted)
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def main() -> int:
    # Tenant registry read under an elevated session (platform-level).
    reg = session_for(tenant_id=None, is_superadmin=True)
    try:
        tenant_ids = [t.id for t in reg.execute(select(Tenant)).scalars()]
    finally:
        reg.close()

    total = 0
    for tid in tenant_ids:
        try:
            n = post_for_tenant(tid)
            total += n
            print(f"  tenant {tid}: posted {n} batch(es)")
        except Exception as exc:  # pragma: no cover
            print(f"  tenant {tid}: ERROR {exc}")
    print(f"✅ Nightly posting complete — {total} batch(es) posted across {len(tenant_ids)} tenant(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
