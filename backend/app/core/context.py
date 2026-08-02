"""Request-scoped tenant/identity context.

A ``ContextVar`` holds the active tenant and principal for the duration of a
request. The middleware populates it; the database session dependency reads it
to issue ``SET LOCAL app.current_tenant`` so PostgreSQL Row-Level Security can
enforce isolation at the database layer (defence in depth on top of the ORM).
"""
from __future__ import annotations

from contextvars import ContextVar
from dataclasses import dataclass
from uuid import UUID


@dataclass
class RequestContext:
    user_id: UUID | None = None
    email: str | None = None
    is_superadmin: bool = False
    tenant_id: UUID | None = None          # active/selected HOA
    permissions: frozenset[str] = frozenset()
    scope: str | None = None               # e.g. "resident" for portal tokens


_ctx: ContextVar[RequestContext] = ContextVar("request_context", default=RequestContext())


def set_context(ctx: RequestContext) -> None:
    _ctx.set(ctx)


def get_context() -> RequestContext:
    return _ctx.get()


def reset_context() -> None:
    _ctx.set(RequestContext())
