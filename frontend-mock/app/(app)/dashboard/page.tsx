"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch } from "@/lib/api";
import type { Structure, StructureDetail, ValueSet, CodeCombination } from "@/lib/types";
import { Badge, Spinner, Alert } from "@/components/ui";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  ListTree, Layers, Link as LinkIcon, Box, 
  AlertCircle, FileSpreadsheet, FileText, ShoppingCart, DollarSign, ShieldCheck, TrendingUp, Activity
} from "lucide-react";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  BarChart, Bar, PieChart, Pie, Cell
} from "recharts";
import { motion } from "framer-motion";

interface Stats {
  structures: number;
  segments: number;
  combinations: number;
  valueSets: number;
  pendingApprovals: number;
  unpostedBatches: number;
  openTickets: number;
  purchaseOrders: number;
  arOutstanding: number;
}

interface IdStatus { status?: string }

const COMPLIANCE = [
  { code: "SOC 2 Type II", desc: "Audit logging & access control" },
  { code: "PCI DSS", desc: "Tokenized card storage (no PAN)" },
  { code: "ISO 27001", desc: "Encryption at rest & in transit" },
  { code: "CCPA", desc: "Data subject rights & retention" },
];

const MOCK_REVENUE_DATA = [
  { name: 'Jan', value: 4000 },
  { name: 'Feb', value: 3000 },
  { name: 'Mar', value: 2000 },
  { name: 'Apr', value: 2780 },
  { name: 'May', value: 1890 },
  { name: 'Jun', value: 2390 },
  { name: 'Jul', value: 3490 },
];

const MOCK_EXPENSE_PIE = [
  { name: 'Operations', value: 45000, color: '#0ea5e9' },
  { name: 'Maintenance', value: 30000, color: '#6366f1' },
  { name: 'Admin', value: 15000, color: '#f59e0b' },
  { name: 'Reserves', value: 10000, color: '#10b981' },
];

const MOCK_TICKETS_DATA = [
  { name: 'Mon', tickets: 12 },
  { name: 'Tue', tickets: 19 },
  { name: 'Wed', tickets: 15 },
  { name: 'Thu', tickets: 22 },
  { name: 'Fri', tickets: 10 },
  { name: 'Sat', tickets: 4 },
  { name: 'Sun', tickets: 6 },
];

