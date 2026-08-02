"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch } from "@/lib/api";
import type { CodeCombination, DistributionSet, PaymentMethod, PaymentTerm, Structure, VendorType } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

type Line = { code_combination_id: string; percent: string };

export default function ApSetupPage() {
  const { token, activeTenantId } = useAuth();
  const [terms, setTerms] = useState<PaymentTerm[]>([]);
  const [types, setTypes] = useState<VendorType[]>([]);
  const [sets, setSets] = useState<DistributionSet[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [combos, setCombos] = useState<CodeCombination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<"" | "term" | "type" | "set" | "method">("");

  const [term, setTerm] = useState({ name: "", due_days: "30", description: "" });
  const [vtype, setVtype] = useState({ code: "", name: "" });
  const [method, setMethod] = useState({ code: "", name: "", method_type: "CHECK" });
  const [tol, setTol] = useState({ amount_tolerance_pct: "0", quantity_tolerance_pct: "0", require_receipt: false });
  const [tolSaved, setTolSaved] = useState(false);
  const [dset, setDset] = useState<{ name: string; description: string; lines: Line[] }>({
    name: "", description: "", lines: [{ code_combination_id: "", percent: "" }],
  });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [t, v, s, m, structures] = await Promise.all([
        apiFetch<PaymentTerm[]>("/ap-config/payment-terms", { token, tenantId: activeTenantId }),
        apiFetch<VendorType[]>("/ap-config/vendor-types", { token, tenantId: activeTenantId }),
        apiFetch<DistributionSet[]>("/ap-config/distribution-sets", { token, tenantId: activeTenantId }),
        apiFetch<PaymentMethod[]>("/ap-config/payment-methods", { token, tenantId: activeTenantId }),
        apiFetch<Structure[]>("/coa/structures", { token, tenantId: activeTenantId }),
      ]);
      setTerms(t); setTypes(v); setSets(s); setMethods(m);
      const tt = await apiFetch<{ amount_tolerance_pct: string; quantity_tolerance_pct: string; require_receipt: boolean }>(
        "/ap-config/match-tolerance", { token, tenantId: activeTenantId }).catch(() => null);
      if (tt) setTol({ amount_tolerance_pct: String(tt.amount_tolerance_pct), quantity_tolerance_pct: String(tt.quantity_tolerance_pct), require_receipt: tt.require_receipt });
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

  async function save(path: string, body: unknown) {
    setBusy(true); setError(null);
    try {
      await apiFetch(path, { method: "POST", token, tenantId: activeTenantId, body });
      setModal("");
      setTerm({ name: "", due_days: "30", description: "" });
      setVtype({ code: "", name: "" });
      setMethod({ code: "", name: "", method_type: "CHECK" });
      setDset({ name: "", description: "", lines: [{ code_combination_id: "", percent: "" }] });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally { setBusy(false); }
  }

  const pctTotal = dset.lines.reduce((s, l) => s + (parseFloat(l.percent) || 0), 0);

  async function saveTolerance() {
    setBusy(true); setError(null); setTolSaved(false);
    try {
      await apiFetch("/ap-config/match-tolerance", {
        method: "PUT", token, tenantId: activeTenantId,
        body: { amount_tolerance_pct: tol.amount_tolerance_pct, quantity_tolerance_pct: tol.quantity_tolerance_pct, require_receipt: tol.require_receipt },
      });
      setTolSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">AP Setup</h1>
        <p className="text-sm text-slate-500">Payment terms, vendor types, and distribution sets.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <Spinner /> : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Payment Terms</h2>
              <Button variant="secondary" onClick={() => setModal("term")}>+ Add</Button>
            </div>
            {terms.map((t) => (
              <div key={t.id} className="border-b border-slate-100 py-1 text-sm">
                <span className="font-medium">{t.name}</span> · net {t.due_days}d
              </div>
            ))}
            {terms.length === 0 && <p className="text-xs text-slate-400">None yet.</p>}
          </Card>

          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Vendor Types</h2>
              <Button variant="secondary" onClick={() => setModal("type")}>+ Add</Button>
            </div>
            {types.map((t) => (
              <div key={t.id} className="border-b border-slate-100 py-1 text-sm">
                <span className="font-mono text-xs text-slate-400">{t.code}</span> {t.name}
              </div>
            ))}
            {types.length === 0 && <p className="text-xs text-slate-400">None yet.</p>}
          </Card>

          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Distribution Sets</h2>
              <Button variant="secondary" onClick={() => setModal("set")}>+ Add</Button>
            </div>
            {sets.map((s) => (
              <div key={s.id} className="border-b border-slate-100 py-1 text-sm">
                <span className="font-medium">{s.name}</span>{" "}
                <Badge>{s.lines.length} lines</Badge>
              </div>
            ))}
            {sets.length === 0 && <p className="text-xs text-slate-400">None yet.</p>}
          </Card>

          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Payment Methods</h2>
              <Button variant="secondary" onClick={() => setModal("method")}>+ Add</Button>
            </div>
            {methods.map((m) => (
              <div key={m.id} className="border-b border-slate-100 py-1 text-sm">
                <span className="font-medium">{m.name}</span>{" "}
                <Badge>{m.method_type}</Badge>
              </div>
            ))}
            {methods.length === 0 && <p className="text-xs text-slate-400">None yet.</p>}
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">PO Match Tolerance</h2>
            <p className="mb-2 text-xs text-slate-400">Allowed overage before an invoice exceeds its PO and is held.</p>
            <div className="space-y-2">
              <div><Label>Amount tolerance %</Label><Input type="number" step="0.001" value={tol.amount_tolerance_pct}
                onChange={(e) => setTol({ ...tol, amount_tolerance_pct: e.target.value })} /></div>
              <div><Label>Quantity tolerance %</Label><Input type="number" step="0.001" value={tol.quantity_tolerance_pct}
                onChange={(e) => setTol({ ...tol, quantity_tolerance_pct: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={tol.require_receipt}
                onChange={(e) => setTol({ ...tol, require_receipt: e.target.checked })} /> Require receipt (3-way)</label>
              <Button onClick={saveTolerance} disabled={busy}>{busy ? "Saving…" : "Save tolerance"}</Button>
              {tolSaved && <span className="ml-2 text-xs text-emerald-600">Saved.</span>}
            </div>
          </Card>
        </div>
      )}

      <Modal open={modal === "term"} onClose={() => setModal("")} title="New Payment Term">
        <form onSubmit={(e) => { e.preventDefault(); save("/ap-config/payment-terms",
          { name: term.name, due_days: Number(term.due_days), description: term.description || undefined }); }}
          className="space-y-3">
          <div><Label>Name</Label><Input value={term.name} onChange={(e) => setTerm({ ...term, name: e.target.value })} required placeholder="NET30" /></div>
          <div><Label>Net due days</Label><Input type="number" value={term.due_days} onChange={(e) => setTerm({ ...term, due_days: e.target.value })} required /></div>
          <div><Label>Description</Label><Input value={term.description} onChange={(e) => setTerm({ ...term, description: e.target.value })} /></div>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Create"}</Button>
        </form>
      </Modal>

      <Modal open={modal === "type"} onClose={() => setModal("")} title="New Vendor Type">
        <form onSubmit={(e) => { e.preventDefault(); save("/ap-config/vendor-types", vtype); }} className="space-y-3">
          <div><Label>Code</Label><Input value={vtype.code} onChange={(e) => setVtype({ ...vtype, code: e.target.value })} required placeholder="SNOW" /></div>
          <div><Label>Name</Label><Input value={vtype.name} onChange={(e) => setVtype({ ...vtype, name: e.target.value })} required placeholder="Contracted Snow" /></div>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Create"}</Button>
        </form>
      </Modal>

      <Modal open={modal === "method"} onClose={() => setModal("")} title="New Payment Method">
        <form onSubmit={(e) => { e.preventDefault(); save("/ap-config/payment-methods", method); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Code</Label><Input value={method.code} onChange={(e) => setMethod({ ...method, code: e.target.value })} required placeholder="CHECK" /></div>
            <div>
              <Label>Type</Label>
              <Select value={method.method_type} onChange={(e) => setMethod({ ...method, method_type: e.target.value })}>
                {["CHECK", "ACH", "WIRE", "CARD"].map((t) => <option key={t}>{t}</option>)}
              </Select>
            </div>
          </div>
          <div><Label>Name</Label><Input value={method.name} onChange={(e) => setMethod({ ...method, name: e.target.value })} required placeholder="Business Check" /></div>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Create"}</Button>
        </form>
      </Modal>

      <Modal open={modal === "set"} onClose={() => setModal("")} title="New Distribution Set">
        <form onSubmit={(e) => { e.preventDefault(); save("/ap-config/distribution-sets", {
          name: dset.name, description: dset.description || undefined,
          lines: dset.lines.map((l) => ({ code_combination_id: l.code_combination_id, percent: l.percent })),
        }); }} className="space-y-3">
          <div><Label>Name</Label><Input value={dset.name} onChange={(e) => setDset({ ...dset, name: e.target.value })} required /></div>
          <Label>Lines (percentages must total 100)</Label>
          {dset.lines.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_80px] gap-2">
              <Select value={l.code_combination_id} required
                onChange={(e) => { const lines = [...dset.lines]; lines[i] = { ...l, code_combination_id: e.target.value }; setDset({ ...dset, lines }); }}>
                <option value="">Account…</option>
                {combos.map((c) => <option key={c.id} value={c.id}>{c.concatenated_segments}</option>)}
              </Select>
              <Input type="number" step="0.0001" placeholder="%" value={l.percent}
                onChange={(e) => { const lines = [...dset.lines]; lines[i] = { ...l, percent: e.target.value }; setDset({ ...dset, lines }); }} />
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button type="button" variant="secondary"
              onClick={() => setDset({ ...dset, lines: [...dset.lines, { code_combination_id: "", percent: "" }] })}>+ Line</Button>
            <span className={`text-xs ${pctTotal === 100 ? "text-emerald-600" : "text-rose-600"}`}>Total: {pctTotal}%</span>
          </div>
          <Button type="submit" disabled={busy || pctTotal !== 100}>{busy ? "Saving…" : "Create"}</Button>
        </form>
      </Modal>
    </div>
  );
}
