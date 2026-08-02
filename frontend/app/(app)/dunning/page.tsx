"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { DunningLog, DunningRule } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Select, Spinner } from "@/components/ui";

const TONE: Record<string, string> = { SENT: "A", ESCALATED: "O", NO_EMAIL: "O", SKIPPED_OPTOUT: "O", FAILED: "R" };

export default function DunningPage() {
  const { token, activeTenantId } = useAuth();
  const [rules, setRules] = useState<DunningRule[]>([]);
  const [logs, setLogs] = useState<DunningLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", days_past_due: "30", action: "REMINDER", escalate_to_stage: "PAYMENT_PLAN", attach_statement: true });
  const [asOf, setAsOf] = useState("2026-06-30");
  const [reg, setReg] = useState({ start: "2026-01-01", end: "2026-12-31" });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [r, l] = await Promise.all([
        apiFetch<DunningRule[]>("/dunning/rules", { token, tenantId: activeTenantId }),
        apiFetch<DunningLog[]>("/dunning/logs", { token, tenantId: activeTenantId }),
      ]);
      setRules(r); setLogs(l); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  async function addRule(e: React.FormEvent) {
    e.preventDefault(); setBusy("rule"); setError(null);
    try {
      await apiFetch("/dunning/rules", { method: "POST", token, tenantId: activeTenantId, body: {
        name: form.name, days_past_due: Number(form.days_past_due), action: form.action,
        escalate_to_stage: form.action === "ESCALATE" ? form.escalate_to_stage : undefined,
        attach_statement: form.attach_statement } });
      setForm({ name: "", days_past_due: "30", action: "REMINDER", escalate_to_stage: "PAYMENT_PLAN", attach_statement: true });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(null); }
  }

  async function delRule(id: string) {
    setBusy(id); setError(null);
    try { await apiFetch(`/dunning/rules/${id}`, { method: "DELETE", token, tenantId: activeTenantId }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
    finally { setBusy(null); }
  }

  async function runNow() {
    setBusy("run"); setError(null); setMsg(null);
    try {
      const r = await apiFetch<{ reminders_sent: number; escalations: number; skipped: number }>(
        "/dunning/run", { method: "POST", token, tenantId: activeTenantId, body: { as_of: asOf } });
      setMsg(`Dunning run: ${r.reminders_sent} reminders, ${r.escalations} escalations, ${r.skipped} skipped.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Run failed"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Dunning</h1>
        <p className="text-sm text-slate-500">Automated payment reminders + collections escalation by days past due.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      {loading ? <Spinner /> : (
        <>
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Dunning ladder</h2>
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-1 pr-3">Rule</th><th className="py-1 pr-3">Days past due</th>
                <th className="py-1 pr-3">Action</th><th className="py-1 pr-3">Attach</th><th className="py-1 pr-3 text-right"></th></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-1 pr-3 font-medium">{r.name}</td>
                    <td className="py-1 pr-3">{r.days_past_due}</td>
                    <td className="py-1 pr-3"><Badge>{r.action}{r.escalate_to_stage ? ` → ${r.escalate_to_stage}` : ""}</Badge></td>
                    <td className="py-1 pr-3">{r.attach_statement ? "PDF" : "—"}</td>
                    <td className="py-1 pr-3 text-right"><Button variant="secondary" onClick={() => delRule(r.id)} disabled={busy === r.id}>Delete</Button></td>
                  </tr>
                ))}
                {rules.length === 0 && <tr><td colSpan={5} className="py-2 text-slate-400">No rules yet.</td></tr>}
              </tbody>
            </table>
            <form onSubmit={addRule} className="mt-3 grid items-end gap-3 md:grid-cols-5">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><Label>Days past due</Label><Input type="number" value={form.days_past_due} onChange={(e) => setForm({ ...form, days_past_due: e.target.value })} /></div>
              <div>
                <Label>Action</Label>
                <Select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })}>
                  <option value="REMINDER">REMINDER</option><option value="ESCALATE">ESCALATE</option>
                </Select>
              </div>
              {form.action === "ESCALATE" ? (
                <div>
                  <Label>Escalate to</Label>
                  <Select value={form.escalate_to_stage} onChange={(e) => setForm({ ...form, escalate_to_stage: e.target.value })}>
                    <option value="NOTICE">NOTICE</option><option value="PAYMENT_PLAN">PAYMENT_PLAN</option><option value="LIEN">LIEN</option>
                  </Select>
                </div>
              ) : (
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" checked={form.attach_statement} onChange={(e) => setForm({ ...form, attach_statement: e.target.checked })} /> Attach statement
                </label>
              )}
              <Button type="submit" disabled={busy === "rule"}>{busy === "rule" ? "…" : "+ Rule"}</Button>
            </form>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">Run / Reports</span>
              <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-40" />
              <Button onClick={runNow} disabled={busy === "run"}>{busy === "run" ? "Running…" : "Run dunning (as of)"}</Button>
              <span className="mx-2 text-slate-300">|</span>
              <Input value={reg.start} onChange={(e) => setReg({ ...reg, start: e.target.value })} className="w-32" />
              <Input value={reg.end} onChange={(e) => setReg({ ...reg, end: e.target.value })} className="w-32" />
              <Button variant="secondary" onClick={() => downloadFile(`/dunning/effectiveness/export?start=${reg.start}&end=${reg.end}`, token!, activeTenantId!, "dunning_effectiveness.xlsx")}>Effectiveness xlsx</Button>
            </div>
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">History</h2>
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-1 pr-3">When</th><th className="py-1 pr-3">Action</th>
                <th className="py-1 pr-3">DPD</th><th className="py-1 pr-3 text-right">Balance</th>
                <th className="py-1 pr-3">Status</th></tr></thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="py-1 pr-3 text-xs">{new Date(l.created_at).toLocaleDateString()}</td>
                    <td className="py-1 pr-3">{l.action}</td>
                    <td className="py-1 pr-3">{l.days_past_due}</td>
                    <td className="py-1 pr-3 text-right">${l.balance}</td>
                    <td className="py-1 pr-3"><Badge tone={TONE[l.status]}>{l.status}</Badge></td>
                  </tr>
                ))}
                {logs.length === 0 && <tr><td colSpan={5} className="py-2 text-slate-400">No dunning activity yet.</td></tr>}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
