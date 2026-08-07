"use client";

import {
  AlertTriangle, Gavel, HandCoins, Landmark, PiggyBank, Presentation,
  TrendingUp, Wallet,
} from "lucide-react";
import { useAuth } from "../../providers";
import { useApi } from "@/lib/use-api";
import { Badge, Card } from "@/components/ui";
import {
  Column, DataTable, PageHeader, PageShell, SectionGuide, StatCard, StatGrid,
  StatusBadge, money,
} from "@/components/app/kit";
import {
  AgeingChart, BudgetActualChart, CashTrendChart, ChartCard,
  InflowOutflowChart,
} from "@/components/app/charts";

export default function BoardPage() {
  const { tenant } = useAuth();
  const { data: board } = useApi<any>("/board/exec-dashboard", null);
  const { data: forecast } = useApi<any[]>("/board/cash-flow-forecast", []);
  const { data: aging } = useApi<any>("/subledger/aging", null);
  const { data: cases } = useApi<any[]>("/collections/cases", []);
  const { data: budget } = useApi<any[]>("/budgeting/lines", []);

  const forecastCols: Column<any>[] = [
    { key: "period", header: "Month", render: (r) => <span className="font-medium">{r.period}</span> },
    { key: "opening", header: "Opening", numeric: true, render: (r) => money(r.opening, 0) },
    { key: "in", header: "Money in", numeric: true, render: (r) => <span className="text-success">+{money(r.inflow, 0)}</span> },
    { key: "out", header: "Money out", numeric: true, render: (r) => <span className="text-destructive">−{money(r.outflow, 0)}</span> },
    {
      key: "end",
      header: "Closing",
      numeric: true,
      render: (r) => <span className="font-semibold">{money(r.ending, 0)}</span>,
    },
  ];

  const caseCols: Column<any>[] = [
    { key: "unit", header: "Unit", render: (c) => <span className="font-medium">{c.unit}</span> },
    { key: "name", header: "Homeowner", render: (c) => c.name },
    { key: "stage", header: "Stage", render: (c) => <StatusBadge status={c.stage} /> },
    { key: "days", header: "Days overdue", numeric: true, render: (c) => c.days_past_due },
    {
      key: "bal",
      header: "Owing",
      numeric: true,
      render: (c) => <span className="font-semibold text-destructive">{money(c.balance)}</span>,
    },
  ];

  if (!board) return null;

  const maxAging = Math.max(...Object.values(aging?.totals ?? { a: 1 }).map(Number));

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="Board Dashboard"
        description={`The financial position of ${tenant?.name} as the board sees it — written for volunteers, not accountants.`}
      />

      <SectionGuide
        what="A plain-English summary of the community's finances, built for elected homeowner volunteers who are not finance professionals and who meet once a month."
        who="Board members primarily, plus the property manager who presents at the meeting. This same content is bundled into the monthly board packet and emailed automatically."
        how={[
          "Every figure is drawn from posted ledger data, so it agrees with the formal accounts.",
          "Cash is split by fund, because operating money and reserve savings are legally separate.",
          "The ageing table shows how long money has been owed — the further right, the harder it is to collect.",
          "The forecast projects the next six months from current dues, known bills and historical patterns.",
          "Delinquency is shown by stage so the board can see who is close to legal action.",
        ]}
        flow="Read-only. This screen consumes what every other section produces and pushes nothing back."
      />

      <StatGrid>
        <StatCard label="Total cash" value={money(board.cash_total, 0)} hint="Both funds combined" tone="primary" icon={Wallet} />
        <StatCard label="Owed by homeowners" value={money(board.ar_open_total, 0)} tone="brass" icon={HandCoins} />
        <StatCard
          label="Reserve funded"
          value={`${board.reserve_funded_pct}%`}
          hint="Against the 2025 study"
          tone={board.reserve_funded_pct >= 70 ? "success" : "warning"}
          icon={PiggyBank}
        />
        <StatCard label="Occupancy" value={`${board.occupancy_pct}%`} hint={`${board.units} units`} icon={TrendingUp} />
      </StatGrid>

      {/* funds */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider">
          The two funds
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {board.funds.map((f: any) => (
            <Card key={f.fund} padded={false}>
              <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    <Landmark className={f.fund === "Reserve" ? "h-4 w-4 text-brass" : "h-4 w-4 text-primary"} />
                    {f.fund} Fund
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {f.fund === "Operating"
                      ? "Pays this month's bills"
                      : "Saved for major repairs years ahead"}
                  </p>
                </div>
                <p className="stat-value shrink-0 text-2xl font-semibold">
                  {money(f.cash, 0)}
                </p>
              </div>
              <div className="px-5 py-3">
                <p className="text-xs text-muted-foreground">
                  {f.ar_open > 0 ? (
                    <>
                      <span className="font-semibold text-foreground">
                        {money(f.ar_open, 0)}
                      </span>{" "}
                      still owed into this fund by homeowners
                    </>
                  ) : (
                    "Funded entirely by transfers from the operating fund"
                  )}
                </p>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ageing */}
        {aging && (
          <ChartCard
            title="How long money has been owed"
            caption={`The further right, the harder it becomes to collect · ${money(aging.grand_total, 0)} outstanding in total`}
            table={{
              head: ["Bucket", "Outstanding"],
              rows: Object.entries(aging.totals).map(([k, v]) => [
                k === "Current" ? "Not yet due" : `${k} days overdue`,
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

        {/* budget variance */}
        <ChartCard
          title="Spending against budget"
          caption="Where the community is over or under for the year"
          table={{
            head: ["Category", "Fund", "Budget", "Actual", "Variance"],
            rows: budget.map((b) => [
              b.name,
              b.fund,
              money(b.budget, 0),
              money(b.actual, 0),
              `${b.variance < 0 ? "over " : "under "}${money(Math.abs(b.variance), 0)}`,
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
      </div>

      {/* cash charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="Operating cash, next six months"
          caption="Projected closing balance each month"
          table={{
            head: ["Month", "Opening", "Closing"],
            rows: forecast.map((f) => [
              f.period,
              money(f.opening, 0),
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

        <ChartCard
          title="Money in against money out"
          caption="Dues collected versus bills paid, per month"
          table={{
            head: ["Month", "Money in", "Money out"],
            rows: forecast.map((f) => [
              f.period,
              money(f.inflow, 0),
              money(f.outflow, 0),
            ]),
          }}
        >
          <InflowOutflowChart
            data={forecast.map((f) => ({
              period: f.period.replace(" 2026", ""),
              inflow: f.inflow,
              outflow: f.outflow,
            }))}
          />
        </ChartCard>
      </div>

      {/* delinquency */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wider">
              Homeowners in collections
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {board.open_cases} open case(s) · {board.active_plans} on a payment
              plan · {board.filed_liens} lien(s) filed
            </p>
          </div>
          {board.filed_liens > 0 && (
            <Badge tone="danger">
              <Gavel className="h-3 w-3" />
              {board.filed_liens} lien filed
            </Badge>
          )}
        </div>
        <DataTable rows={cases} columns={caseCols} />
      </section>

      {/* forecast */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider">
            Six-month cash forecast
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Projected from current dues, known commitments and historical
            spending. Operating fund only.
          </p>
        </div>
        <DataTable rows={forecast} columns={forecastCols} getRowKey={(r) => r.period} />
      </section>

      <Card className="border-primary/25 bg-accent/40">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <Presentation className="h-4 w-4 text-primary" />
          The monthly board packet
        </p>
        <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
          Everything on this screen, plus the trial balance, income statement and
          delinquency report, is assembled into a single document on the fifth of
          each month and sent to every board member automatically. Nobody has to
          remember to produce it — see the Scheduled Jobs screen.
        </p>
      </Card>
    </PageShell>
  );
}
