"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import {
  Building2, FileText, Mail, Phone, Plus, ShieldAlert, TriangleAlert, Wallet,
} from "lucide-react";
import { useAuth } from "../../providers";
import { useApi, useMutate } from "@/lib/use-api";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select } from "@/components/ui";
import {
  Column, DataTable, DetailSheet, EmptyState, Facts, FilterChips, PageHeader,
  PageShell, SectionGuide, StatCard, StatGrid, StatusBadge, Toolbar, money,
  shortDate,
} from "@/components/app/kit";
import { ChartCard, VendorSpendChart } from "@/components/app/charts";

export default function VendorsPage() {
  const { can } = useAuth();
  const { data: vendors } = useApi<any[]>("/vendors", []);
  const { data: payables } = useApi<any[]>("/payables", []);
  const { data: pos } = useApi<any[]>("/purchasing", []);
  const { data: tickets } = useApi<any[]>("/service-desk/tickets", []);
  const { mutate } = useMutate();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const vendor = vendors.find((v) => v.id === selected) ?? null;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return vendors.filter((v) => {
      if (status !== "ALL" && v.status?.toUpperCase() !== status) return false;
      return (
        !q ||
        v.name.toLowerCase().includes(q) ||
        (v.category ?? "").toLowerCase().includes(q) ||
        v.vendor_number.toLowerCase().includes(q)
      );
    });
  }, [vendors, status, search]);

  const active = vendors.filter((v) => v.status?.toUpperCase() === "ACTIVE").length;
  const ytd = vendors.reduce((s, v) => s + Number(v.ytd_spend ?? 0), 0);
  const missingW9 = vendors.filter((v) => !v.w9_on_file).length;

  const columns: Column<any>[] = [
    {
      key: "name",
      header: "Vendor",
      render: (v) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{v.name}</p>
          <p className="font-mono text-2xs text-muted-foreground">
            {v.vendor_number}
          </p>
        </div>
      ),
    },
    {
      key: "category",
      header: "Trade",
      render: (v) => <Badge tone="neutral">{v.category}</Badge>,
    },
    {
      key: "terms",
      header: "Terms",
      render: (v) => <span className="text-xs">{v.payment_terms}</span>,
    },
    {
      key: "contact",
      header: "Contact",
      render: (v) => (
        <div className="min-w-0">
          <p className="truncate text-xs">{v.email}</p>
          <p className="truncate text-2xs text-muted-foreground">{v.phone}</p>
        </div>
      ),
    },
    {
      key: "open",
      header: "Open POs",
      numeric: true,
      render: (v) => (
        <span className="text-sm">{v.open_pos > 0 ? v.open_pos : "—"}</span>
      ),
    },
    {
      key: "ytd",
      header: "Spend this year",
      numeric: true,
      render: (v) => <span className="text-sm">{money(v.ytd_spend, 0)}</span>,
    },
    {
      key: "compliance",
      header: "Paperwork",
      render: (v) =>
        v.w9_on_file ? (
          <Badge tone="success">Complete</Badge>
        ) : (
          <Badge tone="warning">W-9 missing</Badge>
        ),
    },
    { key: "status", header: "Status", render: (v) => <StatusBadge status={v.status} /> },
  ];

  const vendorInvoices = payables.filter((p) => p.vendor_id === selected);
  const vendorPos = pos.filter((p) => p.vendor_id === selected);
  const vendorTickets = tickets.filter((t) => t.vendor_id === selected);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Accounts Payable"
        title="Vendors"
        description="The contractors and suppliers this community buys from — landscapers, plumbers, elevator engineers, security firms."
        actions={
          can("vendor.manage") && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Add vendor
            </Button>
          )
        }
      />

      <SectionGuide
        what="The supplier master list. Everything the community spends money on runs through a vendor record — it carries the payment terms, the contact details, the tax paperwork and the running total of what has been spent this year."
        who="Property managers and accountants both maintain vendors. Approving spend to a vendor is a separate permission that the accountant deliberately does not hold."
        how={[
          "A vendor is added once with its trade, contact details and payment terms.",
          "Payment terms decide the due date on every invoice from that vendor automatically.",
          "A service ticket can be assigned to a vendor, which turns into a purchase order.",
          "Their invoices are matched against those orders before anything is paid.",
          "Year-to-date spend accumulates for tax reporting at year end.",
        ]}
        flow="Vendors sit at the centre of the money-out cycle: Service Desk assigns them, Purchasing commits to them, Receiving confirms their work, Payables records their bills, Payments settles them."
      />

      {flash && <Alert kind="success">{flash}</Alert>}

      <StatGrid>
        <StatCard label="Vendors" value={vendors.length} hint={`${active} active`} tone="primary" icon={Building2} />
        <StatCard label="Spend this year" value={money(ytd, 0)} tone="brass" icon={Wallet} />
        <StatCard
          label="Open commitments"
          value={vendors.reduce((s, v) => s + v.open_pos, 0)}
          hint="Purchase orders not yet closed"
          icon={FileText}
        />
        <StatCard
          label="Missing paperwork"
          value={missingW9}
          tone={missingW9 ? "warning" : "success"}
          hint={missingW9 ? "W-9 required for tax reporting" : "All complete"}
          icon={TriangleAlert}
        />
      </StatGrid>

      <ChartCard
        title="Where the money goes"
        caption="Spend per vendor so far this year — the basis for year-end tax reporting"
        table={{
          head: ["Vendor", "Trade", "Spend this year"],
          rows: [...vendors]
            .sort((a, b) => b.ytd_spend - a.ytd_spend)
            .map((v) => [v.name, v.category, money(v.ytd_spend, 0)]),
        }}
      >
        <VendorSpendChart
          data={[...vendors]
            .sort((a, b) => b.ytd_spend - a.ytd_spend)
            .slice(0, 7)
            .map((v) => ({ name: v.name, spend: v.ytd_spend }))}
        />
      </ChartCard>

      <Toolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search vendors by name, trade or number…"
        filters={
          <FilterChips
            value={status}
            onChange={setStatus}
            options={[
              { value: "ALL", label: "All", count: vendors.length },
              { value: "ACTIVE", label: "Active", count: active },
              { value: "INACTIVE", label: "Inactive", count: vendors.length - active },
            ]}
          />
        }
      />

      <DataTable
        rows={filtered}
        columns={columns}
        onRowClick={(v) => setSelected(v.id)}
        empty={<EmptyState icon={Building2} title="No vendors match" />}
      />

      {vendor && (
        <DetailSheet
          open
          onClose={() => setSelected(null)}
          title={vendor.name}
          subtitle={`${vendor.vendor_number} · ${vendor.category}`}
          badge={<StatusBadge status={vendor.status} />}
          width="xl"
          footer={
            can("vendor.manage") && (
              <Button
                variant={vendor.status === "ACTIVE" ? "danger" : "primary"}
                onClick={() =>
                  mutate(`/vendors/${vendor.id}`, "PATCH", {
                    status: vendor.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
                  })
                }
              >
                {vendor.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
              </Button>
            )
          }
        >
          <div className="space-y-6">
            <Facts
              items={[
                { label: "Trade", value: vendor.category },
                { label: "Payment terms", value: vendor.payment_terms },
                { label: "Email", value: vendor.email },
                { label: "Phone", value: vendor.phone },
                { label: "Onboarded", value: shortDate(vendor.onboarded) },
                {
                  label: "Spend this year",
                  value: (
                    <span className="tabular">{money(vendor.ytd_spend)}</span>
                  ),
                },
              ]}
            />

            {!vendor.w9_on_file && (
              <Alert kind="warning" title="Tax paperwork missing">
                No W-9 on file. This vendor cannot be included in year-end 1099
                reporting until one is uploaded.
              </Alert>
            )}

            <Card className="border-destructive/30 bg-destructive/5">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
                <ShieldAlert className="h-4 w-4" />
                This vendor has no login
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Vendors exist only as records — there is no account, so they
                cannot sign in, receive a notification, see assigned work, or
                submit their own invoice. Staff key everything in on their
                behalf. The Roles &amp; Flow screen sets out the three options
                for changing this.
              </p>
            </Card>

            <Panel title={`Service tickets (${vendorTickets.length})`}>
              {vendorTickets.length === 0 ? (
                <Muted>No tickets have been assigned to this vendor.</Muted>
              ) : (
                vendorTickets.map((t) => (
                  <Row
                    key={t.id}
                    left={t.subject}
                    sub={`${t.ticket_number} · Unit ${t.unit}`}
                    right={<StatusBadge status={t.status} />}
                  />
                ))
              )}
            </Panel>

            <Panel title={`Purchase orders (${vendorPos.length})`}>
              {vendorPos.length === 0 ? (
                <Muted>No purchase orders raised.</Muted>
              ) : (
                vendorPos.map((p) => (
                  <Row
                    key={p.id}
                    left={p.description}
                    sub={`${p.po_number} · ${p.fund} fund`}
                    right={
                      <div className="text-right">
                        <p className="tabular text-sm font-semibold">
                          {money(p.amount, 0)}
                        </p>
                        <StatusBadge status={p.status} />
                      </div>
                    }
                  />
                ))
              )}
            </Panel>

            <Panel title={`Invoices (${vendorInvoices.length})`}>
              {vendorInvoices.length === 0 ? (
                <Muted>No invoices recorded.</Muted>
              ) : (
                vendorInvoices.map((inv) => (
                  <Row
                    key={inv.id}
                    left={inv.invoice_number}
                    sub={`${shortDate(inv.invoice_date)}${inv.on_hold ? " · on hold" : ""}`}
                    right={
                      <div className="text-right">
                        <p className="tabular text-sm font-semibold">
                          {money(inv.amount)}
                        </p>
                        <StatusBadge status={inv.status} />
                      </div>
                    }
                  />
                ))
              )}
            </Panel>
          </div>
        </DetailSheet>
      )}

      {creating && (
        <Modal
          open
          onClose={() => setCreating(false)}
          title="Add a vendor"
          description="Payment terms set here decide the due date on every invoice from this vendor."
          footer={<NewVendorFooter onClose={() => setCreating(false)} onCreate={async (b) => {
            await mutate("/vendors", "POST", b);
            setCreating(false);
            setFlash(`${b.name} added to the vendor list.`);
            setTimeout(() => setFlash(null), 4000);
          }} />}
        >
          <NewVendorForm />
        </Modal>
      )}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ pieces */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </p>
      <div className="overflow-hidden rounded-lg border">
        <div className="divide-y">{children}</div>
      </div>
    </div>
  );
}

