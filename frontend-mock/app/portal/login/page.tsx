"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronDown, Home, Mail, Smartphone } from "lucide-react";
import { TENANTS } from "@/lib/mock-data/seed";
import { tenantData } from "@/lib/mock-data/store";
import { Badge, Button, Card } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";
import { cn } from "@/lib/utils";
import { isLive } from "@/lib/api";
import LivePortalLogin from "./live-portal-login";

export default function PortalLoginPage() {
  // In live mode use real backend portal auth; mock mode stays as the demo persona picker.
  if (isLive) return <LivePortalLogin />;
  return <MockPortalLogin />;
}

function MockPortalLogin() {
  const router = useRouter();
  const [tenantId, setTenantId] = useState(TENANTS[0].id);
  const [open, setOpen] = useState(false);

  const residents = tenantData(tenantId).residents.filter((r: any) => r.is_active);
  const [residentId, setResidentId] = useState<string>(residents[0]?.id ?? "");
  const resident =
    residents.find((r: any) => r.id === residentId) ?? residents[0];

  function enter() {
    localStorage.setItem(
      "casa_portal_session",
      JSON.stringify({ residentId: resident.id, tenantId })
    );
    router.replace("/portal");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
              CH
            </div>
            <div>
              <p className="text-lg font-semibold tracking-tight">
                Resident Portal
              </p>
              <p className="text-xs text-muted-foreground">
                {TENANTS.find((t) => t.id === tenantId)?.name}
              </p>
            </div>
          </div>
          <ThemeToggle />
        </div>

        <Card>
          <h1 className="text-xl font-semibold tracking-tight">
            Sign in to your account
          </h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            This is what a homeowner sees &mdash; a completely separate
            application from the staff one, showing only their own units.
          </p>

          <div className="mt-5">
            <label className="mb-1.5 block text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              Community
            </label>
            <div className="flex flex-wrap gap-1.5">
              {TENANTS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTenantId(t.id);
                    const next = tenantData(t.id).residents.filter(
                      (r: any) => r.is_active
                    );
                    setResidentId(next[0]?.id ?? "");
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    tenantId === t.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-muted"
                  )}
                >
                  <Home className="h-3.5 w-3.5" />
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              Sign in as
            </label>
            <div className="relative">
              <button
                onClick={() => setOpen((o) => !o)}
                aria-expanded={open}
                className="flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left shadow-sm transition-colors hover:bg-muted/50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {resident?.full_name
                    .split(" ")
                    .map((w: string) => w[0])
                    .join("")}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {resident?.full_name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {resident?.username} · {resident?.unit_count} unit
                    {resident?.unit_count > 1 ? "s" : ""}
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
                <div className="absolute z-20 mt-1.5 max-h-72 w-full animate-fade-in overflow-y-auto rounded-lg border bg-popover shadow-xl scroll-thin">
                  {residents.map((r: any) => (
                    <button
                      key={r.id}
                      onClick={() => {
                        setResidentId(r.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2.5 border-b px-3 py-2.5 text-left last:border-0 transition-colors",
                        r.id === residentId ? "bg-accent" : "hover:bg-muted/60"
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold">
                            {r.full_name}
                          </span>
                          <Badge
                            tone={r.resident_type === "OWNER" ? "primary" : "info"}
                            className="text-[10px]"
                          >
                            {r.resident_type}
                          </Badge>
                          {r.unit_count > 1 && (
                            <Badge tone="brass" className="text-[10px]">
                              {r.unit_count} units
                            </Badge>
                          )}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {r.username}
                        </span>
                      </span>
                      {r.id === residentId && (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2.5">
            {resident?.mfa_channel === "SMS" ? (
              <Smartphone className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              In the live product a one-time code is sent by{" "}
              <span className="font-semibold text-foreground">
                {resident?.mfa_channel === "SMS" ? "text message" : "email"}
              </span>
              . Residents get a code rather than an authenticator app, on purpose
              &mdash; they are not technical users.
            </p>
          </div>

          <Button size="lg" className="mt-5 w-full" onClick={enter}>
            Sign in
            <ArrowRight className="h-4 w-4" />
          </Button>

          <a
            href="/portal/forgot-password"
            className="mt-3 block text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Forgot your password?
          </a>
          <a
            href="/login"
            className="mt-1 block text-center text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Staff sign-in is a different door &rarr;
          </a>
        </Card>
      </div>
    </div>
  );
}
