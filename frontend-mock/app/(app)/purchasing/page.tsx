"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile, API_BASE } from "@/lib/api";
import type { CodeCombination, PurchaseOrder, Structure, Vendor } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

const TONE: Record<string, string> = {
  INCOMPLETE: "none", SUBMITTED: "R", APPROVED: "A", REJECTED: "L", CANCELLED: "L",
  PARTIALLY_BILLED: "O", FULLY_BILLED: "A", CLOSED: "none",
};

type LineForm = { item_description: string; quantity: string; unit_price: string; code_combination_id: string };
const BLANK_LINE: LineForm = { item_description: "", quantity: "1", unit_price: "", code_combination_id: "" };

export default function PurchasingPage() {
  const { token, activeTenantId } = useAuth();
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [combos, setCombos] = useState<CodeCombination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState({ vendor_id: "", cost_center: "", active_on: "", min_remaining: "" });
  const fileRef = useRef<HTMLInputElement>(null);

  const [hdr, setHdr] = useState({
    vendor_id: "", order_date: "2026-02-01", document_type: "STANDARD",
    start_date: "", end_date: "", amount_limit: "", description: "",
  });
  const [lines, setLines] = useState<LineForm[]>([{ ...BLANK_LINE }]);

  const vName = (id: string) => vendors.find((v) => v.id === id)?.name || id?.slice(0, 8) || "Unknown";

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (filter.vendor_id) qs.set("vendor_id", filter.vendor_id);
      if (filter.cost_center) qs.set("cost_center", filter.cost_center);
      if (filter.active_on) qs.set("active_on", filter.active_on);
      if (filter.min_remaining) qs.set("min_remaining", filter.min_remaining);
      const [p, v, structures] = await Promise.all([
        apiFetch<PurchaseOrder[]>(`/purchasing${qs.toString() ? `?${qs}` : ""}`, { token, tenantId: activeTenantId }),
        apiFetch<Vendor[]>("/vendors", { token, tenantId: activeTenantId }),
        apiFetch<Structure[]>("/coa/structures", { token, tenantId: activeTenantId }),
      ]);
      setPos(p); setVendors(v);
      if (structures[0]) {
        setCombos(await apiFetch<CodeCombination[]>(
          `/coa/structures/${structures[0].id}/combinations`, { token, tenantId: activeTenantId }));
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy("create"); setError(null);
    try {
      await apiFetch("/purchasing", {
        method: "POST", token, tenantId: activeTenantId,
        body: {
          vendor_id: hdr.vendor_id, order_date: hdr.order_date, document_type: hdr.document_type,
          description: hdr.description || undefined,
          start_date: hdr.start_date || undefined, end_date: hdr.end_date || undefined,
          amount_limit: hdr.amount_limit || undefined,
          lines: lines.map((l) => {
            const amt = ((Number(l.quantity) || 0) * (Number(l.unit_price) || 0)).toFixed(2);
            return {
              item_description: l.item_description, quantity: Number(l.quantity), unit_price: l.unit_price,
              distributions: [{ code_combination_id: l.code_combination_id, amount: amt }],
            };
          }),
        },
      });
      setOpen(false);
      setHdr({ vendor_id: "", order_date: "2026-02-01", document_type: "STANDARD",
               start_date: "", end_date: "", amount_limit: "", description: "" });
      setLines([{ ...BLANK_LINE }]);
      setMsg("Purchase order created.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create PO");
    } finally { setBusy(null); }
  }

  async function submitPo(id: string) {
    setBusy(id); setError(null);
    try {
      await apiFetch(`/purchasing/${id}/submit`, { method: "POST", token, tenantId: activeTenantId });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally { setBusy(null); }
  }

  async function doImport(file: File) {
    setBusy("import"); setError(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch(`${API_BASE}/purchasing/import/xlsx`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": activeTenantId! }, body: fd,
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Import failed");
      const r = await res.json();
      setMsg(`Imported ${r.created} PO(s); skipped ${r.skipped}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally { setBusy(null); if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Purchasing — Contracts & POs</h1>
          <p className="text-sm text-slate-500">Multi-line POs/contracts with timeframe, dollar limit, and KFF distributions.</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
            onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy === "import"}>
            {busy === "import" ? "Importing…" : "Import xlsx"}
          </Button>
          <Button variant="secondary" onClick={() => downloadFile("/purchasing/export/xlsx", token!, activeTenantId!, "purchase_orders.xlsx")}>Export xlsx</Button>
          <Button onClick={() => setOpen(true)}>+ New PO / Contract</Button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">Reports</span>
          {[
            ["commitment-register", "Commitment Register"],
            ["variance-by-contract", "Contract Variance"],
            ["cost-center-utilization", "Cost Center Utilization"],
            ["contract-utilization", "Contract Utilization (CC/Fund)"],
            ["matched-summary", "Matched vs Non-matched"],
            ["activity-log", "Activity Log"],
          ].map(([path, label]) => (
            <Button key={path} variant="secondary"
              onClick={() => downloadFile(`/purchasing/reports/${path}`, token!, activeTenantId!, `${path}.xlsx`)}>
              {label}
            </Button>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <Label>Vendor</Label>
            <Select value={filter.vendor_id} onChange={(e) => setFilter({ ...filter, vendor_id: e.target.value })}>
              <option value="">All vendors</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          </div>
          <div><Label>Cost center</Label><Input value={filter.cost_center} className="w-32"
            onChange={(e) => setFilter({ ...filter, cost_center: e.target.value })} placeholder="e.g. 100" /></div>
          <div><Label>Active on</Label><Input type="date" value={filter.active_on} className="w-40"
            onChange={(e) => setFilter({ ...filter, active_on: e.target.value })} /></div>
          <div><Label>Min remaining $</Label><Input type="number" value={filter.min_remaining} className="w-32"
            onChange={(e) => setFilter({ ...filter, min_remaining: e.target.value })} /></div>
          <Button variant="secondary" onClick={load}>Search</Button>
        </div>
      </Card>

      <Card>
        {loading ? <Spinner /> : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-2 pr-3">PO #</th><th className="py-2 pr-3">Vendor</th><th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3 text-right">Amount</th><th className="py-2 pr-3 text-right">Limit</th>
                <th className="py-2 pr-3 text-right">Billed</th><th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {pos.map((p) => (
                <tr key={p.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono">
                    <Link href={`/purchasing/${p.id}`} className="text-brand-600 hover:underline">{p.po_number}</Link>
                  </td>
                  <td className="py-2 pr-3">{vName(p.vendor_id)}</td>
                  <td className="py-2 pr-3">{p.document_type}</td>
                  <td className="py-2 pr-3 text-right font-medium">${Number(p.amount).toFixed(2)}</td>
                  <td className="py-2 pr-3 text-right text-slate-500">${Number(p.amount_limit).toFixed(2)}</td>
                  <td className="py-2 pr-3 text-right text-slate-500">${Number(p.billed_amount).toFixed(2)}</td>
                  <td className="py-2 pr-3"><Badge tone={TONE[p.status]}>{p.status}</Badge></td>
                  <td className="py-2 pr-3 text-right">
                    {p.status === "INCOMPLETE" && (
                      <Button variant="secondary" onClick={() => submitPo(p.id)} disabled={busy === p.id}>Submit</Button>
                    )}
                  </td>
                </tr>
              ))}
              {pos.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-slate-400">No POs.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New Purchase Order / Contract">
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Vendor</Label>
              <Select value={hdr.vendor_id} onChange={(e) => setHdr({ ...hdr, vendor_id: e.target.value })} required>
                <option value="">Select vendor…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </div>
            <div>
              <Label>Type</Label>
              <Select value={hdr.document_type} onChange={(e) => setHdr({ ...hdr, document_type: e.target.value })}>
                <option value="STANDARD">STANDARD (PO)</option>
                <option value="CONTRACT">CONTRACT</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Order date</Label><Input type="date" value={hdr.order_date}
              onChange={(e) => setHdr({ ...hdr, order_date: e.target.value })} required /></div>
            <div><Label>Start{hdr.document_type === "CONTRACT" ? "" : " (opt)"}</Label><Input type="date" value={hdr.start_date}
              onChange={(e) => setHdr({ ...hdr, start_date: e.target.value })} /></div>
            <div><Label>End{hdr.document_type === "CONTRACT" ? "" : " (opt)"}</Label><Input type="date" value={hdr.end_date}
              onChange={(e) => setHdr({ ...hdr, end_date: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Description</Label><Input value={hdr.description}
              onChange={(e) => setHdr({ ...hdr, description: e.target.value })} placeholder="e.g. Landscape contract" /></div>
            <div><Label>Amount limit (cap){hdr.document_type === "CONTRACT" ? "" : " — defaults to total"}</Label>
              <Input type="number" step="0.01" value={hdr.amount_limit}
                onChange={(e) => setHdr({ ...hdr, amount_limit: e.target.value })} placeholder={total.toFixed(2)} /></div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-700">Lines</span>
              <span className="text-xs text-slate-500">Total ${total.toFixed(2)}</span>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_70px_90px_1fr_28px] items-end gap-2">
                <div><Label>Item</Label><Input value={l.item_description} required
                  onChange={(e) => { const n = [...lines]; n[i] = { ...l, item_description: e.target.value }; setLines(n); }} /></div>
                <div><Label>Qty</Label><Input type="number" step="0.01" value={l.quantity} required
                  onChange={(e) => { const n = [...lines]; n[i] = { ...l, quantity: e.target.value }; setLines(n); }} /></div>
                <div><Label>Unit $</Label><Input type="number" step="0.01" value={l.unit_price} required
                  onChange={(e) => { const n = [...lines]; n[i] = { ...l, unit_price: e.target.value }; setLines(n); }} /></div>
                <div><Label>Account (Fund req.)</Label>
                  <Select value={l.code_combination_id} required
                    onChange={(e) => { const n = [...lines]; n[i] = { ...l, code_combination_id: e.target.value }; setLines(n); }}>
                    <option value="">Account…</option>
                    {combos.map((c) => <option key={c.id} value={c.id}>{c.concatenated_segments}</option>)}
                  </Select>
                </div>
                <button type="button" className="mb-1 text-rose-500 disabled:opacity-30" disabled={lines.length === 1}
                  onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <Button type="button" variant="secondary" onClick={() => setLines([...lines, { ...BLANK_LINE }])}>+ Line</Button>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy === "create"}>{busy === "create" ? "Creating…" : "Create PO"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
