"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../providers";
import { apiFetch } from "@/lib/api";
import type { Membership, Tenant } from "@/lib/types";
import { Spinner } from "@/components/ui";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  LayoutDashboard, Ticket, Users, Files, Bell, ListTree, Tags,
  Building2, Settings, PieChart, Landmark, Wallet, ShoppingCart,
  PackageCheck, Lock, FileText, CreditCard, HandCoins, Receipt,
  PhoneCall, Mail, AlertCircle, BookOpen, CalendarOff, CheckSquare,
  UserCog, Home, BadgeDollarSign, Timer, BarChart3, Database,
  ShieldCheck, Presentation
} from "lucide-react";

type NavItem = { href: string; label: string; icon: React.ElementType; superadmin?: boolean };
type NavGroup = { title: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    title: "Core Operations",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/service-desk", label: "Service Desk", icon: Ticket },
      { href: "/residents", label: "Residents", icon: Users },
      { href: "/documents", label: "Documents", icon: Files },
      { href: "/notifications", label: "Notifications", icon: Bell },
    ],
  },
  {
    title: "Financial Setup",
    items: [
      { href: "/coa", label: "Chart of Accounts", icon: ListTree },
      { href: "/value-sets", label: "Value Sets", icon: Tags },
      { href: "/vendors", label: "Vendors", icon: Building2 },
      { href: "/ap-setup", label: "AP Setup", icon: Settings },
      { href: "/cash", label: "Cash & Bank Rec", icon: Wallet },
      { href: "/budgets", label: "Budgets", icon: PieChart },
      { href: "/fixed-assets", label: "Fixed Assets", icon: Landmark },
    ],
  },
  {
    title: "Accounts Payable",
    items: [
      { href: "/purchasing", label: "Purchasing (PO)", icon: ShoppingCart },
      { href: "/receiving", label: "Receiving", icon: PackageCheck },
      { href: "/encumbrance", label: "Encumbrances", icon: Lock },
      { href: "/payables", label: "Payables (AP)", icon: FileText },
      { href: "/payments", label: "Payments (AP)", icon: CreditCard },
    ],
  },
  {
    title: "Accounts Receivable",
    items: [
      { href: "/ar-billing", label: "AR Billing", icon: Receipt },
      { href: "/collections", label: "Collections", icon: PhoneCall },
      { href: "/statements", label: "AR Statements", icon: Mail },
      { href: "/dunning", label: "Dunning", icon: AlertCircle },
      { href: "/receivables", label: "Receivables (AR)", icon: HandCoins },
    ],
  },
  {
    title: "General Ledger",
    items: [
      { href: "/gl", label: "General Ledger", icon: BookOpen },
      { href: "/periods", label: "Period Close", icon: CalendarOff },
      { href: "/approvals", label: "Approvals", icon: CheckSquare },
    ],
  },
  {
    title: "System Admin",
    items: [
      { href: "/users", label: "Users & Roles", icon: UserCog },
      { href: "/tenants", label: "HOAs (Tenants)", icon: Home, superadmin: true },
      { href: "/gateway", label: "Payment Gateway", icon: BadgeDollarSign },
      { href: "/scheduler", label: "Scheduled Jobs", icon: Timer },
      { href: "/reports", label: "Reports", icon: BarChart3 },
      { href: "/board", label: "Board Dashboard", icon: Presentation },
      { href: "/migration", label: "Data Migration", icon: Database },
      { href: "/go-live", label: "Go-Live & Compliance", icon: ShieldCheck },
    ],
  },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { ready, token, user, memberships, activeTenantId, setActiveTenant, logout } =
    useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [saTenants, setSaTenants] = useState<Membership[]>([]);

  useEffect(() => {
    if (ready && !token) router.replace("/login");
  }, [ready, token, router]);

  // Force a password change on first login before anything else is usable.
  useEffect(() => {
    if (ready && token && user?.mustChangePassword && pathname !== "/change-password") {
      router.replace("/change-password");
    }
  }, [ready, token, user?.mustChangePassword, pathname, router]);

  // SUPERADMIN has no memberships — load all HOAs to populate the switcher.
  // Reloads on navigation and on a "casa:tenants-changed" event (fired after an
  // HOA is created) so a newly created HOA appears in the switcher immediately.
  useEffect(() => {
    if (!token || !user?.isSuperadmin) return;
    let cancelled = false;
    const loadSaTenants = () => {
      apiFetch<Tenant[]>("/tenants", { token })
        .then((rows) => {
          if (cancelled) return;
          setSaTenants(
            rows.map((t) => ({
              tenant_id: t.id,
              tenant_name: t.name,
              tenant_slug: t.slug,
              role_code: "SUPERADMIN",
              role_name: "Super Administrator",
            }))
          );
          if (!activeTenantId && rows[0]) setActiveTenant(rows[0].id);
        })
        .catch(() => undefined);
    };
    loadSaTenants();
    window.addEventListener("casa:tenants-changed", loadSaTenants);
    return () => {
      cancelled = true;
      window.removeEventListener("casa:tenants-changed", loadSaTenants);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user?.isSuperadmin, pathname]);

  if (!ready || !token || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const tenantOptions = user.isSuperadmin ? saTenants : memberships;
  const activeName =
    tenantOptions.find((m) => m.tenant_id === activeTenantId)?.tenant_name ||
    (user.isSuperadmin ? "Loading HOAs…" : "Select an HOA");

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
            CH
          </div>
          <div>
            <div className="text-sm font-bold text-slate-800">Casa Harmony AI</div>
            <div className="text-[11px] text-slate-400">HOA ERP · v2</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-2">
          <Accordion type="multiple" className="w-full" defaultValue={["Core Operations", "Financial Setup", "Accounts Payable", "Accounts Receivable", "General Ledger", "System Admin"]}>
            {NAV_GROUPS.map((group) => {
              const filteredItems = group.items.filter((n) => !n.superadmin || user.isSuperadmin);
              if (filteredItems.length === 0) return null;
              return (
                <AccordionItem key={group.title} value={group.title} className="border-b-0">
                  <AccordionTrigger className="px-2 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-700 hover:no-underline">
                    {group.title}
                  </AccordionTrigger>
                  <AccordionContent className="pb-2 pt-0">
                    <div className="flex flex-col space-y-1">
                      {filteredItems.map((n) => {
                        const active = pathname === n.href || pathname.startsWith(n.href + "/");
                        const Icon = n.icon;
                        return (
                          <Link
                            key={n.href}
                            href={n.href}
                            className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                              active
                                ? "bg-brand-50 text-brand-700"
                                : "text-slate-600 hover:bg-slate-100"
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                            {n.label}
                          </Link>
                        );
                      })}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </nav>
        <div className="border-t border-slate-200 p-3 text-[11px] text-slate-400">
          SOC 2 · PCI DSS · ISO 27001 · CCPA
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Active HOA
            </label>
            <select
              value={activeTenantId ?? ""}
              onChange={(e) => setActiveTenant(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            >
              {tenantOptions.length === 0 && (
                <option value="">{activeName}</option>
              )}
              {tenantOptions.map((m) => (
                <option key={m.tenant_id} value={m.tenant_id}>
                  {m.tenant_name} · {m.role_code}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium text-slate-700">{user.email}</div>
              <div className="text-[11px] text-slate-400">
                {user.isSuperadmin ? "SUPERADMIN" : "Tenant user"}
              </div>
            </div>
            <a
              href="/change-password"
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Change password
            </a>
            <button
              onClick={() => {
                logout();
                router.replace("/login");
              }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Logout
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
