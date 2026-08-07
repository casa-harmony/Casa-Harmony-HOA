"use client";

import { useMemo, useState } from "react";
import {
  CreditCard, Landmark, Percent, RotateCcw, ShieldCheck, TrendingUp, XCircle,
} from "lucide-react";
import { useAuth } from "../../providers";
import { useApi, useMutate } from "@/lib/use-api";
import { Alert, Badge, Button, Card, Switch } from "@/components/ui";
import {
  Column, DataTable, EmptyState, FilterChips, PageHeader, PageShell,
  SectionGuide, StatCard, StatGrid, StatusBadge, Toolbar, money, relTime,
} from "@/components/app/kit";

export default function GatewayPage() {
  const { can } = useAuth();
  const { data: txns } = useApi<any[]>("/gateway/transactions", []);
  const { data: config } = useApi<any>("/gateway/config", null);
  const { mutate } = useMutate();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [flash, setFlash] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return txns.filter((t) => {
      if (status !== "ALL" && t.status !== status) return false;
      return (
        !q ||
        t.payer.toLowerCase().includes(q) ||
        t.reference.toLowerCase().includes(q) ||
        String(t.unit).includes(q)
      );
    });
  }, [txns, status, search]);

  const settled = txns.filter((t) => t.status === "SUCCESS");
  const collected = settled.reduce((s, t) => s + t.amount, 0);
  const fees = settled.reduce((s, t) => s + t.fee, 0);
  const failed = txns.filter((t) => t.status === "FAILED").length;

  const columns: Column<any>[] = [
    {
      key: "payer",
      header: "Paid by",
      render: (t) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{t.payer}</p>
          <p className="truncate text-2xs text-muted-foreground">Unit {t.unit}</p>
        </div>
      ),
    },
    {
      key: "method",
      header: "Method",
      render: (t) => (
        <span className="inline-flex items-center gap-1.5 text-xs">
          {t.method === "CARD" ? (
            <>
              <CreditCard className="h-3 w-3 text-muted-foreground" />
              Card ••{t.card_last4}
            </>
          ) : (
            <>
              <Landmark className="h-3 w-3 text-muted-foreground" />
              Bank transfer
            </>
          )}
        </span>
      ),
    },
    {
      key: "ref",
      header: "Reference",
      render: (t) => (
        <span className="font-mono text-2xs text-muted-foreground">
          {t.reference}
        </span>
      ),
    },
    { key: "amount", header: "Amount", numeric: true, render: (t) => <span className="text-sm font-semibold">{money(t.amount)}</span> },
    { key: "fee", header: "Fee", numeric: true, render: (t) => <span className="text-xs text-muted-foreground">{money(t.fee)}</span> },
    { key: "status", header: "Status", render: (t) => <StatusBadge status={t.status} /> },
    { key: "when", header: "When", render: (t) => <span className="text-xs text-muted-foreground">{relTime(t.created_at)}</span> },
    {
      key: "act",
      header: "",
      render: (t) =>
        t.status === "SUCCESS" && can("payment.manage") ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={async (e) => {
              e.stopPropagation();
              await mutate(`/gateway/transactions/${t.id}/refund`, "POST");
              setFlash(`${money(t.amount)} refunded to ${t.payer}.`);
              setTimeout(() => setFlash(null), 4000);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Refund
          </Button>
        ) : null,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="Payment Gateway"
        description="How homeowners pay online, what it costs the community in processing fees, and the record of every attempt."
      />

      <SectionGuide
        what="The connection to the card and bank-transfer processor that lets residents pay their dues online from the portal, instead of posting a cheque."
        who="Configured by administrators. Accountants watch the transaction feed because it feeds the receivables ledger. Residents use it without ever seeing this screen."
        how={[
          "A resident pays from their portal by card or bank transfer.",
          "The card number is never stored here — it is exchanged for a token held by the processor, so the community holds nothing sensitive.",
          "The processor charges a fee, which can either be absorbed by the community or passed to the resident.",
          "Successful payments post automatically against that unit's balance.",
          "A failed payment leaves the balance outstanding, which will eventually trigger the collections ladder.",
          "Refunds are issued from here and reverse the original posting.",
        ]}
        flow="Feeds Receivables directly — a successful payment reduces a homeowner's balance without anybody keying anything in."
      />

      {flash && <Alert kind="success">{flash}</Alert>}

      <StatGrid>
        <StatCard label="Collected online" value={money(collected, 0)} tone="success" icon={TrendingUp} />
        <StatCard label="Processing fees" value={money(fees)} hint={config?.pass_fees_to_resident ? "Passed to residents" : "Absorbed by the community"} tone="brass" icon={Percent} />
        <StatCard label="Successful" value={settled.length} tone="success" />
        <StatCard label="Failed" value={failed} tone={failed ? "danger" : "success"} icon={XCircle} />
      </StatGrid>

      {config && (
        <Card padded={false}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
            <div>
              <h3 className="text-sm font-semibold">Gateway configuration</h3>
              <p className="text-xs text-muted-foreground">
                Connected to {config.provider}
              </p>
            </div>
            <Badge tone={config.mode === "TEST" ? "warning" : "success"}>
              {config.mode === "TEST" ? "Test mode" : "Live mode"}
            </Badge>
          </div>
          <div className="grid grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
            <ConfigCell label="Card payments" value={config.card_enabled ? "Enabled" : "Disabled"} sub={`${config.card_fee_pct}% + ${money(config.card_fee_flat)}`} on={config.card_enabled} />
            <ConfigCell label="Bank transfer" value={config.ach_enabled ? "Enabled" : "Disabled"} sub={`${money(config.ach_fee_flat)} flat`} on={config.ach_enabled} />
            <ConfigCell label="Who pays the fee" value={config.pass_fees_to_resident ? "The resident" : "The community"} sub="Configurable per community" on />
            <ConfigCell label="Card details stored" value="Never" sub="Tokenised at the processor" on />
          </div>
        </Card>
      )}

      {config?.mode === "TEST" && (
        <Alert kind="warning" title="Still in test mode">
          No real money moves while the gateway is in test mode. Switching to
          live is one of the items on the go-live checklist.
        </Alert>
      )}

      <Toolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search by payer, unit or reference…"
        filters={
          <FilterChips
            value={status}
            onChange={setStatus}
            options={[
              { value: "ALL", label: "All", count: txns.length },
              { value: "SUCCESS", label: "Successful", count: settled.length },
              { value: "FAILED", label: "Failed", count: failed },
              { value: "REFUNDED", label: "Refunded", count: txns.filter((t) => t.status === "REFUNDED").length },
            ]}
          />
        }
      />

      <DataTable
        rows={filtered}
        columns={columns}
        empty={<EmptyState icon={CreditCard} title="No transactions match" />}
      />

      <Card className="border-primary/25 bg-accent/40">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Card security
        </p>
        <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
          Card numbers never touch this system. When a resident pays, the card
          is sent straight to the processor, which returns a token — a
          meaningless reference that can only be used to charge that same card
          again through the same account. That token is what gets stored. It
          means a breach of this database exposes no card data at all, and it is
          what keeps the platform within the card industry's security rules.
        </p>
      </Card>
    </PageShell>
  );
}

function ConfigCell({ label, value, sub, on }: { label: string; value: string; sub: string; on: boolean }) {
  return (
    <div className="px-5 py-4">
      <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={"mt-1 text-sm font-semibold " + (on ? "" : "text-muted-foreground")}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
