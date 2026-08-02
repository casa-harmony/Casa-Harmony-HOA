"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { BudgetControl, BudgetVersion, BudgetVersionDetail, BvARow, CodeCombination, Structure } from "@/lib/types";
import { Alert, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Calculator, Download, Play, Plus, Send, CheckCircle, Save, TrendingUp, DollarSign } from "lucide-react";
import { motion } from "framer-motion";
import { ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

const TONE: Record<string, "outline" | "secondary" | "default" | "destructive"> = { DRAFT: "outline", SUBMITTED: "secondary", APPROVED: "default", REJECTED: "destructive" };

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

  const acct = (id: string) => combos.find((c) => c.id === id)?.concatenated_segments || id?.slice(0, 8) || "Unknown";
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

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <Card className="shadow-sm border-slate-200/60 rounded-xl overflow-hidden p-5 bg-white">
        <h2 className="mb-4 text-sm font-semibold text-slate-700 uppercase tracking-wide">Budgetary Control</h2>
        {control && (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <Label className="text-slate-600">Mode</Label>
              <Select value={control.mode} onChange={(e) => saveControl(e.target.value, control.controlling_version_id)}>
                {["NONE", "ADVISORY", "ABSOLUTE"].map((m) => <option key={m}>{m}</option>)}
              </Select>
            </div>
            <div>
              <Label className="text-slate-600">Controlling version</Label>
              <Select value={control.controlling_version_id || ""} onChange={(e) => saveControl(control.mode, e.target.value || null)}>
                <option value="">— None —</option>
                {versions.filter((v) => v.status === "APPROVED").map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </div>
            <p className="text-xs text-slate-500 max-w-lg mb-2">ADVISORY flags the Board on overage; ABSOLUTE blocks over-budget PO approval.</p>
          </div>
        )}
        </Card>
      </motion.div>

      {loading ? <Spinner /> : (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }} className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card className="shadow-sm border-slate-200 rounded-xl overflow-hidden p-0">
            <h2 className="p-4 border-b border-slate-100 bg-slate-50 text-sm font-semibold text-slate-700 uppercase tracking-wide">Versions</h2>
            <div className="divide-y divide-slate-100">
              {versions.map((v) => (
                <button key={v.id} onClick={() => openVersion(v.id)}
                  className={`flex w-full items-center justify-between p-4 text-left text-sm transition-colors hover:bg-slate-50 ${sel?.id === v.id ? "bg-indigo-50 border-l-4 border-l-indigo-500 pl-3" : ""}`}>
                  <div>
                    <div className="font-medium text-slate-800">{v.name}</div>
                    <div className="text-xs text-slate-500 mt-1">FY{v.fiscal_year} · {v.version_type}</div>
                  </div>
                  <span className="flex items-center gap-2">
                    {v.is_controlling && <Badge variant="default" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border-0">CTRL</Badge>}
                    <Badge variant={TONE[v.status] || "outline"}>{v.status}</Badge>
                  </span>
                </button>
              ))}
              {versions.length === 0 && <p className="p-4 text-xs text-slate-500">No versions yet.</p>}
            </div>
          </Card>

          <Card className="shadow-sm border-slate-200 rounded-xl overflow-hidden">
            {!sel ? <div className="p-12 text-center text-slate-500 font-medium flex flex-col items-center gap-2"><Calculator className="h-8 w-8 text-slate-300" /> Select a version to view details</div> : (
              <div className="flex flex-col h-full">
                <div className="p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800 flex items-center gap-3">
                      {sel.name} 
                      <Badge variant={TONE[sel.status] || "outline"}>{sel.status}</Badge>
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {sel.status === "DRAFT" && <Button variant="secondary" className="bg-indigo-50 text-indigo-700 hover:bg-indigo-100" onClick={() => setModal("spread")}><Plus className="h-4 w-4 mr-1" /> Line</Button>}
                    {sel.status === "DRAFT" && <Button variant="secondary" onClick={() => versionAction("submit")} disabled={busy === "submit"}><Send className="h-4 w-4 mr-1" /> Submit</Button>}
                    {sel.status === "SUBMITTED" && <Button variant="primary" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => versionAction("approve")} disabled={busy === "approve"}><CheckCircle className="h-4 w-4 mr-1" /> Approve</Button>}
                    <Button variant="secondary" onClick={() => downloadFile(`/budgeting/versions/${sel.id}/spread/export`, token!, activeTenantId!, "budget_spread.xlsx")} title="Export Spread XLSX"><Download className="h-4 w-4 text-slate-500" /></Button>
                    <Button variant="secondary" onClick={() => downloadFile(`/budgeting/versions/${sel.id}/vs-actual/export`, token!, activeTenantId!, "budget_vs_actual.xlsx")} title="Export Budget vs Actual XLSX"><Download className="h-4 w-4 text-slate-500" /></Button>
                  </div>
                </div>

                {/* Chart Section */}
                {bva.length > 0 && (
                  <div className="p-6 border-b border-slate-100 bg-slate-50/30">
                    <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-indigo-500" />
                      Budget vs Actual Overview
                    </h3>
                    <div className="h-[220px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={bva} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="account" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} />
                          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(v) => `$${v/1000}k`} />
                          <Tooltip formatter={(val: any) => `$${Number(val).toLocaleString()}`} cursor={{ fill: '#f8fafc' }} />
                          <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                          <Bar dataKey="budget" name="Budget" fill="#94a3b8" radius={[4, 4, 0, 0]} barSize={24} />
                          <Bar dataKey="actual" name="Actual" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={24} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="font-semibold text-slate-600">Account</TableHead>
                        <TableHead className="font-semibold text-slate-600">Fund</TableHead>
                        <TableHead className="font-semibold text-slate-600 text-right">Annual budget</TableHead>
                        <TableHead className="font-semibold text-slate-600 text-right">Actual</TableHead>
                        <TableHead className="font-semibold text-slate-600 text-right w-48">Utilization</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bva.map((r) => {
                        const pct = Number(r.budget) > 0 ? (Number(r.actual) / Number(r.budget)) * 100 : 0;
                        const isOver = pct > 100;
                        return (
                          <TableRow key={r.code_combination_id} className="hover:bg-slate-50 group">
                            <TableCell className="font-mono text-slate-600 font-medium">{r.account}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-slate-500 bg-white shadow-sm border-slate-200/60">{r.fund_value}</Badge>
                            </TableCell>
                            <TableCell className="text-right font-semibold text-slate-800">${Number(r.budget).toLocaleString(undefined, {minimumFractionDigits: 2})}</TableCell>
                            <TableCell className="text-right font-medium text-slate-600">${Number(r.actual).toLocaleString(undefined, {minimumFractionDigits: 2})}</TableCell>
                            <TableCell className="text-right align-middle">
                              <div className="flex flex-col items-end gap-1 w-full max-w-[120px] ml-auto">
                                <div className={`text-xs font-bold ${isOver ? "text-rose-600" : "text-emerald-600"}`}>
                                  {pct.toFixed(1)}% {isOver ? "over" : "used"}
                                </div>
                                <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                  <div 
                                    className={`h-full rounded-full transition-all duration-500 ${isOver ? "bg-rose-500" : "bg-emerald-500"}`} 
                                    style={{ width: `${Math.min(pct, 100)}%` }}
                                  />
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {bva.length === 0 && Object.keys(annual).length === 0 && (
                        <TableRow>
                          <TableCell colSpan={5} className="h-32 text-center text-slate-500 font-medium">
                            No budget lines. Add lines with <span className="font-semibold">Line</span>.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </Card>
        </motion.div>
      )}

      <Modal open={modal === "version"} onClose={() => setModal("")} title="New Budget Version">
        <form onSubmit={createVersion} className="space-y-3">
          <div><Label>Name</Label><Input value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} required placeholder="FY2026 Operating" /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
