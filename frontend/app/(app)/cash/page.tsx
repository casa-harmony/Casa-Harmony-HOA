"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile, API_BASE } from "@/lib/api";
import type { CashPosition, CeBankAccount, CeStatement, CodeCombination, Structure } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

export default function CashPage() {
  const { token, activeTenantId } = useAuth();
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

  const acctName = (id: string) => accounts.find((a) => a.id === id)?.account_code || id.slice(0, 8);
  const byFund: Record<string, CashPosition[]> = {};
  position.forEach((p) => { (byFund[p.fund_value] ||= []).push(p); });

  return (
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

      {loading ? <Spinner /> : (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {position.map((p) => (
              <Card key={p.bank_account_id}>
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-700">{p.name}</div>
                  <Badge tone={p.fund_value === "RESV" ? "O" : "A"}>{p.fund_value}</Badge>
                </div>
                <div className="mt-1 text-2xl font-bold text-slate-800">${Number(p.closing_balance).toFixed(2)}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {p.statement_date ? `as of ${p.statement_date}` : "no statements"} ·{" "}
                  <span className={p.open_items ? "text-amber-600" : "text-emerald-600"}>{p.open_items} open</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  +${Number(p.deposits).toFixed(2)} / ${Number(p.withdrawals).toFixed(2)}
                </div>
              </Card>
            ))}
            {position.length === 0 && <p className="text-sm text-slate-400">No bank accounts yet.</p>}
          </div>

          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-700">Reports</span>
              <Input value={reg.start} onChange={(e) => setReg({ ...reg, start: e.target.value })} className="w-32" />
              <Input value={reg.end} onChange={(e) => setReg({ ...reg, end: e.target.value })} className="w-32" />
              <Button variant="secondary" onClick={() => downloadFile(`/cash/reports/bank-rec/export`, token!, activeTenantId!, "bank_reconciliation.xlsx")}>Bank Rec</Button>
              <Button variant="secondary" onClick={() => downloadFile(`/cash/reports/cash-flow/export?start=${reg.start}&end=${reg.end}`, token!, activeTenantId!, "cash_flow.xlsx")}>Cash Flow by Fund</Button>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Statements</h2>
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                  <th className="py-1 pr-3">Date</th><th className="py-1 pr-3">Account</th>
                  <th className="py-1 pr-3 text-right">Closing</th><th className="py-1 pr-3">Status</th></tr></thead>
                <tbody>
                  {statements.map((s) => (
                    <tr key={s.id} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => openStatement(s.id)}>
                      <td className="py-1 pr-3">{s.statement_date}</td>
                      <td className="py-1 pr-3">{acctName(s.ce_bank_account_id)}</td>
                      <td className="py-1 pr-3 text-right">${Number(s.closing_balance).toFixed(2)}</td>
                      <td className="py-1 pr-3"><Badge tone={s.status === "RECONCILED" ? "A" : "O"}>{s.status}</Badge></td>
                    </tr>
                  ))}
                  {statements.length === 0 && <tr><td colSpan={4} className="py-2 text-slate-400">None yet.</td></tr>}
                </tbody>
              </table>
            </Card>

            <Card>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">
                Reconciliation {sel ? `· ${sel.statement_date}` : ""}
              </h2>
              {!sel ? <p className="text-sm text-slate-400">Select a statement to reconcile its lines.</p> : (
                <>
                  {(sel.lines || []).map((l) => (
                    <div key={l.id} className="border-b border-slate-100 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span>{l.description || "—"} <span className="text-xs text-slate-400">{l.reference}</span></span>
                        <span className={Number(l.amount) < 0 ? "text-rose-600" : "text-emerald-600"}>${Number(l.amount).toFixed(2)}</span>
                      </div>
                      {l.reconciled ? (
                        <Badge tone="A">reconciled · {l.match_type}</Badge>
                      ) : (
                        <div className="mt-1 flex items-center gap-2">
                          <Select className="flex-1" value={adjust[l.id] || ""} onChange={(e) => setAdjust({ ...adjust, [l.id]: e.target.value })}>
                            <option value="">Offset account…</option>
                            {combos.map((c) => <option key={c.id} value={c.id}>{c.concatenated_segments}</option>)}
                          </Select>
                          <Button variant="secondary" onClick={() => doAdjust(l.id)} disabled={busy === l.id}>Adjust</Button>
                        </div>
                      )}
                    </div>
                  ))}
                  {sel.status !== "RECONCILED" && (
                    <Button className="mt-3" onClick={() => reconcile(sel.id)} disabled={busy === "rec"}>
                      {busy === "rec" ? "…" : "Reconcile statement"}
                    </Button>
                  )}
                </>
              )}
            </Card>
          </div>
        </>
      )}

      <Modal open={modal === "account"} onClose={() => setModal("")} title="New Bank Account">
        <form onSubmit={saveAccount} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Account code</Label><Input value={acct.account_code} onChange={(e) => setAcct({ ...acct, account_code: e.target.value })} required placeholder="OPER-CHK" /></div>
            <div>
              <Label>Fund</Label>
              <Select value={acct.fund_value} onChange={(e) => setAcct({ ...acct, fund_value: e.target.value })}>
                <option value="OPER">OPER</option><option value="RESV">RESV</option>
              </Select>
            </div>
          </div>
          <div><Label>Name</Label><Input value={acct.name} onChange={(e) => setAcct({ ...acct, name: e.target.value })} required /></div>
          <div className="grid grid-cols-2 gap-3">
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
          <div className="grid grid-cols-3 gap-3">
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
}
