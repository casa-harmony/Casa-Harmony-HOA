"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile, API_BASE } from "@/lib/api";
import type { CashPosition, CeBankAccount, CeStatement, CodeCombination, Structure } from "@/lib/types";
import {  Alert, Badge, Button, Input, Label, Modal, Select, Spinner  } from "@/components/ui";
import { ReadinessEmptyState } from "@/components/readiness";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Wallet, ArrowUpRight, ArrowDownRight, ArrowRightLeft, FileSpreadsheet } from "lucide-react";

const MOCK_CASH_FLOW = [
  { month: "Jan", in: 0, out: 0 },
  { month: "Feb", in: 0, out: 0 },
  { month: "Mar", in: 0, out: 0 },
  { month: "Apr", in: 0, out: 0 },
  { month: "May", in: 0, out: 0 },
  { month: "Jun", in: 0, out: 0 },
];
export default function CashPage() {
  const { token, activeTenantId, refresh } = useAuth();
  const [accounts, setAccounts] = useState<CeBankAccount[]>([]);
  const [position, setPosition] = useState<CashPosition[]>([]);
  const [statements, setStatements] = useState<CeStatement[]>([]);
  const [combos, setCombos] = useState<CodeCombination[]>([]);
  const [sel, setSel] = useState<CeStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [modal, setModal] = useState<"" | "account" | "upload">("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [acct, setAcct] = useState({ account_code: "", name: "", fund_value: "OPER", bank_name: "", account_number: "", routing_number: "", gl_cash_combination_id: "" });
  const [up, setUp] = useState({ ce_bank_account_id: "", statement_date: "2026-03-31", opening_balance: "0", closing_balance: "0" });
  const [adjust, setAdjust] = useState<Record<string, string>>({});
  const [reg, setReg] = useState({ start: "2026-01-01", end: "2026-12-31" });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [a, pos, st, structures] = await Promise.all([
        apiFetch<CeBankAccount[]>("/cash/bank-accounts", { token, tenantId: activeTenantId }),
        apiFetch<CashPosition[]>("/cash/position", { token, tenantId: activeTenantId }),
        apiFetch<CeStatement[]>("/cash/statements", { token, tenantId: activeTenantId }),
        apiFetch<Structure[]>("/coa/structures", { token, tenantId: activeTenantId }),
      ]);
      setAccounts(a); setPosition(pos); setStatements(st);
      if (structures[0]) setCombos(await apiFetch<CodeCombination[]>(
        `/coa/structures/${structures[0].id}/combinations`, { token, tenantId: activeTenantId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  const cashCombos = combos.filter((c) => c.natural_account_value === "1000" || c.natural_account_value === "1010");

  async function saveAccount(e: React.FormEvent) {
    e.preventDefault(); setBusy("account"); setError(null);
    try {
      await apiFetch("/cash/bank-accounts", { method: "POST", token, tenantId: activeTenantId,
        body: { ...acct, account_number: acct.account_number || undefined,
                routing_number: acct.routing_number || undefined,
                gl_cash_combination_id: acct.gl_cash_combination_id || undefined } });
      setModal(""); setAcct({ account_code: "", name: "", fund_value: "OPER", bank_name: "", account_number: "", routing_number: "", gl_cash_combination_id: "" });
      await load();
      refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(null); }
  }

  async function uploadStatement(e: React.FormEvent) {
    e.preventDefault();
    const f = fileRef.current?.files?.[0];
    if (!f || !up.ce_bank_account_id) { setError("Pick a bank account and a CSV/xlsx file."); return; }
    setBusy("upload"); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("ce_bank_account_id", up.ce_bank_account_id);
      fd.append("statement_date", up.statement_date);
      fd.append("opening_balance", up.opening_balance);
      fd.append("closing_balance", up.closing_balance);
      const res = await fetch(`${API_BASE}/cash/statements/import`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": activeTenantId! }, body: fd });
      if (!res.ok) throw new Error((await res.json()).detail || "Import failed");
      setModal(""); setMsg("Statement imported."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Import failed"); }
    finally { setBusy(null); }
  }

  async function openStatement(id: string) {
    setSel(await apiFetch<CeStatement>(`/cash/statements/${id}`, { token, tenantId: activeTenantId }));
  }

  async function doAdjust(lineId: string) {
    const offset = adjust[lineId];
    if (!offset) { setError("Pick an offset account for the adjustment."); return; }
    setBusy(lineId); setError(null);
    try {
      const r = await apiFetch<CeStatement>(`/cash/statements/lines/${lineId}/adjust`, {
        method: "POST", token, tenantId: activeTenantId,
        body: { offset_combination_id: offset, gl_date: sel?.statement_date, description: "Bank adjustment" } });
      setSel(r); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Adjust failed"); }
    finally { setBusy(null); }
  }

  async function reconcile(id: string) {
    setBusy("rec"); setError(null);
    try {
      await apiFetch(`/cash/statements/${id}/reconcile`, { method: "POST", token, tenantId: activeTenantId });
      setMsg("Statement reconciled."); await openStatement(id); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Reconcile failed"); }
    finally { setBusy(null); }
  }

  const acctName = (id: string) => accounts.find((a) => a.id === id)?.account_code || id?.slice(0, 8) || "Unknown";
  const byFund: Record<string, CashPosition[]> = {};
  position.forEach((p) => { (byFund[p.fund_value] ||= []).push(p); });

  const content = (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Cash & Bank Reconciliation</h1>
          <p className="text-sm text-slate-500">Per-Fund bank accounts, statement import, and reconciliation.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setModal("account")}>+ Bank Account</Button>
          <Button onClick={() => setModal("upload")}>↑ Import Statement</Button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      {loading ? (
        <div className="flex justify-center items-center h-64"><Spinner /></div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, staggerChildren: 0.1 }}
          className="space-y-6"
        >
          {/* Cash Flow Chart */}
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
            <Card className="shadow-sm border-slate-200/60 overflow-hidden">
              <CardHeader className="bg-slate-50/50 pb-4 border-b border-slate-100">
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <ArrowRightLeft className="h-4 w-4 text-slate-500" />
                  6-Month Cash Flow Trend
                </CardTitle>
                <CardDescription>Inflows vs Outflows across all bank accounts</CardDescription>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="h-[250px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={MOCK_CASH_FLOW} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} tickFormatter={(val) => `$${val/1000}k`} />
                      <Tooltip cursor={{ fill: '#f8fafc' }} formatter={(value: any) => `$${Number(value).toLocaleString()}`} />
                      <Bar dataKey="in" name="Inflow" fill="#10b981" radius={[4, 4, 0, 0]} barSize={30} />
                      <Bar dataKey="out" name="Outflow" fill="#ef4444" radius={[4, 4, 0, 0]} barSize={30} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Bank Accounts */}
          <div>
            <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Wallet className="h-5 w-5 text-indigo-500" /> Account Balances
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {position.map((p, i) => (
                <motion.div key={p.bank_account_id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 * i }}>
                  <Card className="shadow-sm border-slate-200/60 hover:shadow-md transition-all group overflow-hidden relative">
                    <div className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-2xl -mr-8 -mt-8 pointer-events-none opacity-20 ${p.fund_value === "RESV" ? "bg-amber-500" : "bg-indigo-500"}`}></div>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm font-semibold text-slate-700">{p.name}</CardTitle>
                        <Badge tone={p.fund_value === "RESV" ? "O" : "A"}>{p.fund_value}</Badge>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-black text-slate-900 tracking-tight">
                        ${Number(p.closing_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                        <div className="bg-emerald-50 rounded p-2 border border-emerald-100">
                          <div className="text-emerald-600 flex items-center gap-1 font-medium mb-1"><ArrowUpRight className="h-3 w-3" /> In</div>
                          <div className="font-semibold text-slate-800">${Number(p.deposits).toLocaleString()}</div>
                        </div>
                        <div className="bg-rose-50 rounded p-2 border border-rose-100">
                          <div className="text-rose-600 flex items-center gap-1 font-medium mb-1"><ArrowDownRight className="h-3 w-3" /> Out</div>
                          <div className="font-semibold text-slate-800">${Number(p.withdrawals).toLocaleString()}</div>
                        </div>
                      </div>
                      <div className="mt-4 text-xs text-slate-500 flex items-center justify-between">
                        <span>{p.statement_date ? `As of ${p.statement_date}` : "No statements"}</span>
                        <span className={`font-medium ${p.open_items ? "text-amber-600" : "text-emerald-600"}`}>
                          {p.open_items} open items
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              ))}
              {position.length === 0 && <p className="text-sm text-slate-400 col-span-full">No bank accounts yet.</p>}
            </div>
          </div>

          <Card className="shadow-sm border-slate-200/60 bg-slate-50/50">
            <CardContent className="py-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 bg-white px-3 py-1.5 rounded-md border border-slate-200">
                  <FileSpreadsheet className="h-4 w-4 text-slate-400" /> Export Reports
                </div>
                <Input value={reg.start} onChange={(e) => setReg({ ...reg, start: e.target.value })} className="w-36 bg-white" type="date" />
                <span className="text-slate-400 text-sm">to</span>
                <Input value={reg.end} onChange={(e) => setReg({ ...reg, end: e.target.value })} className="w-36 bg-white" type="date" />
                <Button variant="secondary" className="bg-white" onClick={() => downloadFile(`/cash/reports/bank-rec/export`, token!, activeTenantId!, "bank_reconciliation.xlsx")}>Bank Rec</Button>
                <Button variant="secondary" className="bg-white" onClick={() => downloadFile(`/cash/reports/cash-flow/export?start=${reg.start}&end=${reg.end}`, token!, activeTenantId!, "cash_flow.xlsx")}>Cash Flow</Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="shadow-sm border-slate-200/60">
              <CardHeader className="bg-slate-50/50 border-b border-slate-100 py-3">
                <CardTitle className="text-sm font-semibold text-slate-800">Statements</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      <th className="py-3 px-4">Date</th>
                      <th className="py-3 px-4">Account</th>
                      <th className="py-3 px-4 text-right">Closing</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statements.map((s) => (
                      <tr key={s.id} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50 transition-colors" onClick={() => openStatement(s.id)}>
                        <td className="py-3 px-4 font-medium text-slate-700">{s.statement_date}</td>
                        <td className="py-3 px-4 text-slate-600">{acctName(s.ce_bank_account_id)}</td>
                        <td className="py-3 px-4 text-right font-medium text-slate-800">${Number(s.closing_balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td className="py-3 px-4"><Badge tone={s.status === "RECONCILED" ? "A" : "O"}>{s.status}</Badge></td>
                      </tr>
                    ))}
                    {statements.length === 0 && <tr><td colSpan={4} className="py-4 px-4 text-slate-400 text-center">No statements uploaded.</td></tr>}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-slate-200/60">
              <CardHeader className="bg-slate-50/50 border-b border-slate-100 py-3">
                <CardTitle className="text-sm font-semibold text-slate-800">
                  Reconciliation {sel ? <span className="text-slate-500 font-normal ml-1">· {sel.statement_date}</span> : ""}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {!sel ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center text-slate-400">
                    <FileSpreadsheet className="h-8 w-8 mb-2 text-slate-200" />
                    <p className="text-sm">Select a statement to reconcile its lines.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {(sel.lines || []).map((l) => (
                      <div key={l.id} className="border border-slate-100 rounded-lg p-3 text-sm bg-white shadow-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-slate-700">
                            {l.description || "—"} 
                            <span className="text-xs text-slate-400 font-normal ml-2 block sm:inline">{l.reference}</span>
                          </span>
                          <span className={`font-bold ${Number(l.amount) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                            ${Math.abs(Number(l.amount)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </span>
                        </div>
                        {l.reconciled ? (
                          <div className="flex items-center gap-2 text-xs">
                            <Badge tone="A">reconciled</Badge>
                            <span className="text-slate-400">{l.match_type}</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 bg-slate-50 p-2 rounded border border-slate-100 mt-2">
                            <Select className="flex-1 bg-white" value={adjust[l.id] || ""} onChange={(e) => setAdjust({ ...adjust, [l.id]: e.target.value })}>
                              <option value="">Offset account…</option>
                              {combos.map((c) => <option key={c.id} value={c.id}>{c.concatenated_segments}</option>)}
                            </Select>
                            <Button variant="secondary" className="bg-white" onClick={() => doAdjust(l.id)} disabled={busy === l.id}>Adjust</Button>
                          </div>
                        )}
                      </div>
                    ))}
                    {sel.status !== "RECONCILED" && (
                      <Button className="w-full mt-4" onClick={() => reconcile(sel.id)} disabled={busy === "rec"}>
                        {busy === "rec" ? "Processing…" : "Reconcile Statement"}
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </motion.div>
      )}

      <Modal open={modal === "account"} onClose={() => setModal("")} title="New Bank Account">
        <form onSubmit={saveAccount} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Account code</Label><Input value={acct.account_code} onChange={(e) => setAcct({ ...acct, account_code: e.target.value })} required placeholder="OPER-CHK" /></div>
            <div>
              <Label>Fund</Label>
              <Select value={acct.fund_value} onChange={(e) => setAcct({ ...acct, fund_value: e.target.value })}>
                <option value="OPER">OPER</option><option value="RESV">RESV</option>
              </Select>
            </div>
          </div>
          <div><Label>Name</Label><Input value={acct.name} onChange={(e) => setAcct({ ...acct, name: e.target.value })} required /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Bank name</Label><Input value={acct.bank_name} onChange={(e) => setAcct({ ...acct, bank_name: e.target.value })} /></div>
            <div><Label>Routing #</Label><Input value={acct.routing_number} onChange={(e) => setAcct({ ...acct, routing_number: e.target.value })} /></div>
          </div>
          <div><Label>Account # (encrypted)</Label><Input value={acct.account_number} onChange={(e) => setAcct({ ...acct, account_number: e.target.value })} /></div>
          <div>
            <Label>GL cash account</Label>
            <Select value={acct.gl_cash_combination_id} onChange={(e) => setAcct({ ...acct, gl_cash_combination_id: e.target.value })}>
              <option value="">Select cash account…</option>
              {cashCombos.map((c) => <option key={c.id} value={c.id}>{c.concatenated_segments}</option>)}
            </Select>
          </div>
          <Button type="submit" disabled={busy === "account"}>{busy === "account" ? "Saving…" : "Create"}</Button>
        </form>
      </Modal>

      <Modal open={modal === "upload"} onClose={() => setModal("")} title="Import Bank Statement">
        <form onSubmit={uploadStatement} className="space-y-3">
          <div>
            <Label>Bank account</Label>
            <Select value={up.ce_bank_account_id} onChange={(e) => setUp({ ...up, ce_bank_account_id: e.target.value })} required>
              <option value="">Select…</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.account_code} — {a.name}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><Label>Statement date</Label><Input type="date" value={up.statement_date} onChange={(e) => setUp({ ...up, statement_date: e.target.value })} required /></div>
            <div><Label>Opening</Label><Input type="number" step="0.01" value={up.opening_balance} onChange={(e) => setUp({ ...up, opening_balance: e.target.value })} /></div>
            <div><Label>Closing</Label><Input type="number" step="0.01" value={up.closing_balance} onChange={(e) => setUp({ ...up, closing_balance: e.target.value })} /></div>
          </div>
          <div>
            <Label>CSV / xlsx file (date, description, reference, amount)</Label>
            <input ref={fileRef} type="file" accept=".csv,.xlsx,.xlsm" className="block w-full text-sm" />
          </div>
          <Button type="submit" disabled={busy === "upload"}>{busy === "upload" ? "Importing…" : "Import"}</Button>
        </form>
      </Modal>
    </div>
  );

  return <ReadinessEmptyState requiredStage="LEDGER" fallback={content} />;
}
