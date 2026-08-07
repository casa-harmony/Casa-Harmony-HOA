"use client";

import { useMemo, useState } from "react";
import { Ban, Banknote, CheckCircle2, CreditCard, Landmark, Wallet } from "lucide-react";
import { useAuth } from "../../providers";
import { useApi, useMutate } from "@/lib/use-api";
import { Alert, Badge, Button, Card } from "@/components/ui";
import {
  Column, DataTable, DetailSheet, EmptyState, Facts, FilterChips, PageHeader,
  PageShell, SectionGuide, StatCard, StatGrid, StatusBadge, Toolbar, money,
  shortDate,
} from "@/components/app/kit";

export default function PaymentsPage() {
  const { can } = useAuth();
  const { data: payments } = useApi<any[]>("/ap-payments", []);
  const { data: banks } = useApi<any[]>("/cash/bank-accounts", []);
  const { mutate } = useMutate();

  const [search, setSearch] = useState("");
  const [method, setMethod] = useState("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const pay = payments.find((p) => p.id === selected) ?? null;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return payments.filter((p) => {
      if (method !== "ALL" && p.method !== method) return false;
      return (
        !q ||
        p.payment_number.toLowerCase().includes(q) ||
        p.vendor_name.toLowerCase().includes(q) ||
        p.reference.toLowerCase().includes(q)
      );
    });
  }, [payments, method, search]);

  const total = payments
    .filter((p) => p.status !== "CANCELLED")
    .reduce((s, p) => s + p.amount, 0);
  const uncleared = payments.filter((p) => !p.cleared && p.status !== "CANCELLED");
  const ach = payments.filter((p) => p.method === "ACH").length;
  const check = payments.filter((p) => p.method === "CHECK").length;

  const columns: Column<any>[] = [
    {
      key: "ref",
      header: "Payment",
      render: (p) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{p.payment_number}</p>
          <p className="truncate font-mono text-2xs text-muted-foreground">
            {p.reference}
          </p>
        </div>
      ),
    },
    {
      key: "vendor",
      header: "Paid to",
      render: (p) => (
        <div className="min-w-0">
          <p className="truncate text-sm">{p.vendor_name}</p>
          <p className="truncate text-2xs text-muted-foreground">
            for {p.invoice_number}
          </p>
        </div>
      ),
    },
    {
      key: "method",
      header: "Method",
      render: (p) => (
        <span className="inline-flex items-center gap-1.5 text-xs">
          {p.method === "ACH" ? (
            <Landmark className="h-3 w-3 text-muted-foreground" />
          ) : (
            <Banknote className="h-3 w-3 text-muted-foreground" />
          )}
          {p.method}
        </span>
      ),
    },
    {
      key: "date",
      header: "Date",
      render: (p) => (
        <span className="text-xs text-muted-foreground">
          {shortDate(p.payment_date)}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      numeric: true,
      render: (p) => (
        <span className="text-sm font-semibold">{money(p.amount)}</span>
      ),
    },
    {
      key: "cleared",
      header: "Bank",
      render: (p) =>
        p.status === "CANCELLED" ? (
          <Badge tone="neutral">Voided</Badge>
        ) : p.cleared ? (
          <Badge tone="success">Cleared</Badge>
        ) : (
          <Badge tone="warning">In transit</Badge>
        ),
    },
    { key: "status", header: "Status", render: (p) => <StatusBadge status={p.status} /> },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Accounts Payable"
        title="Payments"
        description="Money actually leaving the community's bank accounts, and whether each payment has cleared."
      />

      <SectionGuide
        what="The record of every payment issued to a vendor — by bank transfer or by cheque — drawn from a named bank account and traceable back to the invoice it settles."
        who="Accountants issue payments. Only someone holding the payment permission can void or stop one. Every action is written to the audit trail with the person's name against it."
        how={[
          "A payment can only be raised against an invoice that has been approved.",
          "It is drawn from a specific bank account, which decides which fund the money leaves.",
          "The payment is issued by bank transfer or cheque and gets a reference number.",
          "It stays 'in transit' until it appears on the bank statement and is reconciled.",
          "A payment can be voided before it clears; afterwards a correcting entry is required instead.",
        ]}
        flow="Receives approved invoices from Payables. Feeds the General Ledger and Bank Reconciliation. Reconciliation writes back — matching a payment on the statement marks it cleared here."
      />

      {flash && <Alert kind="success">{flash}</Alert>}

      <StatGrid>
        <StatCard label="Paid this period" value={money(total, 0)} tone="brass" icon={Wallet} />
        <StatCard
          label="Not yet cleared"
          value={uncleared.length}
          hint={uncleared.length ? money(uncleared.reduce((s, p) => s + p.amount, 0), 0) : "All cleared"}
          tone={uncleared.length ? "warning" : "success"}
        />
        <StatCard label="By bank transfer" value={ach} icon={Landmark} />
        <StatCard label="By cheque" value={check} icon={Banknote} />
      </StatGrid>

      {/* bank position */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {banks.map((b) => (
          <Card key={b.id} className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{b.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {b.bank} {b.masked} · {b.fund} fund
              </p>
              {b.unreconciled_items > 0 && (
                <Badge tone="warning" className="mt-1.5">
                  {b.unreconciled_items} unreconciled
                </Badge>
              )}
            </div>
            <p className="stat-value shrink-0 text-xl font-semibold">
              {money(b.balance, 0)}
            </p>
          </Card>
        ))}
      </div>

      <Toolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search by payment number, vendor or reference…"
        filters={
          <FilterChips
            value={method}
            onChange={setMethod}
            options={[
              { value: "ALL", label: "All", count: payments.length },
              { value: "ACH", label: "Bank transfer", count: ach },
              { value: "CHECK", label: "Cheque", count: check },
            ]}
          />
        }
      />

      <DataTable
        rows={filtered}
        columns={columns}
        onRowClick={(p) => setSelected(p.id)}
        empty={
          <EmptyState
            icon={CreditCard}
            title="No payments yet"
            description="Approve an invoice on the Payables screen and pay it to see a payment appear here."
          />
        }
      />

      {pay && (
        <DetailSheet
          open
          onClose={() => setSelected(null)}
          title={pay.payment_number}
          subtitle={`${pay.vendor_name} · ${shortDate(pay.payment_date)}`}
          badge={<StatusBadge status={pay.status} />}
          footer={
            can("ap.pay") &&
            pay.status !== "CANCELLED" && (
              <>
                {!pay.cleared && (
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      await mutate(`/ap-payments/${pay.id}/clear`, "POST");
                      setFlash("Marked as cleared on the bank statement.");
                      setTimeout(() => setFlash(null), 4000);
                    }}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Mark cleared
                  </Button>
                )}
                <Button
                  variant="danger"
                  onClick={async () => {
                    await mutate(`/ap-payments/${pay.id}/void`, "POST");
                    setFlash(`${pay.payment_number} voided. A reversing entry has been queued for the ledger.`);
                    setTimeout(() => setFlash(null), 5000);
                  }}
                >
                  <Ban className="h-4 w-4" />
                  Void payment
                </Button>
              </>
            )
          }
        >
          <div className="space-y-6">
            <Facts
              items={[
                { label: "Paid to", value: pay.vendor_name },
                { label: "Settles invoice", value: pay.invoice_number },
                { label: "Method", value: pay.method === "ACH" ? "Bank transfer" : "Cheque" },
                { label: "Reference", value: <span className="font-mono text-xs">{pay.reference}</span> },
                { label: "Drawn from", value: pay.bank_account },
                { label: "Amount", value: <span className="tabular font-semibold">{money(pay.amount)}</span> },
              ]}
            />

            <Card className={pay.cleared ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5"}>
              <p className="text-sm font-semibold">
                {pay.cleared ? "Cleared the bank" : "Still in transit"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {pay.cleared
                  ? "This payment has been matched against the bank statement during reconciliation."
                  : "The payment has been issued but has not yet appeared on a bank statement. It will clear at the next reconciliation."}
              </p>
            </Card>

            <Card className="border-primary/25 bg-accent/40">
              <p className="text-sm font-semibold">Why this cannot simply be deleted</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Once a payment posts to the ledger it is permanent. Voiding it
                creates a reversing entry dated today rather than erasing the
                original — which is what keeps the financial statements
                defensible to an auditor.
              </p>
            </Card>
          </div>
        </DetailSheet>
      )}
    </PageShell>
  );
}
