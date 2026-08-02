"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { GlBatch } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Spinner } from "@/components/ui";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "none", SUBMITTED: "R", APPROVED: "O", POSTED: "A", REJECTED: "L",
};

export default function GlPage() {
  const { token, activeTenantId } = useAuth();
  const [batches, setBatches] = useState<GlBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [period, setPeriod] = useState("FEB-2026");
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      setBatches(await apiFetch<GlBatch[]>("/gl/batches", { token, tenantId: activeTenantId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load batches");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTenantId]);

  async function postingRun() {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const r = await apiFetch<{ count: number }>("/gl/posting-runs", {
        method: "POST", token, tenantId: activeTenantId,
      });
      setMsg(`Posting run complete: ${r.count} batch(es) posted.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Posting run failed");
    } finally {
      setBusy(false);
    }
  }

  async function exportTB() {
    try {
      await downloadFile(
        `/gl/trial-balance/export?period=${encodeURIComponent(period)}`,
        token!, activeTenantId!, `trial_balance_${period}.xlsx`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  }

  async function exportFS(fmt: "xlsx" | "docx") {
    try {
      await downloadFile(
        `/gl/financial-statements/export?period=${encodeURIComponent(period)}&fmt=${fmt}`,
        token!, activeTenantId!, `financial_statements_${period}.${fmt}`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  }

  const posted = batches.filter((b) => b.status === "POSTED");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">General Ledger</h1>
          <p className="text-sm text-slate-500">
            Journal batches, control totals, and posting to balances.
          </p>
        </div>
        <Button onClick={postingRun} disabled={busy}>
          {busy ? "Posting…" : "▶ Run Nightly Posting"}
        </Button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-700">Reports · Period</span>
          <Input value={period} onChange={(e) => setPeriod(e.target.value)}
            className="w-40" placeholder="FEB-2026" />
          <Button variant="secondary" onClick={exportTB}>Trial Balance ⬇</Button>
          <Button variant="secondary" onClick={() => exportFS("xlsx")}>Financials (xlsx) ⬇</Button>
          <Button variant="secondary" onClick={() => exportFS("docx")}>Financials (docx) ⬇</Button>
        </div>
        <p className="text-xs text-slate-400">
          Fund-based Balance Sheet + Statement of Revenues &amp; Expenses.
        </p>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Journal Batches ({batches.length})
        </h2>
        {loading ? (
          <Spinner />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                  <th className="py-2 pr-3">Batch</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Period</th>
                  <th className="py-2 pr-3">Dr</th>
                  <th className="py-2 pr-3">Cr</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-medium text-slate-700">{b.batch_name}</td>
                    <td className="py-2 pr-3"><Badge>{b.source}</Badge></td>
                    <td className="py-2 pr-3 font-mono text-xs">{b.period_name}</td>
                    <td className="py-2 pr-3">{Number(b.control_total_dr).toFixed(2)}</td>
                    <td className="py-2 pr-3">{Number(b.control_total_cr).toFixed(2)}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <Link href={`/gl/${b.id}`} className="text-xs text-brand-600 hover:underline">
                        review →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-400">
          Posting history: {posted.length} posted batch(es).
        </p>
      </Card>
    </div>
  );
}
