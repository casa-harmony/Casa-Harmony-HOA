"""Routing-number → bank enrichment via a public API (best-effort).

Uses routingnumbers.info. Network failures degrade gracefully to ``None`` so bank
setup still works offline (the operator simply types the bank name manually).
"""
from __future__ import annotations


def lookup_routing(routing_number: str) -> dict | None:
    rn = (routing_number or "").strip()
    if len(rn) != 9 or not rn.isdigit():
        return None
    try:
        import httpx

        resp = httpx.get(
            "https://www.routingnumbers.info/api/data.json",
            params={"rn": rn}, timeout=4.0,
        )
        data = resp.json()
        if data.get("code") != 200:
            return None
        return {
            "bank_name": data.get("customer_name"),
            "routing_number": rn,
            "address": data.get("address"),
            "city": data.get("city"),
            "state": data.get("state"),
        }
    except Exception:
        return None  # offline / unreachable — caller supplies the name manually
