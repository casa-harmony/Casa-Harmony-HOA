"use client";

import { useMemo, useState } from "react";
import {
  Ban, CheckCircle2, CircleDollarSign, FileText, Link2, Lock, Plus, Send,
  TriangleAlert, Unlock,
} from "lucide-react";
import { useAuth } from "../../providers";
import { useApi, useMutate } from "@/lib/use-api";
import {  Alert, Badge, Button, Card, Input, Label, Modal, Select, Textarea  } from "@/components/ui";
import { ReadinessEmptyState } from "@/components/readiness";
import {
  Column, DataTable, DetailSheet, EmptyState, Facts, FilterChips, PageHeader,
  PageShell, SectionGuide, StatCard, StatGrid, StatusBadge, Toolbar, money,
  shortDate,
} from "@/components/app/kit";

export default function PayablesPage() {
  const { can, persona } = useAuth();
  const { data: payables } = useApi<any[]>("/payables", []);
  const { data: vendors } = useApi<any[]>("/vendors", []);
  const { data: pos } = useApi<any[]>("/purchasing", []);
  const { mutate } = useMutate();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [holding, setHolding] = useState(false);
  const [holdReason, setHoldReason] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const inv = payables.find((p) => p.id === selected) ?? null;
  const linkedPo = pos.find((p) => p.id === inv?.po_header_id) ?? null;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return payables.filter((p) => {
      if (status === "HELD" && !p.on_hold) return false;
      if (status !== "ALL" && status !== "HELD" && p.status !== status) return false;
      return (
        !q ||
        p.invoice_number.toLowerCase().includes(q) ||
        p.vendor_name.toLowerCase().includes(q)
      );
    });
  }, [payables, status, search]);

  const held = payables.filter((p) => p.on_hold);
  const unpaid = payables.filter((p) => p.status !== "PAID" && p.status !== "CANCELLED");
  const owed = unpaid.reduce((s, p) => s + p.amount + p.tax_amount, 0);
  const exceptions = payables.filter((p) => p.match_status === "MATCH_EXCEPTION");

  function say(m: string) {
    setFlash(m);
    setTimeout(() => setFlash(null), 5000);
  }

  const columns: Column<any>[] = [
    {
      key: "inv",
      header: "Invoice",
      render: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{p.invoice_number}</p>
          <p className="truncate text-2xs text-muted-foreground">{p.vendor_name}</p>
        </div>
      ),
    },
    {
      key: "po",
      header: "Order",
      render: (p) =>
        p.po_number ? (
          <span className="inline-flex items-center gap-1 font-mono text-2xs text-primary">
            <Link2 className="h-3 w-3" />
            {p.po_number}
          </span>
        ) : (
          <span className="text-2xs text-muted-foreground">No order</span>
        ),
    },
    { key: "match", header: "Match", render: (p) => <StatusBadge status={p.match_status} /> },
    {
      key: "fund",
      header: "Fund",
      render: (p) => (
        <Badge tone={p.fund === "Reserve" ? "brass" : "primary"}>{p.fund}</Badge>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      render: (p) => (
        <span className="text-sm font-semibold">{money(p.amount + p.tax_amount)}</span>
      ),
    },
    {
      key: "due",
      header: "Due",
      render: (p) => (
        <span className="text-xs text-muted-foreground">{shortDate(p.due_date)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (p) => (
        <div className="flex flex-wrap items-center gap-1">
          <StatusBadge status={p.status} />
          {p.on_hold && <Badge tone="danger">On hold</Badge>}
        </div>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Accounts Payable"
        title="Payables"
        description="Bills received from vendors — checked against what was ordered and what was delivered before a cent leaves the community's account."
        actions={
          can("ap.manage") && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              Enter invoice
            </Button>
          )
        }
      />

      <SectionGuide
        what="Where vendor bills are recorded and controlled. An invoice arrives, is entered against the purchase order it relates to, and must agree with that order and the record of delivery before it can be paid."
        who="Accountants enter invoices; property managers and the board approve them. The person who enters a bill is deliberately not the person who authorises paying it."
        how={[
          "The invoice is entered and coded to a fund and an account.",
          "If it references a purchase order, the system compares the three documents — order, delivery record, invoice. This is the three-way match.",
          "Inside the community's tolerance it matches automatically. Outside it, the invoice is flagged and put on hold.",
          "A held invoice cannot be paid until a person releases it and records why.",
          "The invoice is submitted for approval, and the amount decides how many people must sign.",
          "Once approved it is paid, the money is drawn from a bank account, and the expense posts to the ledger.",
        ]}
        flow="Receives from Purchasing and Receiving. Sends to Payments, then to the General Ledger. The link back is real — paying an invoice updates the amount billed on its purchase order."
      />

      {flash && <Alert kind="success">{flash}</Alert>}

      <StatGrid>
        <StatCard label="Owed to vendors" value={money(owed, 0)} hint={`${unpaid.length} unpaid`} tone="brass" icon={CircleDollarSign} />
        <StatCard
          label="On hold"
          value={held.length}
          tone={held.length ? "danger" : "success"}
          hint={held.length ? "Blocked from payment" : "Nothing blocked"}
          icon={Lock}
        />
        <StatCard
          label="Match exceptions"
          value={exceptions.length}
          tone={exceptions.length ? "warning" : "success"}
          hint="Disagree with the order"
          icon={TriangleAlert}
        />
        <StatCard label="Paid this period" value={payables.filter((p) => p.status === "PAID").length} tone="success" icon={CheckCircle2} />
      </StatGrid>

      <Toolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search by invoice number or vendor…"
        filters={
          <FilterChips
            value={status}
            onChange={setStatus}
            options={[
              { value: "ALL", label: "All", count: payables.length },
              { value: "DRAFT", label: "Draft", count: payables.filter((p) => p.status === "DRAFT").length },
              { value: "PENDING", label: "Awaiting approval", count: payables.filter((p) => p.status === "PENDING").length },
              { value: "APPROVED", label: "Approved", count: payables.filter((p) => p.status === "APPROVED").length },
              { value: "PAID", label: "Paid", count: payables.filter((p) => p.status === "PAID").length },
              { value: "HELD", label: "On hold", count: held.length },
            ]}
          />
        }
      />

      <DataTable
        rows={filtered}
        columns={columns}
        onRowClick={(p) => setSelected(p.id)}
        empty={<EmptyState icon={FileText} title="No invoices match" />}
      />

      {inv && (
        <DetailSheet
          open
          onClose={() => {
            setSelected(null);
            setHolding(false);
          }}
          title={inv.invoice_number}
          subtitle={`${inv.vendor_name} · ${shortDate(inv.invoice_date)}`}
          badge={
            <div className="flex gap-1.5">
              <StatusBadge status={inv.status} />
              {inv.on_hold && <Badge tone="danger">On hold</Badge>}
            </div>
          }
          width="xl"
          footer={
            <>
              {inv.on_hold && can("ap.manage") && (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    await mutate(`/payables/${inv.id}/release-hold`, "POST");
                    say(`${inv.invoice_number} released — it can now be approved.`);
                  }}
                >
                  <Unlock className="h-4 w-4" />
                  Release hold
                </Button>
              )}
              {!inv.on_hold && inv.status !== "PAID" && can("ap.manage") && (
                <Button variant="secondary" onClick={() => setHolding((h) => !h)}>
                  <Lock className="h-4 w-4" />
                  Place on hold
                </Button>
              )}
              {inv.status === "DRAFT" && can("ap.manage") && (
                <Button
                  onClick={async () => {
                    await mutate(`/payables/${inv.id}/submit`, "POST", {
                      actor: persona?.full_name,
                    });
                    say(`${inv.invoice_number} submitted — now on the Approvals screen.`);
                  }}
                >
                  <Send className="h-4 w-4" />
                  Submit for approval
                </Button>
              )}
              {inv.status === "APPROVED" && can("ap.pay") && (
                <Button
                  onClick={async () => {
                    await mutate(`/ap-payments`, "POST", {
                      vendor_id: inv.vendor_id,
                      payment_date: new Date().toISOString().split('T')[0],
                      applications: [{ invoice_id: inv.id, amount: inv.amount }]
                    });
                    say(`Payment issued for ${inv.invoice_number}. See the Payments screen.`);
                  }}
                >
                  Pay now
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-6">
            {inv.on_hold && (
              <Alert kind="error" title="This invoice is on hold">
                {inv.hold_reason}. No payment can be issued until it is released
                by someone with payables access.
              </Alert>
            )}

            {holding && (
              <Card className="border-warning/40 bg-warning/5">
                <Label htmlFor="hr">Why is this being held?</Label>
                <Textarea
                  id="hr"
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                  placeholder="e.g. Quantity billed exceeds the delivery record"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setHolding(false)}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    disabled={!holdReason.trim()}
                    onClick={async () => {
                      await mutate(`/payables/${inv.id}/hold`, "POST", {
                        reason: holdReason.trim(),
                      });
                      setHolding(false);
                      setHoldReason("");
                      say("Invoice placed on hold and the inbox notified.");
                    }}
                  >
                    Confirm hold
                  </Button>
                </div>
              </Card>
            )}

            <Facts
              items={[
                { label: "Vendor", value: inv.vendor_name },
                { label: "Invoice date", value: shortDate(inv.invoice_date) },
                { label: "Due date", value: shortDate(inv.due_date) },
                { label: "Fund", value: <Badge tone={inv.fund === "Reserve" ? "brass" : "primary"}>{inv.fund}</Badge> },
                { label: "Account code", value: <span className="font-mono text-xs">{inv.account}</span> },
                { label: "Description", value: inv.description || "—" },
              ]}
            />

            <div className="overflow-hidden rounded-lg border">
              <div className="flex items-center justify-between bg-muted/50 px-4 py-2">
                <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Amount
                </span>
              </div>
              <div className="divide-y">
                <Line label="Net" value={money(inv.amount)} />
                <Line label="Tax" value={money(inv.tax_amount)} />
                <Line label="Total payable" value={money(inv.amount + inv.tax_amount)} bold />
              </div>
            </div>

            {/* three-way match */}
            <div>
              <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                Three-way match
              </p>
              {linkedPo ? (
                <div className="grid grid-cols-3 gap-2">
                  <MatchCard
                    label="Ordered"
                    value={money(linkedPo.amount, 0)}
                    sub={linkedPo.po_number}
                    ok
                  />
                  <MatchCard
                    label="Received"
                    value="Confirmed"
                    sub="Accepted on site"
                    ok
                  />
                  <MatchCard
                    label="Invoiced"
                    value={money(inv.amount, 0)}
                    sub={inv.invoice_number}
                    ok={inv.match_status === "MATCHED"}
                  />
                </div>
              ) : (
                <Card className="border-dashed">
                  <p className="text-sm text-muted-foreground">
                    This invoice has no purchase order behind it, so there is
                    nothing to match against. Communities usually require an
                    order above a threshold amount for exactly this reason.
                  </p>
                </Card>
              )}
              {inv.match_status === "MATCH_EXCEPTION" && (
                <p className="mt-2 text-xs text-destructive">
                  The invoice disagrees with the order by more than the agreed
                  tolerance, so it was flagged automatically and held.
                </p>
              )}
            </div>
          </div>
        </DetailSheet>
      )}

      {creating && (
        <NewInvoiceModal
          vendors={vendors}
          pos={pos}
          onClose={() => setCreating(false)}
          onCreate={async (b) => {
            const created: any = await mutate("/payables", "POST", b);
            setCreating(false);
            say(`Invoice ${created.invoice_number} entered as a draft.`);
            setSelected(created.id);
          }}
        />
      )}
    </PageShell>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between px-4 py-2">
      <span className={bold ? "text-sm font-semibold" : "text-sm text-muted-foreground"}>
        {label}
      </span>
      <span className={"tabular " + (bold ? "text-sm font-semibold" : "text-sm")}>
        {value}
      </span>
    </div>
  );
}

function MatchCard({ label, value, sub, ok }: { label: string; value: string; sub: string; ok: boolean }) {
  return (
    <div
      className={
        "rounded-lg border p-3 " +
        (ok ? "border-success/40 bg-success/8" : "border-destructive/40 bg-destructive/8")
      }
    >
      <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={"tabular mt-1 text-sm font-semibold " + (ok ? "text-success" : "text-destructive")}>
        {value}
      </p>
      <p className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">{sub}</p>
    </div>
  );
}

function NewInvoiceModal({
  vendors, pos, onClose, onCreate,
}: {
  vendors: any[];
  pos: any[];
  onClose: () => void;
  onCreate: (b: any) => Promise<void>;
}) {
  const [form, setForm] = useState({
    vendor_id: vendors[0]?.id ?? "",
    po_header_id: "",
    invoice_number: "",
    amount: "",
    description: "",
    fund: "Operating",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const vendorPos = pos.filter(
    (p) => p.vendor_id === form.vendor_id && p.status === "APPROVED"
  );

  return (
    <Modal
      open
      onClose={onClose}
      title="Enter a vendor invoice"
      description="Linking an invoice to a purchase order lets the system match it automatically."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!form.invoice_number.trim() || !form.amount || busy}
            onClick={async () => {
              setBusy(true);
              await onCreate({ ...form, amount: Number(form.amount) });
              setBusy(false);
            }}
          >
            {busy ? "Saving…" : "Save as draft"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="v">Vendor</Label>
            <Select id="v" value={form.vendor_id} onChange={(e) => { set("vendor_id", e.target.value); set("po_header_id", ""); }}>
              {vendors.filter((v) => v.status === "ACTIVE").map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="n">Invoice number</Label>
            <Input id="n" value={form.invoice_number} onChange={(e) => set("invoice_number", e.target.value)} placeholder="INV-2026-0412" autoFocus />
          </div>
        </div>
        <div>
          <Label htmlFor="po">Against a purchase order</Label>
          <Select id="po" value={form.po_header_id} onChange={(e) => set("po_header_id", e.target.value)}>
            <option value="">No order — enter directly</option>
            {vendorPos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.po_number} — {p.description} ({money(p.amount, 0)})
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {form.po_header_id
              ? "This invoice will be matched against the order and its delivery record."
              : "Without an order there is nothing to match against, so no automatic check happens."}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="a">Net amount ($)</Label>
            <Input id="a" type="number" value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="1250.00" />
          </div>
          <div>
            <Label htmlFor="f">Fund</Label>
            <Select id="f" value={form.fund} onChange={(e) => set("fund", e.target.value)}>
              <option>Operating</option>
              <option>Reserve</option>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="d">Description</Label>
          <Input id="d" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Quarterly landscaping service" />
        </div>
      </div>
    </Modal>
  );
}
