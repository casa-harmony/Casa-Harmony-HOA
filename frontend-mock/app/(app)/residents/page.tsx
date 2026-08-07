"use client";

import { useMemo, useState } from "react";
import {
  Home, KeyRound, Mail, Phone, Plus, ShieldCheck, Smartphone, UserCheck, Users,
} from "lucide-react";
import { useAuth } from "../../providers";
import { useApi, useMutate } from "@/lib/use-api";
import {
  Alert, Badge, Button, Card, Input, Label, Modal, Select, Switch,
} from "@/components/ui";
import {
  Column, DataTable, DetailSheet, EmptyState, Facts, FilterChips, PageHeader,
  PageShell, SectionGuide, StatCard, StatGrid, StatusBadge, Toolbar, money,
  relTime, shortDate,
} from "@/components/app/kit";

export default function ResidentsPage() {
  const { can } = useAuth();
  const { data: residents } = useApi<any[]>("/residents", []);
  const { data: homeowners } = useApi<any[]>("/subledger/homeowners", []);
  const { mutate } = useMutate();

  const [tab, setTab] = useState<"PEOPLE" | "UNITS">("PEOPLE");
  const [type, setType] = useState("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const resident = residents.find((r) => r.id === selected) ?? null;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return residents.filter((r) => {
      if (type !== "ALL" && r.resident_type !== type) return false;
      if (!q) return true;
      return (
        r.full_name.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [residents, type, search]);

  const owners = residents.filter((r) => r.resident_type === "OWNER").length;
  const renters = residents.filter((r) => r.resident_type === "RENTER").length;
  const active = residents.filter((r) => r.is_active).length;
  const delinquent = homeowners.filter((h) => h.balance > 0);

  const residentCols: Column<any>[] = [
    {
      key: "name",
      header: "Resident",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{r.full_name}</p>
          <p className="truncate font-mono text-2xs text-muted-foreground">
            {r.username}
          </p>
        </div>
      ),
    },
    { key: "type", header: "Type", render: (r) => <StatusBadge status={r.resident_type} /> },
    {
      key: "units",
      header: "Units",
      numeric: true,
      render: (r) => (
        <span className="text-sm">
          {r.unit_count}
          {r.unit_count > 1 && (
            <Badge tone="info" className="ml-1.5">
              multi
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: "contact",
      header: "Contact",
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate text-xs">{r.email}</p>
          <p className="truncate text-2xs text-muted-foreground">{r.phone}</p>
        </div>
      ),
    },
    {
      key: "mfa",
      header: "Sign-in code",
      render: (r) => (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {r.mfa_channel === "SMS" ? (
            <Smartphone className="h-3 w-3" />
          ) : (
            <Mail className="h-3 w-3" />
          )}
          {r.mfa_channel}
        </span>
      ),
    },
    {
      key: "status",
      header: "Portal",
      render: (r) =>
        r.is_active ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="neutral">Disabled</Badge>
        ),
    },
    {
      key: "last",
      header: "Last sign-in",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.last_login ? relTime(r.last_login) : "Never"}
        </span>
      ),
    },
  ];

  const unitCols: Column<any>[] = [
    {
      key: "unit",
      header: "Unit",
      render: (h) => (
        <div>
          <p className="font-medium">Unit {h.property_unit}</p>
          <p className="font-mono text-2xs text-muted-foreground">
            {h.account_number}
          </p>
        </div>
      ),
    },
    {
      key: "owner",
      header: "Account holder",
      render: (h) => (
        <div className="min-w-0">
          <p className="truncate text-sm">
            {h.first_name} {h.last_name}
          </p>
          <p className="truncate text-2xs text-muted-foreground">{h.email}</p>
        </div>
      ),
    },
    {
      key: "dues",
      header: "Monthly dues",
      numeric: true,
      render: (h) => <span className="text-sm">{money(h.monthly_dues)}</span>,
    },
    {
      key: "balance",
      header: "Balance owing",
      numeric: true,
      render: (h) => (
        <span
          className={
            h.balance > 0 ? "text-sm font-semibold text-destructive" : "text-sm"
          }
        >
          {h.balance > 0 ? money(h.balance) : "—"}
        </span>
      ),
    },
    { key: "status", header: "Status", render: (h) => <StatusBadge status={h.status} /> },
    {
      key: "since",
      header: "Resident since",
      render: (h) => (
        <span className="text-xs text-muted-foreground">
          {shortDate(h.move_in)}
        </span>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Core Operations"
        title="Residents"
        description="The people who live here and the units they hold. A resident is a portal login; a unit is the account their money runs through — the two are linked but separate."
        actions={
          can("resident.manage") && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Invite resident
            </Button>
          )
        }
      />

      <SectionGuide
        what="Two related lists. Residents are self-service portal accounts for homeowners and their renters. Units are the accounts-receivable records that carry the money — the dues charged, the balance owing, the payment history."
        who="Property managers issue and disable portal logins. Accountants work with the unit side because that is where the money lives. Residents themselves see only their own units, in a completely separate portal."
        how={[
          "Every unit exists as an account from the day the community is set up or migrated in.",
          "A resident is invited by email and sets their own password on first sign-in.",
          "One resident can hold several units — a landlord with three condos has one login and sees three.",
          "Several residents can share one unit — co-owners and renters each get their own login.",
          "Residents sign in with a one-time code sent by email or text, not an authenticator app, because they are not technical users.",
          "Disabling a login does not touch the unit's financial record; the account and its balance remain.",
        ]}
        flow="Units feed the receivables cycle: dues are charged here, statements go out from here, and unpaid balances escalate into Collections. Residents log tickets that arrive on the Service Desk."
      />

      {flash && <Alert kind="success">{flash}</Alert>}

      <StatGrid>
        <StatCard label="Portal accounts" value={residents.length} hint={`${active} active`} tone="primary" icon={Users} />
        <StatCard label="Owners" value={owners} icon={Home} />
        <StatCard label="Renters" value={renters} icon={UserCheck} />
        <StatCard
          label="Units owing money"
          value={delinquent.length}
          hint={delinquent.length ? money(delinquent.reduce((s, h) => s + h.balance, 0), 0) : "All current"}
          tone={delinquent.length ? "danger" : "success"}
        />
      </StatGrid>

      <div className="flex gap-1.5 border-b">
        {(["PEOPLE", "UNITS"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors " +
              (tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t === "PEOPLE"
              ? `Portal accounts (${residents.length})`
              : `Units & balances (${homeowners.length})`}
          </button>
        ))}
      </div>

      {tab === "PEOPLE" ? (
        <>
          <Toolbar
            search={search}
            onSearch={setSearch}
            placeholder="Search residents by name, username or email…"
            filters={
              <FilterChips
                value={type}
                onChange={setType}
                options={[
                  { value: "ALL", label: "All", count: residents.length },
                  { value: "OWNER", label: "Owners", count: owners },
                  { value: "RENTER", label: "Renters", count: renters },
                ]}
              />
            }
          />
          <DataTable
            rows={filtered}
            columns={residentCols}
            onRowClick={(r) => setSelected(r.id)}
            empty={
              <EmptyState
                icon={Users}
                title="No residents match"
                description="Clear the search or invite a resident to the portal."
              />
            }
          />
        </>
      ) : (
        <DataTable rows={homeowners} columns={unitCols} />
      )}

      {resident && (
        <DetailSheet
          open
          onClose={() => setSelected(null)}
          title={resident.full_name}
          subtitle={`${resident.username} · ${resident.resident_type.toLowerCase()}`}
          badge={
            resident.is_active ? (
              <Badge tone="success">Portal active</Badge>
            ) : (
              <Badge tone="neutral">Disabled</Badge>
            )
          }
          footer={
            can("resident.manage") && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setFlash(
                      `A password-reset link has been sent to ${resident.email}.`
                    );
                    setTimeout(() => setFlash(null), 4000);
                    setSelected(null);
                  }}
                >
                  <KeyRound className="h-4 w-4" />
                  Send reset link
                </Button>
                <Button
                  variant={resident.is_active ? "danger" : "primary"}
                  onClick={() =>
                    mutate(`/residents/${resident.id}`, "PATCH", {
                      is_active: !resident.is_active,
                    })
                  }
                >
                  {resident.is_active ? "Disable login" : "Enable login"}
                </Button>
              </>
            )
          }
        >
          <div className="space-y-6">
            <Facts
              items={[
                { label: "Resident type", value: <StatusBadge status={resident.resident_type} /> },
                { label: "Units held", value: resident.unit_count },
                { label: "Email", value: resident.email },
                { label: "Phone", value: resident.phone },
                { label: "Sign-in code sent by", value: resident.mfa_channel },
                {
                  label: "Last signed in",
                  value: resident.last_login ? shortDate(resident.last_login) : "Never",
                },
              ]}
            />

            <Card className="border-primary/25 bg-accent/40">
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-primary" />
                What this person can see
              </p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>· Their own assessments, balance and payment history</li>
                <li>· Documents published to residents or to the whole community</li>
                <li>· Their own payment plan or lien, if either exists</li>
                <li>· Nothing about any other unit, resident or the community's overall finances</li>
              </ul>
            </Card>

            <div>
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                Linked units
              </p>
              <div className="space-y-2">
                {homeowners
                  .filter((h) => h.id === resident.homeowner_id)
                  .map((h) => (
                    <div
                      key={h.id}
                      className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2.5"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          Unit {h.property_unit}
                        </p>
                        <p className="font-mono text-2xs text-muted-foreground">
                          {h.account_number}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="tabular text-sm font-semibold">
                          {money(h.monthly_dues)}
                          <span className="text-xs font-normal text-muted-foreground">
                            /mo
                          </span>
                        </p>
                        {h.balance > 0 && (
                          <p className="tabular text-2xs font-semibold text-destructive">
                            {money(h.balance)} owing
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </DetailSheet>
      )}

      {creating && (
        <InviteResidentModal
          homeowners={homeowners}
          onClose={() => setCreating(false)}
          onCreate={async (body) => {
            await mutate("/residents", "POST", body);
            setCreating(false);
            setFlash(
              `${body.full_name} has been invited. They will set their own password on first sign-in.`
            );
            setTimeout(() => setFlash(null), 5000);
          }}
        />
      )}
    </PageShell>
  );
}

function InviteResidentModal({
  homeowners, onClose, onCreate,
}: {
  homeowners: any[];
  onClose: () => void;
  onCreate: (b: any) => Promise<void>;
}) {
  const [form, setForm] = useState({
    full_name: "",
    username: "",
    email: "",
    phone: "",
    resident_type: "OWNER",
    mfa_channel: "EMAIL",
    homeowner_id: homeowners[0]?.id ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite a resident to the portal"
      description="They receive an email invitation and choose their own password. You never see or set it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!form.full_name.trim() || !form.email.trim() || busy}
            onClick={async () => {
              setBusy(true);
              await onCreate(form);
              setBusy(false);
            }}
          >
            {busy ? "Sending…" : "Send invitation"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="n">Full name</Label>
            <Input
              id="n"
              value={form.full_name}
              onChange={(e) => {
                set("full_name", e.target.value);
                set(
                  "username",
                  e.target.value.toLowerCase().replace(/[^a-z]/g, "").slice(0, 12)
                );
              }}
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="u">Username</Label>
            <Input
              id="u"
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="e">Email</Label>
            <Input
              id="e"
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="p">Phone</Label>
            <Input
              id="p"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label htmlFor="t">Type</Label>
            <Select
              id="t"
              value={form.resident_type}
              onChange={(e) => set("resident_type", e.target.value)}
            >
              <option value="OWNER">Owner</option>
              <option value="RENTER">Renter</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="m">Sign-in code by</Label>
            <Select
              id="m"
              value={form.mfa_channel}
              onChange={(e) => set("mfa_channel", e.target.value)}
            >
              <option value="EMAIL">Email</option>
              <option value="SMS">Text message</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="h">Unit</Label>
            <Select
              id="h"
              value={form.homeowner_id}
              onChange={(e) => set("homeowner_id", e.target.value)}
            >
              {homeowners.map((h) => (
                <option key={h.id} value={h.id}>
                  Unit {h.property_unit}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>
    </Modal>
  );
}
