"""Readiness "next action" links must point at real frontend routes.

WP3's guided setup tells a new administrator where to go next; a link to a
route that does not exist turns the whole onboarding path into a dead end.
This test parses every ``next_action_route`` the readiness service can emit
and fails if any of them is missing from the frontend route table.
"""
from __future__ import annotations

import re
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
FRONTEND_APP_DIR = BACKEND_DIR / ".." / "frontend-mock" / "app" / "(app)"


def _emitted_routes() -> set[str]:
    source = (BACKEND_DIR / "app" / "services" / "readiness.py").read_text()
    return set(re.findall(r'"next_action_route":\s*"([^"]+)"', source))


def _frontend_static_routes() -> set[str]:
    """Top-level route segments under app/(app)/, ignoring route groups."""
    routes: set[str] = set()
    if not FRONTEND_APP_DIR.is_dir():
        return routes
    for child in FRONTEND_APP_DIR.iterdir():
        if not child.is_dir():
            continue
        # Next.js route groups like (app) are segment groups, not routes.
        if child.name.startswith("(") and child.name.endswith(")"):
            continue
        routes.add(child.name)
    return routes


def test_readiness_next_action_routes_exist_in_frontend():
    emitted = _emitted_routes()
    assert emitted, "readiness.py emits no next_action_route values to check"
    available = _frontend_static_routes()
    missing = sorted(r for r in emitted if r.lstrip("/") not in available)
    assert not missing, (
        f"Readiness links to missing frontend routes: {missing}. "
        "Update app/services/readiness.py next_action_route to a real route "
        f"under frontend-mock/app/(app)/ (available: {sorted(available)})."
    )
