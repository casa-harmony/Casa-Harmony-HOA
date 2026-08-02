"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { CodeCombination, CommitmentRow, EncumbranceSettings, PoEncumbrance, Structure, Vendor } from "@/lib/types";
import { Alert, Badge, Button, Card, Label, Select, Spinner } from "@/components/ui";

export default function EncumbrancePage() {
  const { token, activeTenantId } = useAuth();
  const [settings, setSettings] = useState<EncumbranceSettings | null>(null);
  const [encs, setEncs] = useState<PoEncumbrance[]>([]);
  const [commitments, setCommitments] = useState<CommitmentRow[]>([]);
  const [combos, setCombos] = useState<CodeCombination[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [s, e, c, v, structures] = await Promise.all([
        apiFetch<EncumbranceSettings>("/encumbrance/settings", { token, tenantId: activeTenantId }).catch(() => null),
        apiFetch<PoEncumbrance[]>("/encumbrance", { token, tenantId: activeTenantId }),
        apiFetch<CommitmentRow[]>("/encumbrance/commitments", { token, tenantId: activeTenantId }),
        apiFetch<Vendor[]>("/vendors", { token, tenantId: activeTenantId }),
        apiFetch<Structure[]>("/coa/structures", { token, tenantId: activeTenantId }),
      ]);
      setSettings(s || { id: null, enabled: false, encumbrance_combination_id: null, reserve_combination_id: null });
      setEncs(e); setCommitments(c); setVendors(v);
      if (structures[0]) setCombos(await apiFetch<CodeCombination[]>(
        `/coa/structures/${structures[0].id}/combinations`, { token, tenantId: activeTenantId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  const vName = (id: string) => vendors.find((v) => v.id === id)?.name || id?.slice(0, 8) || "Unknown";

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setBusy(true); setError(null);
    try {
      await apiFetch("/encumbrance/settings", { method: "PUT", token, tenantId: activeTenantId,
        body: { enabled: settings.enabled,
                encumbrance_combination_id: settings.encumbrance_combination_id || null,
                reserve_combination_id: settings.reserve_combination_id || null } });
      setMsg("Encumbrance settings saved."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Encumbrances & Commitments</h1>
          <p className="text-sm text-slate-500">Open commitments by contract, cost center, and Fund.</p>
        </div>
        <Button variant="secondary" onClick={() => downloadFile("/encumbrance/register/export", token!, activeTenantId!, "encumbrance_register.xlsx")}>Register xlsx</Button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      {loading ? <Spinner /> : (
        <>
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">GL Encumbrance Settings</h2>
            {settings && (
              <form onSubmit={saveSettings} className="grid items-end gap-3 md:grid-cols-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={settings.enabled}
                    onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />
                  Post encumbrance journals
                </label>
                <div>
                  <Label>Encumbrance account</Label>
                  <Select value={settings.encumbrance_combination_id || ""}
                    onChange={(e) => setSettings({ ...settings, encumbrance_combination_id: e.target.value || null })}>
                    <option value="">—</option>
                    {combos.map((c) => <option key={c.id} value={c.id}>{c.concatenated_segments}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Reserve account</Label>
                  <Select value={settings.reserve_combination_id || ""}
                    onChange={(e) => setSettings({ ...settings, reserve_combination_id: e.target.value || null })}>
                    <option value="">—</option>
                    {combos.map((c) => <option key={c.id} value={c.id}>{c.concatenated_segments}</option>)}
                  </Select>
                </div>
                <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              </form>
            )}
            <p className="mt-2 text-xs text-slate-400">
              When enabled, PO approval posts Dr encumbrance / Cr reserve (draft GL batch); billing
              liquidates it proportionally. When off, commitments are still tracked here without GL.
            </p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Encumbrance inquiry (by PO)</h2>
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                  <th className="py-1 pr-3">PO</th><th className="py-1 pr-3">Vendor</th>
                  <th className="py-1 pr-3 text-right">Encumbered</th><th className="py-1 pr-3 text-right">Liquidated</th>
                  <th className="py-1 pr-3 text-right">Open</th></tr></thead>
                <tbody>
                  {encs.map((e) => (
                    <tr key={e.id} className="border-b border-slate-100">
                      <td className="py-1 pr-3 font-mono">{e.po_number}</td>
                      <td className="py-1 pr-3">{vName(e.vendor_id)}</td>
                      <td className="py-1 pr-3 text-right">${Number(e.encumbered_amount).toFixed(2)}</td>
                      <td className="py-1 pr-3 text-right text-slate-500">${Number(e.liquidated_amount).toFixed(2)}</td>
                      <td className="py-1 pr-3 text-right font-medium">${Number(e.open_commitment).toFixed(2)}</td>
                    </tr>
                  ))}
                  {encs.length === 0 && <tr><td colSpan={5} className="py-2 text-slate-400">No encumbrances yet.</td></tr>}
                </tbody>
              </table>
            </Card>

            <Card>
              <h2 className="mb-2 text-sm font-semibold text-slate-700">Available commitment by Cost Center / Fund</h2>
              <table className="w-full text-left text-sm">
                <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                  <th className="py-1 pr-3">Cost Center</th><th className="py-1 pr-3">Fund</th>
                  <th className="py-1 pr-3 text-right">Committed</th><th className="py-1 pr-3 text-right">Billed</th>
                  <th className="py-1 pr-3 text-right">Available</th></tr></thead>
                <tbody>
                  {commitments.map((c, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="py-1 pr-3">{c.cost_center}</td>
                      <td className="py-1 pr-3"><Badge tone={c.fund_value === "RESV" ? "O" : "A"}>{c.fund_value}</Badge></td>
                      <td className="py-1 pr-3 text-right">${Number(c.committed).toFixed(2)}</td>
                      <td className="py-1 pr-3 text-right text-slate-500">${Number(c.billed).toFixed(2)}</td>
                      <td className="py-1 pr-3 text-right font-medium">${Number(c.available).toFixed(2)}</td>
                    </tr>
                  ))}
                  {commitments.length === 0 && <tr><td colSpan={5} className="py-2 text-slate-400">No open commitments.</td></tr>}
                </tbody>
              </table>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
