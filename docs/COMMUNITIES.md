# Logins & communities (HOAs)

How to sign in today, and how to create / remove a community (tenant). Commands
run from `backend/` with the environment loaded:

```bash
set -a; . ./.env; set +a
```

Community management writes across identity tables, so run those scripts as the
**owner** role by prefixing `DATABASE_URL="$MIGRATION_DB_URL"`.

---

## Who can log in right now

The live Neon database currently holds one community and two staff logins
(everything else was development/test data and has been purged).

### Staff — main login (`/login`)

| Login | Password | Role | Community |
|---|---|---|---|
| `superadmin@casaharmony.ai` | `ChangeMe!Superadmin1` | SUPERADMIN (whole platform) | all |
| `sysadmin@casaharmony.ai` | `ChangeMe!Sysadmin1` | SYSADMIN | Casa Harmony Master Association |

- **SUPERADMIN** is the only role that can create communities. It sees and
  administers every HOA.
- **SYSADMIN** runs a single HOA end to end — users, residents, COA, and all the
  financial modules.
- **Change both passwords after first login** (they are seed defaults).

### Resident — portal login (`/portal/login`)

| Username | Community (HOA) | Password | Unit |
|---|---|---|---|
| `owner1` | `casa-harmony` | `ChangeMe!Owner1` | Demo Homeowner 1 |

Residents sign in with **HOA + username + password**, then an emailed one-time
code (in development the code comes back in the API response as `dev_otp`; in
production it is emailed).

> The other names you may see on staff screens in the Casa Harmony HOA — "Bo
> Ard", "Del Inquent", "Dun Ning", "Pat Owner" — are **sample/demo homeowners**,
> not real people. Casa Harmony is the kitchen-sink demo HOA. For real use,
> create your own clean community (below); its screens start empty and show only
> the residents you add.

---

## Create a new community

One command provisions the whole thing — the HOA, its Chart of Accounts, an
admin login, and any resident logins you list:

```bash
DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.create_community \
    --name "Willowbrook HOA" --slug willowbrook \
    --admin-email admin@willowbrook.org --admin-password 'Str0ng!Passw0rd' \
    --resident 'jsmith:Jane Smith:101A:jane@example.com' \
    --resident 'bjones:Bob Jones:102B:bob@example.com'
```

- `--slug` is the URL-safe id residents log in against (lower-case, digits,
  hyphens). It cannot be changed later, so pick it deliberately.
- The admin is created as **SYSADMIN** for that HOA and can then do everything
  else from inside the app.
- Each `--resident` is `username:Full Name:unit[:email]`, repeatable. Every
  resident is linked to a freshly created homeowner "unit" and starts with **no
  usable password** — they set one via the portal's *Forgot password* (or you
  can set it for them from the staff Residents screen).
- Add `--no-coa` only if you intend to configure the Chart of Accounts by hand.

You can also do all of this **inside the app** as SUPERADMIN/SYSADMIN: create the
tenant, add users and grant memberships, then add residents on the Residents
screen. The script just does it in one step, which is handy for standing up a
clean demo quickly.

### After creating

1. Sign in as the new admin at `/login`.
2. Add residents / homeowners, or import them, from the staff screens.
3. Residents set their password via `/portal/login` → *Forgot password*.

---

## Remove a community

Deletes an HOA and **all** its data — irreversible. Used above to clear the
development/test communities.

```bash
DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.purge_tenant --slug willowbrook
# add --yes to skip the confirmation prompt
```

It refuses to touch `casa-harmony` unless you pass `--force`, and afterwards
removes any user left with no remaining membership.

---

## Starting completely fresh

To wipe everything and re-seed just the baseline (superadmin, sysadmin, the Casa
Harmony demo HOA):

```bash
DATABASE_URL="$MIGRATION_DB_URL" python -m scripts.purge_tenant --slug casa-harmony --force
python -m scripts.seed      # recreates the baseline as the app role
```

Or point `create_community` at a clean database and skip the demo HOA entirely.
