"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE } from "@/lib/api";
import type {
  PortalDashboard, PortalDocument, PortalInvoice, PortalNotification, PortalReceiptItem, PortalUnit,
} from "@/lib/types";

type Tab = "assessments" | "payments" | "documents";

export default function PortalDashboardPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [resident, setResident] = useState<{ full_name: string; resident_type: string; must_change_password?: boolean } | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const [pw, setPw] = useState({ current_password: "", new_password: "" });
  const [dash, setDash] = useState<PortalDashboard | null>(null);
  const [notifs, setNotifs] = useState<PortalNotification[]>([]);
  const [units, setUnits] = useState<PortalUnit[]>([]);
  const [selected, setSelected] = useState<PortalUnit | null>(null);
  const [tab, setTab] = useState<Tab>("assessments");
  const [invoices, setInvoices] = useState<PortalInvoice[]>([]);
  const [receipts, setReceipts] = useState<PortalReceiptItem[]>([]);
  const [docs, setDocs] = useState<PortalDocument[]>([]);
  const [collections, setCollections] = useState<{ payment_plans: { plan_number: string; status: string; remaining: string; next_due: string | null }[]; liens: { lien_number: string; status: string; amount: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const api = useCallback(async (path: string, init?: RequestInit) => {
    const t = localStorage.getItem("casa_portal_token");
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...(init?.headers || {}) },
    });
    if (res.status === 401) { router.push("/portal/login"); throw new Error("Session expired"); }
    if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail || "Request failed"); }
    return res;
  }, [router]);

  const blob = useCallback((path: string, filename: string) => {
    const t = localStorage.getItem("casa_portal_token");
    fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${t}` } })
      .then((r) => r.blob()).then((b) => {
        const url = URL.createObjectURL(b); const a = document.createElement("a");
        a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
      });
  }, []);

  useEffect(() => {
    const t = localStorage.getItem("casa_portal_token");
    if (!t) { router.push("/portal/login"); return; }
    setToken(t);
    const r = localStorage.getItem("casa_portal_resident");
    if (r) setResident(JSON.parse(r));
    api("/portal/dashboard").then((res) => res.json()).then(setDash).catch(() => {});
    api("/portal/notifications").then((res) => res.json()).then(setNotifs).catch(() => {});
    api("/portal/collections").then((res) => res.json()).then(setCollections).catch(() => {});
    api("/portal/units").then((res) => res.json()).then((u: PortalUnit[]) => {
      setUnits(u); if (u[0]) selectUnit(u[0]);
    }).catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadTabData(u: PortalUnit, which: Tab) {
    try {
      if (which === "assessments") setInvoices(await (await api(`/portal/units/${u.homeowner_id}/invoices`)).json());
      if (which === "payments") setReceipts(await (await api(`/portal/units/${u.homeowner_id}/receipts`)).json());
      if (which === "documents") setDocs(await (await api(`/portal/units/${u.homeowner_id}/documents`)).json());
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load"); }
  }

  async function selectUnit(u: PortalUnit) { setSelected(u); setTab("assessments"); await loadTabData(u, "assessments"); }
  function switchTab(t: Tab) { setTab(t); if (selected) loadTabData(selected, t); }

  async function refresh() {
    api("/portal/dashboard").then((res) => res.json()).then(setDash).catch(() => {});
    api("/portal/notifications").then((res) => res.json()).then(setNotifs).catch(() => {});
    const res = await api("/portal/units"); const u: PortalUnit[] = await res.json(); setUnits(u);
    const cur = u.find((x) => x.homeowner_id === selected?.homeowner_id) || u[0];
    if (cur) { setSelected(cur); await loadTabData(cur, tab); }
  }

  async function pay(inv: PortalInvoice) {
    setBusy(inv.id); setError(null); setMsg(null);
    try {
      // Prefer the real hosted gateway when enabled; fall back to the tokenized path.
      try {
        const res = await api("/portal/pay/checkout", { method: "POST", body: JSON.stringify({ invoice_id: inv.id, amount: inv.balance }) });
        const data = await res.json();
        if (data.checkout_url) { window.location.href = data.checkout_url; return; }
      } catch { /* gateway not enabled — use tokenized fallback */ }
      await api("/portal/pay", { method: "POST", body: JSON.stringify({ invoice_id: inv.id, amount: inv.balance }) });
      setMsg(`Payment of $${Number(inv.balance).toFixed(2)} received for ${inv.invoice_number}. Thank you!`);
      await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Payment failed"); }
    finally { setBusy(null); }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault(); setBusy("pw"); setError(null);
    try {
      await api("/portal/change-password", { method: "POST", body: JSON.stringify(pw) });
      setMsg("Password updated."); setPwOpen(false); setPw({ current_password: "", new_password: "" });
      if (resident) { const next = { ...resident, must_change_password: false }; setResident(next); localStorage.setItem("casa_portal_resident", JSON.stringify(next)); }
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to change password"); }
    finally { setBusy(null); }
  }

  function logout() {
    localStorage.removeItem("casa_portal_token"); localStorage.removeItem("casa_portal_resident");
    router.push("/portal/login");
  }

  if (!token) return null;
  const monthly = invoices.filter((i) => !["SPECIAL_ASSESSMENT", "LATE_FEE"].includes(i.invoice_type));
  const special = invoices.filter((i) => ["SPECIAL_ASSESSMENT", "LATE_FEE"].includes(i.invoice_type));
  const tone: Record<string, string> = { OVERDUE: "bg-rose-50 text-rose-700", LATE_FEE: "bg-rose-50 text-rose-700", DUE_SOON: "bg-amber-50 text-amber-800" };

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex items-center justify-between bg-white px-4 py-3 shadow-sm sm:px-6">
        <div>
          <div className="font-bold text-slate-800">Homeowner Portal</div>
          <div className="text-xs text-slate-500">{resident?.full_name} · {resident?.resident_type}</div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setPwOpen((v) => !v)} className="text-sm text-slate-500 hover:text-slate-800">Password</button>
          <button onClick={logout} className="text-sm text-slate-500 hover:text-slate-800">Sign out</button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        {error && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        {msg && <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}

        {resident?.must_change_password && !pwOpen && (
          <div className="flex items-center justify-between rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <span>Please change your temporary password.</span>
            <button onClick={() => setPwOpen(true)} className="font-semibold underline">Change now</button>
          </div>
        )}
        {pwOpen && (
          <form onSubmit={changePassword} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="font-semibold text-slate-800">Change password</div>
            <input type="password" placeholder="Current password" required value={pw.current_password}
              onChange={(e) => setPw({ ...pw, current_password: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <input type="password" placeholder="New password (min 8)" minLength={8} required value={pw.new_password}
              onChange={(e) => setPw({ ...pw, new_password: e.target.value })} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button type="submit" disabled={busy === "pw"} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">{busy === "pw" ? "Saving…" : "Update"}</button>
              <button type="button" onClick={() => setPwOpen(false)} className="text-sm text-slate-500">Cancel</button>
            </div>
          </form>
        )}

        {/* Notifications */}
        {notifs.length > 0 && (
          <div className="space-y-2">
            {notifs.map((n, i) => (
              <div key={i} className={`rounded-lg px-3 py-2 text-sm ${tone[n.category] || "bg-slate-50 text-slate-700"}`}>{n.message}</div>
            ))}
          </div>
        )}

        {/* Dashboard summary */}
        {dash && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Balance due", `$${Number(dash.total_balance).toFixed(2)}`],
              ["Units", String(dash.units)],
              ["Open items", String(dash.open_invoices)],
              ["Next due", dash.next_due_date || "—"]].map(([k, v]) => (
              <div key={k} className="rounded-xl bg-white p-3 shadow-sm">
                <div className="text-xs text-slate-400">{k}</div>
                <div className="mt-1 text-lg font-bold text-slate-800">{v}</div>
              </div>
            ))}
          </div>
        )}

        {/* Collections status */}
        {collections && (collections.payment_plans.length > 0 || collections.liens.length > 0) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
            <div className="mb-1 font-semibold text-amber-900">Account status</div>
            {collections.payment_plans.map((p) => (
              <div key={p.plan_number} className="text-amber-800">
                Payment plan {p.plan_number} — {p.status}, ${Number(p.remaining).toFixed(2)} remaining
                {p.next_due ? ` (next due ${p.next_due})` : ""}.
              </div>
            ))}
            {collections.liens.map((l) => (
              <div key={l.lien_number} className="text-rose-700">Lien {l.lien_number} — {l.status}, ${Number(l.amount).toFixed(2)}.</div>
            ))}
          </div>
        )}

        {/* Unit selector */}
        <div className="grid gap-3 sm:grid-cols-2">
          {units.map((u) => (
            <button key={u.homeowner_id} onClick={() => selectUnit(u)}
              className={`rounded-xl border p-4 text-left ${selected?.homeowner_id === u.homeowner_id ? "border-brand-500 bg-white" : "border-slate-200 bg-white/60"}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800">Unit {u.unit_number}</span>
                {u.is_primary && <span className="text-xs text-brand-600">primary</span>}
              </div>
              <div className="mt-1 text-xs text-slate-400">Account {u.account_number}</div>
              <div className="mt-2 text-lg font-bold text-slate-800">${Number(u.balance).toFixed(2)}<span className="ml-1 text-xs font-normal text-slate-400">balance</span></div>
            </button>
          ))}
        </div>

        {selected && (
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex gap-1 rounded-lg bg-slate-100 p-1 text-sm">
                {(["assessments", "payments", "documents"] as Tab[]).map((t) => (
                  <button key={t} onClick={() => switchTab(t)}
                    className={`rounded-md px-3 py-1 capitalize ${tab === t ? "bg-white font-semibold text-slate-800 shadow-sm" : "text-slate-500"}`}>{t}</button>
                ))}
              </div>
              <button onClick={() => blob(`/portal/units/${selected.homeowner_id}/statement/export`, `statement_${selected.account_number}.xlsx`)}
                className="text-xs text-brand-600 hover:underline">Statement ⬇</button>
            </div>

            {tab === "assessments" && (
              <div className="space-y-4">
                {[["Monthly assessments", monthly], ["Special assessments & fees", special]].map(([label, list]) => (
                  <div key={label as string}>
                    <div className="mb-1 text-xs font-semibold uppercase text-slate-400">{label as string}</div>
                    <table className="w-full text-left text-sm">
                      <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                        <th className="py-1 pr-2">Invoice</th><th className="py-1 pr-2">Due</th>
                        <th className="py-1 pr-2 text-right">Balance</th><th className="py-1 pr-2 text-right">Pay</th></tr></thead>
                      <tbody>
                        {(list as PortalInvoice[]).map((i) => (
                          <tr key={i.id} className="border-b border-slate-100">
                            <td className="py-1 pr-2 font-mono text-xs">{i.invoice_number}</td>
                            <td className="py-1 pr-2">{i.due_date || "—"}</td>
                            <td className="py-1 pr-2 text-right">${Number(i.balance).toFixed(2)}</td>
                            <td className="py-1 pr-2 text-right">
                              {Number(i.balance) > 0 ? (
                                <button onClick={() => pay(i)} disabled={busy === i.id} className="rounded bg-brand-600 px-3 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50">{busy === i.id ? "…" : "Pay"}</button>
                              ) : <span className="text-xs text-emerald-600">{i.status}</span>}
                            </td>
                          </tr>
                        ))}
                        {(list as PortalInvoice[]).length === 0 && <tr><td colSpan={4} className="py-2 text-slate-400">None.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                ))}
                <p className="text-xs text-slate-400">Payments are processed via a tokenized method (no card number is stored).</p>
              </div>
            )}

            {tab === "payments" && (
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                  <th className="py-1 pr-2">Receipt</th><th className="py-1 pr-2">Date</th>
                  <th className="py-1 pr-2">Method</th><th className="py-1 pr-2 text-right">Amount</th></tr></thead>
                <tbody>
                  {receipts.map((r) => (
                    <tr key={r.receipt_number} className="border-b border-slate-100">
                      <td className="py-1 pr-2 font-mono text-xs">{r.receipt_number}</td>
                      <td className="py-1 pr-2">{r.receipt_date}</td>
                      <td className="py-1 pr-2">{r.payment_method}</td>
                      <td className="py-1 pr-2 text-right">${Number(r.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                  {receipts.length === 0 && <tr><td colSpan={4} className="py-2 text-slate-400">No payments yet.</td></tr>}
                </tbody>
              </table>
            )}

            {tab === "documents" && (
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                  <th className="py-1 pr-2">Document</th><th className="py-1 pr-2">Type</th>
                  <th className="py-1 pr-2">Date</th><th className="py-1 pr-2 text-right">Get</th></tr></thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id} className="border-b border-slate-100">
                      <td className="py-1 pr-2">{d.filename}</td>
                      <td className="py-1 pr-2 text-xs text-slate-500">{d.entity_type}</td>
                      <td className="py-1 pr-2 text-xs">{new Date(d.created_at).toLocaleDateString()}</td>
                      <td className="py-1 pr-2 text-right">
                        <button onClick={() => blob(`/portal/documents/${d.id}/download`, d.filename)} className="text-xs text-brand-600 hover:underline">Download</button>
                      </td>
                    </tr>
                  ))}
                  {docs.length === 0 && <tr><td colSpan={4} className="py-2 text-slate-400">No documents.</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
