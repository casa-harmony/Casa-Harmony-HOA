"use client";

/**
 * App-level composites. These sit above the primitives in components/ui.tsx
 * and give every section the same anatomy: a header, an optional explainer,
 * summary stats, then the working surface.
 */

import React from "react";
import {
  ChevronDown,
  ChevronRight,
  Info,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, Input, Card } from "@/components/ui";

/* =============================================================== PageHeader */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="mb-1 font-mono text-2xs font-semibold uppercase tracking-[0.14em] text-primary">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </div>
  );
}

/* ============================================================= SectionGuide */

/**
 * The in-app explainer. Collapsed by default so it never gets in the way of a
 * demo, but one click away when the client asks "what is this screen for?".
 */
export function SectionGuide({
  what,
  who,
  how,
  flow,
  defaultOpen = false,
}: {
  what: string;
  who: string;
  how: string[];
  flow?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);

  return (
    <div className="overflow-hidden rounded-xl border bg-accent/40">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-accent/60"
      >
        <Info className="h-4 w-4 shrink-0 text-primary" />
        <span className="flex-1 text-sm font-medium text-accent-foreground">
          What is this screen, and how does it work?
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div className="animate-fade-in space-y-4 border-t border-primary/15 px-4 py-4">
          <GuideBlock label="What it is">{what}</GuideBlock>
          <GuideBlock label="Who uses it">{who}</GuideBlock>
          <div>
            <p className="mb-1.5 font-mono text-2xs font-semibold uppercase tracking-[0.12em] text-primary">
              How it works
            </p>
            <ol className="space-y-1.5">
              {how.map((step, i) => (
                <li
                  key={i}
                  className="grid grid-cols-[18px_1fr] gap-2 text-sm leading-relaxed text-muted-foreground"
                >
                  <span className="font-mono text-2xs font-semibold text-primary/70">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
          {flow && <GuideBlock label="Where it connects">{flow}</GuideBlock>}
        </div>
      )}
    </div>
  );
}

function GuideBlock({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 font-mono text-2xs font-semibold uppercase tracking-[0.12em] text-primary">
        {label}
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

/* ================================================================ StatCard */

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
  icon: Icon,
  onClick,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger" | "brass" | "primary";
  icon?: React.ElementType;
  onClick?: () => void;
}) {
  const tones = {
    default: "text-foreground",
    primary: "text-primary",
    success: "text-success",
    warning: "text-warning",
    danger: "text-destructive",
    brass: "text-brass",
  }[tone];

  const stripe = {
    default: "bg-border",
    primary: "bg-primary",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-destructive",
    brass: "bg-brass",
  }[tone];

  const Comp: any = onClick ? "button" : "div";

  return (
    <Comp
      onClick={onClick}
      className={cn(
        "relative w-full overflow-hidden rounded-xl border bg-card p-4 text-left shadow-sm transition-colors",
        onClick && "hover:border-primary/40 hover:bg-accent/30"
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-0.5", stripe)} />
      <div className="flex items-start justify-between gap-2">
        <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground/60" />}
      </div>
      <p
        className={cn(
          "stat-value mt-2 text-2xl font-semibold tracking-tight",
          tones
        )}
      >
        {value}
      </p>
      {hint && (
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      )}
    </Comp>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
  );
}

/* ============================================================== EmptyState */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: React.ElementType;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="surface-grid flex flex-col items-center justify-center rounded-xl border border-dashed px-6 py-14 text-center">
      {Icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border bg-card">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      )}
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ============================================================= StatusBadge */

/** Every status string the system uses, mapped to a tone. */
const STATUS_TONES: Record<string, string> = {
  // generic lifecycle
  DRAFT: "neutral",
  PENDING: "warning",
  PENDING_INSPECTION: "warning",
  SUBMITTED: "warning",
  APPROVED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
  CLOSED: "neutral",
  ACTIVE: "success",
  INACTIVE: "neutral",
  COMPLETED: "success",
  FAILED: "danger",
  SUCCESS: "success",
  // tickets
  OPEN: "info",
  IN_PROGRESS: "warning",
  RESOLVED: "success",
  // priority
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
  URGENT: "danger",
  // AP
  PAID: "success",
  MATCHED: "success",
  NOT_MATCHED: "neutral",
  MATCH_EXCEPTION: "danger",
  ON_HOLD: "danger",
  // receiving
  ACCEPTED: "success",
  // GL / periods
  POSTED: "success",
  UNPOSTED: "warning",
  // collections
  NONE: "neutral",
  NOTICE: "warning",
  PAYMENT_PLAN: "warning",
  LIEN: "danger",
  DEFAULTED: "danger",
  FILED: "danger",
  RELEASED: "success",
  WRITTEN_OFF: "neutral",
  // compliance
  PASS: "success",
  WARN: "warning",
  FAIL: "danger",
  INFO: "info",
  DONE: "success",
  // residents
  OWNER: "primary",
  RENTER: "info",
};

export function StatusBadge({
  status,
  className,
}: {
  status?: string | null;
  className?: string;
}) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const key = String(status).toUpperCase().replace(/[\s-]/g, "_");
  const tone = STATUS_TONES[key] ?? "neutral";
  return (
    <Badge tone={tone} className={className}>
      {String(status).replace(/_/g, " ")}
    </Badge>
  );
}

/* =============================================================== DataTable */

export interface Column<T> {
  key: string;
  header: string;
  /** Right-align and tabular-figure the cell — use for money and counts. */
  numeric?: boolean;
  className?: string;
  render: (row: T) => React.ReactNode;
}

export function DataTable<T extends { id?: string }>({
  rows,
  columns,
  onRowClick,
  empty,
  getRowKey,
}: {
  rows: T[];
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  empty?: React.ReactNode;
  getRowKey?: (row: T, i: number) => string;
}) {
  if (rows.length === 0) {
    return (
      <>{empty ?? <EmptyState title="Nothing here yet" />}</>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    "whitespace-nowrap px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground",
                    c.numeric && "text-right",
                    c.className
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={getRowKey ? getRowKey(row, i) : row.id ?? i}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  "border-b last:border-0 transition-colors",
                  onRowClick && "cursor-pointer hover:bg-accent/40"
                )}
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-4 py-3 align-middle text-foreground",
                      c.numeric && "tabular text-right",
                      c.className
                    )}
                  >
                    {c.render(row)}
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

/* ================================================================= Toolbar */

export function Toolbar({
  search,
  onSearch,
  placeholder = "Search…",
  filters,
  right,
}: {
  search?: string;
  onSearch?: (v: string) => void;
  placeholder?: string;
  filters?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {onSearch && (
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search ?? ""}
              onChange={(e) => onSearch(e.target.value)}
              placeholder={placeholder}
              className="h-9 pl-8"
            />
            {search && (
              <button
                onClick={() => onSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
        {filters}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

/** Segmented filter chips — the standard way to filter a list in this app. */
export function FilterChips({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; count?: number }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span
                className={cn(
                  "tabular rounded px-1 text-2xs font-semibold",
                  active ? "bg-primary/15" : "bg-muted"
                )}
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================= DetailSheet */

/** Right-hand slide-over used for record detail across the app. */
export function DetailSheet({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
  footer,
  width = "lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: "md" | "lg" | "xl";
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const w = { md: "max-w-md", lg: "max-w-xl", xl: "max-w-3xl" }[width];

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/30 backdrop-blur-sm">
      <div
        className="flex-1"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "flex h-full w-full flex-col border-l bg-card shadow-2xl",
          w
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold text-foreground">
                {title}
              </h2>
              {badge}
            </div>
            {subtitle && (
              <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="-mr-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 scroll-thin">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t bg-muted/40 px-5 py-3">
            {footer}
          </div>
        )}
      </aside>
    </div>
  );
}

/* ========================================================= DescriptionList */

export function Facts({
  items,
  columns = 2,
}: {
  items: { label: string; value: React.ReactNode }[];
  columns?: 1 | 2 | 3;
}) {
  const cols = { 1: "grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3" }[
    columns
  ];
  return (
    <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-3.5", cols)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            {it.label}
          </dt>
          <dd className="mt-0.5 break-words text-sm font-medium text-foreground">
            {it.value ?? "—"}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ================================================================ Timeline */

export interface TimelineEvent {
  at: string;
  actor?: string;
  title: string;
  detail?: string;
  tone?: "default" | "success" | "warning" | "danger" | "primary";
}

export function Timeline({ events }: { events: TimelineEvent[] }) {
  if (!events.length) {
    return (
      <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
    );
  }
  return (
    <ol className="relative space-y-4 pl-5">
      <span className="absolute inset-y-1 left-[5px] w-px bg-border" aria-hidden />
      {events.map((e, i) => {
        const dot = {
          default: "bg-muted-foreground/50",
          primary: "bg-primary",
          success: "bg-success",
          warning: "bg-warning",
          danger: "bg-destructive",
        }[e.tone ?? "default"];
        return (
          <li key={i} className="relative">
            <span
              className={cn(
                "absolute -left-5 top-1.5 h-[9px] w-[9px] rounded-full ring-4 ring-card",
                dot
              )}
              aria-hidden
            />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="text-sm font-medium text-foreground">{e.title}</p>
              <time className="shrink-0 font-mono text-2xs text-muted-foreground">
                {e.at}
              </time>
            </div>
            {e.detail && (
              <p className="mt-0.5 text-sm text-muted-foreground">{e.detail}</p>
            )}
            {e.actor && (
              <p className="mt-0.5 text-xs text-muted-foreground/80">
                by {e.actor}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/* ============================================================ Section shell */

export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground">
            {title}
          </h2>
          {description && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Standard page wrapper: consistent max width and vertical rhythm. */
export function PageShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-[1400px] space-y-6">{children}</div>;
}

/* ------------------------------------------------------------ money helper */

export function money(v: string | number | null | undefined, dp = 2): string {
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

export function shortDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function relTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return String(s);
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return shortDate(s);
}
