"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { CodeCombination, FaAsset, ReserveStudy, ReserveVsActualRow, Structure } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

const TONE: Record<string, string> = { ACTIVE: "A", FULLY_DEPRECIATED: "O", DISPOSED: "L" };

export default function FixedAssetsPage() {
  const { token, activeTenantId } = useAuth();
  const [assets, setAssets] = useState<FaAsset[]>([]);
  const [studies, setStudies] = useState<ReserveStudy[]>([]);
  const [combos, setCombos] = useState<CodeCombination[]>([]);
  const [study, setStudy] = useState<ReserveStudy | null>(null);
  const [rva, setRva] = useState<ReserveVsActualRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<"" | "asset" | "dispose" | "study" | "component">("");
  const [disposeId, setDisposeId] = useState<string>("");
  const [depPeriod, setDepPeriod] = useState("JAN-2026");

  const [na, setNa] = useState({ name: "", cost: "", in_service_date: "2026-01-01", life_months: "60",
    salvage_value: "", category: "", fund_value: "RESV", asset_combination_id: "", accum_depr_combination_id: "", depr_expense_combination_id: "" });
  const [dp, setDp] = useState({ disposal_date: "2026-06-30", proceeds: "", cash_combination_id: "", gain_loss_combination_id: "" });
  const [ns, setNs] = useState({ name: "", study_year: "2026" });
  const [nc, setNc] = useState({ name: "", category: "", fund_value: "RESV", planned_year: "2027", planned_amount: "", replacement_cost: "" });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [a, s, structures] = await Promise.all([
        apiFetch<FaAsset[]>("/fixed-assets/assets", { token, tenantId: activeTenantId }),
        apiFetch<ReserveStudy[]>("/fixed-assets/reserve-studies", { token, tenantId: activeTenantId }),
        apiFetch<Structure[]>("/coa/structures", { token, tenantId: activeTenantId }),
      ]);
      setAssets(a); setStudies(s);
      if (structures[0]) setCombos(await apiFetch<CodeCombination[]>(
        `/coa/structures/${structures[0].id}/combinations`, { token, tenantId: activeTenantId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  function opt(c: CodeCombination) { return <option key={c.id} value={c.id}>{c.concatenated_segments}</option>; }

  async function save(path: string, body: unknown, reset: () => void, key: string) {
    setBusy(key); setError(null);
    try {
      await apiFetch(path, { method: "POST", token, tenantId: activeTenantId, body });
      setModal(""); reset(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(null); }
  }

  async function runDepreciation() {
    setBusy("dep"); setError(null);
    try {
      const r = await apiFetch<{ assets_depreciated: number; total: string }>(
        "/fixed-assets/depreciation/run", { method: "POST", token, tenantId: activeTenantId, body: { period_name: depPeriod } });
      setMsg(`Depreciation ${depPeriod}: ${r.assets_depreciated} assets, $${Number(r.total).toFixed(2)} (draft GL batch).`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Run failed"); }
    finally { setBusy(null); }
  }

  async function openStudy(s: ReserveStudy) {
    setStudy(s);
    setRva(await apiFetch<ReserveVsActualRow[]>(`/fixed-assets/reserve-studies/${s.id}/vs-actual`, { token, tenantId: activeTenantId }));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Fixed Assets & Reserve Studies</h1>
          <p className="text-sm text-slate-500">Asset register, straight-line depreciation, disposals, and reserve planning.</p>
        </div>
        <div className="flex gap-2">
          <Input value={depPeriod} onChange={(e) => setDepPeriod(e.target.value)} className="w-28" />
          <Button variant="secondary" onClick={runDepreciation} disabled={busy === "dep"}>{busy === "dep" ? "…" : "Run Depreciation"}</Button>
          <Button onClick={() => setModal("asset")}>+ Asset</Button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Asset Register ({assets.length})</h2>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => downloadFile("/fixed-assets/reports/register/export", token!, activeTenantId!, "asset_register.xlsx")}>Register xlsx</Button>
            <Button variant="secondary" onClick={() => downloadFile("/fixed-assets/reports/depreciation-forecast/export", token!, activeTenantId!, "depreciation_forecast.xlsx")}>Forecast xlsx</Button>
          </div>
        </div>
        {loading ? <Spinner /> : (
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
              <th className="py-1 pr-3">Asset #</th><th className="py-1 pr-3">Name</th><th className="py-1 pr-3">Fund</th>
              <th className="py-1 pr-3 text-right">Cost</th><th className="py-1 pr-3 text-right">Accum</th>
              <th className="py-1 pr-3 text-right">NBV</th><th className="py-1 pr-3">Status</th><th className="py-1 pr-3"></th></tr></thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id} className="border-b border-slate-100">
                  <td className="py-1 pr-3 font-mono">{a.asset_number}</td>
                  <td className="py-1 pr-3">{a.name}</td>
                  <td className="py-1 pr-3">{a.fund_value}</td>
                  <td className="py-1 pr-3 text-right">${Number(a.cost).toFixed(2)}</td>
                  <td className="py-1 pr-3 text-right text-slate-500">${Number(a.accumulated_depreciation).toFixed(2)}</td>
                  <td className="py-1 pr-3 text-right font-medium">${Number(a.net_book_value).toFixed(2)}</td>
                  <td className="py-1 pr-3"><Badge tone={TONE[a.status]}>{a.status}</Badge></td>
                  <td className="py-1 pr-3 text-right">
                    {a.status !== "DISPOSED" && (
                      <Button variant="secondary" onClick={() => { setDisposeId(a.id); setModal("dispose"); }}>Dispose</Button>
                    )}
                  </td>
                </tr>
              ))}
              {assets.length === 0 && <tr><td colSpan={8} className="py-2 text-slate-400">No assets yet.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Reserve Studies</h2>
            <Button variant="secondary" onClick={() => setModal("study")}>+ Study</Button>
          </div>
          {studies.map((s) => (
            <button key={s.id} onClick={() => openStudy(s)}
              className={`flex w-full items-center justify-between border-b border-slate-100 py-1 text-left text-sm ${study?.id === s.id ? "bg-brand-50" : ""}`}>
              <span>{s.name} <span className="text-xs text-slate-400">FY{s.study_year}</span></span>
              <Badge tone="A">{s.status}</Badge>
            </button>
          ))}
          {studies.length === 0 && <p className="text-xs text-slate-400">No studies yet.</p>}
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Planned vs Actual {study ? `· ${study.name}` : ""}</h2>
            {study && <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setModal("component")}>+ Component</Button>
              <Button variant="secondary" onClick={() => downloadFile(`/fixed-assets/reserve-studies/${study.id}/utilization/export`, token!, activeTenantId!, "reserve_utilization.xlsx")}>xlsx</Button>
            </div>}
          </div>
          {!study ? <p className="text-sm text-slate-400">Select a study.</p> : (
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-1 pr-3">Component</th><th className="py-1 pr-3">Yr</th>
                <th className="py-1 pr-3 text-right">Planned</th><th className="py-1 pr-3 text-right">Actual</th></tr></thead>
              <tbody>
                {rva.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1 pr-3">{r.component} <span className="text-xs text-slate-400">{r.fund_value}</span></td>
                    <td className="py-1 pr-3">{r.planned_year}</td>
                    <td className="py-1 pr-3 text-right">${Number(r.planned_amount).toFixed(2)}</td>
                    <td className="py-1 pr-3 text-right text-slate-500">${Number(r.actual).toFixed(2)}</td>
                  </tr>
                ))}
                {rva.length === 0 && <tr><td colSpan={4} className="py-2 text-slate-400">No components.</td></tr>}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Modal open={modal === "asset"} onClose={() => setModal("")} title="New Fixed Asset">
        <form onSubmit={(e) => { e.preventDefault(); save("/fixed-assets/assets", {
          name: na.name, cost: na.cost, in_service_date: na.in_service_date, life_months: Number(na.life_months),
          salvage_value: na.salvage_value || "0", category: na.category || undefined, fund_value: na.fund_value,
          asset_combination_id: na.asset_combination_id, accum_depr_combination_id: na.accum_depr_combination_id || undefined,
          depr_expense_combination_id: na.depr_expense_combination_id || undefined },
          () => setNa({ ...na, name: "", cost: "", salvage_value: "", category: "", asset_combination_id: "", accum_depr_combination_id: "", depr_expense_combination_id: "" }), "asset"); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Name</Label><Input value={na.name} onChange={(e) => setNa({ ...na, name: e.target.value })} required /></div>
            <div><Label>Category</Label><Input value={na.category} onChange={(e) => setNa({ ...na, category: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Cost</Label><Input type="number" step="0.01" value={na.cost} onChange={(e) => setNa({ ...na, cost: e.target.value })} required /></div>
            <div><Label>Salvage</Label><Input type="number" step="0.01" value={na.salvage_value} onChange={(e) => setNa({ ...na, salvage_value: e.target.value })} /></div>
            <div><Label>Life (months)</Label><Input type="number" value={na.life_months} onChange={(e) => setNa({ ...na, life_months: e.target.value })} required /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>In service</Label><Input type="date" value={na.in_service_date} onChange={(e) => setNa({ ...na, in_service_date: e.target.value })} required /></div>
            <div><Label>Fund</Label><Select value={na.fund_value} onChange={(e) => setNa({ ...na, fund_value: e.target.value })}><option>RESV</option><option>OPER</option></Select></div>
          </div>
          <div><Label>Asset cost account</Label><Select value={na.asset_combination_id} onChange={(e) => setNa({ ...na, asset_combination_id: e.target.value })} required><option value="">Select…</option>{combos.map(opt)}</Select></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Accum. depreciation acct</Label><Select value={na.accum_depr_combination_id} onChange={(e) => setNa({ ...na, accum_depr_combination_id: e.target.value })}><option value="">—</option>{combos.map(opt)}</Select></div>
            <div><Label>Depreciation expense acct</Label><Select value={na.depr_expense_combination_id} onChange={(e) => setNa({ ...na, depr_expense_combination_id: e.target.value })}><option value="">—</option>{combos.map(opt)}</Select></div>
          </div>
          <p className="text-xs text-slate-400">Depreciation accounts are required to post monthly depreciation to the GL.</p>
          <Button type="submit" disabled={busy === "asset"}>{busy === "asset" ? "Saving…" : "Create Asset"}</Button>
        </form>
      </Modal>

      <Modal open={modal === "dispose"} onClose={() => setModal("")} title="Dispose Asset">
        <form onSubmit={(e) => { e.preventDefault(); save(`/fixed-assets/assets/${disposeId}/dispose`, {
          disposal_date: dp.disposal_date, proceeds: dp.proceeds || "0",
          cash_combination_id: dp.cash_combination_id || undefined,
          gain_loss_combination_id: dp.gain_loss_combination_id || undefined },
          () => setDp({ disposal_date: "2026-06-30", proceeds: "", cash_combination_id: "", gain_loss_combination_id: "" }), "dispose"); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Disposal date</Label><Input type="date" value={dp.disposal_date} onChange={(e) => setDp({ ...dp, disposal_date: e.target.value })} required /></div>
            <div><Label>Proceeds</Label><Input type="number" step="0.01" value={dp.proceeds} onChange={(e) => setDp({ ...dp, proceeds: e.target.value })} /></div>
          </div>
          <div><Label>Cash account (if proceeds)</Label><Select value={dp.cash_combination_id} onChange={(e) => setDp({ ...dp, cash_combination_id: e.target.value })}><option value="">—</option>{combos.map(opt)}</Select></div>
          <div><Label>Gain/Loss account</Label><Select value={dp.gain_loss_combination_id} onChange={(e) => setDp({ ...dp, gain_loss_combination_id: e.target.value })}><option value="">—</option>{combos.map(opt)}</Select></div>
          <Button type="submit" disabled={busy === "dispose"}>{busy === "dispose" ? "…" : "Dispose (draft GL batch)"}</Button>
        </form>
      </Modal>

      <Modal open={modal === "study"} onClose={() => setModal("")} title="New Reserve Study">
        <form onSubmit={(e) => { e.preventDefault(); save("/fixed-assets/reserve-studies", {
          name: ns.name, study_year: Number(ns.study_year) }, () => setNs({ name: "", study_year: "2026" }), "study"); }} className="space-y-3">
          <div><Label>Name</Label><Input value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} required /></div>
          <div><Label>Study year</Label><Input type="number" value={ns.study_year} onChange={(e) => setNs({ ...ns, study_year: e.target.value })} required /></div>
          <Button type="submit" disabled={busy === "study"}>{busy === "study" ? "Saving…" : "Create"}</Button>
        </form>
      </Modal>

      <Modal open={modal === "component"} onClose={() => setModal("")} title="New Reserve Component">
        <form onSubmit={(e) => { e.preventDefault(); if (!study) return; save(`/fixed-assets/reserve-studies/${study.id}/components`, {
          name: nc.name, category: nc.category || undefined, fund_value: nc.fund_value,
          planned_year: Number(nc.planned_year), planned_amount: nc.planned_amount || "0",
          replacement_cost: nc.replacement_cost || "0" },
          () => { setNc({ name: "", category: "", fund_value: "RESV", planned_year: "2027", planned_amount: "", replacement_cost: "" }); openStudy(study); }, "component"); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Component</Label><Input value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} required placeholder="Roof" /></div>
            <div><Label>Category</Label><Input value={nc.category} onChange={(e) => setNc({ ...nc, category: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Fund</Label><Select value={nc.fund_value} onChange={(e) => setNc({ ...nc, fund_value: e.target.value })}><option>RESV</option><option>OPER</option></Select></div>
            <div><Label>Planned year</Label><Input type="number" value={nc.planned_year} onChange={(e) => setNc({ ...nc, planned_year: e.target.value })} /></div>
            <div><Label>Planned $</Label><Input type="number" step="0.01" value={nc.planned_amount} onChange={(e) => setNc({ ...nc, planned_amount: e.target.value })} /></div>
          </div>
          <Button type="submit" disabled={busy === "component"}>{busy === "component" ? "Saving…" : "Add Component"}</Button>
        </form>
      </Modal>
    </div>
  );
}
