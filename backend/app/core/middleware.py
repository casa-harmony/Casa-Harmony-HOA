"""Tenant-context middleware.

Resolves the bearer token and the active tenant (``X-Tenant-Id`` header) on every
request and stores them in the request-scoped :class:`RequestContext`. The DB
session dependency later reads this to bind PostgreSQL RLS GUCs.

Authorization (does the principal actually belong to that tenant?) is enforced in
:mod:`app.core.deps`; this layer only *resolves* identity so it is cheap and never
raises for anonymous/public routes.
"""
from __future__ import annotations

import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.core.context import RequestContext, reset_context, set_context
from app.core.security import decode_token


class TenantContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        reset_context()
        ctx = RequestContext()

        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:].strip()
            try:
                claims = decode_token(token)
                ctx.user_id = uuid.UUID(claims["sub"])
                ctx.email = claims.get("email")
                ctx.is_superadmin = bool(claims.get("is_superadmin", False))
                # Which side of the sandbox partition this token belongs to.
                # Absent on tokens issued before the partition existed, which
                # correctly defaults them to the live side.
                ctx.is_sandbox = bool(claims.get("sandbox", False))
                ctx.scope = claims.get("scope")
                # Resident portal tokens carry their HOA; bind RLS from the token
                # (residents never send X-Tenant-Id and cannot switch HOAs).
                if ctx.scope == "resident" and claims.get("tenant_id"):
                    ctx.tenant_id = uuid.UUID(claims["tenant_id"])
            except Exception:
                # Leave context anonymous; protected routes reject downstream.
                ctx = RequestContext()

        # Staff tokens select the active HOA via header; ignored for residents.
        tenant_header = request.headers.get("x-tenant-id")
        if tenant_header and ctx.scope != "resident":
            try:
                ctx.tenant_id = uuid.UUID(tenant_header)
            except ValueError:
                ctx.tenant_id = None

        # Stash raw request metadata for audit logging.
        request.state.client_ip = request.client.host if request.client else None
        request.state.user_agent = request.headers.get("user-agent")

        set_context(ctx)
        try:
            response = await call_next(request)
        finally:
            reset_context()
        return response
