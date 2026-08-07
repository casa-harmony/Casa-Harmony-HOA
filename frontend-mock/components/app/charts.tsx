"use client";

/**
 * Chart set for the app.
 *
 * Rules these follow, so please keep them:
 *  · One y-axis. Never two scales on one plot.
 *  · Categorical hues are assigned in fixed order (chart-1…5) and never cycled.
 *    Colour follows the entity, so filtering never repaints the survivors.
 *  · Ordered buckets (ageing bands) use the sequential ramp — one hue,
 *    light→dark — not the categorical set.
 *  · A single series carries no legend; the title names it. Two or more always do.
 *  · Gridlines and axes are solid hairlines, one shade off the surface.
 *  · Every chart has a hover tooltip. Values live in the tooltip and on the
 *    axis, never printed on every point.
 *  · A table view sits behind every chart for anyone who needs the numbers.
 */

import * as React from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line,
  LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { Table2, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ shell */

export function ChartCard({
  title,
  caption,
  children,
  table,
  action,
}: {
  title: string;
  caption?: string;
  children: React.ReactNode;
  /** Accessible fallback — the same numbers as a table. */
  table?: { head: string[]; rows: (string | number)[][] };
  action?: React.ReactNode;
}) {
  const [showTable, setShowTable] = React.useState(false);

  return (
    <Card padded={false} className="flex flex-col">
      <div className="flex items-start justify-between gap-3 border-b px-5 py-3.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {caption && (
            <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {action}
          {table && (
            <button
              onClick={() => setShowTable((s) => !s)}
              aria-pressed={showTable}
              title={showTable ? "Show the chart" : "Show the numbers"}
              className={cn(
                "rounded-md border p-1.5 transition-colors",
                showTable
                  ? "border-primary bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <Table2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 p-4">
        {showTable && table ? (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  {table.head.map((h, i) => (
                    <th
                      key={h}
                      className={cn(
                        "px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground",
                        i === 0 ? "text-left" : "text-right"
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    {r.map((c, j) => (
                      <td
                        key={j}
                        className={cn(
                          "px-3 py-1.5",
                          j === 0 ? "text-left" : "tabular text-right"
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
        ) : (
          children
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------- primitives */

const AXIS = {
  stroke: "hsl(var(--border))",
  tick: { fill: "hsl(var(--muted-foreground))", fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: "hsl(var(--border))" },
};

/** Solid hairline grid, one shade off the surface — never dashed. */
function Grid({ vertical = false }: { vertical?: boolean }) {
  return (
    <CartesianGrid
      stroke="hsl(var(--border))"
      strokeOpacity={0.6}
      vertical={vertical}
      horizontal={!vertical}
    />
  );
}

function TipBox({
  active,
  payload,
  label,
  format,
}: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 shadow-lg">
      <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="space-y-0.5">
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: p.color }}
            />
            <span className="text-muted-foreground">{p.name}</span>
            <span className="tabular ml-auto font-semibold text-foreground">
              {format ? format(p.value) : p.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const usd0 = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const compact = (n: number) =>
  n >= 1000 ? `$${(n / 1000).toFixed(0)}k` : `$${n}`;

/* ------------------------------------------------------- cash trend (1 series) */

export function CashTrendChart({
  data,
}: {
  data: { period: string; ending: number }[];
}) {
  const last = data[data.length - 1];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 44, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.22} />
            <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <Grid />
        <XAxis dataKey="period" {...AXIS} />
        {/* A fitted domain, so the shape of the trend is readable. Legitimate
            on a line/area; a bar chart would have to start at zero. */}
        <YAxis
          {...AXIS}
          width={52}
          tickFormatter={compact}
          domain={[
            (min: number) => Math.max(0, min - (min || 0) * 0.12),
            (max: number) => max + max * 0.08,
          ]}
        />
        <Tooltip
          content={<TipBox format={usd0} />}
          cursor={{ stroke: "hsl(var(--muted-foreground))", strokeOpacity: 0.35 }}
        />
        <Area
          type="monotone"
          dataKey="ending"
          name="Closing balance"
          stroke="hsl(var(--chart-1))"
          strokeWidth={2}
          fill="url(#cashFill)"
          dot={false}
          activeDot={{
            r: 4,
            stroke: "hsl(var(--card))",
            strokeWidth: 2,
            fill: "hsl(var(--chart-1))",
          }}
        >
          {/* Only the endpoint is labelled — never every point. */}
          <LabelList
            dataKey="ending"
            content={(props: any) => {
              if (props.index !== data.length - 1) return null;
              return (
                <text
                  x={Number(props.x) + 7}
                  y={Number(props.y) + 4}
                  fill="hsl(var(--chart-1))"
                  fontSize={11}
                  fontWeight={600}
                >
                  {compact(last.ending)}
                </text>
              );
            }}
          />
        </Area>
      </AreaChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------ budget vs actual (2 series → legend) */

export function BudgetActualChart({
  data,
}: {
  data: { name: string; budget: number; actual: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 42)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 12, bottom: 0, left: 4 }}
        barGap={2}
      >
        <Grid vertical />
        <XAxis type="number" {...AXIS} tickFormatter={compact} />
        <YAxis
          type="category"
          dataKey="name"
          {...AXIS}
          width={124}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
        />
        <Tooltip
          content={<TipBox format={usd0} />}
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.5 }}
        />
        <Legend
          verticalAlign="top"
          align="left"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}
        />
        <Bar
          dataKey="budget"
          name="Budget"
          fill="hsl(var(--chart-1))"
          fillOpacity={0.35}
          radius={[0, 4, 4, 0]}
          barSize={9}
        />
        <Bar
          dataKey="actual"
          name="Actual"
          fill="hsl(var(--chart-2))"
          radius={[0, 4, 4, 0]}
          barSize={9}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------ ageing buckets (ordered → sequential) */

export function AgeingChart({
  data,
}: {
  data: { bucket: string; amount: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
        <Grid />
        <XAxis dataKey="bucket" {...AXIS} />
        <YAxis {...AXIS} width={52} tickFormatter={compact} />
        <Tooltip
          content={<TipBox format={usd0} />}
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.5 }}
        />
        <Bar dataKey="amount" name="Outstanding" radius={[4, 4, 0, 0]} barSize={34}>
          {data.map((_, i) => (
            <Cell key={i} fill={`hsl(var(--seq-${i + 1}))`} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/* --------------------------------------------- ticket volume (1 series, 1 colour) */

export function TicketMixChart({
  data,
}: {
  data: { label: string; count: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 24, bottom: 0, left: 4 }}
      >
        <Grid vertical />
        <XAxis type="number" {...AXIS} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          {...AXIS}
          width={104}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
        />
        <Tooltip
          content={<TipBox />}
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.5 }}
        />
        {/* One series → one colour. Never a value-ramp across nominal categories. */}
        <Bar
          dataKey="count"
          name="Tickets"
          fill="hsl(var(--chart-1))"
          radius={[0, 4, 4, 0]}
          barSize={14}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ------------------------------------------------ money in vs out (2 series) */

export function InflowOutflowChart({
  data,
}: {
  data: { period: string; inflow: number; outflow: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 4 }} barGap={2}>
        <Grid />
        <XAxis dataKey="period" {...AXIS} />
        <YAxis {...AXIS} width={52} tickFormatter={compact} />
        <Tooltip
          content={<TipBox format={usd0} />}
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.5 }}
        />
        <Legend
          verticalAlign="top"
          align="left"
          height={28}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))" }}
        />
        <Bar dataKey="inflow" name="Money in" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} barSize={12} />
        <Bar dataKey="outflow" name="Money out" fill="hsl(var(--chart-4))" radius={[4, 4, 0, 0]} barSize={12} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/* ---------------------------------------------------- vendor spend (1 series) */

export function VendorSpendChart({
  data,
}: {
  data: { name: string; spend: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 34)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 0, left: 4 }}
      >
        <Grid vertical />
        <XAxis type="number" {...AXIS} tickFormatter={compact} />
        <YAxis
          type="category"
          dataKey="name"
          {...AXIS}
          width={140}
          tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }}
        />
        <Tooltip
          content={<TipBox format={usd0} />}
          cursor={{ fill: "hsl(var(--muted))", fillOpacity: 0.5 }}
        />
        <Bar
          dataKey="spend"
          name="Spend this year"
          fill="hsl(var(--chart-2))"
          radius={[0, 4, 4, 0]}
          barSize={12}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export { usd0, compact };
