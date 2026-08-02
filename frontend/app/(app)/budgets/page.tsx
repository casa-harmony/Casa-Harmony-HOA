"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { BudgetControl, BudgetVersion, BudgetVersionDetail, BvARow, CodeCombination, Structure } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

const TONE: Record<string, string> = { DRAFT: "none", SUBMITTED: "O", APPROVED: "A", REJECTED: "L" };

export default function BudgetsPage() {
  const { token, activeTenantId } = useAuth();
  const [versions, setVersions] = useState<BudgetVersion[]>([]);
  const [control, setControl] = useState<BudgetControl | null>(null);
  const [combos, setCombos] = useState<CodeCombination[]>([]);
  const [sel, setSel] = useState<BudgetVersionDetail | null>(null);
  const [bva, setBva] = useState<BvARow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<"" | "version" | "spread">("");
  const [nv, setNv] = useState({ name: "", fiscal_year: "2026", version_type: "ORIGINAL" });
  const [sp, setSp] = useState({ code_combination_id: "", annual_amount: "" });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [vs, ctl, structures] = await Promise.all([
        apiFetch<BudgetVersion[]>("/budgeting/versions", { token, tenantId: activeTenantId }),
        apiFetch<BudgetControl>("/budgeting/control", { token, tenantId: activeTenantId }).catch(() => null),
        apiFetch<Structure[]>("/coa/structures", { token, tenantId: activeTenantId }),
      ]);
      setVersions(vs); setControl(ctl);
      if (structures[0]) setCombos(await apiFetch<CodeCombination[]>(
        `/coa/structures/${structures[0].id}/combinations`, { token, tenantId: activeTenantId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  async function openVersion(id: string) {
    const [d, rows] = await Promise.all([
      apiFetch<BudgetVersionDetail>(`/budgeting/versions/${id}`, { token, tenantId: activeTenantId }),
      apiFetch<BvARow[]>(`/budgeting/versions/${id}/vs-actual`, { token, tenantId: activeTenantId }).catch(() => []),
    ]);
    setSel(d); setBva(rows);
  }

  async function createVersion(e: React.FormEvent) {
    e.preventDefault(); setBusy("version"); setError(null);
    try {
      const v = await apiFetch<BudgetVersion>("/budgeting/versions", {
        method: "POST", token, tenantId: activeTenantId,
        body: { name: nv.name, fiscal_year: Number(nv.fiscal_year), version_type: nv.version_type } });
      setModal(""); setNv({ name: "", fiscal_year: "2026", version_type: "ORIGINAL" });
      await load(); await openVersion(v.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Create failed"); }
    finally { setBusy(null); }
  }

  async function doSpread(e: React.FormEvent) {
    e.preventDefault(); if (!sel) return;
    setBusy("spread"); setError(null);
    try {
      await apiFetch(`/budgeting/versions/${sel.id}/spread`, { method: "POST", token, tenantId: activeTenantId,
        body: { code_combination_id: sp.code_combination_id, annual_amount: sp.annual_amount, method: "EVEN" } });
      setModal(""); setSp({ code_combination_id: "", annual_amount: "" });
      await openVersion(sel.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Spread failed"); }
    finally { setBusy(null); }
  }

  async function versionAction(verb: "submit" | "approve") {
    if (!sel) return;
    setBusy(verb); setError(null);
    try {
      const body = verb === "approve" ? { approve: true, make_controlling: true } : undefined;
      await apiFetch(`/budgeting/versions/${sel.id}/${verb}`, { method: "POST", token, tenantId: activeTenantId, body });
      setMsg(verb === "approve" ? "Version approved & set controlling." : "Version submitted.");
      await load(); await openVersion(sel.id);
    } catch (e) { setError(e instanceof Error ? e.message : `${verb} failed`); }
    finally { setBusy(null); }
  }

  async function saveControl(mode: string, versionId: string | null) {
    setBusy("control"); setError(null);
    try {
      const c = await apiFetch<BudgetControl>("/budgeting/control", { method: "PUT", token, tenantId: activeTenantId,
        body: { mode, controlling_version_id: versionId } });
      setControl(c); setMsg(`Budgetary control set to ${mode}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Control update failed"); }
    finally { setBusy(null); }
  }

  const acct = (id: string) => combos.find((c) => c.id === id)?.concatenated_segments || id.slice(0, 8);
  // Aggregate selected version lines to annual per combination for display.
  const annual: Record<string, number> = {};
  (sel?.lines || []).forEach((l) => { annual[l.code_combination_id] = (annual[l.code_combination_id] || 0) + Number(l.amount); });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Budgets</h1>
          <p className="text-sm text-slate-500">Versions, period spread, approval, and budgetary control.</p>
        </div>
        <Button onClick={() => setModal("version")}>+ New Version</Button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Budgetary Control</h2>
        {control && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label>Mode</Label>
              <Select value={control.mode} onChange={(e) => saveControl(e.target.value, control.controlling_version_id)}>
                {["NONE", "ADVISORY", "ABSOLUTE"].map((m) => <option key={m}>{m}</option>)}
              </Select>
            </div>
            <div>
              <Label>Controlling version</Label>
              <Select value={control.controlling_version_id || ""} onChange={(e) => saveControl(control.mode, e.target.value || null)}>
                <option value="">—</option>
                {versions.filter((v) => v.status === "APPROVED").map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </div>
            <p className="text-xs text-slate-400">ADVISORY flags the Board on overage; ABSOLUTE blocks over-budget PO approval.</p>
          </div>
        )}
      </Card>

      {loading ? <Spinner /> : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Versions</h2>
            {versions.map((v) => (
              <button key={v.id} onClick={() => openVersion(v.id)}
                className={`flex w-full items-center justify-between border-b border-slate-100 py-2 text-left text-sm ${sel?.id === v.id ? "bg-brand-50" : ""}`}>
                <span>{v.name} <span className="text-xs text-slate-400">FY{v.fiscal_year} · {v.version_type}</span></span>
                <span className="flex items-center gap-1">
                  {v.is_controlling && <Badge tone="A">ctrl</Badge>}
                  <Badge tone={TONE[v.status]}>{v.status}</Badge>
                </span>
              </button>
            ))}
            {versions.length === 0 && <p className="text-xs text-slate-400">No versions yet.</p>}
          </Card>

          <Card>
            {!sel ? <p className="text-sm text-slate-400">Select a version.</p> : (
              <>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-700">{sel.name} <Badge tone={TONE[sel.status]}>{sel.status}</Badge></h2>
                  <div className="flex gap-2">
                    {sel.status === "DRAFT" && <Button variant="secondary" onClick={() => setModal("spread")}>+ Line</Button>}
                    {sel.status === "DRAFT" && <Button variant="secondary" onClick={() => versionAction("submit")} disabled={busy === "submit"}>Submit</Button>}
                    {sel.status === "SUBMITTED" && <Button variant="secondary" onClick={() => versionAction("approve")} disabled={busy === "approve"}>Approve</Button>}
                    <Button variant="secondary" onClick={() => downloadFile(`/budgeting/versions/${sel.id}/spread/export`, token!, activeTenantId!, "budget_spread.xlsx")}>Spread xlsx</Button>
                    <Button variant="secondary" onClick={() => downloadFile(`/budgeting/versions/${sel.id}/vs-actual/export`, token!, activeTenantId!, "budget_vs_actual.xlsx")}>BvA xlsx</Button>
                  </div>
                </div>
                <table className="w-full text-left text-sm">
                  <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                    <th className="py-1 pr-3">Account</th><th className="py-1 pr-3">Fund</th>
                    <th className="py-1 pr-3 text-right">Annual budget</th><th className="py-1 pr-3 text-right">Actual</th>
                    <th className="py-1 pr-3 text-right">Variance</th></tr></thead>
                  <tbody>
                    {bva.map((r) => (
                      <tr key={r.code_combination_id} className="border-b border-slate-100">
                        <td className="py-1 pr-3">{r.account}</td>
                        <td className="py-1 pr-3">{r.fund_value}</td>
                        <td className="py-1 pr-3 text-right">${Number(r.budget).toFixed(2)}</td>
                        <td className="py-1 pr-3 text-right text-slate-500">${Number(r.actual).toFixed(2)}</td>
                        <td className={`py-1 pr-3 text-right font-medium ${Number(r.variance) < 0 ? "text-rose-600" : "text-emerald-600"}`}>${Number(r.variance).toFixed(2)}</td>
                      </tr>
                    ))}
                    {bva.length === 0 && Object.keys(annual).length === 0 && (
                      <tr><td colSpan={5} className="py-2 text-slate-400">No budget lines. Add lines with “+ Line”.</td></tr>
                    )}
                  </tbody>
                </table>
              </>
            )}
          </Card>
        </div>
      )}

      <Modal open={modal === "version"} onClose={() => setModal("")} title="New Budget Version">
        <form onSubmit={createVersion} className="space-y-3">
          <div><Label>Name</Label><Input value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} required placeholder="FY2026 Operating" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Fiscal year</Label><Input type="number" value={nv.fiscal_year} onChange={(e) => setNv({ ...nv, fiscal_year: e.target.value })} required /></div>
            <div>
              <Label>Type</Label>
              <Select value={nv.version_type} onChange={(e) => setNv({ ...nv, version_type: e.target.value })}>
                {["ORIGINAL", "REVISED", "RESERVE", "SPECIAL", "FORECAST"].map((t) => <option key={t}>{t}</option>)}
              </Select>
            </div>
          </div>
          <Button type="submit" disabled={busy === "version"}>{busy === "version" ? "Creating…" : "Create"}</Button>
        </form>
      </Modal>

      <Modal open={modal === "spread"} onClose={() => setModal("")} title="Add Budget Line (spread evenly)">
        <form onSubmit={doSpread} className="space-y-3">
          <div>
            <Label>Account (KFF)</Label>
            <Select value={sp.code_combination_id} onChange={(e) => setSp({ ...sp, code_combination_id: e.target.value })} required>
              <option value="">Select…</option>
              {combos.map((c) => <option key={c.id} value={c.id}>{c.concatenated_segments}</option>)}
            </Select>
          </div>
          <div><Label>Annual amount</Label><Input type="number" step="0.01" value={sp.annual_amount} onChange={(e) => setSp({ ...sp, annual_amount: e.target.value })} required /></div>
          <p className="text-xs text-slate-400">Spread evenly across 12 periods (last absorbs rounding).</p>
          <Button type="submit" disabled={busy === "spread"}>{busy === "spread" ? "Saving…" : "Add Line"}</Button>
        </form>
      </Modal>
    </div>
  );
}
