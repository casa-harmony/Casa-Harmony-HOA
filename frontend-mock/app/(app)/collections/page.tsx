"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { AgingRow, CollectionPlan, DelinquencyCase, Homeowner, Lien } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

const BUCKETS = ["Current", "1-30", "31-60", "61-90", "90+"];
const STAGE_TONE: Record<string, string> = { NOTICE: "O", PAYMENT_PLAN: "A", LIEN: "R", RESOLVED: "none" };

export default function CollectionsPage() {
  const { token, activeTenantId } = useAuth();
  const [aging, setAging] = useState<AgingRow[]>([]);
  const [cases, setCases] = useState<DelinquencyCase[]>([]);
  const [plans, setPlans] = useState<CollectionPlan[]>([]);
  const [liens, setLiens] = useState<Lien[]>([]);
  const [homeowners, setHomeowners] = useState<Homeowner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<"" | "plan" | "lien">("");
  const [asOf, setAsOf] = useState("2026-06-30");
  const [range, setRange] = useState({ start: "2026-01-01", end: "2026-12-31" });
  const [plan, setPlan] = useState({ homeowner_id: "", total_amount: "", installments: "3", start_date: "2026-07-01", frequency_days: "30" });
  const [lien, setLien] = useState({ homeowner_id: "", amount: "", reference: "" });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [ag, cs, pl, li, ho] = await Promise.all([
        apiFetch<AgingRow[]>(`/collections/aging?as_of=${asOf}`, { token, tenantId: activeTenantId }),
        apiFetch<DelinquencyCase[]>("/collections/cases", { token, tenantId: activeTenantId }),
        apiFetch<CollectionPlan[]>("/collections/payment-plans", { token, tenantId: activeTenantId }),
        apiFetch<Lien[]>("/collections/liens", { token, tenantId: activeTenantId }),
        apiFetch<Homeowner[]>("/subledger/homeowners", { token, tenantId: activeTenantId }),
      ]);
      setAging(ag); setCases(cs); setPlans(pl); setLiens(li); setHomeowners(ho);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  const hoName = (id: string) => { const h = homeowners.find((x) => x.id === id); return h ? `${h.first_name} ${h.last_name}` : id?.slice(0, 8) || "Unknown"; };

  async function act(path: string, body?: unknown, label = "act") {
    setBusy(label); setError(null); setMsg(null);
    try {
      await apiFetch(path, { method: "POST", token, tenantId: activeTenantId, body });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(null); }
  }

  async function openCase(hid: string) { await act("/collections/cases", { homeowner_id: hid, as_of: asOf }, hid); }
  async function escalate(hid: string, to: string) { await act(`/collections/cases/${hid}/escalate`, { to_stage: to }, hid); }

  async function createPlan(e: React.FormEvent) {
    e.preventDefault(); setBusy("plan"); setError(null);
    try {
      await apiFetch("/collections/payment-plans", { method: "POST", token, tenantId: activeTenantId, body: {
        homeowner_id: plan.homeowner_id, total_amount: plan.total_amount, installments: Number(plan.installments),
        start_date: plan.start_date, frequency_days: Number(plan.frequency_days) } });
      setModal(""); setMsg("Payment plan created."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
  }

  async function createLien(e: React.FormEvent) {
    e.preventDefault(); setBusy("lien"); setError(null);
    try {
      await apiFetch("/collections/liens", { method: "POST", token, tenantId: activeTenantId, body: {
        homeowner_id: lien.homeowner_id, amount: lien.amount, reference: lien.reference || undefined } });
      setModal(""); setMsg("Lien recorded."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Failed"); } finally { setBusy(null); }
  }

  const caseByHo = (id: string) => cases.find((c) => c.homeowner_id === id);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Collections & Delinquency</h1>
          <p className="text-sm text-slate-500">Aging, escalation (notice → plan → lien), payment plans, liens.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setModal("plan")}>+ Payment Plan</Button>
          <Button variant="secondary" onClick={() => setModal("lien")}>+ Lien</Button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      {loading ? <Spinner /> : (
        <>
          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-700">Aging</h2>
              <Input value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-36" />
              <Button variant="secondary" onClick={load}>Refresh</Button>
              <Button variant="secondary" onClick={() => downloadFile(`/collections/aging/export?as_of=${asOf}`, token!, activeTenantId!, "delinquency_aging.xlsx")}>Aging xlsx</Button>
              <Input value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} className="w-32" />
              <Input value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} className="w-32" />
              <Button variant="secondary" onClick={() => downloadFile(`/collections/effectiveness/export?start=${range.start}&end=${range.end}`, token!, activeTenantId!, "collection_effectiveness.xlsx")}>Effectiveness xlsx</Button>
            </div>
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-1 pr-3">Homeowner</th>{BUCKETS.map((b) => <th key={b} className="py-1 pr-3 text-right">{b}</th>)}
                <th className="py-1 pr-3 text-right">Total</th><th className="py-1 pr-3">Stage</th><th className="py-1 pr-3 text-right">Action</th></tr></thead>
              <tbody>
                {aging.map((r) => {
                  const c = caseByHo(r.homeowner_id);
                  return (
                    <tr key={r.homeowner_id} className="border-b border-slate-100">
                      <td className="py-1 pr-3">{r.name}<span className="ml-1 text-xs text-slate-400">{r.account_number}</span></td>
                      {BUCKETS.map((b) => <td key={b} className="py-1 pr-3 text-right">${Number(r.buckets[b] || 0).toFixed(0)}</td>)}
                      <td className="py-1 pr-3 text-right font-medium">${Number(r.total).toFixed(2)}</td>
                      <td className="py-1 pr-3">{c ? <Badge tone={STAGE_TONE[c.stage]}>{c.stage}</Badge> : <span className="text-xs text-slate-400">—</span>}</td>
                      <td className="py-1 pr-3 text-right">
                        {!c ? (
                          <Button variant="secondary" onClick={() => openCase(r.homeowner_id)} disabled={busy === r.homeowner_id}>Open case</Button>
                        ) : (
                          <div className="flex justify-end gap-1">
                            <Button variant="secondary" onClick={() => act(`/collections/cases/${r.homeowner_id}/notice`, undefined, r.homeowner_id)} disabled={busy === r.homeowner_id}>Notice</Button>
                            {c.stage === "NOTICE" && <Button variant="secondary" onClick={() => escalate(r.homeowner_id, "PAYMENT_PLAN")}>→ Plan</Button>}
                            {c.stage === "PAYMENT_PLAN" && <Button variant="secondary" onClick={() => escalate(r.homeowner_id, "LIEN")}>→ Lien</Button>}
                            {c.stage !== "RESOLVED" && <Button variant="secondary" onClick={() => escalate(r.homeowner_id, "RESOLVED")}>Resolve</Button>}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {aging.length === 0 && <tr><td colSpan={9} className="py-2 text-slate-400">No delinquencies.</td></tr>}
              </tbody>
            </table>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Payment Plans</h2>
              {plans.map((p) => (
                <div key={p.id} className="border-b border-slate-100 py-1 text-sm">
                  <span className="font-mono">{p.plan_number}</span> · {hoName(p.homeowner_id)} · ${Number(p.total_amount).toFixed(2)} / {p.installments} <Badge tone={p.status === "COMPLETED" ? "A" : "O"}>{p.status}</Badge>
                </div>
              ))}
              {plans.length === 0 && <p className="text-xs text-slate-400">None.</p>}
            </Card>
            <Card>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Liens</h2>
              {liens.map((l) => (
                <div key={l.id} className="flex items-center justify-between border-b border-slate-100 py-1 text-sm">
                  <span><span className="font-mono">{l.lien_number}</span> · {hoName(l.homeowner_id)} · ${Number(l.amount).toFixed(2)} <Badge tone={l.status === "FILED" ? "R" : l.status === "RELEASED" ? "A" : "none"}>{l.status}</Badge></span>
                  <div className="flex gap-1">
                    {l.status === "DRAFT" && <Button variant="secondary" onClick={() => act(`/collections/liens/${l.id}/status`, { status: "FILED", on_date: asOf }, l.id)}>File</Button>}
                    {l.status === "FILED" && <Button variant="secondary" onClick={() => act(`/collections/liens/${l.id}/status`, { status: "RELEASED", on_date: asOf }, l.id)}>Release</Button>}
                  </div>
                </div>
              ))}
              {liens.length === 0 && <p className="text-xs text-slate-400">None.</p>}
            </Card>
          </div>
        </>
      )}

      <Modal open={modal === "plan"} onClose={() => setModal("")} title="New Payment Plan">
        <form onSubmit={createPlan} className="space-y-3">
          <div><Label>Homeowner</Label>
            <Select value={plan.homeowner_id} onChange={(e) => setPlan({ ...plan, homeowner_id: e.target.value })} required>
              <option value="">Select…</option>
              {homeowners.map((h) => <option key={h.id} value={h.id}>{h.first_name} {h.last_name} ({h.account_number})</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Total amount</Label><Input type="number" step="0.01" value={plan.total_amount} onChange={(e) => setPlan({ ...plan, total_amount: e.target.value })} required /></div>
            <div><Label>Installments</Label><Input type="number" value={plan.installments} onChange={(e) => setPlan({ ...plan, installments: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start date</Label><Input type="date" value={plan.start_date} onChange={(e) => setPlan({ ...plan, start_date: e.target.value })} /></div>
            <div><Label>Frequency (days)</Label><Input type="number" value={plan.frequency_days} onChange={(e) => setPlan({ ...plan, frequency_days: e.target.value })} /></div>
          </div>
          <Button type="submit" disabled={busy === "plan"}>{busy === "plan" ? "Saving…" : "Create Plan"}</Button>
        </form>
      </Modal>

      <Modal open={modal === "lien"} onClose={() => setModal("")} title="New Lien">
        <form onSubmit={createLien} className="space-y-3">
          <div><Label>Homeowner</Label>
            <Select value={lien.homeowner_id} onChange={(e) => setLien({ ...lien, homeowner_id: e.target.value })} required>
              <option value="">Select…</option>
              {homeowners.map((h) => <option key={h.id} value={h.id}>{h.first_name} {h.last_name} ({h.account_number})</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Amount</Label><Input type="number" step="0.01" value={lien.amount} onChange={(e) => setLien({ ...lien, amount: e.target.value })} required /></div>
            <div><Label>Reference</Label><Input value={lien.reference} onChange={(e) => setLien({ ...lien, reference: e.target.value })} /></div>
          </div>
          <Button type="submit" disabled={busy === "lien"}>{busy === "lien" ? "Saving…" : "Record Lien"}</Button>
        </form>
      </Modal>
    </div>
  );
}
