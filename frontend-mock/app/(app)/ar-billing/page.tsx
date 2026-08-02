"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { BillingPlan, CodeCombination, LateFeeRule, Structure } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

type Line = { income_combination_id: string; amount: string; department: string };

export default function ArBillingPage() {
  const { token, activeTenantId } = useAuth();
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [rule, setRule] = useState<LateFeeRule | null>(null);
  const [combos, setCombos] = useState<CodeCombination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<"" | "plan" | "run">("");
  const [runPlan, setRunPlan] = useState<BillingPlan | null>(null);
  const [np, setNp] = useState<{ name: string; plan_type: string; lines: Line[] }>({
    name: "", plan_type: "MONTHLY_FEE", lines: [{ income_combination_id: "", amount: "", department: "" }] });
  const [run, setRun] = useState({ invoice_date: "2026-07-01", due_days: "30", installments: "1" });
  const [reg, setReg] = useState({ start: "2026-01-01", end: "2026-12-31", late_as_of: "2026-08-31" });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [pl, lr, structures] = await Promise.all([
        apiFetch<BillingPlan[]>("/ar-billing/plans", { token, tenantId: activeTenantId }),
        apiFetch<LateFeeRule>("/ar-billing/late-fee-rule", { token, tenantId: activeTenantId }).catch(() => null),
        apiFetch<Structure[]>("/coa/structures", { token, tenantId: activeTenantId }),
      ]);
      setPlans(pl); setRule(lr);
      if (structures[0]) setCombos(await apiFetch<CodeCombination[]>(
        `/coa/structures/${structures[0].id}/combinations`, { token, tenantId: activeTenantId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  const incomeCombos = combos.filter((c) => (c.natural_account_value || "").startsWith("4"));

  async function createPlan(e: React.FormEvent) {
    e.preventDefault(); setBusy("plan"); setError(null);
    try {
      await apiFetch("/ar-billing/plans", { method: "POST", token, tenantId: activeTenantId, body: {
        name: np.name, plan_type: np.plan_type,
        lines: np.lines.filter((l) => l.income_combination_id && l.amount).map((l) => ({
          income_combination_id: l.income_combination_id, amount: l.amount, department: l.department || undefined })) } });
      setModal(""); setNp({ name: "", plan_type: "MONTHLY_FEE", lines: [{ income_combination_id: "", amount: "", department: "" }] });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Create failed"); }
    finally { setBusy(null); }
  }

  async function doRun(e: React.FormEvent) {
    e.preventDefault(); if (!runPlan) return;
    setBusy("run"); setError(null);
    try {
      const r = await apiFetch<{ invoices_created: number; total_billed: string }>(
        `/ar-billing/plans/${runPlan.id}/run`, { method: "POST", token, tenantId: activeTenantId, body: {
          invoice_date: run.invoice_date, due_days: Number(run.due_days), installments: Number(run.installments) } });
      setModal(""); setMsg(`Billed ${r.invoices_created} invoice(s), $${Number(r.total_billed).toFixed(2)}.`);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Run failed"); }
    finally { setBusy(null); }
  }

  async function saveRule(e: React.FormEvent) {
    e.preventDefault(); if (!rule) return;
    setBusy("rule"); setError(null);
    try {
      const r = await apiFetch<LateFeeRule>("/ar-billing/late-fee-rule", { method: "PUT", token, tenantId: activeTenantId, body: {
        active: rule.active, grace_days: rule.grace_days, fee_type: rule.fee_type,
        flat_amount: rule.flat_amount || "0", percent: rule.percent || "0",
        fund_value: rule.fund_value, income_combination_id: rule.income_combination_id || null } });
      setRule(r); setMsg("Late-fee rule saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(null); }
  }

  async function runLateFees() {
    setBusy("latefees"); setError(null);
    try {
      const r = await apiFetch<{ late_fees_charged: number; total: string }>(
        `/ar-billing/late-fees/run?as_of=${reg.late_as_of}`, { method: "POST", token, tenantId: activeTenantId });
      setMsg(`Late fees: ${r.late_fees_charged} charged, $${Number(r.total).toFixed(2)}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Late-fee run failed"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">AR Billing</h1>
          <p className="text-sm text-slate-500">Monthly fee & special-assessment plans (per-department revenue), late fees.</p>
        </div>
        <Button onClick={() => setModal("plan")}>+ Billing Plan</Button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      {loading ? <Spinner /> : (
        <>
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Billing Plans</h2>
              <Button variant="secondary" onClick={() => downloadFile(`/ar-billing/register/export?start=${reg.start}&end=${reg.end}`, token!, activeTenantId!, "assessment_register.xlsx")}>Register xlsx</Button>
            </div>
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-1 pr-3">Plan</th><th className="py-1 pr-3">Type</th>
                <th className="py-1 pr-3">Lines</th><th className="py-1 pr-3 text-right">Action</th></tr></thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="py-1 pr-3 font-medium">{p.name}</td>
                    <td className="py-1 pr-3"><Badge>{p.plan_type}</Badge></td>
                    <td className="py-1 pr-3 text-xs text-slate-500">{p.lines?.length ?? "—"}</td>
                    <td className="py-1 pr-3 text-right">
                      <Button variant="secondary" onClick={() => { setRunPlan(p); setModal("run"); }}>Run billing</Button>
                    </td>
                  </tr>
                ))}
                {plans.length === 0 && <tr><td colSpan={4} className="py-2 text-slate-400">No plans yet.</td></tr>}
              </tbody>
            </table>
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Late-Fee Rule</h2>
            {rule && (
              <form onSubmit={saveRule} className="grid items-end gap-3 md:grid-cols-5">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={rule.active} onChange={(e) => setRule({ ...rule, active: e.target.checked })} /> Active
                </label>
                <div><Label>Grace days</Label><Input type="number" value={rule.grace_days} onChange={(e) => setRule({ ...rule, grace_days: Number(e.target.value) })} /></div>
                <div>
                  <Label>Type</Label>
                  <Select value={rule.fee_type} onChange={(e) => setRule({ ...rule, fee_type: e.target.value })}>
                    <option value="FLAT">FLAT</option><option value="PERCENT">PERCENT</option>
                  </Select>
                </div>
                {rule.fee_type === "FLAT" ? (
                  <div><Label>Flat $</Label><Input type="number" step="0.01" value={rule.flat_amount} onChange={(e) => setRule({ ...rule, flat_amount: e.target.value })} /></div>
                ) : (
                  <div><Label>Percent</Label><Input type="number" step="0.001" value={rule.percent} onChange={(e) => setRule({ ...rule, percent: e.target.value })} /></div>
                )}
                <div>
                  <Label>Income account</Label>
                  <Select value={rule.income_combination_id || ""} onChange={(e) => setRule({ ...rule, income_combination_id: e.target.value || null })}>
                    <option value="">—</option>
                    {incomeCombos.map((c) => <option key={c.id} value={c.id}>{c.concatenated_segments}</option>)}
                  </Select>
                </div>
                <div className="md:col-span-5 flex items-center gap-2">
                  <Button type="submit" disabled={busy === "rule"}>{busy === "rule" ? "Saving…" : "Save rule"}</Button>
                  <Input value={reg.late_as_of} onChange={(e) => setReg({ ...reg, late_as_of: e.target.value })} className="w-36" />
                  <Button type="button" variant="secondary" onClick={runLateFees} disabled={busy === "latefees"}>Apply late fees (as of)</Button>
                </div>
              </form>
            )}
          </Card>
        </>
      )}

      <Modal open={modal === "plan"} onClose={() => setModal("")} title="New Billing Plan">
        <form onSubmit={createPlan} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Name</Label><Input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} required /></div>
            <div>
              <Label>Type</Label>
              <Select value={np.plan_type} onChange={(e) => setNp({ ...np, plan_type: e.target.value })}>
                <option value="MONTHLY_FEE">MONTHLY_FEE</option>
                <option value="SPECIAL_ASSESSMENT">SPECIAL_ASSESSMENT</option>
              </Select>
            </div>
          </div>
          <Label>Revenue lines (per department / Fund)</Label>
          {np.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_90px_100px] gap-2">
              <Select value={l.income_combination_id} required={i === 0}
                onChange={(e) => { const lines = [...np.lines]; lines[i] = { ...l, income_combination_id: e.target.value }; setNp({ ...np, lines }); }}>
                <option value="">Income account…</option>
                {incomeCombos.map((c) => <option key={c.id} value={c.id}>{c.concatenated_segments}</option>)}
              </Select>
              <Input type="number" step="0.01" placeholder="amt" value={l.amount}
                onChange={(e) => { const lines = [...np.lines]; lines[i] = { ...l, amount: e.target.value }; setNp({ ...np, lines }); }} />
              <Input placeholder="dept" value={l.department}
                onChange={(e) => { const lines = [...np.lines]; lines[i] = { ...l, department: e.target.value }; setNp({ ...np, lines }); }} />
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => setNp({ ...np, lines: [...np.lines, { income_combination_id: "", amount: "", department: "" }] })}>+ Line</Button>
          <div><Button type="submit" disabled={busy === "plan"}>{busy === "plan" ? "Saving…" : "Create Plan"}</Button></div>
        </form>
      </Modal>

      <Modal open={modal === "run"} onClose={() => setModal("")} title={`Run Billing — ${runPlan?.name || ""}`}>
        <form onSubmit={doRun} className="space-y-3">
          <p className="text-sm text-slate-600">Generates an AR invoice per active homeowner and posts to the GL.</p>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Invoice date</Label><Input type="date" value={run.invoice_date} onChange={(e) => setRun({ ...run, invoice_date: e.target.value })} required /></div>
            <div><Label>Due days</Label><Input type="number" value={run.due_days} onChange={(e) => setRun({ ...run, due_days: e.target.value })} /></div>
            <div><Label>Installments</Label><Input type="number" value={run.installments} onChange={(e) => setRun({ ...run, installments: e.target.value })} /></div>
          </div>
          <p className="text-xs text-slate-400">Installments &gt; 1 spreads a special assessment across monthly invoices.</p>
          <Button type="submit" disabled={busy === "run"}>{busy === "run" ? "Running…" : "Run Billing (all homeowners)"}</Button>
        </form>
      </Modal>
    </div>
  );
}
