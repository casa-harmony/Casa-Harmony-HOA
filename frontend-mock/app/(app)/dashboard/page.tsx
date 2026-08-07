"use client";

import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Banknote, Bell, CheckSquare, FileText,
  HandCoins, Ticket, TrendingUp, Users, Wallet,
} from "lucide-react";
import { useAuth } from "../../providers";
import { useApi } from "@/lib/use-api";
import { Badge, Button, Card } from "@/components/ui";
import {
  EmptyState, PageHeader, PageShell, SectionGuide, StatCard, StatGrid,
  StatusBadge, money, relTime, shortDate,
} from "@/components/app/kit";
import {
  AgeingChart, BudgetActualChart, CashTrendChart, ChartCard, TicketMixChart,
} from "@/components/app/charts";

export default function DashboardPage() {
  const { persona, role, tenant, can } = useAuth();

  const { data: board } = useApi<any>("/board/exec-dashboard", null);
  const { data: tickets } = useApi<any[]>(
    can("ticket.manage") ? "/service-desk/tickets" : null,
    []
  );
  const { data: approvals } = useApi<any[]>("/approvals/requests", []);
  const { data: payables } = useApi<any[]>(
    can("ap.manage") ? "/payables" : null,
    []
  );
  const { data: notifications } = useApi<any[]>("/notifications", []);
  const { data: budget } = useApi<any[]>(
    can("budget.manage") ? "/budgeting/lines" : null,
    []
  );
  const { data: forecast } = useApi<any[]>(
    can("report.read") ? "/board/cash-flow-forecast" : null,
    []
  );
  const { data: aging } = useApi<any>(
    can("report.read") ? "/subledger/aging" : null,
    null
  );

  const openTickets = tickets.filter(
    (t) => t.status === "OPEN" || t.status === "IN_PROGRESS"
  );
  const highPriority = openTickets.filter((t) => t.priority === "HIGH");
  const pendingApprovals = approvals.filter((a) => a.status === "PENDING");
  const heldInvoices = payables.filter((p) => p.on_hold);
  const unread = notifications.filter((n) => !n.is_read);
  const overBudget = budget.filter((b) => b.pct > 100);

  const firstName = persona?.full_name.split(" ")[0] ?? "there";

  return (
    <PageShell>
      <PageHeader
        eyebrow={tenant?.name}
        title={`Good morning, ${firstName}`}
        description={`You are signed in as ${role?.name}. This dashboard only shows what your role is allowed to see — sign in as someone else and it changes.`}
        actions={
          <Link href="/roles-and-flow">
            <Button variant="secondary" size="sm">
              How this all fits together
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
        }
      />

      <SectionGuide
        what="The landing screen. It gathers whatever needs a person's attention today and links straight to it — open work, things waiting on approval, money problems, and unread messages."
        who="Everyone, but the contents differ by role. A property manager sees tickets and approvals; an accountant sees invoices and budget variances; a board member sees the financial position only."
        how={[
          "Each tile counts live records from the community currently selected in the header.",
          "Tiles are clickable — they take you to the filtered list behind the number.",
          "Switching community in the header reloads every figure for that community.",
          "Switching role changes which tiles appear at all.",
        ]}
        flow="This screen only reads. Nothing is created here — it is a routing surface into the sections that do the work."
      />

      {/* ------------------------------------------------ money at a glance */}
      {board && can("report.read") && (
        <StatGrid>
          <StatCard
            label="Cash on hand"
            value={money(board.cash_total, 0)}
            hint="Operating + Reserve"
            tone="primary"
            icon={Wallet}
          />
          <StatCard
            label="Owed by homeowners"
            value={money(board.ar_open_total, 0)}
            hint={`${board.open_cases} account(s) in collections`}
            tone="brass"
            icon={HandCoins}
          />
          <StatCard
            label="Reserve funded"
            value={`${board.reserve_funded_pct}%`}
            hint="Against the 2025 reserve study"
            tone={board.reserve_funded_pct >= 70 ? "success" : "warning"}
            icon={TrendingUp}
          />
          <StatCard
            label="Units"
            value={board.units}
            hint={`${board.occupancy_pct}% occupied`}
            icon={Users}
          />
        </StatGrid>
      )}

      {/* -------------------------------------------------- needs attention */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider">
          Needs your attention
        </h2>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {can("ticket.manage") && (
            <AttentionCard
              href="/service-desk"
              icon={Ticket}
              title="Open service tickets"
              count={openTickets.length}
              tone={highPriority.length ? "danger" : "default"}
              caption={
                highPriority.length
                  ? `${highPriority.length} marked high priority`
                  : "Nothing urgent right now"
              }
              rows={openTickets.slice(0, 3).map((t) => ({
                key: t.id,
                left: t.subject,
                right: <StatusBadge status={t.priority} />,
                sub: `${t.ticket_number} · Unit ${t.unit}`,
              }))}
            />
          )}

          <AttentionCard
            href="/approvals"
            icon={CheckSquare}
            title="Waiting for approval"
            count={pendingApprovals.length}
            tone={pendingApprovals.length ? "warning" : "default"}
            caption={
              can("po.approve")
                ? "You are an approver on these"
                : "You can see these but not approve them"
            }
            rows={pendingApprovals.slice(0, 3).map((a) => ({
              key: a.id,
              left: a.vendor_name ?? a.description,
              right: (
                <span className="tabular text-xs font-semibold">
                  {money(a.amount, 0)}
                </span>
              ),
              sub: `${a.document_number} · level ${a.current_level} of ${a.required_levels}`,
            }))}
          />

          {can("ap.manage") && (
            <AttentionCard
              href="/payables"
              icon={AlertTriangle}
              title="Invoices on hold"
              count={heldInvoices.length}
              tone={heldInvoices.length ? "danger" : "success"}
              caption={
                heldInvoices.length
                  ? "Blocked from payment until released"
                  : "No invoices are held"
              }
              rows={heldInvoices.slice(0, 3).map((p) => ({
                key: p.id,
                left: p.vendor_name,
                right: (
                  <span className="tabular text-xs font-semibold">
                    {money(p.amount, 0)}
                  </span>
                ),
                sub: p.hold_reason ?? "",
              }))}
            />
          )}

          {!can("ticket.manage") && !can("ap.manage") && (
            <AttentionCard
              href="/notifications"
              icon={Bell}
              title="Unread messages"
              count={unread.length}
              tone={unread.length ? "warning" : "default"}
              caption="Addressed to you or to your role"
              rows={unread.slice(0, 3).map((n) => ({
                key: n.id,
                left: n.message,
                right: null,
                sub: relTime(n.created_at),
              }))}
            />
          )}
        </div>
      </section>

      {/* ------------------------------------------------------------ charts */}
      {can("report.read") && forecast.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider">
            The numbers over time
          </h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard
              title="Operating cash, next six months"
              caption="Projected closing balance from current dues and known commitments"
              table={{
                head: ["Month", "Opening", "In", "Out", "Closing"],
                rows: forecast.map((f) => [
                  f.period,
                  money(f.opening, 0),
                  money(f.inflow, 0),
                  money(f.outflow, 0),
                  money(f.ending, 0),
                ]),
              }}
            >
              <CashTrendChart
                data={forecast.map((f) => ({
                  period: f.period.replace(" 2026", ""),
                  ending: f.ending,
                }))}
              />
            </ChartCard>

            {aging && (
              <ChartCard
                title="How long money has been owed"
                caption="Outstanding homeowner balances, bucketed by age"
                table={{
                  head: ["Bucket", "Outstanding"],
                  rows: Object.entries(aging.totals).map(([k, v]) => [
                    k,
                    money(Number(v), 0),
                  ]),
                }}
              >
                <AgeingChart
                  data={Object.entries(aging.totals).map(([bucket, amount]) => ({
                    bucket,
                    amount: Number(amount),
                  }))}
                />
              </ChartCard>
            )}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* -------------------------------------------------- budget health */}
        {can("budget.manage") && budget.length > 0 && (
          <ChartCard
            title="Spending against budget"
            caption={
              overBudget.length
                ? `${overBudget.length} line(s) already over for the year`
                : "Every line still within budget"
            }
            action={
              overBudget.length > 0 ? (
                <Badge tone="danger">{overBudget.length} over</Badge>
              ) : undefined
            }
            table={{
              head: ["Category", "Budget", "Actual", "Used"],
              rows: budget.map((b) => [
                b.name,
                money(b.budget, 0),
                money(b.actual, 0),
                `${b.pct}%`,
              ]),
            }}
          >
            <BudgetActualChart
              data={budget.slice(0, 6).map((b) => ({
                name: b.name,
                budget: b.budget,
                actual: b.actual,
              }))}
            />
          </ChartCard>
        )}

        {/* ---------------------------------------------------- recent feed */}
        <Card padded={false}>
          <div className="flex items-center justify-between border-b px-5 py-3.5">
            <div>
              <h3 className="text-sm font-semibold">Recent activity</h3>
              <p className="text-xs text-muted-foreground">
                Everything happening in {tenant?.name}
              </p>
            </div>
            {unread.length > 0 && <Badge tone="primary">{unread.length} new</Badge>}
          </div>
          <div className="divide-y">
            {notifications.slice(0, 7).map((n) => (
              <div key={n.id} className="flex gap-3 px-5 py-2.5">
                <span
                  className={
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full " +
                    (n.is_read ? "bg-border" : "bg-primary")
                  }
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">{n.message}</p>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {n.category} · {relTime(n.created_at)}
                  </p>
                </div>
              </div>
            ))}
            {notifications.length === 0 && (
              <div className="p-5">
                <EmptyState title="No activity yet" icon={Bell} />
              </div>
            )}
          </div>
          <Link
            href="/notifications"
            className="block border-t px-5 py-2.5 text-center text-xs font-medium text-primary hover:bg-muted/50"
          >
            View all notifications
          </Link>
        </Card>
      </div>

      {/* ----------------------------------------- role-restricted reminder */}
      {!can("report.read") && (
        <Card className="border-warning/40 bg-warning/5">
          <p className="text-sm font-semibold text-warning">
            This role sees a deliberately narrow dashboard
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {role?.name} does not hold the reporting permission, so the
            financial tiles are hidden. This is the access model working as
            designed — use the role switcher in the header to compare.
          </p>
        </Card>
      )}
    </PageShell>
  );
}

/* ------------------------------------------------------------------------- */

function AttentionCard({
  href, icon: Icon, title, count, caption, tone = "default", rows,
}: {
  href: string;
  icon: React.ElementType;
  title: string;
  count: number;
  caption: string;
  tone?: "default" | "warning" | "danger" | "success";
  rows: { key: string; left: string; right: React.ReactNode; sub: string }[];
}) {
  const accent = {
    default: "text-muted-foreground",
    warning: "text-warning",
    danger: "text-destructive",
    success: "text-success",
  }[tone];

  return (
    <Card padded={false} className="flex flex-col">
      <div className="flex items-start gap-3 border-b px-5 py-4">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${accent}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">{caption}</p>
        </div>
        <span className={`stat-value text-2xl font-semibold ${accent}`}>
          {count}
        </span>
      </div>
      <div className="flex-1 divide-y">
        {rows.map((r) => (
          <div key={r.key} className="flex items-start gap-3 px-5 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{r.left}</p>
              {r.sub && (
                <p className="truncate text-2xs text-muted-foreground">
                  {r.sub}
                </p>
              )}
            </div>
            {r.right}
          </div>
        ))}
        {rows.length === 0 && (
          <p className="px-5 py-6 text-center text-xs text-muted-foreground">
            Nothing outstanding.
          </p>
        )}
      </div>
      <Link
        href={href}
        className="border-t px-5 py-2.5 text-center text-xs font-medium text-primary hover:bg-muted/50"
      >
        Open {title.toLowerCase()}
      </Link>
    </Card>
  );
}
