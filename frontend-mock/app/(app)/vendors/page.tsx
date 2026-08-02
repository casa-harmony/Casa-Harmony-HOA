"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile, API_BASE } from "@/lib/api";
import type { PaymentTerm, Vendor, VendorType } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

const EMPTY = {
  vendor_number: "", name: "", tax_id: "", email: "", payment_term_id: "",
  vendor_type_id: "", is_1099: false, income_tax_type: "1099-NEC",
  state_reportable: false, tax_reporting_name: "",
};

export default function VendorsPage() {
  const { token, activeTenantId } = useAuth();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [terms, setTerms] = useState<PaymentTerm[]>([]);
  const [types, setTypes] = useState<VendorType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const fileRef = useRef<HTMLInputElement>(null);

  async function doImport(file: File) {
    setBusy(true); setError(null); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/vendors/import/xlsx`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": activeTenantId! },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Import failed");
      setMsg(`Imported ${data.created} suppliers (${data.skipped} skipped).`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [v, t, ty] = await Promise.all([
        apiFetch<Vendor[]>("/vendors", { token, tenantId: activeTenantId }),
        apiFetch<PaymentTerm[]>("/ap-config/payment-terms", { token, tenantId: activeTenantId }).catch(() => []),
        apiFetch<VendorType[]>("/ap-config/vendor-types", { token, tenantId: activeTenantId }).catch(() => []),
      ]);
      setVendors(v); setTerms(t); setTypes(ty);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTenantId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/vendors", {
        method: "POST", token, tenantId: activeTenantId,
        body: {
          vendor_number: form.vendor_number, name: form.name,
          tax_id: form.tax_id || undefined, email: form.email || undefined,
          payment_term_id: form.payment_term_id || undefined,
          vendor_type_id: form.vendor_type_id || undefined,
          is_1099: form.is_1099,
          income_tax_type: form.is_1099 ? form.income_tax_type : undefined,
          state_reportable: form.state_reportable,
          tax_reporting_name: form.tax_reporting_name || undefined,
        },
      });
      setOpen(false);
      setForm({ ...EMPTY });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create vendor");
    } finally {
      setBusy(false);
    }
  }

  const typeName = (id: string | null) => types.find((t) => t.id === id)?.name || "—";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Vendors</h1>
          <p className="text-sm text-slate-500">Supplier master (Tax ID encrypted at rest).</p>
        </div>
        <div className="flex gap-2">
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
            onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])} />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={busy}>Import xlsx</Button>
          <Button variant="secondary"
            onClick={() => downloadFile("/vendors/export/xlsx", token!, activeTenantId!, "suppliers.xlsx")}>Export xlsx</Button>
          <Button onClick={() => setOpen(true)}>+ New Vendor</Button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}
      <Card>
        {loading ? (
          <Spinner />
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-2 pr-3">Number</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">1099</th>
                <th className="py-2 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => (
                <tr key={v.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono">{v.vendor_number}</td>
                  <td className="py-2 pr-3 font-medium">
                    <Link href={`/vendors/${v.id}`} className="text-brand-600 hover:underline">{v.name}</Link>
                  </td>
                  <td className="py-2 pr-3 text-slate-500">{typeName(v.vendor_type_id)}</td>
                  <td className="py-2 pr-3">{v.is_1099 ? <Badge tone="L">{v.income_tax_type || "1099"}</Badge> : "—"}</td>
                  <td className="py-2 pr-3"><Badge tone="A">{v.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New Vendor">
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Vendor #</Label><Input value={form.vendor_number}
              onChange={(e) => setForm({ ...form, vendor_number: e.target.value })} required /></div>
            <div>
              <Label>Vendor type</Label>
              <Select value={form.vendor_type_id} onChange={(e) => setForm({ ...form, vendor_type_id: e.target.value })}>
                <option value="">— none —</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
          </div>
          <div><Label>Name</Label><Input value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Payment term</Label>
              <Select value={form.payment_term_id} onChange={(e) => setForm({ ...form, payment_term_id: e.target.value })}>
                <option value="">— none —</option>
                {terms.map((t) => <option key={t.id} value={t.id}>{t.name} (net {t.due_days}d)</option>)}
              </Select>
            </div>
            <div><Label>Email</Label><Input value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          </div>

          <div className="rounded-lg border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={form.is_1099}
                onChange={(e) => setForm({ ...form, is_1099: e.target.checked })} />
              1099 reportable vendor
            </label>
            {form.is_1099 && (
              <div className="mt-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Tax ID (TIN/EIN, encrypted)</Label><Input value={form.tax_id}
                    onChange={(e) => setForm({ ...form, tax_id: e.target.value })} placeholder="12-3456789" /></div>
                  <div>
                    <Label>1099 form</Label>
                    <Select value={form.income_tax_type} onChange={(e) => setForm({ ...form, income_tax_type: e.target.value })}>
                      {["1099-NEC", "1099-MISC", "1099-INT"].map((f) => <option key={f}>{f}</option>)}
                    </Select>
                  </div>
                </div>
                <div><Label>Tax reporting name (if different)</Label><Input value={form.tax_reporting_name}
                  onChange={(e) => setForm({ ...form, tax_reporting_name: e.target.value })} /></div>
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <input type="checkbox" checked={form.state_reportable}
                    onChange={(e) => setForm({ ...form, state_reportable: e.target.checked })} />
                  State reportable
                </label>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Create"}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
