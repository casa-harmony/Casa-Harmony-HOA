"""Database engine, session factory, and the RLS-aware request session.

Every web request obtains its session via :func:`get_db`. Before yielding, the
session sets two PostgreSQL session variables inside the transaction:

* ``app.current_tenant`` – the active HOA UUID (or the nil UUID for none)
* ``app.is_superadmin``  – ``'on'`` for the platform SUPERADMIN, else ``'off'``

RLS policies (see migration) read these via ``current_setting(...)`` so tenant
isolation is enforced by PostgreSQL itself, not only by application code.
"""
from __future__ import annotations

from typing import Generator
from uuid import UUID

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.core.context import get_context

NIL_UUID = "00000000-0000-0000-0000-000000000000"

engine = create_engine(
    settings.sqlalchemy_database_uri,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


def _apply_rls(session: Session, tenant_id: UUID | None, is_superadmin: bool) -> None:
    """Bind the RLS GUCs for the current transaction (``SET LOCAL``)."""
    session.execute(
        text("SELECT set_config('app.current_tenant', :tid, true)"),
        {"tid": str(tenant_id) if tenant_id else NIL_UUID},
    )
    session.execute(
        text("SELECT set_config('app.is_superadmin', :flag, true)"),
        {"flag": "on" if is_superadmin else "off"},
    )


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency yielding an RLS-scoped session."""
    ctx = get_context()
    session = SessionLocal()
    try:
        _apply_rls(session, ctx.tenant_id, ctx.is_superadmin)
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_elevated_db() -> Generator[Session, None, None]:
    """Dependency for the *public login* route only.

    Authentication happens before a tenant is selected, so resolving the user's
    cross-tenant memberships requires platform-level DB visibility. The route is
    still protected by the password check; this only widens DB row visibility for
    the duration of that single request.
    """
    session = SessionLocal()
    try:
        _apply_rls(session, None, is_superadmin=True)
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def session_for(tenant_id: UUID | None, is_superadmin: bool) -> Session:
    """Open a manually-managed RLS session (scripts, background jobs, tests)."""
    session = SessionLocal()
    _apply_rls(session, tenant_id, is_superadmin)
    return session
