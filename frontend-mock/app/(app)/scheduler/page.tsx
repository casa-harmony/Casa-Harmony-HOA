"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch } from "@/lib/api";
import type { JobRun, SchedulerConfig } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Spinner } from "@/components/ui";

export default function SchedulerPage() {
  const { token, activeTenantId } = useAuth();
  const [cfg, setCfg] = useState<SchedulerConfig | null>(null);
  const [info, setInfo] = useState<{ mode: string; in_process_enabled: boolean } | null>(null);
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [c, r, i] = await Promise.all([
        apiFetch<SchedulerConfig>("/scheduler/config", { token, tenantId: activeTenantId }),
        apiFetch<JobRun[]>("/scheduler/runs", { token, tenantId: activeTenantId }),
        apiFetch<{ mode: string; in_process_enabled: boolean }>("/scheduler/info", { token, tenantId: activeTenantId }).catch(() => null),
      ]);
      setCfg(c); setRuns(r); setInfo(i); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!cfg) return;
    setBusy("save"); setError(null); setMsg(null);
    try {
      const c = await apiFetch<SchedulerConfig>("/scheduler/config", {
        method: "PUT", token, tenantId: activeTenantId, body: {
          monthly_statements_enabled: cfg.monthly_statements_enabled,
          board_packet_enabled: cfg.board_packet_enabled, day_of_month: cfg.day_of_month,
          attach_statement_pdf: cfg.attach_statement_pdf, attach_board_pdf: cfg.attach_board_pdf } });
      setCfg(c); setMsg("Schedule saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(null); }
  }

  async function trigger(job: string) {
    setBusy(job); setError(null); setMsg(null);
    try {
      const r = await apiFetch<{ status: string; summary: string }>(`/scheduler/run/${job}`, { method: "POST", token, tenantId: activeTenantId });
      setMsg(`${job}: ${r.status} — ${r.summary}`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Trigger failed"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Scheduled Jobs</h1>
        <p className="text-sm text-slate-500">
          Monthly AR statements, board packets, and daily dunning — auto-run + manual triggers.
          {info && <> Mode: <span className="font-semibold">{info.mode === "celery" ? "Celery Beat (HA)" : "in-process"}</span>.</>}
        </p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      {loading ? <Spinner /> : cfg && (
        <>
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Monthly schedule</h2>
            <form onSubmit={save} className="flex flex-wrap items-end gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cfg.monthly_statements_enabled}
                  onChange={(e) => setCfg({ ...cfg, monthly_statements_enabled: e.target.checked })} /> Email AR statements
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cfg.board_packet_enabled}
                  onChange={(e) => setCfg({ ...cfg, board_packet_enabled: e.target.checked })} /> Email board packet
              </label>
              <div><Label>Day of month</Label><Input type="number" min={1} max={28} value={cfg.day_of_month}
                onChange={(e) => setCfg({ ...cfg, day_of_month: Number(e.target.value) })} className="w-20" /></div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cfg.attach_statement_pdf}
                  onChange={(e) => setCfg({ ...cfg, attach_statement_pdf: e.target.checked })} /> Attach statement PDF
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cfg.attach_board_pdf}
                  onChange={(e) => setCfg({ ...cfg, attach_board_pdf: e.target.checked })} /> Attach board packet PDF
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={cfg.dunning_enabled}
                  onChange={(e) => setCfg({ ...cfg, dunning_enabled: e.target.checked })} /> Daily dunning sweep
              </label>
              <Button type="submit" disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save"}</Button>
            </form>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" onClick={() => trigger("statements")} disabled={busy === "statements"}>Run statements now</Button>
              <Button variant="secondary" onClick={() => trigger("board-packet")} disabled={busy === "board-packet"}>Run board packet now</Button>
            </div>
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Run history</h2>
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-1 pr-3">Job</th><th className="py-1 pr-3">Trigger</th>
                <th className="py-1 pr-3">Status</th><th className="py-1 pr-3">Summary</th>
                <th className="py-1 pr-3">When</th></tr></thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-slate-100">
                    <td className="py-1 pr-3 font-medium">{r.job_name}</td>
                    <td className="py-1 pr-3 text-xs text-slate-500">{r.trigger}</td>
                    <td className="py-1 pr-3"><Badge tone={r.status === "SUCCESS" ? "A" : "R"}>{r.status}</Badge></td>
                    <td className="py-1 pr-3 text-xs">{r.summary}</td>
                    <td className="py-1 pr-3 text-xs">{r.finished_at ? new Date(r.finished_at).toLocaleString() : "—"}</td>
                  </tr>
                ))}
                {runs.length === 0 && <tr><td colSpan={5} className="py-2 text-slate-400">No runs yet.</td></tr>}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