function Row({ left, sub, right }: { left: string; sub: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="truncate text-sm">{left}</p>
        <p className="truncate font-mono text-2xs text-muted-foreground">{sub}</p>
      </div>
      <div className="shrink-0">{right}</div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-4 text-center text-xs text-muted-foreground">{children}</p>;
}

/* --------------------------------------------------------- new vendor form */

// Form and footer are siblings under the same Modal (not nested), so a plain
// module-level object can't tell the footer to re-render when the form
// changes it — that starved the footer's disabled/name check of updates.
// useSyncExternalStore + explicit notify gives both a shared, reactive value.
const emptyDraft = { name: "", category: "", payment_terms: "Net 30", email: "", phone: "" };
let draft = { ...emptyDraft };
const draftListeners = new Set<() => void>();

function setDraftField(k: string, v: string) {
  draft = { ...draft, [k]: v };
  draftListeners.forEach((fn) => fn());
}

function resetDraft() {
  draft = { ...emptyDraft };
  draftListeners.forEach((fn) => fn());
}

function useDraft() {
  return useSyncExternalStore(
    (onChange) => {
      draftListeners.add(onChange);
      return () => draftListeners.delete(onChange);
    },
    () => draft
  );
}

function NewVendorForm() {
  const draft = useDraft();
  const set = (k: string, v: string) => setDraftField(k, v);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="vn">Vendor name</Label>
          <Input id="vn" value={draft.name} onChange={(e) => set("name", e.target.value)} autoFocus />
        </div>
        <div>
          <Label htmlFor="vc">Trade</Label>
          <Input id="vc" value={draft.category} onChange={(e) => set("category", e.target.value)} placeholder="Plumbing" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="vt">Payment terms</Label>
          <Select id="vt" value={draft.payment_terms} onChange={(e) => set("payment_terms", e.target.value)}>
            {["Net 15", "Net 30", "Net 45", "Due on receipt"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ve">Email</Label>
          <Input id="ve" value={draft.email} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="vp">Phone</Label>
          <Input id="vp" value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
        </div>
      </div>
    </div>
  );
}

function NewVendorFooter({ onClose, onCreate }: { onClose: () => void; onCreate: (b: any) => Promise<void> }) {
  const draft = useDraft();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex w-full items-center gap-3">
      {error && <p className="flex-1 text-left text-xs text-destructive">{error}</p>}
      <div className="ml-auto flex gap-2">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button
          disabled={busy || !draft.name.trim()}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onCreate({ ...draft });
              resetDraft();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Could not add vendor");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Adding…" : "Add vendor"}
        </Button>
      </div>
    </div>
  );
}
