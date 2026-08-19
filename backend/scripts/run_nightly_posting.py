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


def post_for_tenant(tenant_id, sandbox: bool = False) -> int:
    db = session_for(tenant_id=tenant_id, is_superadmin=True, sandbox=sandbox)
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
    # Both sides of the sandbox partition are posted, each under its own session:
    # RLS hides one side from the other, so a single pass would silently skip the
    # sandbox and leave a developer wondering why their batches never post.
    total = 0
    count = 0
    for sandbox in (False, True):
        # Tenant registry read under an elevated session (platform-level).
        reg = session_for(tenant_id=None, is_superadmin=True, sandbox=sandbox)
        try:
            tenant_ids = [t.id for t in reg.execute(select(Tenant)).scalars()]
        finally:
            reg.close()

        label = "sandbox" if sandbox else "live"
        for tid in tenant_ids:
            count += 1
            try:
                n = post_for_tenant(tid, sandbox=sandbox)
                total += n
                print(f"  {label} tenant {tid}: posted {n} batch(es)")
            except Exception as exc:  # pragma: no cover
                print(f"  {label} tenant {tid}: ERROR {exc}")
    print(f"✅ Nightly posting complete — {total} batch(es) posted across {count} tenant(s).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