export default function DashboardPage() {
  const { token, activeTenantId, memberships, user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token || !activeTenantId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const structures = await apiFetch<Structure[]>("/coa/structures", {
          token,
          tenantId: activeTenantId,
        });
        const valueSets = await apiFetch<ValueSet[]>("/coa/value-sets", {
          token,
          tenantId: activeTenantId,
        });
        let segments = 0;
        let combinations = 0;
        if (structures[0]) {
          const detail = await apiFetch<StructureDetail>(
            `/coa/structures/${structures[0].id}`,
            { token, tenantId: activeTenantId }
          );
          segments = detail.segments.length;
          const combos = await apiFetch<CodeCombination[]>(
            `/coa/structures/${structures[0].id}/combinations`,
            { token, tenantId: activeTenantId }
          );
          combinations = combos.length;
        }
        
        const safe = async <T,>(p: string): Promise<T[]> => {
          try {
            return await apiFetch<T[]>(p, { token, tenantId: activeTenantId });
          } catch {
            return [];
          }
        };
        const [approvals, batches, tickets, pos] = await Promise.all([
          safe<IdStatus>("/approvals/requests?status_filter=PENDING"),
          safe<IdStatus>("/gl/batches"),
          safe<IdStatus>("/service-desk/tickets"),
          safe<IdStatus>("/purchasing"),
        ]);
        let arOutstanding = 0;
        try {
          const ag = await apiFetch<{ grand_total: number }>("/subledger/aging",
            { token, tenantId: activeTenantId });
          arOutstanding = ag.grand_total;
        } catch { }
        setStats({
          structures: structures.length,
          segments,
          combinations,
          valueSets: valueSets.length,
          pendingApprovals: approvals.length,
          unpostedBatches: batches.filter((b) => b.status !== "POSTED").length,
          openTickets: tickets.filter((t) => t.status === "OPEN" || t.status === "IN_PROGRESS").length,
          purchaseOrders: pos.length,
          arOutstanding,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, [token, activeTenantId]);

  const tenantName =
    memberships.find((m) => m.tenant_id === activeTenantId)?.tenant_name ||
    (user?.isSuperadmin ? "Selected HOA" : "—");

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            {activeTenantId ? tenantName : "Select an HOA to begin."} · Functional currency: USD
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone="A" className="bg-emerald-50 text-emerald-700 border-emerald-200">
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 mr-2 animate-pulse"></span>
            System Operational
          </Badge>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      
      {loading ? (
        <div className="flex justify-center items-center h-64"><Spinner /></div>
      ) : (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, staggerChildren: 0.1 }}
          className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6"
        >
          
          {/* Main KPI Card - takes up 2 columns */}
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1 }} className="col-span-1 md:col-span-2 lg:col-span-2">
            <Card className="h-full shadow-sm border-slate-200/60 overflow-hidden relative group hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
              <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/80 via-white to-white opacity-80 z-0"></div>
              <CardHeader className="relative z-10 pb-2">
                <CardTitle className="text-sm font-medium text-slate-500 flex items-center justify-between">
                  <span>AR Outstanding</span>
                  <DollarSign className="h-4 w-4 text-indigo-500" />
                </CardTitle>
              </CardHeader>
              <CardContent className="relative z-10">
                <div className="text-4xl font-black text-slate-900 tracking-tight">
                  ${stats ? stats.arOutstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}
                </div>
                <p className="text-xs text-indigo-600 mt-1 font-medium flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  +12% from last month
                </p>
                <div className="h-[120px] mt-4 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={MOCK_REVENUE_DATA} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <Tooltip cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                      <Area type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorValue)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Secondary KPI Cards */}
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.2 }}>
            <Card className="h-full shadow-sm border-slate-200/60 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-slate-300 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 bg-amber-50 rounded-full blur-3xl opacity-0 group-hover:opacity-50 transition-opacity"></div>
              <CardHeader className="pb-2 relative z-10">
                <CardTitle className="text-sm font-medium text-slate-500 flex items-center justify-between">
                  <span>Pending Approvals</span>
                  <AlertCircle className="h-4 w-4 text-amber-500" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-black text-slate-800 tracking-tight">{stats?.pendingApprovals ?? "—"}</div>
                <p className="text-xs text-slate-400 mt-2 font-medium">Requires immediate action</p>
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }}>
            <Card className="h-full shadow-sm border-slate-200/60 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-slate-300 relative overflow-hidden group">
              <div className="absolute top-0 right-0 p-8 bg-rose-50 rounded-full blur-3xl opacity-0 group-hover:opacity-50 transition-opacity"></div>
              <CardHeader className="pb-2 relative z-10">
                <CardTitle className="text-sm font-medium text-slate-500 flex items-center justify-between">
                  <span>Unposted GL Batches</span>
                  <FileSpreadsheet className="h-4 w-4 text-rose-500" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-4xl font-black text-slate-800 tracking-tight">{stats?.unpostedBatches ?? "—"}</div>
                <p className="text-xs text-slate-400 mt-2 font-medium">Ready for review</p>
              </CardContent>
            </Card>
          </motion.div>

          {/* Expense Pie Chart */}
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.4 }} className="col-span-1 md:col-span-3 lg:col-span-2">
            <Card className="h-full shadow-sm border-slate-200/60 transition-all duration-300 hover:shadow-lg">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-slate-800">Expense Distribution</CardTitle>
                <CardDescription>YTD Expenses by category</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="min-h-[200px] w-full flex flex-col sm:flex-row items-center gap-4">
                  <div className="h-[200px] w-full sm:w-1/2">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={MOCK_EXPENSE_PIE} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={2} dataKey="value">
                          {MOCK_EXPENSE_PIE.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: any) => `$${Number(value).toLocaleString()}`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-full sm:w-1/2 flex flex-col gap-2">
                    {MOCK_EXPENSE_PIE.map((entry) => (
                      <div key={entry.name} className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <div className="h-3 w-3 rounded-full" style={{ backgroundColor: entry.color }} />
                          <span className="text-slate-600 font-medium">{entry.name}</span>
                        </div>
                        <span className="font-semibold text-slate-900">${(entry.value / 1000).toFixed(0)}k</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Service Desk Chart */}
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5 }} className="col-span-1 md:col-span-3 lg:col-span-2">
            <Card className="h-full shadow-sm border-slate-200/60 transition-all duration-300 hover:shadow-lg">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-slate-800">Service Desk Activity</CardTitle>
                <CardDescription>Volume of open tickets ({stats?.openTickets ?? 0} currently open)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[200px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={MOCK_TICKETS_DATA}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8' }} />
                      <Tooltip cursor={{ fill: '#f8fafc' }} />
                      <Bar dataKey="tickets" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* COA Configuration Mini-Bento */}
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.6 }} className="col-span-1 md:col-span-3 lg:col-span-4">
            <Card className="h-full shadow-sm border-transparent bg-slate-900 text-white transition-all duration-300 hover:shadow-xl hover:shadow-slate-900/20 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-64 h-64 bg-brand-500/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
              <CardHeader className="relative z-10 pb-2">
                <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                  <Activity className="h-4 w-4" /> System Configuration
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="rounded-lg bg-slate-800 p-4">
                    <div className="flex items-center gap-2 text-slate-400 text-xs mb-1 font-medium tracking-wide uppercase">
                      <ListTree className="h-3 w-3" /> Structures
                    </div>
                    <div className="text-2xl font-black">{stats?.structures ?? "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-800 p-4">
                    <div className="flex items-center gap-2 text-slate-400 text-xs mb-1 font-medium tracking-wide uppercase">
                      <Layers className="h-3 w-3" /> Segments
                    </div>
                    <div className="text-2xl font-black">{stats?.segments ?? "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-800 p-4">
                    <div className="flex items-center gap-2 text-slate-400 text-xs mb-1 font-medium tracking-wide uppercase">
                      <LinkIcon className="h-3 w-3" /> Combinations
                    </div>
                    <div className="text-2xl font-black">{stats?.combinations ?? "—"}</div>
                  </div>
                  <div className="rounded-lg bg-slate-800 p-4">
                    <div className="flex items-center gap-2 text-slate-400 text-xs mb-1 font-medium tracking-wide uppercase">
                      <Box className="h-3 w-3" /> Value Sets
                    </div>
                    <div className="text-2xl font-black">{stats?.valueSets ?? "—"}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
          
        </motion.div>
      )}

      {/* Compliance Section */}
      <Card className="shadow-sm border-slate-200/60 mt-8 border-t-4 border-t-emerald-500 hover:shadow-md transition-shadow">
        <CardHeader className="pb-4 border-b border-slate-100 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-600" />
            Compliance Posture
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {COMPLIANCE.map((c) => (
              <div
                key={c.code}
                className="group rounded-xl border border-slate-200 bg-white p-4 transition-all hover:border-emerald-200 hover:shadow-md"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500"></div>
                  <div className="text-sm font-bold text-slate-800">{c.code}</div>
                </div>
                <div className="text-xs text-slate-500 leading-relaxed">{c.desc}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
