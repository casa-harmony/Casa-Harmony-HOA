"""End-to-end HOA isolation check against a *running* API.

The RLS unit tests prove the database enforces isolation. This proves the
deployed stack does, over HTTP, the way an attacker would actually try it:

  1. sign in as a real user;
  2. read their own HOA's data — should succeed;
  3. point X-Tenant-Id at an HOA they are NOT a member of and re-issue the
     same reads — every one must fail or come back empty.

Step 3 is the one that matters. Tenant selection is a client-supplied header,
so nothing stops a caller from changing it; the server has to be the thing
that says no.

    python -m scripts.check_tenant_isolation --base http://127.0.0.1:8000/api/v1
"""
from __future__ import annotations

import argparse
import sys
import uuid

import httpx

# Tenant-scoped reads that should never return another HOA's rows.
PROBE_ENDPOINTS = [
    "/subledger/homeowners",
    "/subledger/invoices",
    "/vendors",
    "/purchasing",
    "/payables",
    "/gl/batches",
    "/documents",
    "/service-desk/tickets",
    "/collections/cases",
    "/residents",
]

PASS, FAIL = "  [PASS]", "  [FAIL]"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8000/api/v1")
    ap.add_argument("--email", default="sysadmin@casaharmony.ai")
    ap.add_argument("--password", default="ChangeMe!Sysadmin1")
    ap.add_argument("--su-email", default="superadmin@casaharmony.ai")
    ap.add_argument("--su-password", default="ChangeMe!Superadmin1")
    args = ap.parse_args()

    failures: list[str] = []
    c = httpx.Client(base_url=args.base, timeout=30.0)

    # ---- 1. sign in --------------------------------------------------------
    print("1. Authentication")
    r = c.post("/auth/login", json={"email": args.email, "password": args.password})
    if r.status_code != 200:
        print(f"{FAIL} login failed: {r.status_code} {r.text[:200]}")
        return 1
    body = r.json()
    token = body["access_token"]
    mine = {m["tenant_id"] for m in body["memberships"]}
    print(f"{PASS} signed in as {body['email']} · superadmin={body['is_superadmin']}")
    print(f"  [info] member of {len(mine)} HOA(s)")
    auth = {"Authorization": f"Bearer {token}"}

    if not mine:
        print(f"{FAIL} user has no memberships; cannot test isolation")
        return 1
    home = sorted(mine)[0]

    # ---- 2. a second HOA this user must not see ----------------------------
    print("\n2. Provisioning a foreign HOA (as SUPERADMIN)")
    r = c.post("/auth/login", json={"email": args.su_email, "password": args.su_password})
    if r.status_code != 200:
        print(f"{FAIL} superadmin login failed: {r.status_code}")
        return 1
    su = {"Authorization": f"Bearer {r.json()['access_token']}"}

    slug = f"isolation-probe-{uuid.uuid4().hex[:8]}"
    r = c.post("/tenants", headers=su,
               json={"name": f"Isolation Probe {slug[-8:]}", "slug": slug})
    if r.status_code not in (200, 201):
        print(f"{FAIL} could not create foreign tenant: {r.status_code} {r.text[:300]}")
        return 1
    foreign = r.json()["id"]
    print(f"{PASS} created foreign HOA {foreign}")
    if foreign in mine:
        print(f"{FAIL} test setup wrong: foreign tenant is in the user's memberships")
        return 1

    # ---- 3. own HOA reads --------------------------------------------------
    print(f"\n3. Reads against the user's OWN HOA ({home[:8]}…)")
    own_ok = 0
    for ep in PROBE_ENDPOINTS:
        r = c.get(ep, headers={**auth, "X-Tenant-Id": home})
        if r.status_code == 200:
            own_ok += 1
        elif r.status_code == 403:
            pass  # role simply lacks this permission — not an isolation problem
        else:
            print(f"  [warn] {ep} → {r.status_code}")
    print(f"{PASS} {own_ok}/{len(PROBE_ENDPOINTS)} endpoints readable in the user's own HOA")

    # ---- 4. the actual attack ---------------------------------------------
    print(f"\n4. Same reads with X-Tenant-Id forged to the FOREIGN HOA ({foreign[:8]}…)")
    for ep in PROBE_ENDPOINTS:
        r = c.get(ep, headers={**auth, "X-Tenant-Id": foreign})

        if r.status_code in (401, 403, 404):
            print(f"{PASS} {ep} → {r.status_code} (refused)")
            continue

        if r.status_code != 200:
            print(f"  [warn] {ep} → {r.status_code} (unexpected, not a leak)")
            continue

        payload = r.json()
        rows = payload if isinstance(payload, list) else payload.get("items", payload)
        n = len(rows) if isinstance(rows, list) else (0 if not rows else 1)
        if n:
            print(f"{FAIL} {ep} → 200 with {n} row(s) from an HOA the user does not belong to")
            failures.append(f"LEAK {ep}")
        else:
            print(f"{PASS} {ep} → 200 but empty (RLS filtered it)")

    # ---- 5. writes into a foreign HOA --------------------------------------
    print("\n5. Write attempt into the foreign HOA")
    r = c.post("/vendors", headers={**auth, "X-Tenant-Id": foreign},
               json={"name": "Isolation probe vendor", "vendor_number": "ISO-1"})
    if r.status_code in (401, 403, 404, 422):
        print(f"{PASS} POST /vendors → {r.status_code} (refused)")
    elif r.status_code in (200, 201):
        print(f"{FAIL} POST /vendors → {r.status_code}: wrote into a foreign HOA")
        failures.append("LEAK write /vendors")
    else:
        print(f"  [warn] POST /vendors → {r.status_code}")

    # ---- 6. no tenant header at all ---------------------------------------
    print("\n6. Tenant-scoped read with NO X-Tenant-Id")
    r = c.get("/subledger/homeowners", headers=auth)
    if r.status_code == 200:
        payload = r.json()
        rows = payload if isinstance(payload, list) else []
        if rows:
            print(f"{FAIL} returned {len(rows)} row(s) with no tenant selected")
            failures.append("LEAK no-tenant-header")
        else:
            print(f"{PASS} 200 but empty")
    else:
        print(f"{PASS} → {r.status_code} (refused)")

    # The probe tenant was created through the API, which has no delete route,
    # so it cannot be removed over HTTP. Tell the caller how to clean it up.
    print(f"\nNOTE: this run created a throwaway HOA (slug '{slug}'). Remove it with:")
    print(f'  DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.purge_tenant --slug {slug} --yes')

    print("\n" + "=" * 60)
    if failures:
        print("RESULT: TENANT ISOLATION FAILURES")
        for f in failures:
            print(f"   - {f}")
        return 1
    print("RESULT: no cross-HOA access observed over HTTP.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
