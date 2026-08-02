"use client";

import { useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import { Alert, Button, Card, Input, Label, Spinner } from "@/components/ui";

interface BvaRow {
  account: string;
  fund: string;
  type: string;
  budget: string;
  actual: string;
  variance: string;
}

export default function ReportsPage() {
  const { token, activeTenantId } = useAuth();
  const [period, setPeriod] = useState("FEB-2026");
  const [start, setStart] = useState("2026-01-01");
  const [end, setEnd] = useState("2026-12-31");
  const [taxYear, setTaxYear] = useState("2026");
  const [error, setError] = useState<string | null>(null);
  const [bva, setBva] = useState<BvaRow[] | null>(null);
  const [loadingBva, setLoadingBva] = useState(false);

  async function dl(path: string, filename: string) {
    setError(null);
    try {
      await downloadFile(path, token!, activeTenantId!, filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  }

  async function loadBva() {
    setLoadingBva(true);
    setError(null);
    try {
      setBva(await apiFetch<BvaRow[]>(`/gl/budget-vs-actual?period=${encodeURIComponent(period)}`,
        { token, tenantId: activeTenantId }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load Budget vs Actual");
    } finally {
      setLoadingBva(false);
    }
  }

  const enc = encodeURIComponent;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Reports</h1>
        <p className="text-sm text-slate-500">
          Audit-ready financial and operational reports, fund-segmented (USD).
        </p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label>Period</Label>
            <Input value={period} onChange={(e) => setPeriod(e.target.value)} className="w-36" placeholder="FEB-2026" />
          </div>
          <div>
            <Label>Collections from</Label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-44" />
          </div>
          <div>
            <Label>to</Label>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-44" />
          </div>
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">General Ledger</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => dl(`/gl/trial-balance/export?period=${enc(period)}`, `trial_balance_${period}.xlsx`)}>Trial Balance (xlsx)</Button>
            <Button variant="secondary" onClick={() => dl(`/gl/financial-statements/export?period=${enc(period)}&fmt=xlsx`, `financials_${period}.xlsx`)}>Financials (xlsx)</Button>
            <Button variant="secondary" onClick={() => dl(`/gl/financial-statements/export?period=${enc(period)}&fmt=docx`, `financials_${period}.docx`)}>Financials (docx)</Button>
            <Button variant="secondary" onClick={() => dl(`/gl/budget-vs-actual/export?period=${enc(period)}`, `budget_vs_actual_${period}.xlsx`)}>Budget vs Actual (xlsx)</Button>
            <Button variant="secondary" onClick={() => dl(`/gl/board-report/export?period=${enc(period)}`, `board_report_${period}.pdf`)}>Board Report (PDF)</Button>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Receivables</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => dl(`/subledger/ar-aging/export`, `ar_aging.xlsx`)}>AR Aging (xlsx)</Button>
            <Button variant="secondary" onClick={() => dl(`/subledger/ar-summary/export`, `ar_by_fund.xlsx`)}>AR by Fund (xlsx)</Button>
            <Button variant="secondary" onClick={() => dl(`/subledger/collections/export?start=${enc(start)}&end=${enc(end)}`, `collections.xlsx`)}>Collections (xlsx)</Button>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Service Desk</h2>
          <Button variant="secondary" onClick={() => dl(`/service-desk/cost-summary/export`, `service_requests.xlsx`)}>Service Requests & Cost (xlsx)</Button>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Payables — 1099</h2>
          <div className="flex items-end gap-2">
            <div>
              <Label>Tax year</Label>
              <Input value={taxYear} onChange={(e) => setTaxYear(e.target.value)} className="w-24" />
            </div>
            <Button variant="secondary"
              onClick={() => dl(`/ap-config/1099/export?year=${enc(taxYear)}`, `1099_${taxYear}.xlsx`)}>
              1099 Vendor Payments (xlsx)
            </Button>
          </div>
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Compliance</h2>
          <Button variant="secondary" onClick={() => dl(`/privacy/compliance-report/export`, `compliance_summary.pdf`)}>Compliance Summary (PDF)</Button>
        </Card>
      </div>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Budget vs Actual — {period}</h2>
          <Button onClick={loadBva} disabled={loadingBva}>{loadingBva ? "Loading…" : "Run"}</Button>
        </div>
        {loadingBva ? (
          <Spinner />
        ) : bva && bva.length > 0 ? (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                  <th className="py-2 pr-3">Fund</th>
                  <th className="py-2 pr-3">Account</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3 text-right">Budget</th>
                  <th className="py-2 pr-3 text-right">Actual</th>
                  <th className="py-2 pr-3 text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {bva.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1 pr-3 font-mono text-xs">{r.fund}</td>
                    <td className="py-1 pr-3 font-mono text-xs">{r.account}</td>
                    <td className="py-1 pr-3">{r.type}</td>
                    <td className="py-1 pr-3 text-right">{Number(r.budget).toFixed(2)}</td>
                    <td className="py-1 pr-3 text-right">{Number(r.actual).toFixed(2)}</td>
                    <td className={`py-1 pr-3 text-right ${Number(r.variance) < 0 ? "text-rose-600" : "text-emerald-600"}`}>
                      {Number(r.variance).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : bva ? (
          <p className="text-sm text-slate-500">No budget or actuals for {period}.</p>
        ) : (
          <p className="text-sm text-slate-400">Click Run to compute Budget vs Actual for the period.</p>
        )}
      </Card>
    </div>
  );
}
