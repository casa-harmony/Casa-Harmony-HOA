"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile } from "@/lib/api";
import type { ExecDashboard, ForecastRow } from "@/lib/types";
import { Alert, Button, Card, Input, Spinner } from "@/components/ui";

const BUCKETS = ["Current", "1-30", "31-60", "61-90", "90+"];

export default function BoardDashboardPage() {
  const { token, activeTenantId } = useAuth();
  const [dash, setDash] = useState<ExecDashboard | null>(null);
  const [forecast, setForecast] = useState<ForecastRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState({ start: "2026-07-01", months: "6", as_of: "2026-06-30" });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [d, f] = await Promise.all([
        apiFetch<ExecDashboard>("/board/exec-dashboard", { token, tenantId: activeTenantId }),
        apiFetch<ForecastRow[]>(`/board/cash-flow-forecast?start=${opts.start}&months=${opts.months}`, { token, tenantId: activeTenantId }),
      ]);
      setDash(d); setForecast(f);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Board Dashboard</h1>
        <p className="text-sm text-slate-500">Fund health, delinquency, and cash-flow forecast.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      {loading ? <Spinner /> : dash && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Cash on hand", `$${Number(dash.cash_total).toFixed(2)}`],
              ["AR outstanding", `$${Number(dash.ar_open_total).toFixed(2)}`],
              ["Delinquent", `$${Number(dash.delinquent_total).toFixed(2)}`],
              ["Open cases", String(dash.open_cases)]].map(([k, v]) => (
              <Card key={k}>
                <div className="text-xs text-slate-400">{k}</div>
                <div className="mt-1 text-xl font-bold text-slate-800">{v}</div>
              </Card>
            ))}
          </div>

          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Fund health</h2>
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-1 pr-3">Fund</th><th className="py-1 pr-3 text-right">Cash</th>
                <th className="py-1 pr-3 text-right">AR open</th></tr></thead>
              <tbody>
                {dash.funds.map((f) => (
                  <tr key={f.fund} className="border-b border-slate-100">
                    <td className="py-1 pr-3 font-medium">{f.fund}</td>
                    <td className="py-1 pr-3 text-right">${Number(f.cash).toFixed(2)}</td>
                    <td className="py-1 pr-3 text-right">${Number(f.ar_open).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-700">Board packets & forecast</h2>
              <Input value={opts.as_of} onChange={(e) => setOpts({ ...opts, as_of: e.target.value })} className="w-32" />
              <Button variant="secondary" onClick={() => downloadFile(`/board/delinquency-packet/export?as_of=${opts.as_of}`, token!, activeTenantId!, "delinquency_packet.pdf")}>Delinquency packet (PDF)</Button>
              <Input value={opts.start} onChange={(e) => setOpts({ ...opts, start: e.target.value })} className="w-32" />
              <Input value={opts.months} onChange={(e) => setOpts({ ...opts, months: e.target.value })} className="w-16" />
              <Button variant="secondary" onClick={load}>Refresh</Button>
              <Button variant="secondary" onClick={() => downloadFile(`/board/cash-flow-forecast/export?start=${opts.start}&months=${opts.months}`, token!, activeTenantId!, "cash_flow_forecast.xlsx")}>Forecast (xlsx)</Button>
            </div>
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-1 pr-3">Period</th><th className="py-1 pr-3">Fund</th>
                <th className="py-1 pr-3 text-right">Opening</th><th className="py-1 pr-3 text-right">Inflows</th>
                <th className="py-1 pr-3 text-right">Outflows</th><th className="py-1 pr-3 text-right">Ending</th></tr></thead>
              <tbody>
                {forecast.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-1 pr-3">{r.period}</td>
                    <td className="py-1 pr-3">{r.fund}</td>
                    <td className="py-1 pr-3 text-right">${Number(r.opening).toFixed(0)}</td>
                    <td className="py-1 pr-3 text-right text-emerald-600">+${Number(r.inflow).toFixed(0)}</td>
                    <td className="py-1 pr-3 text-right text-rose-600">-${Number(r.outflow).toFixed(0)}</td>
                    <td className="py-1 pr-3 text-right font-medium">${Number(r.ending).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold text-slate-700">Aging by Fund</h2>
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-1 pr-3">Fund</th>{BUCKETS.map((b) => <th key={b} className="py-1 pr-3 text-right">{b}</th>)}</tr></thead>
              <tbody>
                {Object.entries(dash.aging_by_fund).map(([fund, b]) => (
                  <tr key={fund} className="border-b border-slate-100">
                    <td className="py-1 pr-3 font-medium">{fund}</td>
                    {BUCKETS.map((k) => <td key={k} className="py-1 pr-3 text-right">${Number(b[k] || 0).toFixed(0)}</td>)}
                  </tr>
                ))}
                {Object.keys(dash.aging_by_fund).length === 0 && <tr><td colSpan={6} className="py-2 text-slate-400">No delinquencies.</td></tr>}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
