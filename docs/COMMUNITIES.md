# Logins & Communities (HOAs)

**Everything runs against real Neon PostgreSQL — no mock data sources.** All data persists across browser sessions and redeploys. Upload documents and they land in Cloudinary. Add residents and they're live in the database immediately.

Commands run from `backend/` with the environment loaded:

```bash
cd backend
set -a; . ./.env; set +a
```

Community management (creating/removing HOAs) needs the **database owner role**:

```bash
DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.create_community …
DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.purge_tenant …
```

---

## Who can log in right now

The live Neon database currently holds one community and two staff logins
(everything else was development/test data and has been purged).

### Staff — main login (`/login`)

| Email | Password | Role | Can do |
|---|---|---|---|
| `superadmin@casaharmony.ai` | `<See .env / provisioning output>` | **SUPERADMIN** | Create communities, manage all HOAs, change sysadmin password |
| `sysadmin@casaharmony.ai` | `<See .env / provisioning output>` | **SYSADMIN** | Run Casa Harmony HOA: add/manage users, residents, finances, everything except creating new HOAs |

**Change both passwords immediately** — these are factory defaults.

SUPERADMIN is the only role that can create a community. Use it to spin up a new HOA, then sign in as that HOA's SYSADMIN to manage it day-to-day.

### Resident — portal login (`/portal/login`)

| Username | HOA | Password | Unit |
|---|---|---|---|
| `owner1` | `casa-harmony` | `<See .env / provisioning output>` | Demo Homeowner 1 |

Residents authenticate with **HOA slug + username + password**, then receive a one-time code (in development, returned in the API response as `dev_otp`; in production, sent by email or SMS).

> **Casa Harmony is the demo HOA** — it holds sample homeowners and invoices for testing the UI. To work with real data, create your own community (see next section). Your community starts empty; you add the residents and their data from the staff screens or via the provisioning script.

---

## Create a new community

One command stands up a complete HOA end-to-end:

```bash
DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.create_community \
    --name "Willowbrook HOA" \
    --slug willowbrook \
    --admin-email admin@willowbrook.org \
    --admin-password 'StrongPassword123!' \
    --resident 'jsmith:Jane Smith:101A:jane@example.com' \
    --resident 'bjones:Bob Jones:102B:bob@example.com'
```

This creates:
- The HOA (tenant) itself
- A default 6-segment Chart of Accounts (standard HOA structure)
- An admin user (SYSADMIN role for that HOA only)
- Resident accounts linked to their units (homeowners)

**Arguments:**
- `--name`: Display name, e.g., "Willowbrook HOA"
- `--slug`: URL-safe id residents log in against (lowercase, digits, hyphens only; permanent, so choose carefully)
- `--admin-email`: Staff login email
- `--admin-password`: Staff password (8+ characters recommended)
- `--resident`: Repeatable; format is `username:Full Name:unit_number[:email]`
  - Username is the resident portal login
  - Unit is their building/lot (e.g., 101A, Unit 12)
  - Email is optional
  - Residents are auto-linked to a homeowner account created for their unit

**After provisioning:**

1. Admin signs in at `/login` with their email and password
2. Residents receive instructions to visit `/portal/login`, set a password via "Forgot password", then sign in
3. Admin adds invoices, receipts, residents, documents, etc. from the staff screens
4. All financial data, documents, and resident records live in the database in real-time

**Alternatively**, do all of this inside the app as SUPERADMIN:
1. Navigate to Communities screen
2. Click "New community"
3. Fill in the details and save
4. Add users and memberships from the Users screen
5. Add residents from the Residents screen

The script is faster for standing up a test HOA quickly; the UI is better for production use where you're doing it once and want full control.

---

## Hide or remove a community

### Hide the demo HOA from community lists

The Casa Harmony demo community is marked as "demo" and hidden from community lists by default. To show it:

1. Open the Communities screen (staff-only, SUPERADMIN access)
2. Click "Show demo communities" button in the top-right
3. The Casa Harmony card now appears with a "Demo" badge

This is a display toggle only — the demo HOA still exists, all its data is intact, and any staff member who is a member of it still accesses it normally. It's simply not shown in the default community list.

### Permanently delete a community

Deletes an HOA and **all** its data and attachments — **irreversible**:

```bash
DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.purge_tenant --slug willowbrook --yes
```

The script:
- Deletes every row scoped to that HOA (invoices, residents, documents, GL journals, etc.)
- Removes any Cloudinary files associated with documents in that HOA
- Deletes the HOA tenant itself
- Cleans up any users left with no remaining memberships

It refuses to touch `casa-harmony` (the demo) unless you pass `--force`. Use `--yes` to skip the confirmation prompt.

---

## Document storage

Uploaded invoices, contracts, reserve studies, and other document attachments are stored in **Cloudinary** (if configured) or fall back to local disk (if not).

**For production** (e.g., Railway), set these environment variables on the API:
```
CLOUDINARY_CLOUD_NAME=your-cloud
CLOUDINARY_API_KEY=your-key
CLOUDINARY_API_SECRET=your-secret
CLOUDINARY_FOLDER=casa-harmony/documents
```

Or pass a single `CLOUDINARY_URL`:
```
CLOUDINARY_URL=cloudinary://key:secret@cloud-name
```

**For local development**, leave them unset. Documents upload to `/tmp/casa_docs` (local disk) which vanishes on restart — fine for testing, not for production.

All document downloads are gated by the API: the system generates a signed, short-lived Cloudinary URL server-side before sending it to the client, so access control (permissions + tenant isolation) lives at the API layer, not Cloudinary's link security.

---

## Reset everything (careful!)

To wipe all HOAs and recreate just the baseline (superadmin, sysadmin, Casa Harmony demo):

```bash
# Delete all communities
DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.purge_tenant --slug casa-harmony --force --yes

# Re-seed the baseline
python -m scripts.seed
```

This recreates the factory default state: SUPERADMIN, SYSADMIN logins, and the Casa Harmony demo HOA ready to use.
