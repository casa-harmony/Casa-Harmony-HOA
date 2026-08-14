"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { PoDetail, PurchaseOrder, RcvReceipt, Vendor } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

const TONE: Record<string, string> = { ACCEPTED: "A", PENDING_INSPECTION: "O", REJECTED: "L" };

export default function ReceivingPage() {
  const { token, activeTenantId } = useAuth();
  const [receipts, setReceipts] = useState<RcvReceipt[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [po, setPo] = useState<PoDetail | null>(null);
  const [hdr, setHdr] = useState({ po_header_id: "", received_date: "2026-03-01", packing_slip: "", needs_inspection: false });
  const [qty, setQty] = useState<Record<string, string>>({});
  const [reg, setReg] = useState({ start: "2026-01-01", end: "2026-12-31" });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [rc, p, v] = await Promise.all([
        apiFetch<RcvReceipt[]>("/receiving", { token, tenantId: activeTenantId }),
        apiFetch<PurchaseOrder[]>("/purchasing?po_status=APPROVED", { token, tenantId: activeTenantId }),
        apiFetch<Vendor[]>("/vendors", { token, tenantId: activeTenantId }),
      ]);
      // Approved + partially billed POs are receivable.
      const all = await apiFetch<PurchaseOrder[]>("/purchasing", { token, tenantId: activeTenantId });
      setReceipts(rc);
      setPos(all.filter((x) => ["APPROVED", "PARTIALLY_BILLED", "FULLY_BILLED"].includes(x.status)));
      setVendors(v);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  const vName = (id?: string) => {
    if (!id) return "Unknown";
    return vendors.find((v) => v.id === id)?.name || id.slice(0, 8);
  };
  const poNum = (id?: string) => {
    if (!id) return "Unknown";
    return pos.find((p) => p.id === id)?.po_number || id.slice(0, 8);
  };

  async function selectPo(id: string) {
    setHdr({ ...hdr, po_header_id: id });
    setQty({});
    setPo(null);
    if (!id) return;
    setPo(await apiFetch<PoDetail>(`/purchasing/${id}`, { token, tenantId: activeTenantId }));
  }

  async function createReceipt(e: React.FormEvent) {
    e.preventDefault();
    const lines = Object.entries(qty)
      .filter(([, q]) => Number(q) > 0)
      .map(([po_line_id, q]) => ({ po_line_id, quantity: q }));
    if (lines.length === 0) { setError("Enter at least one received quantity."); return; }
    setBusy("create"); setError(null);
    try {
      await apiFetch("/receiving", {
        method: "POST", token, tenantId: activeTenantId,
        body: { po_header_id: hdr.po_header_id, received_date: hdr.received_date,
                packing_slip: hdr.packing_slip || undefined, needs_inspection: hdr.needs_inspection, lines },
      });
      setOpen(false); setPo(null); setQty({});
      setHdr({ po_header_id: "", received_date: "2026-03-01", packing_slip: "", needs_inspection: false });
      setMsg("Receipt recorded.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Receipt failed");
    } finally { setBusy(null); }
  }

  async function inspect(id: string, verb: "accept" | "reject") {
    setBusy(id); setError(null);
    try {
      if (verb === "accept") await apiFetch(`/receiving/${id}/accept`, { method: "POST", token, tenantId: activeTenantId });
      else await apiFetch(`/receiving/${id}/reject`, { method: "POST", token, tenantId: activeTenantId });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${verb} failed`);
    } finally { setBusy(null); }
  }

  const pending = receipts.filter((r) => r.status === "PENDING_INSPECTION");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Receiving</h1>
          <p className="text-sm text-slate-500">Record receipts against POs to enable 3-way matching.</p>
        </div>
        <Button onClick={() => setOpen(true)}>+ New Receipt</Button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">Receiving register</span>
          <Input value={reg.start} onChange={(e) => setReg({ ...reg, start: e.target.value })} className="w-32" />
          <Input value={reg.end} onChange={(e) => setReg({ ...reg, end: e.target.value })} className="w-32" />
          <Button variant="secondary" onClick={() => downloadFile(`/receiving/register/export?start=${reg.start}&end=${reg.end}`, token!, activeTenantId!, "receiving_register.xlsx")}>Export xlsx</Button>
        </div>
      </Card>

      {pending.length > 0 && (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-amber-700">Inspection queue ({pending.length})</h2>
          {pending.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-b border-slate-100 py-1 text-sm">
              <span><span className="font-mono">{r.receipt_number}</span> · PO {poNum(r.po_header_id)} · {r.received_date}</span>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => inspect(r.id, "accept")} disabled={busy === r.id}>Accept</Button>
                <Button variant="secondary" onClick={() => inspect(r.id, "reject")} disabled={busy === r.id}>Reject</Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Card>
        {loading ? <Spinner /> : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-2 pr-3">Receipt #</th><th className="py-2 pr-3">PO</th>
                <th className="py-2 pr-3">Date</th><th className="py-2 pr-3">Packing slip</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono">{r.receipt_number}</td>
                  <td className="py-2 pr-3">{poNum(r.po_header_id)}</td>
                  <td className="py-2 pr-3">{r.received_date}</td>
                  <td className="py-2 pr-3">{r.packing_slip || "—"}</td>
                  <td className="py-2 pr-3"><Badge tone={TONE[r.status]}>{r.status}</Badge></td>
                </tr>
              ))}
              {receipts.length === 0 && (
                <tr><td colSpan={5} className="py-3 text-slate-400">No receipts yet.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New Receipt">
        <form onSubmit={createReceipt} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Purchase Order</Label>
              <Select value={hdr.po_header_id} onChange={(e) => selectPo(e.target.value)} required>
                <option value="">Select PO…</option>
                {pos.map((p) => <option key={p.id} value={p.id}>{p.po_number} — {vName(p.vendor_id)}</option>)}
              </Select>
            </div>
            <div><Label>Received date</Label><Input type="date" value={hdr.received_date}
              onChange={(e) => setHdr({ ...hdr, received_date: e.target.value })} required /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Packing slip</Label><Input value={hdr.packing_slip}
              onChange={(e) => setHdr({ ...hdr, packing_slip: e.target.value })} /></div>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input type="checkbox" checked={hdr.needs_inspection}
                onChange={(e) => setHdr({ ...hdr, needs_inspection: e.target.checked })} />
              Requires inspection before acceptance
            </label>
          </div>
          {po && (
            <div className="rounded-lg border border-slate-200 p-3">
              <p className="mb-2 text-xs font-semibold uppercase text-slate-400">Receive quantities</p>
              {po.lines.map((l) => {
                const ordered = Number(l.quantity);
                const recd = l.distributions.reduce((s, d) => s + Number(d.quantity_received), 0);
                return (
                  <div key={l.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-slate-100 py-1.5 text-sm">
                    <div>
                      #{l.line_num} {l.item_description}
                      <span className="ml-2 text-xs text-slate-400">ordered {ordered} · received {recd}</span>
                    </div>
                    <Input type="number" step="0.0001" placeholder="qty" className="w-24"
                      value={qty[l.id] || ""} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy === "create" || !po}>{busy === "create" ? "Saving…" : "Record Receipt"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
