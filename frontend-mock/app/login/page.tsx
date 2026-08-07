"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  Eye,
  Lock,
  ShieldCheck,
  X,
} from "lucide-react";
import { useAuth } from "../providers";
import { PERSONAS, TENANTS } from "@/lib/mock-data/seed";
import { NAV_GROUPS, ROLES, permsFor, roleHas } from "@/lib/rbac";
import { Badge, Button, Card } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";
import { cn } from "@/lib/utils";

export default function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [personaId, setPersonaId] = useState(PERSONAS[2].id); // HOA Admin
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const persona = PERSONAS.find((p) => p.id === personaId)!;
  const role = ROLES[persona.role_code];
  const availableTenants = TENANTS.filter((t) =>
    persona.tenant_ids.includes(t.id)
  );
  const effectiveTenant = tenantId ?? availableTenants[0]?.id;

  const perms = useMemo(() => permsFor(persona.role_code), [persona.role_code]);

  const reachable = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({
        title: g.title,
        items: g.items.filter((i) => !i.disabled).map((i) => ({
          label: i.label,
          allowed: i.perm === null || roleHas(persona.role_code, i.perm),
        })),
      })),
    [persona.role_code]
  );

  const reachableCount = reachable.reduce(
    (n, g) => n + g.items.filter((i) => i.allowed).length,
    0
  );
  const totalCount = reachable.reduce((n, g) => n + g.items.length, 0);

  function enter() {
    signIn(personaId, effectiveTenant ?? undefined);
    router.replace("/dashboard");
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto grid min-h-screen max-w-6xl grid-cols-1 gap-10 px-6 py-10 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-center lg:py-16">
        {/* ---------------------------------------------------- left: sign-in */}
        <div>
          <div className="mb-8 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
                CH
              </div>
              <div>
                <p className="text-lg font-semibold tracking-tight">
                  Casa Harmony
                </p>
                <p className="text-xs text-muted-foreground">
                  Service Desk + ERP for Homeowner Associations
                </p>
              </div>
            </div>
            <ThemeToggle />
          </div>

          <h1 className="text-3xl font-semibold tracking-tight">
            Choose who to sign in as
          </h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            This is a front-end demonstration. Pick a role and the whole
            application re-renders as that person &mdash; the menu, the data and
            the actions available all change to match their real permissions.
          </p>

          {/* persona picker */}
          <div className="mt-7">
            <label className="mb-1.5 block text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sign in as
            </label>
            <div className="relative">
              <button
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                aria-haspopup="listbox"
                className="flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left shadow-sm transition-colors hover:bg-muted/50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {persona.full_name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {persona.full_name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {persona.title}
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    open && "rotate-180"
                  )}
                />
              </button>

              {open && (
                <div
                  role="listbox"
                  className="absolute z-20 mt-1.5 w-full animate-fade-in overflow-hidden rounded-lg border bg-popover shadow-xl"
                >
                  {PERSONAS.map((p) => {
                    const r = ROLES[p.role_code];
                    const active = p.id === personaId;
                    return (
                      <button
                        key={p.id}
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          setPersonaId(p.id);
                          setTenantId(null);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-start gap-3 border-b px-3 py-2.5 text-left transition-colors last:border-0",
                          active ? "bg-accent" : "hover:bg-muted/60"
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-2xs font-semibold",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {p.full_name
                            .split(" ")
                            .map((w) => w[0])
                            .join("")}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-semibold">
                              {p.full_name}
                            </span>
                            <Badge
                              tone={r?.implemented ? "primary" : "warning"}
                              className="text-[10px]"
                            >
                              {p.role_code.replace(/_/g, " ")}
                            </Badge>
                          </span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {p.title}
                          </span>
                        </span>
                        {active && (
                          <Check className="mt-1 h-4 w-4 shrink-0 text-primary" />
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* community picker */}
          {availableTenants.length > 1 && (
            <div className="mt-4">
              <label className="mb-1.5 block text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                Start in which community?
              </label>
              <div className="flex flex-wrap gap-1.5">
                {availableTenants.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTenantId(t.id)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                      effectiveTenant === t.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <Building2 className="h-3.5 w-3.5" />
                    {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 rounded-lg border bg-muted/40 px-3 py-2.5">
            <p className="text-xs leading-relaxed text-muted-foreground">
              <span className="font-semibold text-foreground">
                {persona.full_name}
              </span>{" "}
              &mdash; {persona.pitch}
            </p>
          </div>

          <Button size="lg" className="mt-5 w-full" onClick={enter}>
            Enter the application
            <ArrowRight className="h-4 w-4" />
          </Button>

          <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            No password needed &mdash; this build has no server and stores
            nothing outside your browser.
          </p>
        </div>

        {/* --------------------------------------------------- right: preview */}
        <Card padded={false} className="overflow-hidden">
          <div className="border-b bg-muted/40 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-2xs font-semibold uppercase tracking-[0.14em] text-primary">
                  Access preview
                </p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight">
                  {role?.name}
                </h2>
              </div>
              {!role?.implemented && (
                <Badge tone="warning">Proposed &mdash; not yet on server</Badge>
              )}
            </div>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              {role?.blurb}
            </p>
          </div>

          <div className="grid grid-cols-3 divide-x border-b">
            <Stat label="Scope" value={role?.scope ?? "—"} />
            <Stat
              label="Screens"
              value={`${reachableCount} of ${totalCount}`}
            />
            <Stat
              label="Permissions"
              value={
                role?.perms === "*"
                  ? "All"
                  : `${perms.length} granted`
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-5 p-5 sm:grid-cols-2">
            <div>
              <p className="mb-2.5 flex items-center gap-1.5 font-mono text-2xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                <Eye className="h-3.5 w-3.5" />
                Screens they can open
              </p>
              <div className="space-y-3">
                {reachable.map((g) => (
                  <div key={g.title}>
                    <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70">
                      {g.title}
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {g.items.map((i) => (
                        <span
                          key={i.label}
                          className={cn(
                            "rounded border px-1.5 py-0.5 text-[11px]",
                            i.allowed
                              ? "border-primary/30 bg-primary/10 font-medium text-primary"
                              : "border-border bg-muted text-muted-foreground/50 line-through"
                          )}
                        >
                          {i.label}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <p className="mb-2 flex items-center gap-1.5 font-mono text-2xs font-semibold uppercase tracking-[0.12em] text-success">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  What they can do
                </p>
                <ul className="space-y-1.5">
                  {role?.can.map((c) => (
                    <li
                      key={c}
                      className="grid grid-cols-[14px_1fr] gap-2 text-xs leading-relaxed text-muted-foreground"
                    >
                      <Check className="mt-0.5 h-3.5 w-3.5 text-success" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 flex items-center gap-1.5 font-mono text-2xs font-semibold uppercase tracking-[0.12em] text-destructive">
                  <X className="h-3.5 w-3.5" />
                  What they cannot do
                </p>
                <ul className="space-y-1.5">
                  {role?.cannot.map((c) => (
                    <li
                      key={c}
                      className="grid grid-cols-[14px_1fr] gap-2 text-xs leading-relaxed text-muted-foreground"
                    >
                      <X className="mt-0.5 h-3.5 w-3.5 text-destructive/70" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}
