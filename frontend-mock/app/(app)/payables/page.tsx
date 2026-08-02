"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { ApInvoice, CodeCombination, DistributionSet, PoDetail, PoLine, PurchaseOrder, Structure, Vendor } from "@/lib/types";
import { Alert, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Play, Pause, XCircle, CheckCircle, Download, Check } from "lucide-react";

const TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  DRAFT: "outline", SUBMITTED: "secondary", APPROVED: "default", ACCOUNTED: "default", REJECTED: "destructive", PAID: "default",
};
const MATCH_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  NOT_MATCHED: "outline", MATCHED: "default", MATCH_EXCEPTION: "destructive",
};

export default function PayablesPage() {
  const { token, activeTenantId } = useAuth();
  const [invoices, setInvoices] = useState<ApInvoice[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [combos, setCombos] = useState<CodeCombination[]>([]);
  const [distSets, setDistSets] = useState<DistributionSet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({
    vendor_id: "", invoice_number: "", invoice_date: "2026-02-10", gl_date: "2026-02-15",
    po_header_id: "", po_line_id: "", amount: "", tax_amount: "", code_combination_id: "", distribution_set_id: "",
  });
  const [poLines, setPoLines] = useState<PoLine[]>([]);
  const [reg, setReg] = useState({ start: "2026-01-01", end: "2026-12-31" });

  async function onSelectPo(po_header_id: string) {
    setForm((f) => ({ ...f, po_header_id, po_line_id: "" }));
    setPoLines([]);
    if (!po_header_id) return;
    try {
      const detail = await apiFetch<PoDetail>(`/purchasing/${po_header_id}`, { token, tenantId: activeTenantId });
      setPoLines(detail.lines);
    } catch { /* ignore */ }
  }

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [inv, v, p, structures] = await Promise.all([
        apiFetch<ApInvoice[]>("/payables", { token, tenantId: activeTenantId }),
        apiFetch<Vendor[]>("/vendors", { token, tenantId: activeTenantId }),
        apiFetch<PurchaseOrder[]>("/purchasing", { token, tenantId: activeTenantId }),
        apiFetch<Structure[]>("/coa/structures", { token, tenantId: activeTenantId }),
      ]);
      setInvoices(inv);
      setVendors(v);
      setPos(p.filter((x) => ["APPROVED", "PARTIALLY_BILLED"].includes(x.status)));
      if (structures[0]) {
        setCombos(await apiFetch<CodeCombination[]>(
          `/coa/structures/${structures[0].id}/combinations`,
          { token, tenantId: activeTenantId }
        ));
      }
      setDistSets(await apiFetch<DistributionSet[]>("/ap-config/distribution-sets",
        { token, tenantId: activeTenantId }).catch(() => []));
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
    setBusy("create");
    setError(null);
    try {
      await apiFetch("/payables", {
        method: "POST", token, tenantId: activeTenantId,
        body: {
          vendor_id: form.vendor_id, invoice_number: form.invoice_number,
          invoice_date: form.invoice_date, gl_date: form.gl_date,
          po_header_id: form.po_header_id || undefined,
          tax_amount: form.tax_amount || "0",
          lines: [
            // Matched to a PO line with no override → inherit the PO distributions.
            form.po_line_id && !form.distribution_set_id && !form.code_combination_id
              ? { amount: form.amount, po_line_id: form.po_line_id }
              : form.distribution_set_id
              ? { amount: form.amount, distribution_set_id: form.distribution_set_id, po_line_id: form.po_line_id || undefined }
              : { amount: form.amount, po_line_id: form.po_line_id || undefined,
                  distributions: [{ code_combination_id: form.code_combination_id, amount: form.amount }] },
          ],
        },
      });
      setOpen(false);
      setForm({ vendor_id: "", invoice_number: "", invoice_date: "2026-02-10",
                gl_date: "2026-02-15", po_header_id: "", po_line_id: "", amount: "", tax_amount: "",
                code_combination_id: "", distribution_set_id: "" });
      setPoLines([]);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create invoice");
    } finally {
      setBusy(null);
    }
  }

  async function submit(id: string) {
    setBusy(id);
    setError(null);
    try {
      await apiFetch(`/payables/${id}/submit`, { method: "POST", token, tenantId: activeTenantId });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed");
    } finally {
      setBusy(null);
    }
  }

  async function cancelInvoice(id: string) {
    if (!window.confirm("Cancel this invoice? Any PO billing will be reversed.")) return;
    setBusy(id); setError(null);
    try {
      await apiFetch(`/payables/${id}/cancel`, { method: "POST", token, tenantId: activeTenantId });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally { setBusy(null); }
  }

  async function hold(id: string) {
    const reason = window.prompt("Reason for hold?");
    if (!reason) return;
    setBusy(id); setError(null);
    try {
      await apiFetch(`/payables/${id}/hold`, { method: "POST", token, tenantId: activeTenantId, body: { reason } });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Hold failed");
    } finally { setBusy(null); }
  }

  async function releaseHold(id: string) {
    setBusy(id); setError(null);
    try {
      await apiFetch(`/payables/${id}/release-hold`, { method: "POST", token, tenantId: activeTenantId });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Release failed");
    } finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Payables — AP Invoices</h1>
          <p className="text-sm text-slate-500">
            Invoice entry with PO matching; approval generates a draft GL batch.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>+ New Invoice</Button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <Card className="shadow-sm border-slate-200 rounded-xl overflow-hidden p-5">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Reports</span>
          <Input value={reg.start} onChange={(e) => setReg({ ...reg, start: e.target.value })} className="w-32" />
          <Input value={reg.end} onChange={(e) => setReg({ ...reg, end: e.target.value })} className="w-32" />
          <Button variant="secondary" className="text-slate-600 bg-white" onClick={() => downloadFile(`/payables/register/export?start=${reg.start}&end=${reg.end}`, token!, activeTenantId!, "ap_invoice_register.xlsx")}><Download className="h-4 w-4 mr-2" /> Invoice Register</Button>
          <Button variant="secondary" className="text-slate-600 bg-white" onClick={() => downloadFile(`/payables/distributions/export?start=${reg.start}&end=${reg.end}`, token!, activeTenantId!, "ap_distributions.xlsx")}><Download className="h-4 w-4 mr-2" /> Distributions by Fund/Period</Button>
        </div>
      </Card>
      <Card className="shadow-sm border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
             <div className="flex justify-center p-12"><Spinner /></div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="font-semibold text-slate-600">Invoice #</TableHead>
                  <TableHead className="font-semibold text-slate-600 text-right">Amount</TableHead>
                  <TableHead className="font-semibold text-slate-600 text-right">Tax</TableHead>
                  <TableHead className="font-semibold text-slate-600">Match</TableHead>
                  <TableHead className="font-semibold text-slate-600">Status</TableHead>
                  <TableHead className="font-semibold text-slate-600 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id} className="hover:bg-slate-50 transition-colors">
                    <TableCell className="font-mono text-slate-800 font-medium">
                      <div className="flex items-center gap-2">
                        {inv.invoice_number}
                        {inv.on_hold && <span title={inv.hold_reason || ""}><Badge variant="destructive">HOLD</Badge></span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-medium text-slate-800">${Number(inv.amount).toFixed(2)}</TableCell>
                    <TableCell className="text-right text-slate-500">${Number(inv.tax_amount || 0).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={MATCH_TONE[inv.match_status] || "outline"}>{inv.match_status.replace("_", " ")}</Badge>
                    </TableCell>
                    <TableCell><Badge variant={TONE[inv.status] || "outline"}>{inv.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {inv.status === "DRAFT" && !inv.on_hold && (
                          <Button variant="ghost" className="h-8 w-8 p-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" onClick={() => submit(inv.id)} disabled={busy === inv.id} title="Submit">
                            <CheckCircle className="h-4 w-4" />
                          </Button>
                        )}
                        {!inv.on_hold && !["PAID", "CANCELLED"].includes(inv.status) && (
                          <Button variant="ghost" className="h-8 w-8 p-1 text-amber-600 hover:text-amber-700 hover:bg-amber-50" onClick={() => hold(inv.id)} disabled={busy === inv.id} title="Hold">
                            <Pause className="h-4 w-4" />
                          </Button>
                        )}
                        {inv.on_hold && (
                          <Button variant="ghost" className="h-8 w-8 p-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50" onClick={() => releaseHold(inv.id)} disabled={busy === inv.id} title="Release Hold">
                            <Play className="h-4 w-4" />
                          </Button>
                        )}
                        {!["PAID", "CANCELLED"].includes(inv.status) && (
                          <Button variant="ghost" className="h-8 w-8 p-1 text-rose-600 hover:text-rose-700 hover:bg-rose-50" onClick={() => cancelInvoice(inv.id)} disabled={busy === inv.id} title="Cancel">
                            <XCircle className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {invoices.length === 0 && (
                  <TableRow>
                     <TableCell colSpan={6} className="h-32 text-center text-slate-500 font-medium">
                        No invoices found.
                     </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </div>    </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New AP Invoice">
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Vendor</Label>
              <Select value={form.vendor_id} onChange={(e) => setForm({ ...form, vendor_id: e.target.value })} required>
                <option value="">Select vendor…</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </div>
            <div><Label>Invoice #</Label><Input value={form.invoice_number}
              onChange={(e) => setForm({ ...form, invoice_number: e.target.value })} required /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Invoice date</Label><Input type="date" value={form.invoice_date}
              onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} required /></div>
            <div><Label>GL date</Label><Input type="date" value={form.gl_date}
              onChange={(e) => setForm({ ...form, gl_date: e.target.value })} required /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Match to PO (optional)</Label>
              <Select value={form.po_header_id} onChange={(e) => onSelectPo(e.target.value)}>
                <option value="">No PO (unmatched)</option>
                {pos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.po_number} — rem ${(Number(p.amount_limit) - Number(p.billed_amount)).toFixed(2)}
                  </option>
                ))}
              </Select>
            </div>
            {form.po_header_id && (
              <div>
                <Label>PO line (inherits distributions)</Label>
                <Select value={form.po_line_id} onChange={(e) => setForm({ ...form, po_line_id: e.target.value })}>
                  <option value="">Select line…</option>
                  {poLines.map((l) => <option key={l.id} value={l.id}>#{l.line_num} {l.item_description}</option>)}
                </Select>
              </div>
            )}
          </div>
          {form.po_header_id ? (
            <p className="text-xs text-emerald-700">
              Matched invoices within tolerance are fast-tracked (auto-approved). Pick a PO line to
              inherit its accounting, or override with an account/distribution set below.
            </p>
          ) : (
            <p className="text-xs text-amber-700">
              Unmatched invoices require Board verification of the accounting distribution.
            </p>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Amount</Label><Input type="number" step="0.01" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} required /></div>
            <div><Label>Tax</Label><Input type="number" step="0.01" value={form.tax_amount}
              onChange={(e) => setForm({ ...form, tax_amount: e.target.value })} placeholder="0.00" /></div>
            <div>
              <Label>Distribution set (optional)</Label>
              <Select value={form.distribution_set_id}
                onChange={(e) => setForm({ ...form, distribution_set_id: e.target.value })}>
                <option value="">— single account —</option>
                {distSets.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.lines.length} lines)</option>)}
              </Select>
            </div>
          </div>
          {!form.distribution_set_id && !form.po_line_id && (
            <div>
              <Label>Account (KFF)</Label>
              <Select value={form.code_combination_id}
                onChange={(e) => setForm({ ...form, code_combination_id: e.target.value })}
                required={!form.distribution_set_id && !form.po_line_id}>
                <option value="">Select…</option>
                {combos.map((c) => <option key={c.id} value={c.id}>{c.concatenated_segments}</option>)}
              </Select>
            </div>
          )}
          {form.po_line_id && !form.distribution_set_id && !form.code_combination_id && (
            <p className="text-xs text-slate-500">Distributions will be inherited from the selected PO line.</p>
          )}
          {form.distribution_set_id && (
            <p className="text-xs text-slate-500">
              The amount will be split across this set's accounts by percentage.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy === "create"}>
              {busy === "create" ? "Creating…" : "Create Invoice"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
