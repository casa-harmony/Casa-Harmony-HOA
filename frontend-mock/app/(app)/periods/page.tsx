"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { AccountingPeriod } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Spinner } from "@/components/ui";

const TONE: Record<string, string> = { OPEN: "A", CLOSED: "L", FUTURE: "O" };
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export default function PeriodsPage() {
  const { token, activeTenantId } = useAuth();
  const [periods, setPeriods] = useState<AccountingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newPeriod, setNewPeriod] = useState({ month: "JAN", year: "2026" });
  const [yearEnd, setYearEnd] = useState({ year: "2026", re: "3000" });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      setPeriods(await apiFetch<AccountingPeriod[]>("/periods", { token, tenantId: activeTenantId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  async function act(period: string, verb: "open" | "close" | "reopen") {
    setBusy(period + verb); setError(null); setMsg(null);
    try {
      await apiFetch(`/periods/${period}/${verb}`, { method: "POST", token, tenantId: activeTenantId });
      setMsg(`${period} ${verb === "close" ? "closed" : "opened"}.`); await load();
    } catch (e) { setError(e instanceof Error ? e.message : `${verb} failed`); }
    finally { setBusy(null); }
  }

  async function yearEndClose() {
    setBusy("yearend"); setError(null); setMsg(null);
    try {
      const r = await apiFetch<{ batch_name: string; control_total_dr: string }>(
        `/periods/year-end-close?year=${yearEnd.year}&retained_earnings_natural=${yearEnd.re}`,
        { method: "POST", token, tenantId: activeTenantId });
      setMsg(`Year-end draft batch created: ${r.batch_name} ($${Number(r.control_total_dr).toFixed(2)}). Review & post in GL.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Year-end close failed"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Period Close & GL Lock-Down</h1>
        <p className="text-sm text-slate-500">Open/close accounting periods. Closed periods reject posting.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label>Open / create period</Label>
            <div className="flex gap-2">
              <select className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                value={newPeriod.month} onChange={(e) => setNewPeriod({ ...newPeriod, month: e.target.value })}>
                {MONTHS.map((m) => <option key={m}>{m}</option>)}
              </select>
              <Input className="w-24" value={newPeriod.year} onChange={(e) => setNewPeriod({ ...newPeriod, year: e.target.value })} />
              <Button variant="secondary" onClick={() => act(`${newPeriod.month}-${newPeriod.year}`, "open")}
                disabled={busy !== null}>Open</Button>
            </div>
          </div>
          <div className="ml-auto flex items-end gap-2">
            <div>
              <Label>Year-end close</Label>
              <div className="flex gap-2">
                <Input className="w-24" value={yearEnd.year} onChange={(e) => setYearEnd({ ...yearEnd, year: e.target.value })} />
                <Input className="w-20" title="Retained earnings natural account" value={yearEnd.re}
                  onChange={(e) => setYearEnd({ ...yearEnd, re: e.target.value })} />
                <Button variant="secondary" onClick={yearEndClose} disabled={busy === "yearend"}>Roll forward</Button>
              </div>
            </div>
            <Button variant="secondary" onClick={() => downloadFile("/periods/checklist/export", token!, activeTenantId!, "period_close_checklist.xlsx")}>Checklist xlsx</Button>
          </div>
        </div>
      </Card>

      <Card>
        {loading ? <Spinner /> : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-2 pr-3">Period</th><th className="py-2 pr-3">Window</th>
                <th className="py-2 pr-3">Status</th><th className="py-2 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono">{p.period_name}</td>
                  <td className="py-2 pr-3 text-slate-500">{p.start_date} → {p.end_date}</td>
                  <td className="py-2 pr-3"><Badge tone={TONE[p.status]}>{p.status}</Badge></td>
                  <td className="py-2 pr-3">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => downloadFile(`/periods/${p.period_name}/trial-balance/export`, token!, activeTenantId!, `tb_${p.period_name}.xlsx`)}>TB</Button>
                      {p.status !== "CLOSED" ? (
                        <Button variant="secondary" onClick={() => act(p.period_name, "close")} disabled={busy !== null}>Close</Button>
                      ) : (
                        <Button variant="secondary" onClick={() => act(p.period_name, "reopen")} disabled={busy !== null}>Reopen</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {periods.length === 0 && (
                <tr><td colSpan={4} className="py-3 text-slate-400">No periods opened yet. Periods are implicitly open until closed.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
