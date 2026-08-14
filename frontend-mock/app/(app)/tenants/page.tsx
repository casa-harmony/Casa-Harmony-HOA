"use client";

import { useState } from "react";
import {
  Building2, CheckCircle2, Home, MapPin, Plus, ShieldCheck, Users, Wallet,
} from "lucide-react";
import { useAuth } from "../../providers";
import { useApi } from "@/lib/use-api";
import { TENANTS } from "@/lib/mock-data/seed";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select } from "@/components/ui";
import {
  DetailSheet, Facts, PageHeader, PageShell, SectionGuide, StatCard, StatGrid,
  StatusBadge, money,
} from "@/components/app/kit";

export default function TenantsPage() {
  const { activeTenantId, setActiveTenant, can } = useAuth();
  const [showDemo, setShowDemo] = useState(false);
  const { data: tenants } = useApi<any[]>(
    showDemo ? "/tenants?include_demo=true" : "/tenants",
    []
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const tenant = tenants.find((t) => t.id === selected) ?? null;
  const totalUnits = tenants.reduce((s, t) => s + t.num_units, 0);
  const monthlyBilling = tenants.reduce((s, t) => s + t.num_units * t.monthly_dues, 0);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="Communities (HOAs)"
        description="Every homeowner association on the platform. Each is completely sealed off from the others — this is the top of the multi-tenancy model."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant={showDemo ? "primary" : "outline"}
              onClick={() => setShowDemo((v) => !v)}
            >
              {showDemo ? "Hide demo communities" : "Show demo communities"}
            </Button>
            {can("tenant.create") && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="h-4 w-4" />
                New community
              </Button>
            )}
          </div>
        }
      />

      <SectionGuide
        what="The list of communities the platform serves. In the codebase these are called 'tenants' in the multi-tenancy sense — each one is a separate homeowner association, not a renter. Client-facing labels should say 'communities'."
        who="Only the platform superadmin sees this screen. Even a regional director covering all three cannot create or suspend one — that authority stays with the software vendor."
        how={[
          "A community is created with its legal name, address, unit count and timezone.",
          "Creating it automatically sets up a chart of accounts, accounting periods and the two funds.",
          "Staff are then granted membership of that community with a role.",
          "Data is separated twice: every record carries the community it belongs to, and the database itself refuses to return another community's rows.",
          "Suspending a community blocks all access without deleting anything.",
        ]}
        flow="Everything in the application hangs beneath a community. Switching community in the header reloads every screen with that community's data — try it."
      />

      {flash && <Alert kind="success">{flash}</Alert>}

      <StatGrid>
        <StatCard label="Communities" value={tenants.length} tone="primary" icon={Building2} />
        <StatCard label="Units under management" value={totalUnits} icon={Home} />
        <StatCard label="Billed monthly" value={money(monthlyBilling, 0)} tone="brass" icon={Wallet} />
        <StatCard label="All active" value={`${tenants.filter((t) => t.status === "active").length} of ${tenants.length}`} tone="success" icon={CheckCircle2} />
      </StatGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {tenants.map((t) => {
          const isActive = t.id === activeTenantId;
          return (
            <Card
              key={t.id}
              padded={false}
              className={
                "flex flex-col overflow-hidden transition-colors " +
                (isActive ? "border-primary ring-1 ring-primary/25" : "")
              }
            >
              <div className="border-b bg-muted/40 px-5 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold">{t.name}</p>
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {t.city}, {t.state}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {t.is_demo && <Badge tone="neutral">Demo</Badge>}
                    {isActive && <Badge tone="primary">Viewing</Badge>}
                  </div>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{t.kind}</p>
              </div>

              <div className="grid grid-cols-2 divide-x border-b">
                <div className="px-4 py-3">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Units
                  </p>
                  <p className="stat-value mt-0.5 text-lg font-semibold">
                    {t.num_units}
                  </p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Monthly dues
                  </p>
                  <p className="stat-value mt-0.5 text-lg font-semibold">
                    {money(t.monthly_dues, 0)}
                  </p>
                </div>
              </div>

              <div className="flex flex-1 flex-col justify-end gap-2 p-4">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Established {t.founded}</span>
                  <StatusBadge status={t.status} />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => setSelected(t.id)}
                  >
                    Details
                  </Button>
                  <Button
                    size="sm"
                    className="flex-1"
                    disabled={isActive}
                    onClick={() => setActiveTenant(t.id)}
                  >
                    {isActive ? "Current" : "Switch to"}
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="border-primary/25 bg-accent/40">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" />
          How these are kept apart
        </p>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold">Barrier one — the application</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Every request carries which community you are working in, and the
              server checks you hold a membership there.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold">Barrier two — the database</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              A rule on every table filters rows by community, so even a bug in
              the application cannot return another community's data.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold">Encryption and audit</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Sensitive fields are encrypted at rest, and every change is written
              to an append-only audit trail.
            </p>
          </div>
        </div>
      </Card>

      {tenant && (
        <DetailSheet
          open
          onClose={() => setSelected(null)}
          title={tenant.name}
          subtitle={tenant.legal_name}
          badge={<StatusBadge status={tenant.status} />}
          footer={
            <Button
              disabled={tenant.id === activeTenantId}
              onClick={() => {
                setActiveTenant(tenant.id);
                setSelected(null);
              }}
            >
              Switch to this community
            </Button>
          }
        >
          <div className="space-y-6">
            <Facts
              items={[
                { label: "Legal name", value: tenant.legal_name },
                { label: "Type", value: tenant.kind },
                { label: "Location", value: `${tenant.city}, ${tenant.state}` },
                { label: "Timezone", value: tenant.timezone },
                { label: "Units", value: tenant.num_units },
                { label: "Established", value: tenant.founded },
                { label: "Monthly dues per unit", value: money(tenant.monthly_dues) },
                {
                  label: "Gross monthly billing",
                  value: (
                    <span className="tabular font-semibold">
                      {money(tenant.num_units * tenant.monthly_dues, 0)}
                    </span>
                  ),
                },
              ]}
            />

            <Card>
              <p className="text-sm font-semibold">Set up automatically on creation</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>· A chart of accounts with fund, department and account segments</li>
                <li>· Operating and Reserve funds, kept separate as law requires</li>
                <li>· Twelve accounting periods for the current year</li>
                <li>· Default approval hierarchies for orders and invoices</li>
                <li>· An empty audit trail that begins recording immediately</li>
              </ul>
            </Card>
          </div>
        </DetailSheet>
      )}

      {creating && (
        <Modal
          open
          onClose={() => setCreating(false)}
          title="Create a community"
          description="Only the platform superadmin can do this. Setting one up provisions its chart of accounts, funds and periods automatically."
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setCreating(false);
                  setFlash(
                    "In the live product this provisions a new community with its chart of accounts, funds and periods. The demo runs on three fixed communities."
                  );
                  setTimeout(() => setFlash(null), 7000);
                }}
              >
                Create community
              </Button>
            </>
          }
        >
          <div className="space-y-4">
            <div>
              <Label htmlFor="cn">Community name</Label>
              <Input id="cn" placeholder="Willow Creek Estates" autoFocus />
            </div>
            <div>
              <Label htmlFor="cl">Legal name</Label>
              <Input id="cl" placeholder="Willow Creek Estates Homeowners Association, Inc." />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="cu">Units</Label>
                <Input id="cu" type="number" placeholder="120" />
              </div>
              <div>
                <Label htmlFor="cd">Monthly dues ($)</Label>
                <Input id="cd" type="number" placeholder="350" />
              </div>
              <div>
                <Label htmlFor="ct">Timezone</Label>
                <Select id="ct">
                  <option>America/Los_Angeles</option>
                  <option>America/Denver</option>
                  <option>America/Chicago</option>
                  <option>America/New_York</option>
                </Select>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </PageShell>
  );
}
