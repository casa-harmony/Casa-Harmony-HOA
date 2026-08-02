"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { CodeCombination, GlBatchDetail, Structure } from "@/lib/types";
import { Alert, Badge, Button, Card, Spinner } from "@/components/ui";

const TONE: Record<string, string> = {
  DRAFT: "none", SUBMITTED: "R", APPROVED: "O", POSTED: "A", REJECTED: "L",
};

export default function GlBatchReviewPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const { token, activeTenantId } = useAuth();
  const [batch, setBatch] = useState<GlBatchDetail | null>(null);
  const [accounts, setAccounts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const b = await apiFetch<GlBatchDetail>(`/gl/batches/${batchId}`, {
        token, tenantId: activeTenantId,
      });
      setBatch(b);
      // Resolve code combination ids → concatenated string for KFF display.
      const structures = await apiFetch<Structure[]>("/coa/structures", {
        token, tenantId: activeTenantId,
      });
      if (structures[0]) {
        const combos = await apiFetch<CodeCombination[]>(
          `/coa/structures/${structures[0].id}/combinations`,
          { token, tenantId: activeTenantId }
        );
        const map: Record<string, string> = {};
        combos.forEach((c) => (map[c.id] = c.concatenated_segments));
        setAccounts(map);
      }
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load batch");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTenantId, batchId]);

  async function action(verb: "submit" | "approve" | "post") {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/gl/batches/${batchId}/${verb}`, {
        method: "POST", token, tenantId: activeTenantId,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : `${verb} failed`);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner />;
  if (!batch) return <Alert kind="error">{error || "Not found"}</Alert>;

  const balanced = Number(batch.control_total_dr) === Number(batch.control_total_cr);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/gl" className="text-xs text-brand-600">← General Ledger</Link>
          <h1 className="text-xl font-bold text-slate-800">{batch.batch_name}</h1>
          <p className="text-sm text-slate-500">
            Source {batch.source} · Period {batch.period_name} ·{" "}
            <Badge tone={TONE[batch.status]}>{batch.status}</Badge>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary"
            onClick={() => downloadFile(`/gl/batches/${batchId}/export`, token!, activeTenantId!,
              `batch_${batch.batch_name}.xlsx`)}>
            ⬇ xlsx
          </Button>
          {batch.status === "DRAFT" && (
            <Button onClick={() => action("submit")} disabled={busy}>Submit</Button>
          )}
          {batch.status === "SUBMITTED" && (
            <Button onClick={() => action("approve")} disabled={busy}>Approve</Button>
          )}
          {batch.status === "APPROVED" && (
            <Button onClick={() => action("post")} disabled={busy}>Post to GL</Button>
          )}
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <Card>
        <div className="flex flex-wrap gap-6 text-sm">
          <div>
            <div className="text-xs uppercase text-slate-400">Total Debits</div>
            <div className="text-lg font-bold text-slate-800">
              {Number(batch.control_total_dr).toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-400">Total Credits</div>
            <div className="text-lg font-bold text-slate-800">
              {Number(batch.control_total_cr).toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-slate-400">Balanced</div>
            <div className="text-lg font-bold">
              {balanced ? (
                <span className="text-emerald-600">✓ In balance</span>
              ) : (
                <span className="text-rose-600">✗ Out of balance</span>
              )}
            </div>
          </div>
        </div>
      </Card>

      {batch.headers.map((h) => (
        <Card key={h.id}>
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className="font-semibold text-slate-800">{h.je_name}</div>
              <div className="text-xs text-slate-400">
                {h.je_category} · {h.je_source} · {h.accounting_date}
                {h.source_doc_type && ` · from ${h.source_doc_type}`}
              </div>
            </div>
            <Badge tone={TONE[h.status]}>{h.status}</Badge>
          </div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-1 pr-3">#</th>
                <th className="py-1 pr-3">Account (KFF combination)</th>
                <th className="py-1 pr-3">Fund</th>
                <th className="py-1 pr-3 text-right">Debit</th>
                <th className="py-1 pr-3 text-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {h.lines.map((l) => (
                <tr key={l.line_num} className="border-b border-slate-100">
                  <td className="py-1 pr-3 font-mono">{l.line_num}</td>
                  <td className="py-1 pr-3 font-mono text-xs">
                    {accounts[l.code_combination_id] || l.code_combination_id?.slice(0, 8) || "Unknown"}
                  </td>
                  <td className="py-1 pr-3"><Badge tone="fund">{l.fund_value}</Badge></td>
                  <td className="py-1 pr-3 text-right">
                    {Number(l.entered_dr) ? Number(l.entered_dr).toFixed(2) : ""}
                  </td>
                  <td className="py-1 pr-3 text-right">
                    {Number(l.entered_cr) ? Number(l.entered_cr).toFixed(2) : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}
