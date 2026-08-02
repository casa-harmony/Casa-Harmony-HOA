"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { StatementDelivery, StatementRun } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Spinner } from "@/components/ui";

const TONE: Record<string, string> = { SENT: "A", SKIPPED_OPTOUT: "O", NO_EMAIL: "O", FAILED: "R", GENERATED: "none" };

export default function StatementsPage() {
  const { token, activeTenantId } = useAuth();
  const [runs, setRuns] = useState<StatementRun[]>([]);
  const [sel, setSel] = useState<StatementRun | null>(null);
  const [deliveries, setDeliveries] = useState<StatementDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ as_of: "2026-06-30", send_email: true });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      setRuns(await apiFetch<StatementRun[]>("/statements/runs", { token, tenantId: activeTenantId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  async function runBatch(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null); setMsg(null);
    try {
      const r = await apiFetch<StatementRun>("/statements/run", {
        method: "POST", token, tenantId: activeTenantId,
        body: { as_of: form.as_of, send_email: form.send_email } });
      setMsg(`Run ${r.run_number}: ${r.generated} generated, ${r.sent} sent, ${r.skipped} skipped, ${r.failed} failed.`);
      await load(); await openRun(r);
    } catch (e) { setError(e instanceof Error ? e.message : "Run failed"); }
    finally { setBusy(false); }
  }

  async function openRun(r: StatementRun) {
    setSel(r);
    setDeliveries(await apiFetch<StatementDelivery[]>(`/statements/runs/${r.id}/deliveries`, { token, tenantId: activeTenantId }));
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">AR Statements</h1>
        <p className="text-sm text-slate-500">Batch-generate homeowner statements and email them (portal link to pay).</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <Card>
        <form onSubmit={runBatch} className="flex flex-wrap items-end gap-3">
          <div><Label>As of</Label><Input type="date" value={form.as_of} onChange={(e) => setForm({ ...form, as_of: e.target.value })} /></div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={form.send_email} onChange={(e) => setForm({ ...form, send_email: e.target.checked })} /> Send email
          </label>
          <Button type="submit" disabled={busy}>{busy ? "Running…" : "Run batch (all homeowners)"}</Button>
        </form>
        <p className="mt-2 text-xs text-slate-400">Opted-out and no-email homeowners are skipped and recorded.</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Runs</h2>
          {loading ? <Spinner /> : (
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-1 pr-3">Run</th><th className="py-1 pr-3">As of</th>
                <th className="py-1 pr-3 text-right">Sent/Gen</th><th className="py-1 pr-3 text-right">Report</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => openRun(r)}>
                    <td className="py-1 pr-3 font-mono">{r.run_number}</td>
                    <td className="py-1 pr-3">{r.as_of_date}</td>
                    <td className="py-1 pr-3 text-right">{r.sent}/{r.generated}{r.failed ? ` · ${r.failed} failed` : ""}</td>
                    <td className="py-1 pr-3 text-right">
                      <button onClick={(ev) => { ev.stopPropagation(); downloadFile(`/statements/runs/${r.id}/report/export`, token!, activeTenantId!, `${r.run_number}.xlsx`); }} className="text-xs text-brand-600 hover:underline">xlsx</button>
                    </td>
                  </tr>
                ))}
                {runs.length === 0 && <tr><td colSpan={4} className="py-2 text-slate-400">No runs yet.</td></tr>}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Deliveries {sel ? `· ${sel.run_number}` : ""}</h2>
          {!sel ? <p className="text-sm text-slate-400">Select a run to view delivery log.</p> : (
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-1 pr-3">Email</th><th className="py-1 pr-3 text-right">Balance</th><th className="py-1 pr-3">Status</th></tr></thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-b border-slate-100">
                    <td className="py-1 pr-3">{d.email || "—"}</td>
                    <td className="py-1 pr-3 text-right">${Number(d.balance).toFixed(2)}</td>
                    <td className="py-1 pr-3"><Badge tone={TONE[d.status]}>{d.status}</Badge></td>
                  </tr>
                ))}
                {deliveries.length === 0 && <tr><td colSpan={3} className="py-2 text-slate-400">No deliveries.</td></tr>}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
