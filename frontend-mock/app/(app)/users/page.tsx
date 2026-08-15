"use client";

import { useMemo, useState } from "react";
import { Check, Building2, KeyRound, Plus, ShieldCheck, UserCog, Users, X } from "lucide-react";
import { useAuth } from "../../providers";
import { useApi, useMutate } from "@/lib/use-api";
import { ALL_PERMISSIONS, PERMISSIONS, ROLES, permsFor, roleHas } from "@/lib/rbac";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select } from "@/components/ui";
import {
  Column, DataTable, DetailSheet, Facts, PageHeader, PageShell, SectionGuide,
  StatCard, StatGrid, Toolbar,
} from "@/components/app/kit";
import { cn } from "@/lib/utils";

/** Users with no memberships have no role yet (server sends role_code: null). */
function displayRole(roleCode: string | null | undefined): string {
  return roleCode ? roleCode.replace(/_/g, " ") : "No role";
}

export default function UsersPage() {
  const { can, refresh, user: userSession } = useAuth();
  const { data: users } = useApi<any[]>("/users", []);
  const { data: communities } = useApi<any[]>("/tenants", []);
  const { mutate, busy } = useMutate();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [roleTab, setRoleTab] = useState<string>("HOA_ADMIN");
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const [form, setForm] = useState({
    full_name: "",
    email: "",
    title: "Community Administrator",
    role_code: "HOA_ADMIN",
    is_superadmin: false,
    tenant_ids: [] as string[],
  });

  const handleCreateUser = async () => {
    if (!form.full_name.trim() || !form.email.trim()) return;
    try {
      await mutate("/users", "POST", {
        full_name: form.full_name,
        email: form.email,
        job_title: form.title,
        role_code: form.role_code,
        is_superadmin: form.is_superadmin,
        tenant_id: form.tenant_ids[0] || null,
        // Invitation, not a typed password: the server emails a one-time
        // set-password link (single-use reset token).
        send_invite: true,
      });
      setCreating(false);
      setFlash(`User '${form.full_name}' created successfully as ${form.role_code.replace(/_/g, " ")}.`);
      refresh();
      setTimeout(() => setFlash(null), 6000);
      setForm({
        full_name: "",
        email: "",
        title: "Community Administrator",
        role_code: "HOA_ADMIN",
        is_superadmin: false,
        tenant_ids: [] as string[],
      });
    } catch (e: any) {
      setFlash(`Error creating user: ${e?.message ?? "Failed"}`);
    }
  };

  const user = users.find((u) => u.id === selected) ?? null;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return users.filter(
      (u) =>
        !q ||
        u.full_name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.role_code ?? "").toLowerCase().includes(q)
    );
  }, [users, search]);

  const columns: Column<any>[] = [
    {
      key: "name",
      header: "Person",
      render: (u) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-2xs font-bold text-primary">
            {u.full_name.split(" ").map((w: string) => w[0]).join("")}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{u.full_name}</p>
            <p className="truncate text-2xs text-muted-foreground">{u.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: "title",
      header: "Job title",
      render: (u) => (
        <span className="text-xs text-muted-foreground">{u.job_title ?? u.title}</span>
      ),
    },
    {
      key: "role",
      header: "Role",
      render: (u) => (
        <Badge tone={ROLES[u.role_code]?.implemented ? "primary" : "warning"}>
          {displayRole(u.role_code)}
        </Badge>
      ),
    },
    {
      key: "communities",
      header: "Communities",
      render: (u) => (
        <div className="flex flex-wrap gap-1">
          {(u.tenant_ids || []).map((id: string) => (
            <Badge key={id} tone="neutral" className="text-[10px]">
              {communities.find((t: any) => t.id === id)?.name || id}
            </Badge>
          ))}
        </div>
      ),
    },
    {
      key: "perms",
      header: "Permissions",
      numeric: true,
      render: (u) => (
        <span className="text-xs text-muted-foreground">
          {u.is_superadmin ? "All" : permsFor(u.role_code).length}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (u) => (u.is_active ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">Disabled</Badge>),
    },
  ];

  const activeRole = ROLES[roleTab];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="Users & Roles"
        description="Staff accounts and what each one is allowed to do. A person has one login for the whole platform; their powers are granted per community."
        actions={
          (can("user.manage") || userSession?.isSuperadmin) && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Create user
            </Button>
          )
        }
      />

      {flash && <Alert kind="success">{flash}</Alert>}

      <SectionGuide
        what="The access control centre. Every staff member has a single global login, and a separate grant — called a membership — for each community they work on. That grant carries the role, and the role carries the permissions."
        who="Only roles holding the user-management permission can open this screen. Accountants deliberately cannot — try switching to David Lin and it vanishes from the menu."
        how={[
          "A person is created once with an email address and must set their own password on first sign-in.",
          "They are then granted access to one or more communities, each with its own role.",
          "The role decides everything: which menu items appear, which buttons are enabled, and which requests the server will accept.",
          "One person can be an administrator in one community and read-only in another.",
          "Removing a membership removes access to that community without deleting the person.",
        ]}
        flow="This screen governs every other screen. Permissions granted here are checked on every single request the application makes."
      />

      <StatGrid>
        <StatCard label="Staff accounts" value={users.length} tone="primary" icon={Users} />
        <StatCard label="Roles in use" value={new Set(users.map((u) => u.role_code)).size} icon={ShieldCheck} />
        <StatCard label="Communities" value={communities.length} icon={Building2} />
        <StatCard label="Permissions defined" value={ALL_PERMISSIONS.length} icon={KeyRound} />
      </StatGrid>

      <Toolbar search={search} onSearch={setSearch} placeholder="Search staff by name, email or role…" />

      <DataTable rows={filtered} columns={columns} onRowClick={(u) => setSelected(u.id)} />

      {/* ------------------------------------------------- role comparison */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider">
            What each role can do
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The full permission set behind every role, exactly as the server
            enforces it. Greyed entries are not granted.
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {Object.values(ROLES).map((r) => (
            <button
              key={r.code}
              onClick={() => setRoleTab(r.code)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                roleTab === r.code
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted"
              )}
            >
              {r.code.replace(/_/g, " ")}
              {!r.implemented && (
                <span className="rounded bg-warning/20 px-1 text-[10px] text-warning">
                  proposed
                </span>
              )}
            </button>
          ))}
        </div>

        {activeRole && (
          <Card padded={false}>
            <div className="border-b px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{activeRole.name}</h3>
                {!activeRole.implemented && (
                  <Badge tone="warning">Not yet built on the server</Badge>
                )}
              </div>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                {activeRole.blurb}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Scope:</span>{" "}
                {activeRole.scope} ·{" "}
                <span className="font-semibold text-foreground">Permissions:</span>{" "}
                {activeRole.perms === "*" ? "all" : `${activeRole.perms.length} of ${ALL_PERMISSIONS.length}`}
              </p>
            </div>

            <div className="grid grid-cols-1 divide-y border-b sm:grid-cols-2 sm:divide-x sm:divide-y-0">
              <div className="p-5">
                <p className="mb-2.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-success">
                  <Check className="h-3.5 w-3.5" /> Can do
                </p>
                <ul className="space-y-1.5">
                  {activeRole.can.map((c) => (
                    <li key={c} className="grid grid-cols-[14px_1fr] gap-2 text-sm text-muted-foreground">
                      <Check className="mt-1 h-3.5 w-3.5 text-success" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-5">
                <p className="mb-2.5 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-destructive">
                  <X className="h-3.5 w-3.5" /> Cannot do
                </p>
                <ul className="space-y-1.5">
                  {activeRole.cannot.map((c) => (
                    <li key={c} className="grid grid-cols-[14px_1fr] gap-2 text-sm text-muted-foreground">
                      <X className="mt-1 h-3.5 w-3.5 text-destructive/70" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="p-5">
              <p className="mb-2.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                Every permission the server checks
              </p>
              <div className="flex flex-wrap gap-1">
                {ALL_PERMISSIONS.map((p) => {
                  const granted = roleHas(activeRole.code, p);
                  return (
                    <code
                      key={p}
                      title={PERMISSIONS[p]?.[1]}
                      className={cn(
                        "rounded border px-1.5 py-0.5 font-mono text-[10px]",
                        granted
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border bg-muted text-muted-foreground/40 line-through"
                      )}
                    >
                      {p}
                    </code>
                  );
                })}
              </div>
            </div>
          </Card>
        )}
      </section>

      {user && (
        <DetailSheet
          open
          onClose={() => setSelected(null)}
          title={user.full_name}
          subtitle={user.title}
          badge={<Badge tone="primary">{displayRole(user.role_code)}</Badge>}
          width="lg"
        >
          <div className="space-y-6">
            <Facts
              items={[
                { label: "Email", value: user.email },
                { label: "Role", value: ROLES[user.role_code]?.name },
                { label: "Scope", value: ROLES[user.role_code]?.scope },
                { label: "Platform superadmin", value: user.is_superadmin ? "Yes" : "No" },
              ]}
            />

            <div>
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                Community memberships
              </p>
              <div className="space-y-2">
                {user.tenant_ids.map((id: string) => {
                  const t = communities.find((x: any) => x.id === id);
                  return (
                    <div key={id} className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{t?.name}</p>
                        <p className="truncate text-2xs text-muted-foreground">
                          {t?.kind}
                        </p>
                      </div>
                      <Badge tone="primary">{displayRole(user.role_code)}</Badge>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                One login, one password — but a separate role grant per
                community. This is exactly how a management company operates.
              </p>
            </div>

            {user.email === userSession?.email && (
              <Card className="border-primary/25 bg-accent/40">
                <p className="text-sm font-semibold">This is you</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  You are currently signed in as this person.
                </p>
              </Card>
            )}
          </div>
        </DetailSheet>
      )}
      {creating && (
        <Modal
          open
          onClose={() => setCreating(false)}
          title="Create a user account"
          description="A person is created once with a single login. Assign their primary role and community access."
          footer={
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
              <Button type="submit" 
              onClick={handleCreateUser}
              disabled={!form.full_name.trim() || !form.email.trim() || busy === "/users"}
              >
              {busy === "/users" ? "Creating..." : "Create user"}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <div>
              <Label htmlFor="ufn">Full Name</Label>
              <Input
                id="ufn"
                placeholder="Jane Doe"
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                autoFocus
              />
            </div>
            <div>
              <Label htmlFor="uem">Email Address</Label>
              <Input
                id="uem"
                type="email"
                placeholder="jane.doe@casaharmony.ai"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="utitle">Job Title</Label>
              <Input
                id="utitle"
                placeholder="Community Manager / Lead Accountant"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="urole">Assigned Role</Label>
                <Select
                  id="urole"
                  value={form.role_code}
                  onChange={(e) => setForm({ ...form, role_code: e.target.value })}
                >
                  {Object.values(ROLES).map((r) => (
                    <option key={r.code} value={r.code}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="utenant">Assigned Community</Label>
                <Select
                  id="utenant"
                  value={form.tenant_ids[0] || ""}
                  onChange={(e) => setForm({ ...form, tenant_ids: [e.target.value] })}
                >
                  {communities.map((t: any) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {userSession?.isSuperadmin && (
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="superadmin-chk"
                  checked={form.is_superadmin}
                  onChange={(e) => setForm({ ...form, is_superadmin: e.target.checked })}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                <Label htmlFor="superadmin-chk" className="text-xs font-semibold cursor-pointer">
                  Grant Platform Superadmin Access (Cross-Tenant System Access)
                </Label>
              </div>
            )}
          </div>
        </Modal>
      )}
    </PageShell>
  );
}
