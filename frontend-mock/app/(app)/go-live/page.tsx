"use client";

import { useState } from "react";
import {
  Activity, CheckCircle2, Rocket, ShieldCheck, TriangleAlert, XCircle,
} from "lucide-react";
import { useAuth } from "../../providers";
import { useApi } from "@/lib/use-api";
import { Alert, Badge, Button, Card } from "@/components/ui";
import {
  PageHeader, PageShell, SectionGuide, StatCard, StatGrid, shortDate,
} from "@/components/app/kit";
import { cn } from "@/lib/utils";

const STATUS_META: Record<string, { tone: string; icon: React.ElementType; label: string }> = {
  PASS: { tone: "success", icon: CheckCircle2, label: "Ready" },
  WARN: { tone: "warning", icon: TriangleAlert, label: "Needs attention" },
  FAIL: { tone: "danger", icon: XCircle, label: "Blocking" },
  INFO: { tone: "info", icon: Activity, label: "For information" },
};

export default function GoLivePage() {
  const { tenant } = useAuth();
  const { data: checklist } = useApi<any>("/compliance/checklist", null);
  const { data: status } = useApi<any>("/compliance/go-live/status", null);
  const [flash, setFlash] = useState<string | null>(null);

  if (!checklist) return null;

  const items = checklist.items ?? [];
  const summary = checklist.summary ?? { PASS: 0, WARN: 0, FAIL: 0, INFO: 0 };
  const health = checklist.health ?? {};
  const blocking = summary.FAIL ?? 0;
  const readyPct = Math.round((summary.PASS / Math.max(1, items.length)) * 100);

  const grouped = items.reduce((acc: Record<string, any[]>, it: any) => {
    (acc[it.category] ||= []).push(it);
    return acc;
  }, {});

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="Go-Live & Compliance"
        description={`Whether ${tenant?.name} is ready to stop being a test system and start handling real money.`}
        actions={
          <Button disabled={blocking > 0} onClick={() => setFlash("In the live product this switches the community to live operation, locks migration rollback and enables live payment processing.")}>
            <Rocket className="h-4 w-4" />
            {blocking > 0 ? `${blocking} blocking issue(s)` : "Go live"}
          </Button>
        }
      />

      <SectionGuide
        what="The pre-flight check. Before a community starts taking real payments there is a list of things that must be true — the books must balance, approvals must be configured, insurance must be current, the payment gateway must be switched from test to live."
        who="Platform staff and senior administrators run this with the client before launch. The board usually wants to see the result."
        how={[
          "Each check runs against live data — this is not a manual tick-list somebody fills in.",
          "Checks are graded: ready, needs attention, or blocking.",
          "A blocking issue prevents go-live entirely until it is resolved.",
          "Items marked as needing attention are judgement calls for a person to sign off.",
          "Going live locks migration rollback and switches the payment gateway to live mode.",
        ]}
        flow="Reads from every other section — the ledger, payables, purchasing, cash, documents and setup. Nothing writes back until the moment the community actually goes live."
      />

      {flash && <Alert kind="info">{flash}</Alert>}

      {status && !status.is_live && (
        <Alert kind="warning" title="This community is not live yet">
          It is running in preparation mode. No real money moves, the payment
          gateway is in test mode, and data imports can still be rolled back.
        </Alert>
      )}

      <StatGrid>
        <StatCard label="Checks passing" value={`${summary.PASS} of ${items.length}`} hint={`${readyPct}% ready`} tone={readyPct > 80 ? "success" : "warning"} icon={CheckCircle2} />
        <StatCard label="Need attention" value={summary.WARN} tone={summary.WARN ? "warning" : "success"} icon={TriangleAlert} />
        <StatCard label="Blocking" value={blocking} tone={blocking ? "danger" : "success"} icon={XCircle} />
        <StatCard label="Last validated" value={status ? shortDate(status.last_validation_at) : "—"} icon={Activity} />
      </StatGrid>

      {/* readiness bar */}
      <Card>
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-semibold">Overall readiness</p>
          <p className="tabular text-sm font-semibold">{readyPct}%</p>
        </div>
        <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-muted">
          {summary.PASS > 0 && (
            <div className="bg-success" style={{ width: `${(summary.PASS / items.length) * 100}%` }} />
          )}
          {summary.WARN > 0 && (
            <div className="bg-warning" style={{ width: `${(summary.WARN / items.length) * 100}%` }} />
          )}
          {summary.FAIL > 0 && (
            <div className="bg-destructive" style={{ width: `${(summary.FAIL / items.length) * 100}%` }} />
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-success" /> {summary.PASS} ready
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-warning" /> {summary.WARN} need attention
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-destructive" /> {summary.FAIL} blocking
          </span>
        </div>
      </Card>

      {/* checks by category */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider">
          The checklist
        </h2>
        <div className="space-y-4">
          {Object.entries(grouped).map(([category, list]) => (
            <div key={category}>
              <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                {category}
              </p>
              <Card padded={false}>
                <div className="divide-y">
                  {(list as any[]).map((it) => {
                    const meta = STATUS_META[it.status] ?? STATUS_META.INFO;
                    const Icon = meta.icon;
                    return (
                      <div key={it.code} className="flex items-start gap-3 px-5 py-3.5">
                        <Icon
                          className={cn(
                            "mt-0.5 h-4 w-4 shrink-0",
                            it.status === "PASS" && "text-success",
                            it.status === "WARN" && "text-warning",
                            it.status === "FAIL" && "text-destructive",
                            it.status === "INFO" && "text-info"
                          )}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">{it.title}</p>
                            <Badge tone={meta.tone as any}>{meta.label}</Badge>
                            {it.manual && <Badge tone="neutral">Human sign-off</Badge>}
                          </div>
                          <p className="mt-0.5 text-sm text-muted-foreground">
                            {it.detail}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          ))}
        </div>
      </section>

      {/* system health */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider">
            System health
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Live counts the checks are derived from
          </p>
        </div>
        <Card padded={false}>
          <div className="grid grid-cols-2 divide-x divide-y sm:grid-cols-3 lg:grid-cols-4">
            {[
              ["Posted journal batches", health.gl_posted_batches],
              ["Unbalanced batches", health.gl_unbalanced_batches],
              ["Open periods", health.open_periods],
              ["Closed periods", health.closed_periods],
              ["Budget control mode", health.budget_control_mode],
              ["Invoices on hold", health.ap_open_holds],
              ["Unreconciled statements", health.unreconciled_statements],
              ["Active fixed assets", health.active_assets],
              ["Chart of accounts", health.coa_structures],
              ["Vendors", health.vendors],
              ["Audit events recorded", health.audit_events?.toLocaleString?.() ?? health.audit_events],
            ].map(([label, value]) => (
              <div key={String(label)} className="px-4 py-3">
                <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {label}
                </p>
                <p className="stat-value mt-0.5 text-lg font-semibold">
                  {value ?? "—"}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </section>

      <Card className="border-primary/25 bg-accent/40">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" />
          What happens the moment a community goes live
        </p>
        <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
          <li>· The payment gateway switches from test to live and real money begins moving</li>
          <li>· Data imports can no longer be rolled back</li>
          <li>· Scheduled jobs start running against real residents</li>
          <li>· The audit trail becomes the system of record for compliance</li>
          <li>· Corrections from this point are made by posting entries, never by editing history</li>
        </ul>
      </Card>
    </PageShell>
  );
}
