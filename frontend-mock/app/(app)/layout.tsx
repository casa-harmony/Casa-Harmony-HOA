"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertCircle, BadgeDollarSign, Bell, BookOpen, Building2, CalendarOff,
  CheckSquare, CreditCard, Database, FileText, Files, HandCoins, Home,
  LayoutDashboard, ListTree, Lock, LogOut, Mail, Menu, Network, PackageCheck,
  PhoneCall, PieChart, Presentation, Receipt, RefreshCw, Repeat, Landmark,
  Settings, ShieldCheck, ShoppingCart, Tags, Ticket, Timer, UserCog, Users,
  Wallet, X, ChevronDown, Check, BarChart3,
} from "lucide-react";
import { useAuth } from "../providers";
import { PERSONAS } from "@/lib/mock-data/seed";
import { ROLES } from "@/lib/rbac";
import { resetStore } from "@/lib/mock-data/store";
import { useApi, useMutate } from "@/lib/use-api";
import { Badge, Button, Spinner } from "@/components/ui";
import { ThemeToggle } from "@/components/theme";
import { relTime } from "@/components/app/kit";
import { cn } from "@/lib/utils";

const ICONS: Record<string, React.ElementType> = {
  "/dashboard": LayoutDashboard,
  "/service-desk": Ticket,
  "/residents": Users,
  "/documents": Files,
  "/notifications": Bell,
  "/vendors": Building2,
  "/payables": FileText,
  "/payments": CreditCard,
  "/purchasing": ShoppingCart,
  "/receiving": PackageCheck,
  "/encumbrance": Lock,
  "/ap-setup": Settings,
  "/ar-billing": Receipt,
  "/receivables": HandCoins,
  "/collections": PhoneCall,
  "/statements": Mail,
  "/dunning": AlertCircle,
  "/coa": ListTree,
  "/value-sets": Tags,
  "/budgets": PieChart,
  "/gl": BookOpen,
  "/periods": CalendarOff,
  "/cash": Wallet,
  "/fixed-assets": Landmark,
  "/approvals": CheckSquare,
  "/users": UserCog,
  "/tenants": Home,
  "/gateway": BadgeDollarSign,
  "/scheduler": Timer,
  "/reports": BarChart3,
  "/board": Presentation,
  "/migration": Database,
  "/go-live": ShieldCheck,
  "/roles-and-flow": Network,
  "/portal/login": Home,
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (auth.ready && !auth.signedIn) router.replace("/login");
  }, [auth.ready, auth.signedIn, router]);

  useEffect(() => setMobileOpen(false), [pathname]);

  if (!auth.ready || !auth.signedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Preparing the demo…" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* desktop sidebar */}
      <aside className="hidden w-[248px] shrink-0 flex-col border-r bg-sidebar lg:flex">
        <SidebarContent />
      </aside>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="absolute inset-0 bg-foreground/40 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex w-[264px] flex-col border-r bg-sidebar">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground hover:bg-muted"
              aria-label="Close menu"
            >
              <X className="h-4 w-4" />
            </button>
            <SidebarContent />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto scroll-thin px-5 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ sidebar */

function SidebarContent() {
  const { nav, tenant, persona, role } = useAuth();
  const pathname = usePathname();

  return (
    <>
      <div className="flex items-center gap-2.5 border-b px-4 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
          CH
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">
            Casa Harmony
          </p>
          <p className="truncate text-2xs text-muted-foreground">
            {tenant?.name ?? "—"}
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto scroll-thin px-2.5 py-3">
        {nav.map((group) => (
          <div key={group.title} className="mb-4">
            <p className="mb-1 px-2 text-2xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/70">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = ICONS[item.href] ?? LayoutDashboard;
                const active =
                  pathname === item.href ||
                  pathname.startsWith(item.href + "/");
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] font-medium transition-colors",
                      active
                        ? "bg-primary/12 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t p-3">
        <div className="rounded-lg bg-muted/60 px-2.5 py-2">
          <p className="truncate text-xs font-semibold">{persona?.full_name}</p>
          <p className="truncate text-2xs text-muted-foreground">
            {role?.name}
          </p>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------- topbar */

function TopBar({ onMenu }: { onMenu: () => void }) {
  const {
    tenants, tenant, setActiveTenant, persona, role, switchPersona, signOut,
    refresh,
  } = useAuth();
  const router = useRouter();
  const [tenantOpen, setTenantOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);

  const { data: notifications } = useApi<any[]>("/notifications", []);
  const { mutate } = useMutate();
  const unread = useMemo(
    () => notifications.filter((n) => !n.is_read).length,
    [notifications]
  );

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur lg:px-6">
      <button
        onClick={onMenu}
        className="rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden"
        aria-label="Open menu"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* community switcher */}
      <div className="relative">
        <button
          onClick={() => setTenantOpen((o) => !o)}
          className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-sm font-medium shadow-sm transition-colors hover:bg-muted"
        >
          <Building2 className="h-3.5 w-3.5 text-primary" />
          <span className="max-w-[9rem] truncate">{tenant?.name}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
        {tenantOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setTenantOpen(false)} />
            <div className="absolute left-0 z-20 mt-1.5 w-72 animate-fade-in overflow-hidden rounded-lg border bg-popover shadow-xl">
              <p className="border-b px-3 py-2 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                Communities you can access
              </p>
              {tenants.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveTenant(t.id);
                    setTenantOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 border-b px-3 py-2.5 text-left last:border-0 transition-colors",
                    t.id === tenant?.id ? "bg-accent" : "hover:bg-muted/60"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.name}</p>
                    <p className="truncate text-2xs text-muted-foreground">
                      {t.kind} · {t.city}, {t.state}
                    </p>
                  </div>
                  {t.id === tenant?.id && (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="flex-1" />

      {/* demo controls */}
      <button
        onClick={() => {
          resetStore();
          refresh();
        }}
        title="Reset all demo data to its original state"
        className="hidden items-center gap-1.5 rounded-lg border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground sm:flex"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Reset demo
      </button>

      <ThemeToggle />

      {/* notifications */}
      <div className="relative">
        <button
          onClick={() => setBellOpen((o) => !o)}
          className="relative rounded-lg border bg-card p-2 text-muted-foreground shadow-sm transition-colors hover:bg-muted hover:text-foreground"
          aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">
              {unread}
            </span>
          )}
        </button>
        {bellOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setBellOpen(false)} />
            <div className="absolute right-0 z-20 mt-1.5 w-[22rem] animate-fade-in overflow-hidden rounded-lg border bg-popover shadow-xl">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Inbox
                </p>
                {unread > 0 && (
                  <button
                    onClick={() => mutate("/notifications/read-all", "POST")}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto scroll-thin">
                {notifications.slice(0, 8).map((n) => (
                  <button
                    key={n.id}
                    onClick={() => mutate(`/notifications/${n.id}/read`, "POST")}
                    className={cn(
                      "flex w-full gap-2.5 border-b px-3 py-2.5 text-left last:border-0 transition-colors hover:bg-muted/60",
                      !n.is_read && "bg-primary/[0.06]"
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                        n.is_read ? "bg-transparent" : "bg-primary"
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs leading-relaxed text-foreground">
                        {n.message}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <Badge tone="neutral" className="text-[10px]">
                          {n.category}
                        </Badge>
                        <span className="text-2xs text-muted-foreground">
                          {relTime(n.created_at)}
                        </span>
                      </span>
                    </span>
                  </button>
                ))}
                {notifications.length === 0 && (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Nothing in the inbox.
                  </p>
                )}
              </div>
              <Link
                href="/notifications"
                onClick={() => setBellOpen(false)}
                className="block border-t px-3 py-2 text-center text-xs font-medium text-primary hover:bg-muted/60"
              >
                View all notifications
              </Link>
            </div>
          </>
        )}
      </div>

      {/* persona switcher */}
      <div className="relative">
        <button
          onClick={() => setPersonaOpen((o) => !o)}
          className="flex items-center gap-2 rounded-lg border bg-card py-1 pl-1 pr-2 shadow-sm transition-colors hover:bg-muted"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-2xs font-bold text-primary">
            {persona?.full_name.split(" ").map((w) => w[0]).join("")}
          </span>
          <span className="hidden text-left sm:block">
            <span className="block max-w-[8rem] truncate text-xs font-semibold leading-tight">
              {persona?.full_name}
            </span>
            <span className="block max-w-[8rem] truncate text-[10px] leading-tight text-muted-foreground">
              {persona?.role_code.replace(/_/g, " ")}
            </span>
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>

        {personaOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setPersonaOpen(false)} />
            <div className="absolute right-0 z-20 mt-1.5 w-[21rem] animate-fade-in overflow-hidden rounded-lg border bg-popover shadow-xl">
              <div className="border-b bg-muted/50 px-3 py-2">
                <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Switch role — the app re-renders instantly
                </p>
              </div>
              <div className="max-h-96 overflow-y-auto scroll-thin">
                {PERSONAS.map((p) => {
                  const r = ROLES[p.role_code];
                  const active = p.id === persona?.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => {
                        switchPersona(p.id);
                        setPersonaOpen(false);
                        router.push("/dashboard");
                      }}
                      className={cn(
                        "flex w-full items-start gap-2.5 border-b px-3 py-2.5 text-left last:border-0 transition-colors",
                        active ? "bg-accent" : "hover:bg-muted/60"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                          active
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {p.full_name.split(" ").map((w) => w[0]).join("")}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-xs font-semibold">
                            {p.full_name}
                          </span>
                          <Badge
                            tone={r?.implemented ? "primary" : "warning"}
                            className="text-[10px]"
                          >
                            {p.role_code.replace(/_/g, " ")}
                          </Badge>
                        </span>
                        <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">
                          {p.title}
                        </span>
                      </span>
                      {active && <Check className="mt-1 h-3.5 w-3.5 shrink-0 text-primary" />}
                    </button>
                  );
                })}
              </div>
              <button
                onClick={() => {
                  signOut();
                  router.replace("/login");
                }}
                className="flex w-full items-center gap-2 border-t px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <LogOut className="h-3.5 w-3.5" />
                Back to the sign-in screen
              </button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
