"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import { Alert, Badge, Button, Card, Spinner } from "@/components/ui";

interface ChecklistItem { code: string; title: string; category: string; status: string; detail: string; manual: boolean; }
interface Checklist {
  health: Record<string, unknown>;
  items: ChecklistItem[];
  summary: Record<string, number>;
  go_live_ready: boolean;
}

const TONE: Record<string, string> = { PASS: "A", WARN: "O", FAIL: "R", INFO: "none" };

interface GoLiveStatus { is_live: boolean; went_live_at: string | null; last_validation_at: string | null; last_validation_passed: boolean; }
interface ValidationCheck { check: string; ok: boolean; detail: string; }
interface RotationStep { code: string; title: string; instructions: string; status: string; notes: string | null; }

export default function GoLivePage() {
  const { token, activeTenantId } = useAuth();
  const [data, setData] = useState<Checklist | null>(null);
  const [status, setStatus] = useState<GoLiveStatus | null>(null);
  const [validation, setValidation] = useState<ValidationCheck[] | null>(null);
  const [guide, setGuide] = useState<RotationStep[]>([]);
  const [ready, setReady] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [cl, st, g] = await Promise.all([
        apiFetch<Checklist>("/compliance/checklist", { token, tenantId: activeTenantId }),
        apiFetch<GoLiveStatus>("/compliance/go-live/status", { token, tenantId: activeTenantId }).catch(() => null),
        apiFetch<RotationStep[]>("/compliance/cutover/guide", { token, tenantId: activeTenantId }).catch(() => []),
      ]);
      setData(cl); setStatus(st); setGuide(g);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  async function exec(action: string, path: string, method = "POST") {
    setBusy(action); setError(null); setMsg(null);
    try {
      const r = await apiFetch<Record<string, unknown>>(path, { method, token, tenantId: activeTenantId });
      if (action === "validate") setValidation((r as { checks: ValidationCheck[] }).checks);
      if (action === "backup") setMsg(`Backup: ${r.status} ${r.filename ? `(${r.filename})` : ""}`);
      if (action === "activate") setMsg("Go-Live activated.");
      if (action === "deactivate") setMsg("Go-Live deactivated.");
      if (action === "cutover") {
        setValidation((r as { checks: ValidationCheck[] }).checks);
        setReady(Boolean((r as { production_ready: boolean }).production_ready));
        setMsg(`Cutover: validation ${(r as { validation_passed: boolean }).validation_passed ? "PASSED" : "FAILED"}, backup ${(r as { backup: { status: string } }).backup.status}.`);
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : `${action} failed`); }
    finally { setBusy(null); }
  }

  async function rotate(code: string) {
    setBusy(code); setError(null); setMsg(null);
    try {
      await apiFetch(`/compliance/go-live/rotate/${code}`, { method: "POST", token, tenantId: activeTenantId });
      setMsg(`Recorded rotation: ${code}.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Rotation failed"); }
    finally { setBusy(null); }
  }

  async function setItem(code: string, status: string) {
    setBusy(code); setError(null);
    try {
      await apiFetch(`/compliance/items/${code}`, { method: "PUT", token, tenantId: activeTenantId, body: { status } });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Update failed"); }
    finally { setBusy(null); }
  }

  const HEALTH_LABELS: Record<string, string> = {
    gl_posted_batches: "Posted GL batches", gl_unbalanced_batches: "Unbalanced batches",
    open_periods: "Open periods", closed_periods: "Closed periods",
    budget_control_mode: "Budget control", ap_open_holds: "AP invoices on hold",
    unreconciled_statements: "Unreconciled statements", active_assets: "Active fixed assets",
    coa_structures: "COA structures", vendors: "Vendors", audit_events: "Audit events",
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Go-Live & Compliance</h1>
          <p className="text-sm text-slate-500">System health, readiness checklist, and compliance package.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => downloadFile("/compliance/package/export", token!, activeTenantId!, "go_live_package.xlsx")}>Package xlsx</Button>
          <Button variant="secondary" onClick={() => downloadFile("/compliance/go-live/execution-report/export", token!, activeTenantId!, "go_live_execution.xlsx")}>Execution xlsx</Button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      {loading || !data ? <Spinner /> : (
        <>
          <Card>
            <div className="flex flex-wrap items-center gap-4">
              <div className={`rounded-lg px-4 py-2 text-sm font-bold ${data.go_live_ready ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {data.go_live_ready ? "✓ Go-Live Ready" : "⚠ Not yet ready"}
              </div>
              {(["PASS", "WARN", "FAIL", "INFO"] as const).map((s) => (
                <span key={s} className="text-sm text-slate-600">
                  <Badge tone={TONE[s]}>{s}</Badge> {data.summary[s] || 0}
                </span>
              ))}
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-700">Execution</h2>
              <span className="text-sm">
                Status: <Badge tone={status?.is_live ? "A" : "none"}>{status?.is_live ? "LIVE" : "NOT LIVE"}</Badge>
                {status?.last_validation_at && (
                  <span className="ml-2 text-xs text-slate-400">
                    last validated {new Date(status.last_validation_at).toLocaleString()} ·{" "}
                    {status.last_validation_passed ? "passed" : "failed"}
                  </span>
                )}
              </span>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => exec("validate", "/compliance/go-live/validate")} disabled={busy === "validate"}>Validate</Button>
                <Button variant="secondary" onClick={() => exec("backup", "/compliance/go-live/backup")} disabled={busy === "backup"}>Run Backup</Button>
                {status?.is_live ? (
                  <Button variant="secondary" onClick={() => exec("deactivate", "/compliance/go-live/deactivate")} disabled={busy === "deactivate"}>Deactivate</Button>
                ) : (
                  <Button onClick={() => exec("activate", "/compliance/go-live/activate")} disabled={busy === "activate"}>Activate Go-Live</Button>
                )}
              </div>
            </div>
            {validation && (
              <div className="mt-3 space-y-1">
                {validation.map((c) => (
                  <div key={c.check} className="flex items-center justify-between border-b border-slate-100 py-1 text-sm">
                    <span>{c.check} <span className="text-xs text-slate-400">{c.detail}</span></span>
                    <Badge tone={c.ok ? "A" : "R"}>{c.ok ? "PASS" : "FAIL"}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold text-slate-700">Production Cutover</h2>
              {ready !== null && <Badge tone={ready ? "A" : "R"}>{ready ? "PRODUCTION READY" : "NOT READY"}</Badge>}
              <div className="ml-auto flex gap-2">
                <Button onClick={() => exec("cutover", "/compliance/cutover/execute")} disabled={busy === "cutover"}>
                  {busy === "cutover" ? "Running…" : "Execute cutover"}
                </Button>
                <Button variant="secondary" onClick={() => downloadFile("/compliance/cutover/report/export", token!, activeTenantId!, "cutover_report.xlsx")}>Cutover report</Button>
              </div>
            </div>
            <p className="mb-2 text-xs text-slate-400">
              Execute runs final validation + a fresh backup. Complete the key rotations below, then
              activate Go-Live (Execution panel) to reach Production Ready.
            </p>
            {guide.map((g) => (
              <div key={g.code} className="border-t border-slate-100 py-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">{g.title}</span>
                  {g.status === "DONE"
                    ? <Badge tone="A">rotated</Badge>
                    : <Button variant="secondary" onClick={() => rotate(g.code)} disabled={busy === g.code}>Mark rotated</Button>}
                </div>
                <p className="mt-1 text-xs text-slate-500">{g.instructions}</p>
              </div>
            ))}
          </Card>

          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <Card>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Checklist</h2>
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                  <th className="py-1 pr-3">Item</th><th className="py-1 pr-3">Category</th>
                  <th className="py-1 pr-3">Status</th><th className="py-1 pr-3 text-right">Action</th></tr></thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr key={it.code} className="border-b border-slate-100">
                      <td className="py-1.5 pr-3">{it.title}<div className="text-xs text-slate-400">{it.detail}</div></td>
                      <td className="py-1.5 pr-3 text-xs">{it.category}</td>
                      <td className="py-1.5 pr-3"><Badge tone={TONE[it.status]}>{it.status}</Badge></td>
                      <td className="py-1.5 pr-3 text-right">
                        {it.manual && (
                          <div className="flex justify-end gap-1">
                            <Button variant="secondary" onClick={() => setItem(it.code, "DONE")} disabled={busy === it.code}>Done</Button>
                            <Button variant="secondary" onClick={() => setItem(it.code, "NA")} disabled={busy === it.code}>N/A</Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <Card>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">System Health</h2>
              {Object.entries(HEALTH_LABELS).map(([k, label]) => (
                <div key={k} className="flex items-center justify-between border-b border-slate-100 py-1 text-sm">
                  <span className="text-slate-600">{label}</span>
                  <span className="font-medium">{String(data.health[k])}</span>
                </div>
              ))}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
