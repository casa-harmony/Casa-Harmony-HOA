"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { ApPayment, Payable, PaymentMethod, Vendor } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

const STATUS_TONE: Record<string, string> = { CREATED: "A", VOID: "L", STOPPED: "R" };

export default function PaymentsPage() {
  const { token, activeTenantId } = useAuth();
  const [payable, setPayable] = useState<Payable[]>([]);
  const [payments, setPayments] = useState<ApPayment[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [payModal, setPayModal] = useState(false);
  const [batchModal, setBatchModal] = useState(false);
  const [pay, setPay] = useState({ payment_method_id: "", payment_date: "2026-05-25", reference: "" });
  const [batch, setBatch] = useState({ payment_method_id: "", payment_date: "2026-05-25", due_before: "2026-12-31" });
  const [reg, setReg] = useState({ start: "2026-01-01", end: "2026-12-31" });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [pa, pm, me, ve] = await Promise.all([
        apiFetch<Payable[]>("/ap-payments/payable", { token, tenantId: activeTenantId }),
        apiFetch<ApPayment[]>("/ap-payments", { token, tenantId: activeTenantId }),
        apiFetch<PaymentMethod[]>("/ap-config/payment-methods", { token, tenantId: activeTenantId }).catch(() => []),
        apiFetch<Vendor[]>("/vendors", { token, tenantId: activeTenantId }),
      ]);
      setPayable(pa); setPayments(pm); setMethods(me); setVendors(ve);
      setSelected({});
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  const vName = (id: string) => vendors.find((v) => v.id === id)?.name || id?.slice(0, 8) || "Unknown";
  const chosen = payable.filter((p) => selected[p.invoice_id]);
  const chosenVendors = new Set(chosen.map((p) => p.vendor_id));
  const chosenTotal = chosen.reduce((s, p) => s + Number(p.amount_remaining), 0);

  async function createPayment(e: React.FormEvent) {
    e.preventDefault();
    if (chosenVendors.size !== 1) { setError("Select invoices for a single vendor per payment."); return; }
    setBusy("pay"); setError(null);
    try {
      await apiFetch("/ap-payments", {
        method: "POST", token, tenantId: activeTenantId,
        body: {
          vendor_id: chosen[0].vendor_id,
          payment_method_id: pay.payment_method_id || undefined,
          payment_date: pay.payment_date, reference: pay.reference || undefined,
          applications: chosen.map((p) => ({ invoice_id: p.invoice_id, amount: p.amount_remaining })),
        },
      });
      setPayModal(false); setMsg(`Payment created for ${vName(chosen[0].vendor_id)}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Payment failed");
    } finally { setBusy(null); }
  }

  async function runBatch(e: React.FormEvent) {
    e.preventDefault();
    setBusy("batch"); setError(null);
    try {
      const r = await apiFetch<{ payments_created: number; total_paid: string }>("/ap-payments/batch", {
        method: "POST", token, tenantId: activeTenantId,
        body: { payment_method_id: batch.payment_method_id || undefined, payment_date: batch.payment_date, due_before: batch.due_before },
      });
      setBatchModal(false); setMsg(`Batch run: ${r.payments_created} payments, $${Number(r.total_paid).toFixed(2)}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Batch failed");
    } finally { setBusy(null); }
  }

  async function action(id: string, verb: "void" | "stop") {
    setBusy(id); setError(null);
    try {
      await apiFetch(`/ap-payments/${id}/${verb}`, { method: "POST", token, tenantId: activeTenantId });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${verb} failed`);
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Payments (AP)</h1>
          <p className="text-sm text-slate-500">Select payable invoices, pay vendors, void/stop, batch runs.</p>
        </div>
        <Button variant="secondary" onClick={() => setBatchModal(true)}>▶ Batch Pay</Button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <Card>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">Reports</span>
          <Input value={reg.start} onChange={(e) => setReg({ ...reg, start: e.target.value })} className="w-32" />
          <Input value={reg.end} onChange={(e) => setReg({ ...reg, end: e.target.value })} className="w-32" />
          <Button variant="secondary" onClick={() => downloadFile(`/ap-payments/register/export?start=${reg.start}&end=${reg.end}`, token!, activeTenantId!, "payment_register.xlsx")}>Register</Button>
          <Button variant="secondary" onClick={() => downloadFile(`/ap-payments/aged-payables/export`, token!, activeTenantId!, "aged_payables.xlsx")}>Aged Payables</Button>
          <Button variant="secondary" onClick={() => downloadFile(`/ap-payments/cash-requirements/export`, token!, activeTenantId!, "cash_requirements.xlsx")}>Cash Requirements</Button>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Payable invoices ({payable.length})</h2>
          <Button disabled={chosen.length === 0} onClick={() => { setError(null); setPayModal(true); }}>
            Pay selected ({chosen.length}) · ${chosenTotal.toFixed(2)}
          </Button>
        </div>
        {loading ? <Spinner /> : payable.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing payable. Approve AP invoices to make them payable.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-2 pr-3"></th><th className="py-2 pr-3">Invoice</th><th className="py-2 pr-3">Vendor</th>
                <th className="py-2 pr-3">Due</th><th className="py-2 pr-3 text-right">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {payable.map((p) => (
                <tr key={p.invoice_id} className="border-b border-slate-100">
                  <td className="py-2 pr-3"><input type="checkbox" checked={!!selected[p.invoice_id]}
                    onChange={(e) => setSelected({ ...selected, [p.invoice_id]: e.target.checked })} /></td>
                  <td className="py-2 pr-3 font-mono">{p.invoice_number}</td>
                  <td className="py-2 pr-3">{p.vendor_name}</td>
                  <td className="py-2 pr-3">{p.due_date || "—"}</td>
                  <td className="py-2 pr-3 text-right">${Number(p.amount_remaining).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Payments ({payments.length})</h2>
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
              <th className="py-2 pr-3">Payment #</th><th className="py-2 pr-3">Vendor</th><th className="py-2 pr-3">Date</th>
              <th className="py-2 pr-3 text-right">Amount</th><th className="py-2 pr-3">Status</th><th className="py-2 pr-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((p) => (
              <tr key={p.id} className="border-b border-slate-100">
                <td className="py-2 pr-3 font-mono">{p.payment_number}</td>
                <td className="py-2 pr-3">{vName(p.vendor_id)}</td>
                <td className="py-2 pr-3">{p.payment_date}</td>
                <td className="py-2 pr-3 text-right">${Number(p.amount).toFixed(2)}</td>
                <td className="py-2 pr-3"><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge></td>
                <td className="py-2 pr-3">
                  {p.status === "CREATED" && (
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => action(p.id, "stop")} disabled={busy === p.id}>Stop</Button>
                      <Button variant="secondary" onClick={() => action(p.id, "void")} disabled={busy === p.id}>Void</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Modal open={payModal} onClose={() => setPayModal(false)} title="Create Payment">
        <form onSubmit={createPayment} className="space-y-3">
          <p className="text-sm text-slate-600">
            Paying <b>{chosen[0] ? vName(chosen[0].vendor_id) : ""}</b> — {chosen.length} invoice(s), total <b>${chosenTotal.toFixed(2)}</b>.
            {chosenVendors.size > 1 && <span className="text-rose-600"> Select one vendor only.</span>}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Method</Label>
              <Select value={pay.payment_method_id} onChange={(e) => setPay({ ...pay, payment_method_id: e.target.value })}>
                <option value="">— none —</option>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.method_type})</option>)}
              </Select>
            </div>
            <div><Label>Date</Label><Input type="date" value={pay.payment_date} onChange={(e) => setPay({ ...pay, payment_date: e.target.value })} required /></div>
          </div>
          <div><Label>Reference (check #/trace)</Label><Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} /></div>
          <Button type="submit" disabled={busy === "pay" || chosenVendors.size !== 1}>{busy === "pay" ? "Paying…" : "Create Payment"}</Button>
        </form>
      </Modal>

      <Modal open={batchModal} onClose={() => setBatchModal(false)} title="Batch Payment Run">
        <form onSubmit={runBatch} className="space-y-3">
          <p className="text-sm text-slate-600">Pays every invoice due on/before the date — one payment per vendor.</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Method</Label>
              <Select value={batch.payment_method_id} onChange={(e) => setBatch({ ...batch, payment_method_id: e.target.value })}>
                <option value="">— none —</option>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.method_type})</option>)}
              </Select>
            </div>
            <div><Label>Payment date</Label><Input type="date" value={batch.payment_date} onChange={(e) => setBatch({ ...batch, payment_date: e.target.value })} required /></div>
          </div>
          <div><Label>Pay invoices due on/before</Label><Input type="date" value={batch.due_before} onChange={(e) => setBatch({ ...batch, due_before: e.target.value })} required /></div>
          <Button type="submit" disabled={busy === "batch"}>{busy === "batch" ? "Running…" : "Run Batch"}</Button>
        </form>
      </Modal>
    </div>
  );
}
