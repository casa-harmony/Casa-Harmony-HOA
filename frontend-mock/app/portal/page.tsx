"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight, CheckCircle2, CreditCard, Download, FileText, Home, LogOut,
  MessageSquarePlus, Receipt, Ticket, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { TENANTS } from "@/lib/mock-data/seed";
import {
  Badge, Button, Card, Input, Label, Modal, Select, Spinner, Textarea,
} from "@/components/ui";
import { ThemeToggle } from "@/components/theme";
import {
  EmptyState, StatCard, StatGrid, StatusBadge, money, relTime, shortDate,
} from "@/components/app/kit";
import { cn } from "@/lib/utils";

type Tab = "assessments" | "payments" | "documents" | "requests";

export default function PortalPage() {
  const router = useRouter();
  const [session, setSession] = useState<{ residentId: string; tenantId: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [rev, setRev] = useState(0);

  const [dash, setDash] = useState<any>(null);
  const [units, setUnits] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [tab, setTab] = useState<Tab>("assessments");
  const [rows, setRows] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);
  const [asking, setAsking] = useState(false);

  const tenant = TENANTS.find((t) => t.id === session?.tenantId);

  /* ------------------------------------------------------------- session */
  useEffect(() => {
    try {
      const raw = localStorage.getItem("casa_portal_session");
      if (!raw) {
        router.replace("/portal/login");
        return;
      }
      setSession(JSON.parse(raw));
    } catch {
      router.replace("/portal/login");
    } finally {
      setReady(true);
    }
  }, [router]);

  const call = useCallback(
    <T,>(path: string, init?: { method?: string; body?: any }) => {
      if (!session) return Promise.resolve(null as T);
      const sep = path.includes("?") ? "&" : "?";
      return apiFetch<T>(`${path}${sep}resident=${session.residentId}`, {
        tenantId: session.tenantId,
        method: init?.method,
        body: { ...(init?.body ?? {}), resident_id: session.residentId },
      });
    },
    [session]
  );

  /* ---------------------------------------------------------------- load */
  useEffect(() => {
    if (!session) return;
    call<any>("/portal/dashboard").then(setDash);
    call<any[]>("/portal/units").then((u) => {
      setUnits(u ?? []);
      setSelected((prev: any) => prev ?? (u ?? [])[0] ?? null);
    });
    call<any[]>("/portal/tickets").then((t) => setTickets(t ?? []));
  }, [session, call, rev]);

  /** Tab name → the endpoint that serves it. */
  const ENDPOINT: Record<Exclude<Tab, "requests">, string> = {
    assessments: "invoices",
    payments: "receipts",
    documents: "documents",
  };

  useEffect(() => {
    if (!selected || tab === "requests") return;
    call<any[]>(
      `/portal/units/${selected.homeowner_id}/${ENDPOINT[tab]}`
    ).then((r) => setRows(Array.isArray(r) ? r : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, tab, call, rev]);

  if (!ready || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Opening your account…" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* -------------------------------------------------------- top bar */}
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
            CH
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">
              {tenant?.name}
            </p>
            <p className="truncate text-2xs text-muted-foreground">
              Resident Portal
            </p>
          </div>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              localStorage.removeItem("casa_portal_session");
              router.replace("/portal/login");
            }}
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-5 py-7">
        {/* ------------------------------------------------------ greeting */}
        <div>
          <p className="font-mono text-2xs font-semibold uppercase tracking-[0.14em] text-primary">
            Your account
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Hello, {dash?.resident_name?.split(" ")[0] ?? "there"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            You can see your own {units.length === 1 ? "unit" : `${units.length} units`},
            what you owe, and what you have paid. Nothing about anyone else.
          </p>
        </div>

        {dash && (
          <StatGrid>
            <StatCard
              label="Balance owing"
              value={money(dash.total_balance, 0)}
              tone={dash.total_balance > 0 ? "danger" : "success"}
              hint={dash.total_balance > 0 ? "Payment overdue" : "You are up to date"}
              icon={Wallet}
            />
            <StatCard
              label="Next payment"
              value={money(dash.next_due_amount, 0)}
              hint={`Due ${shortDate(dash.next_due_date)}`}
              tone="primary"
              icon={Receipt}
            />
            <StatCard
              label={units.length === 1 ? "Your unit" : "Your units"}
              value={units.map((u) => u.unit_number).join(", ") || "—"}
              icon={Home}
            />
            <StatCard
              label="Open requests"
              value={dash.open_tickets}
              hint="Reported by you"
              icon={Ticket}
            />
          </StatGrid>
        )}

        {dash?.total_balance > 0 && (
          <Card className="flex flex-wrap items-center justify-between gap-4 border-primary/30 bg-accent/40">
            <div>
              <p className="text-sm font-semibold">
                {money(dash.total_balance)} is outstanding on your account
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Pay by card or bank transfer. Payments post to your balance
                immediately.
              </p>
            </div>
            <Button
              onClick={() =>
                toast.success("Payment accepted", {
                  description:
                    "In the live product this opens the payment provider. Card details never touch this system.",
                })
              }
            >
              <CreditCard className="h-4 w-4" />
              Pay now
            </Button>
          </Card>
        )}

        {/* --------------------------------------------------- unit picker */}
        {units.length > 1 && (
          <div>
            <p className="mb-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              You hold {units.length} units — choose one
            </p>
            <div className="flex flex-wrap gap-2">
              {units.map((u) => (
                <button
                  key={u.homeowner_id}
                  onClick={() => setSelected(u)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    selected?.homeowner_id === u.homeowner_id
                      ? "border-primary bg-primary/10"
                      : "border-border bg-card hover:bg-muted"
                  )}
                >
                  <p className="text-sm font-semibold">Unit {u.unit_number}</p>
                  <p className="text-2xs text-muted-foreground">
                    {u.balance > 0 ? `${money(u.balance, 0)} owing` : "Up to date"}
                  </p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------- tabs */}
        <div>
          <div className="flex flex-wrap gap-1 border-b">
            {(
              [
                ["assessments", "Assessments"],
                ["payments", "Payment history"],
                ["documents", "Documents"],
                ["requests", "My requests"],
              ] as [Tab, string][]
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cn(
                  "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                  tab === k
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="pt-4">
            {tab === "assessments" && (
              <PortalTable
                head={["Period", "Description", "Amount", "Paid", "Status"]}
                rows={rows.map((r) => [
                  r.period,
                  r.description,
                  money(r.amount),
                  money(r.paid_amount),
                  <StatusBadge key={r.id} status={r.status === "DUE" ? "PENDING" : "PAID"} />,
                ])}
                empty="No assessments raised yet."
              />
            )}

            {tab === "payments" && (
              <PortalTable
                head={["Receipt", "Paid on", "Method", "Amount"]}
                rows={rows.map((r) => [
                  r.receipt_number,
                  shortDate(r.paid_on),
                  r.method,
                  money(r.amount),
                ])}
                empty="No payments recorded yet."
              />
            )}

            {tab === "documents" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {rows.length === 0 && (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <EmptyState icon={FileText} title="No documents shared with you yet" />
                  </div>
                )}
                {rows.map((d) => (
                  <Card key={d.id} padded={false} className="flex flex-col">
                    <div className="flex flex-1 items-start gap-3 p-4">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <p className="line-clamp-2 text-sm font-medium leading-snug">
                          {d.filename}
                        </p>
                        <p className="mt-1 text-2xs text-muted-foreground">
                          {(d.size_bytes / 1024).toFixed(0)} KB ·{" "}
                          {relTime(d.created_at)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => toast.success(`Downloading ${d.filename}`)}
                      className="flex items-center justify-center gap-1.5 border-t px-4 py-2 text-xs font-medium text-primary hover:bg-muted/50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </button>
                  </Card>
                ))}
              </div>
            )}

            {tab === "requests" && (
              <div className="space-y-3">
                <div className="flex justify-end">
                  <Button onClick={() => setAsking(true)}>
                    <MessageSquarePlus className="h-4 w-4" />
                    Report something
                  </Button>
                </div>
                {tickets.length === 0 ? (
                  <EmptyState
                    icon={Ticket}
                    title="You have not reported anything"
                    description="Report a maintenance problem, a complaint or a request and the management office picks it up."
                    action={
                      <Button onClick={() => setAsking(true)}>
                        <MessageSquarePlus className="h-4 w-4" />
                        Report something
                      </Button>
                    }
                  />
                ) : (
                  <div className="space-y-2">
                    {tickets.map((t) => (
                      <Card key={t.id} className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{t.subject}</p>
                          <p className="mt-0.5 font-mono text-2xs text-muted-foreground">
                            {t.ticket_number} · reported {relTime(t.created_at)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusBadge status={t.priority} />
                          <StatusBadge status={t.status} />
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <Card className="border-primary/25 bg-accent/40">
          <p className="text-sm font-semibold">What you cannot see here</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Any other unit, any other resident, the community's overall finances,
            vendor contracts, or anything in the staff application. Your account
            is scoped to the units you hold, and the system enforces that in the
            database itself — not just on screen.
          </p>
        </Card>
      </main>

      {asking && (
        <ReportModal
          onClose={() => setAsking(false)}
          onSubmit={async (body) => {
            await call("/portal/tickets", { method: "POST", body });
            setAsking(false);
            setRev((r) => r + 1);
            setTab("requests");
            toast.success("Request submitted", {
              description:
                "The management office has been notified. You can follow its progress here.",
            });
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ table */

function PortalTable({
  head,
  rows,
  empty,
}: {
  head: string[];
  rows: React.ReactNode[][];
  empty: string;
}) {
  if (rows.length === 0) return <EmptyState icon={Receipt} title={empty} />;
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {head.map((h, i) => (
                <th
                  key={h}
                  className={cn(
                    "px-4 py-2.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground",
                    i === 0 ? "text-left" : i >= 2 ? "text-right" : "text-left"
                  )}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b last:border-0">
                {r.map((c, j) => (
                  <td
                    key={j}
                    className={cn(
                      "px-4 py-3",
                      j === 0 ? "font-medium" : j >= 2 ? "tabular text-right" : ""
                    )}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ report modal */

function ReportModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (b: any) => Promise<void>;
}) {
  const [form, setForm] = useState({
    subject: "",
    description: "",
    category: "MAINTENANCE",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open
      onClose={onClose}
      title="Report something"
      description="This goes straight to the management office and appears on their service desk."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!form.subject.trim() || busy}
            onClick={async () => {
              setBusy(true);
              await onSubmit(form);
              setBusy(false);
            }}
          >
            {busy ? "Sending…" : "Submit"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="c">What kind of thing is it?</Label>
          <Select
            id="c"
            value={form.category}
            onChange={(e) => set("category", e.target.value)}
          >
            <option value="MAINTENANCE">Something is broken</option>
            <option value="COMPLAINT">A complaint</option>
            <option value="REQUEST">A request</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="s">Summary</Label>
          <Input
            id="s"
            value={form.subject}
            onChange={(e) => set("subject", e.target.value)}
            placeholder="e.g. Hallway light out on my floor"
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="d">Tell us more</Label>
          <Textarea
            id="d"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="Where is it, and when did you first notice it?"
          />
        </div>
      </div>
    </Modal>
  );
}
