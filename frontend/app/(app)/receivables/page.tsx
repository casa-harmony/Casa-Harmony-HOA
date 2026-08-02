"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { Homeowner } from "@/lib/types";
import { Alert, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

interface Aging {
  as_of: string;
  totals: Record<string, number>;
  grand_total: number;
}
const BUCKETS = ["Current", "1-30", "31-60", "61-90", "90+"];

export default function ReceivablesPage() {
  const { token, activeTenantId } = useAuth();
  const [homeowners, setHomeowners] = useState<Homeowner[]>([]);
  const [aging, setAging] = useState<Aging | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receiptFor, setReceiptFor] = useState<Homeowner | null>(null);
  const [assessOpen, setAssessOpen] = useState(false);

  const [receipt, setReceipt] = useState({
    receipt_number: "", amount: "", receipt_date: "2026-02-20", payment_method: "ACH", fund: "OPER",
  });
  const [assess, setAssess] = useState({
    invoice_date: "2026-03-01", due_date: "2026-03-15", amount: "250.00", invoice_type: "ASSESSMENT",
  });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [hos, ag] = await Promise.all([
        apiFetch<Homeowner[]>("/subledger/homeowners", { token, tenantId: activeTenantId }),
        apiFetch<Aging>("/subledger/aging", { token, tenantId: activeTenantId }).catch(() => null),
      ]);
      setHomeowners(hos);
      setAging(ag);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function accountDrafts() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ batch_id: string | null; message?: string }>(
        "/subledger/invoices/account-run",
        { method: "POST", token, tenantId: activeTenantId });
      setMsg(r.batch_id ? "Draft assessments accounted into a GL batch (review in General Ledger)."
                        : (r.message || "Nothing to account."));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Account run failed");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTenantId]);

  async function recordReceipt(e: React.FormEvent) {
    e.preventDefault();
    if (!receiptFor) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/subledger/receipts", {
        method: "POST", token, tenantId: activeTenantId,
        body: { homeowner_id: receiptFor.id, ...receipt },
      });
      setMsg(`Receipt recorded for ${receiptFor.first_name} ${receiptFor.last_name}.`);
      setReceiptFor(null);
      setReceipt({ receipt_number: "", amount: "", receipt_date: "2026-02-20", payment_method: "ACH", fund: "OPER" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record receipt");
    } finally {
      setBusy(false);
    }
  }

  async function runAssessments(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ invoices_created: number; total_billed: string }>(
        "/subledger/assessment-run",
        { method: "POST", token, tenantId: activeTenantId, body: assess }
      );
      setMsg(`Billed ${r.invoices_created} homeowners — $${Number(r.total_billed).toFixed(2)} total.`);
      setAssessOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assessment run failed");
    } finally {
      setBusy(false);
    }
  }

  async function exportLedger(ho: Homeowner) {
    try {
      await downloadFile(`/subledger/homeowners/${ho.id}/ledger/export`,
        token!, activeTenantId!, `ledger_${ho.account_number}.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Receivables — Homeowners</h1>
          <p className="text-sm text-slate-500">Assessments, receipts, and homeowner ledgers.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={accountDrafts} disabled={busy}>Account Drafts → GL</Button>
          <Button onClick={() => setAssessOpen(true)}>▶ Run Monthly Assessments</Button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      {aging && (
        <Card>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">
              AR Aging — as of {aging.as_of}
            </h2>
            <span className="text-sm font-bold text-slate-800">
              Outstanding ${aging.grand_total.toFixed(2)}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {BUCKETS.map((b) => (
              <div key={b} className="rounded-lg border border-slate-200 p-2 text-center">
                <div className="text-xs uppercase text-slate-400">{b}</div>
                <div className={`text-sm font-semibold ${b === "90+" && (aging.totals[b] || 0) > 0 ? "text-rose-600" : "text-slate-700"}`}>
                  ${(aging.totals[b] || 0).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card>
        {loading ? (
          <Spinner />
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-2 pr-3">Account</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Unit</th>
                <th className="py-2 pr-3">Bank</th>
                <th className="py-2 pr-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {homeowners.map((h) => (
                <tr key={h.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono">{h.account_number}</td>
                  <td className="py-2 pr-3 font-medium text-slate-700">
                    {h.first_name} {h.last_name}
                  </td>
                  <td className="py-2 pr-3">{h.property_unit || "—"}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{h.bank_account_masked || "—"}</td>
                  <td className="py-2 pr-3">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => exportLedger(h)}>Ledger ⬇</Button>
                      <Button onClick={() => setReceiptFor(h)}>Receipt</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={!!receiptFor} onClose={() => setReceiptFor(null)}
        title={`Record Receipt — ${receiptFor?.first_name} ${receiptFor?.last_name}`}>
        <form onSubmit={recordReceipt} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Receipt #</Label><Input value={receipt.receipt_number}
              onChange={(e) => setReceipt({ ...receipt, receipt_number: e.target.value })} required /></div>
            <div><Label>Amount</Label><Input type="number" step="0.01" value={receipt.amount}
              onChange={(e) => setReceipt({ ...receipt, amount: e.target.value })} required /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Date</Label><Input type="date" value={receipt.receipt_date}
              onChange={(e) => setReceipt({ ...receipt, receipt_date: e.target.value })} required /></div>
            <div>
              <Label>Method</Label>
              <Select value={receipt.payment_method}
                onChange={(e) => setReceipt({ ...receipt, payment_method: e.target.value })}>
                {["ACH", "CHECK", "CARD"].map((m) => <option key={m}>{m}</option>)}
              </Select>
            </div>
            <div>
              <Label>Fund</Label>
              <Select value={receipt.fund} onChange={(e) => setReceipt({ ...receipt, fund: e.target.value })}>
                {["OPER", "RESV"].map((f) => <option key={f}>{f}</option>)}
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setReceiptFor(null)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Record (posts to GL)"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={assessOpen} onClose={() => setAssessOpen(false)} title="Run Monthly Assessments">
        <form onSubmit={runAssessments} className="space-y-4">
          <p className="text-sm text-slate-500">
            Generates an assessment invoice for every active homeowner.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Invoice date</Label><Input type="date" value={assess.invoice_date}
              onChange={(e) => setAssess({ ...assess, invoice_date: e.target.value })} required /></div>
            <div><Label>Due date</Label><Input type="date" value={assess.due_date}
              onChange={(e) => setAssess({ ...assess, due_date: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Amount each</Label><Input type="number" step="0.01" value={assess.amount}
              onChange={(e) => setAssess({ ...assess, amount: e.target.value })} required /></div>
            <div>
              <Label>Type</Label>
              <Select value={assess.invoice_type}
                onChange={(e) => setAssess({ ...assess, invoice_type: e.target.value })}>
                {["ASSESSMENT", "LATE_FEE", "SPECIAL"].map((t) => <option key={t}>{t}</option>)}
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAssessOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Running…" : "Run Assessments"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
