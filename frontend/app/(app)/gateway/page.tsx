"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { GatewayConfig, GatewayTxn } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Select, Spinner } from "@/components/ui";

const TONE: Record<string, string> = { SUCCEEDED: "A", PENDING: "O", REFUNDED: "L", FAILED: "R", CHARGEBACK: "R" };

export default function GatewayPage() {
  const { token, activeTenantId } = useAuth();
  const [cfg, setCfg] = useState<GatewayConfig | null>(null);
  const [txns, setTxns] = useState<GatewayTxn[]>([]);
  const [secret, setSecret] = useState({ secret_key: "", webhook_secret: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [c, t] = await Promise.all([
        apiFetch<GatewayConfig>("/gateway/config", { token, tenantId: activeTenantId }),
        apiFetch<GatewayTxn[]>("/gateway/transactions", { token, tenantId: activeTenantId }),
      ]);
      setCfg(c); setTxns(t); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!cfg) return;
    setBusy("save"); setError(null); setMsg(null);
    try {
      const c = await apiFetch<GatewayConfig>("/gateway/config", {
        method: "PUT", token, tenantId: activeTenantId, body: {
          provider: cfg.provider, publishable_key: cfg.publishable_key || null,
          secret_key: secret.secret_key || undefined, webhook_secret: secret.webhook_secret || undefined,
          active: cfg.active } });
      setCfg(c); setSecret({ secret_key: "", webhook_secret: "" }); setMsg("Gateway saved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(null); }
  }

  async function refund(id: string) {
    if (!window.confirm("Refund this payment? A reversing GL batch will be created.")) return;
    setBusy(id); setError(null);
    try {
      await apiFetch(`/gateway/transactions/${id}/refund`, { method: "POST", token, tenantId: activeTenantId });
      setMsg("Refunded."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Refund failed"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Payment Gateway</h1>
          <p className="text-sm text-slate-500">Online collections via a hosted gateway (PCI handled by provider).</p>
        </div>
        <Button variant="secondary" onClick={() => downloadFile("/gateway/reconciliation/export", token!, activeTenantId!, "gateway_reconciliation.xlsx")}>Reconciliation xlsx</Button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      {loading ? <Spinner /> : cfg && (
        <>
          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Configuration</h2>
            <form onSubmit={save} className="grid items-end gap-3 md:grid-cols-2">
              <div>
                <Label>Provider</Label>
                <Select value={cfg.provider} onChange={(e) => setCfg({ ...cfg, provider: e.target.value })}>
                  <option value="MOCK">MOCK (testing)</option>
                  <option value="STRIPE">STRIPE</option>
                </Select>
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" checked={cfg.active} onChange={(e) => setCfg({ ...cfg, active: e.target.checked })} /> Active
              </label>
              <div><Label>Publishable key</Label><Input value={cfg.publishable_key || ""} onChange={(e) => setCfg({ ...cfg, publishable_key: e.target.value })} /></div>
              <div><Label>Secret key {cfg.secret_key_set && <span className="text-xs text-emerald-600">(set)</span>}</Label>
                <Input type="password" value={secret.secret_key} onChange={(e) => setSecret({ ...secret, secret_key: e.target.value })} placeholder="leave blank to keep" /></div>
              <div><Label>Webhook secret {cfg.webhook_secret_set && <span className="text-xs text-emerald-600">(set)</span>}</Label>
                <Input type="password" value={secret.webhook_secret} onChange={(e) => setSecret({ ...secret, webhook_secret: e.target.value })} placeholder="leave blank to keep" /></div>
              <div><Button type="submit" disabled={busy === "save"}>{busy === "save" ? "Saving…" : "Save"}</Button></div>
            </form>
            <p className="mt-2 text-xs text-slate-400">Webhook URL: <code>/api/v1/gateway/webhook/&lt;tenant_id&gt;</code> — signature-verified against the webhook secret.</p>
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Transactions</h2>
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-1 pr-3">Reference</th><th className="py-1 pr-3 text-right">Amount</th>
                <th className="py-1 pr-3">Status</th><th className="py-1 pr-3">When</th><th className="py-1 pr-3 text-right">Action</th></tr></thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100">
                    <td className="py-1 pr-3 font-mono text-xs">{t.txn_ref}</td>
                    <td className="py-1 pr-3 text-right">${Number(t.amount).toFixed(2)}</td>
                    <td className="py-1 pr-3"><Badge tone={TONE[t.status]}>{t.status}</Badge></td>
                    <td className="py-1 pr-3 text-xs">{new Date(t.created_at).toLocaleDateString()}</td>
                    <td className="py-1 pr-3 text-right">
                      {t.status === "SUCCEEDED" && !t.refund_of_id && (
                        <Button variant="secondary" onClick={() => refund(t.id)} disabled={busy === t.id}>Refund</Button>
                      )}
                    </td>
                  </tr>
                ))}
                {txns.length === 0 && <tr><td colSpan={5} className="py-2 text-slate-400">No transactions yet.</td></tr>}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
