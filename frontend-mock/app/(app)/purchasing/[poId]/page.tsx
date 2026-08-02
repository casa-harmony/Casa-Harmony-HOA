"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../../providers";
import { apiFetch } from "@/lib/api";
import type { CodeCombination, PoDetail, Structure } from "@/lib/types";
import { Alert, Badge, Button, Card, Spinner } from "@/components/ui";

const TONE: Record<string, string> = {
  INCOMPLETE: "none", SUBMITTED: "R", APPROVED: "A", REJECTED: "L", CANCELLED: "L",
  PARTIALLY_BILLED: "O", FULLY_BILLED: "A", CLOSED: "none",
};

export default function PoDetailPage() {
  const { poId } = useParams<{ poId: string }>();
  const { token, activeTenantId } = useAuth();
  const [po, setPo] = useState<PoDetail | null>(null);
  const [accts, setAccts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token || !activeTenantId) return;
    (async () => {
      try {
        const detail = await apiFetch<PoDetail>(`/purchasing/${poId}`, { token, tenantId: activeTenantId });
        setPo(detail);
        const structures = await apiFetch<Structure[]>("/coa/structures", { token, tenantId: activeTenantId });
        if (structures[0]) {
          const combos = await apiFetch<CodeCombination[]>(
            `/coa/structures/${structures[0].id}/combinations`, { token, tenantId: activeTenantId });
          setAccts(Object.fromEntries(combos.map((c) => [c.id, c.concatenated_segments])));
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, activeTenantId, poId]);

  if (loading) return <Spinner />;
  if (!po) return <Alert kind="error">{error || "Not found"}</Alert>;

  const pct = Number(po.amount_limit) > 0 ? (Number(po.billed_amount) / Number(po.amount_limit)) * 100 : 0;

  async function closePo() {
    if (!po || !window.confirm(`Close PO ${po.po_number}?`)) return;
    setBusy(true);
    try {
      const updated = await apiFetch<PoDetail>(`/purchasing/${po.id}/close`, { method: "POST", token, tenantId: activeTenantId });
      setPo({ ...po, status: updated.status });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Close failed");
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/purchasing" className="text-xs text-brand-600">← Purchasing</Link>
          <h1 className="text-xl font-bold text-slate-800">{po.po_number} <Badge tone={TONE[po.status]}>{po.status}</Badge></h1>
          <p className="text-sm text-slate-500">
            {po.document_type}{po.description && ` · ${po.description}`}
            {po.start_date && ` · ${po.start_date} → ${po.end_date || "—"}`}
          </p>
        </div>
        {!["INCOMPLETE", "CANCELLED", "CLOSED"].includes(po.status) && (
          <Button variant="secondary" onClick={closePo} disabled={busy}>{busy ? "Closing…" : "Close PO"}</Button>
        )}
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      <div className="grid grid-cols-3 gap-4">
        <Card><div className="text-xs uppercase text-slate-400">Committed</div><div className="text-lg font-bold">${Number(po.amount).toFixed(2)}</div></Card>
        <Card><div className="text-xs uppercase text-slate-400">Limit (cap)</div><div className="text-lg font-bold">${Number(po.amount_limit).toFixed(2)}</div></Card>
        <Card>
          <div className="text-xs uppercase text-slate-400">Billed ({pct.toFixed(0)}%)</div>
          <div className="text-lg font-bold">${Number(po.billed_amount).toFixed(2)}</div>
          <div className="mt-1 h-2 w-full rounded bg-slate-100">
            <div className={`h-2 rounded ${pct >= 100 ? "bg-rose-500" : "bg-brand-500"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
        </Card>
      </div>

      {po.lines.map((l) => (
        <Card key={l.id}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">Line {l.line_num}: {l.item_description}</span>
            <span className="text-sm text-slate-500">{Number(l.quantity)} × ${Number(l.unit_price).toFixed(2)} = ${Number(l.line_amount).toFixed(2)}</span>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-1 pr-3">Account</th><th className="py-1 pr-3">Fund</th>
                <th className="py-1 pr-3 text-right">Amount</th><th className="py-1 pr-3 text-right">Qty Ord</th>
                <th className="py-1 pr-3 text-right">Qty Rcvd</th><th className="py-1 pr-3 text-right">Qty Billed</th>
                <th className="py-1 pr-3 text-right">Amt Billed</th>
              </tr>
            </thead>
            <tbody>
              {l.distributions.map((d) => (
                <tr key={d.id} className="border-b border-slate-100">
                  <td className="py-1 pr-3 font-mono text-xs">{accts[d.code_combination_id] || d.code_combination_id.slice(0, 8)}</td>
                  <td className="py-1 pr-3">{d.fund_value}</td>
                  <td className="py-1 pr-3 text-right">${Number(d.amount).toFixed(2)}</td>
                  <td className="py-1 pr-3 text-right">{Number(d.quantity_ordered)}</td>
                  <td className="py-1 pr-3 text-right">{Number(d.quantity_received)}</td>
                  <td className="py-1 pr-3 text-right">{Number(d.quantity_billed)}</td>
                  <td className="py-1 pr-3 text-right">${Number(d.amount_billed).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
