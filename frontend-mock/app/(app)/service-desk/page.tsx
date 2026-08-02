"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch } from "@/lib/api";
import type { CodeCombination, ServiceTicket, Structure, Vendor } from "@/lib/types";
import { Alert, Spinner } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal, Plus, LayoutGrid, List, ArrowRight, CheckCircle2, AlertCircle, Clock, CheckCircle } from "lucide-react";
import { motion } from "framer-motion";
import { AreaChart, Area, ResponsiveContainer, Tooltip } from "recharts";

const PRIORITY_VARIANT: Record<string, "destructive" | "default" | "secondary" | "outline"> = { LOW: "secondary", MEDIUM: "default", HIGH: "destructive" };
const STATUS_VARIANT: Record<string, "destructive" | "default" | "secondary" | "outline"> = {
  OPEN: "default", IN_PROGRESS: "secondary", RESOLVED: "outline", CLOSED: "outline",
};

const MOCK_TICKET_TREND = [
  { day: 'M', value: 5 }, { day: 'T', value: 8 }, { day: 'W', value: 12 },
  { day: 'T', value: 7 }, { day: 'F', value: 15 }, { day: 'S', value: 4 }, { day: 'S', value: 6 }
];

export default function ServiceDeskPage() {
  const { token, activeTenantId } = useAuth();
  const [tickets, setTickets] = useState<ServiceTicket[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [combos, setCombos] = useState<CodeCombination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  
  const [sheetOpen, setSheetOpen] = useState(false);
  const [poFor, setPoFor] = useState<ServiceTicket | null>(null);
  
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"kanban" | "table">("table");
  const [form, setForm] = useState({
    subject: "", description: "", category: "MAINTENANCE", priority: "MEDIUM",
    vendor_id: "", estimated_cost: "",
  });
  const [poAccount, setPoAccount] = useState("");

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [t, v, structures] = await Promise.all([
        apiFetch<ServiceTicket[]>("/service-desk/tickets", { token, tenantId: activeTenantId }),
        apiFetch<Vendor[]>("/vendors", { token, tenantId: activeTenantId }),
        apiFetch<Structure[]>("/coa/structures", { token, tenantId: activeTenantId }),
      ]);
      setTickets(t);
      setVendors(v);
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

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTenantId]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/service-desk/tickets", {
        method: "POST", token, tenantId: activeTenantId,
        body: {
          subject: form.subject, description: form.description || undefined,
          category: form.category, priority: form.priority,
          vendor_id: form.vendor_id || undefined,
          estimated_cost: form.estimated_cost || undefined,
        },
      });
      setSheetOpen(false);
      setForm({ subject: "", description: "", category: "MAINTENANCE", priority: "MEDIUM",
                vendor_id: "", estimated_cost: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create ticket");
    } finally {
      setBusy(false);
    }
  }

  async function createPo(e: React.FormEvent) {
    e.preventDefault();
    if (!poFor) return;
    setBusy(true);
    setError(null);
    try {
      const po = await apiFetch<{ po_number: string }>(
        `/service-desk/tickets/${poFor.id}/create-po`,
        { method: "POST", token, tenantId: activeTenantId, body: { code_combination_id: poAccount } }
      );
      setMsg(`Created ${po.po_number} from ${poFor.ticket_number}.`);
      setPoFor(null);
      setPoAccount("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create PO");
    } finally {
      setBusy(false);
    }
  }

  async function moveTicket(t: ServiceTicket, status: string) {
    setError(null);
    try {
      await apiFetch(`/service-desk/tickets/${t.id}`, {
        method: "PATCH", token, tenantId: activeTenantId, body: { status },
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to move ticket");
    }
  }

  const COLUMNS = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];
  const NEXT: Record<string, string> = { OPEN: "IN_PROGRESS", IN_PROGRESS: "RESOLVED", RESOLVED: "CLOSED" };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Service Desk</h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage HOA maintenance requests, complaints, and drive expenses.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
            <button
              onClick={() => setView("table")}
              className={`p-1.5 rounded-md text-sm font-medium flex items-center gap-1 transition-all ${
                view === "table" ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200"
              }`}
            >
              <List className="h-4 w-4" /> 
            </button>
            <button
              onClick={() => setView("kanban")}
              className={`p-1.5 rounded-md text-sm font-medium flex items-center gap-1 transition-all ${
                view === "kanban" ? "bg-white shadow-sm text-slate-800" : "text-slate-500 hover:text-slate-700 hover:bg-slate-200"
              }`}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
          <Button onClick={() => setSheetOpen(true)} className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
            <Plus className="h-4 w-4" /> New Ticket
          </Button>
        </div>
      </div>
      
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      {/* KPI Row */}
      {!loading && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="shadow-sm border-slate-200/60 overflow-hidden relative group">
            <div className="absolute right-0 top-0 p-6 bg-indigo-50 rounded-full blur-2xl opacity-0 group-hover:opacity-50 transition-opacity"></div>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Total Tickets</p>
                <p className="text-3xl font-black text-slate-800">{tickets.length}</p>
              </div>
              <div className="h-10 w-10 bg-indigo-100 rounded-full flex items-center justify-center">
                <List className="h-5 w-5 text-indigo-600" />
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm border-slate-200/60 overflow-hidden relative group">
             <div className="absolute right-0 top-0 p-6 bg-rose-50 rounded-full blur-2xl opacity-0 group-hover:opacity-50 transition-opacity"></div>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Open</p>
                <p className="text-3xl font-black text-slate-800">{tickets.filter(t => t.status === "OPEN").length}</p>
              </div>
              <div className="h-10 w-10 bg-rose-100 rounded-full flex items-center justify-center">
                <AlertCircle className="h-5 w-5 text-rose-600" />
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm border-slate-200/60 overflow-hidden relative group">
            <div className="absolute right-0 top-0 p-6 bg-amber-50 rounded-full blur-2xl opacity-0 group-hover:opacity-50 transition-opacity"></div>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">In Progress</p>
                <p className="text-3xl font-black text-slate-800">{tickets.filter(t => t.status === "IN_PROGRESS").length}</p>
              </div>
              <div className="h-10 w-10 bg-amber-100 rounded-full flex items-center justify-center">
                <Clock className="h-5 w-5 text-amber-600" />
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm border-slate-200/60 overflow-hidden relative p-0 flex flex-col justify-end bg-gradient-to-br from-emerald-50 to-emerald-100/50">
            <div className="absolute top-4 left-4 z-10">
              <p className="text-xs font-semibold text-emerald-800 uppercase tracking-wider mb-1">Weekly Trend</p>
              <p className="text-xl font-black text-emerald-900">+14%</p>
            </div>
            <div className="h-24 w-full mt-auto">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={MOCK_TICKET_TREND} margin={{ top: 30, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <Tooltip contentStyle={{ fontSize: '12px', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorTrend)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>
      )}

      {!loading && view === "kanban" && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }} className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {COLUMNS.map((col) => (
            <div key={col} className="rounded-xl bg-slate-50/80 border border-slate-200 p-3 flex flex-col gap-3 shadow-inner">
              <div className="flex items-center justify-between px-1 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{col.replace("_", " ")}</span>
                <Badge variant="secondary" className="bg-white text-slate-700 shadow-sm border border-slate-200/60">{tickets.filter((t) => t.status === col).length}</Badge>
              </div>
              <div className="flex-1 space-y-3">
                {tickets.filter((t) => t.status === col).map((t) => (
                  <div key={t.id} className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-[11px] font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{t.ticket_number}</span>
                      <Badge variant={t.priority === "HIGH" ? "destructive" : t.priority === "MEDIUM" ? "default" : "secondary"} className="text-[10px] shadow-sm">
                        {t.priority}
                      </Badge>
                    </div>
                    <div className="text-sm font-bold text-slate-800 mb-2 leading-snug line-clamp-2">{t.subject}</div>
                    <div className="text-xs text-slate-500 mb-4 flex items-center justify-between">
                       <span className="text-slate-600 font-medium">{t.category}</span>
                       {t.estimated_cost && (
                         <span className="text-indigo-600 font-mono font-bold bg-indigo-50 px-1.5 py-0.5 rounded-md">${Number(t.estimated_cost).toFixed(2)}</span>
                       )}
                    </div>
                    <div className="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
                      {NEXT[t.status] && (
                        <button onClick={(e) => { e.stopPropagation(); moveTicket(t, NEXT[t.status]) }}
                          className="flex items-center gap-1 w-full justify-center rounded-lg bg-indigo-50 px-2 py-1.5 text-xs font-semibold text-indigo-700 hover:bg-indigo-600 hover:text-white transition-colors">
                           Move to {NEXT[t.status].replace("_", " ")} <ArrowRight className="h-3 w-3" />
                        </button>
                      )}
                      {!t.po_header_id && t.vendor_id && t.estimated_cost && (
                        <button onClick={(e) => { e.stopPropagation(); setPoFor(t) }}
                          className="flex items-center justify-center w-full gap-1 rounded-lg bg-emerald-50 px-2 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-600 hover:text-white transition-colors mt-1">
                          <CheckCircle2 className="h-3 w-3" /> Generate PO
                        </button>
                      )}
                      {t.po_header_id && <div className="w-full text-center mt-1"><Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">PO GENERATED</Badge></div>}
                    </div>
                  </div>
                ))}
                {tickets.filter((t) => t.status === col).length === 0 && (
                   <div className="flex items-center justify-center p-6 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                      <span className="text-xs font-medium text-slate-400">No tickets</span>
                   </div>
                )}
              </div>
            </div>
          ))}
        </motion.div>
      )}

      {view === "table" && (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }}>
        <Card className="shadow-sm border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            {loading ? (
               <div className="flex justify-center p-12"><Spinner /></div>
            ) : (
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="font-semibold text-slate-600">Ticket ID</TableHead>
                    <TableHead className="font-semibold text-slate-600">Subject</TableHead>
                    <TableHead className="font-semibold text-slate-600">Category</TableHead>
                    <TableHead className="font-semibold text-slate-600">Priority</TableHead>
                    <TableHead className="font-semibold text-slate-600">Status</TableHead>
                    <TableHead className="font-semibold text-slate-600 text-right">Est. Cost</TableHead>
                    <TableHead className="font-semibold text-slate-600 text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tickets.length === 0 && (
                     <TableRow>
                        <TableCell colSpan={7} className="h-32 text-center text-slate-500 font-medium">
                           No tickets found.
                        </TableCell>
                     </TableRow>
                  )}
                  {tickets.map((t) => (
                    <TableRow key={t.id} className="hover:bg-slate-50 transition-colors group">
                      <TableCell className="font-mono text-[11px] font-medium text-slate-500"><span className="bg-slate-100 px-1.5 py-0.5 rounded">{t.ticket_number}</span></TableCell>
                      <TableCell className="font-semibold text-slate-800">{t.subject}</TableCell>
                      <TableCell><span className="text-slate-600 font-medium">{t.category}</span></TableCell>
                      <TableCell><Badge variant={PRIORITY_VARIANT[t.priority]} className="shadow-sm">{t.priority}</Badge></TableCell>
                      <TableCell><Badge variant={STATUS_VARIANT[t.status]} className={t.status === "RESOLVED" || t.status === "CLOSED" ? "bg-slate-100 text-slate-600" : "shadow-sm"}>{t.status}</Badge></TableCell>
                      <TableCell className="text-right font-mono font-bold text-slate-700">
                         {t.estimated_cost ? `$${Number(t.estimated_cost).toFixed(2)}` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                         <DropdownMenu>
                           <DropdownMenuTrigger asChild>
                             <Button variant="ghost" className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity">
                               <span className="sr-only">Open menu</span>
                               <MoreHorizontal className="h-4 w-4" />
                             </Button>
                           </DropdownMenuTrigger>
                           <DropdownMenuContent align="end" className="w-[200px]">
                             <DropdownMenuLabel>Actions</DropdownMenuLabel>
                             {NEXT[t.status] && (
                               <DropdownMenuItem onClick={() => moveTicket(t, NEXT[t.status])}>
                                 Mark as {NEXT[t.status].replace("_", " ")}
                               </DropdownMenuItem>
                             )}
                             <DropdownMenuSeparator />
                             {t.po_header_id ? (
                               <DropdownMenuItem disabled className="text-emerald-600 font-medium">
                                 Purchase Order Exists
                               </DropdownMenuItem>
                             ) : t.vendor_id && t.estimated_cost ? (
                               <DropdownMenuItem onClick={() => setPoFor(t)} className="text-emerald-600 font-medium">
                                 Create Purchase Order
                               </DropdownMenuItem>
                             ) : (
                               <DropdownMenuItem disabled className="text-slate-400">
                                 Requires vendor & cost for PO
                               </DropdownMenuItem>
                             )}
                           </DropdownMenuContent>
                         </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      </motion.div>
      )}

      {/* Slide-out Sheet for New Ticket */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md w-full overflow-y-auto border-l-0 shadow-2xl">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-2xl font-bold text-slate-900">New Service Ticket</SheetTitle>
            <SheetDescription>
              Create a new request for the service desk team.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={create} className="space-y-6">
            <div className="space-y-2">
               <Label className="text-sm font-semibold text-slate-700">Subject</Label>
               <Input 
                 placeholder="e.g. Broken sprinkler head"
                 value={form.subject}
                 onChange={(e) => setForm({ ...form, subject: e.target.value })} 
                 required 
                 className="bg-slate-50 border-slate-200 focus-visible:ring-indigo-500"
               />
            </div>
            
            <div className="space-y-2">
               <Label className="text-sm font-semibold text-slate-700">Description</Label>
               <Input 
                 placeholder="Additional context..."
                 value={form.description}
                 onChange={(e) => setForm({ ...form, description: e.target.value })} 
                 className="bg-slate-50 border-slate-200 focus-visible:ring-indigo-500"
               />
            </div>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Category</Label>
                <Select value={form.category} onValueChange={(val) => setForm({ ...form, category: val })}>
                  <SelectTrigger className="bg-slate-50 border-slate-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["MAINTENANCE", "COMPLAINT", "REQUEST", "VIOLATION"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Priority</Label>
                <Select value={form.priority} onValueChange={(val) => setForm({ ...form, priority: val })}>
                  <SelectTrigger className="bg-slate-50 border-slate-200"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["LOW", "MEDIUM", "HIGH"].map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-4">
               <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Financial Information</h3>
               <div className="space-y-2">
                 <Label className="text-sm font-semibold text-slate-700">Vendor (Optional)</Label>
                 <Select value={form.vendor_id} onValueChange={(val) => setForm({ ...form, vendor_id: val })}>
                   <SelectTrigger className="bg-white border-slate-200"><SelectValue placeholder="Select vendor..." /></SelectTrigger>
                   <SelectContent>
                     <SelectItem value="none">None</SelectItem>
                     {vendors.map((v) => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}
                   </SelectContent>
                 </Select>
               </div>
               <div className="space-y-2">
                  <Label className="text-sm font-semibold text-slate-700">Estimated cost</Label>
                  <div className="relative">
                     <span className="absolute left-3 top-2.5 text-slate-400 font-medium">$</span>
                     <Input 
                       type="number" step="0.01" 
                       value={form.estimated_cost}
                       onChange={(e) => setForm({ ...form, estimated_cost: e.target.value })} 
                       className="pl-7 bg-white border-slate-200 focus-visible:ring-indigo-500 font-mono"
                     />
                  </div>
               </div>
            </div>
            
            <SheetFooter className="mt-8 pt-6 border-t border-slate-100 flex-col sm:flex-row gap-3 sm:space-x-0">
              <Button type="button" variant="outline" onClick={() => setSheetOpen(false)} className="w-full sm:w-auto">Cancel</Button>
              <Button type="submit" disabled={busy} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white">
                 {busy ? "Saving…" : "Create Ticket"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      {/* Slide-out Sheet for Create PO */}
      <Sheet open={!!poFor} onOpenChange={(val) => !val && setPoFor(null)}>
        <SheetContent className="sm:max-w-md w-full overflow-y-auto border-l-0 shadow-2xl">
          <SheetHeader className="mb-6">
            <SheetTitle className="text-2xl font-bold text-slate-900">Generate Purchase Order</SheetTitle>
            <SheetDescription>
              Creating a PO from ticket <span className="font-mono text-slate-800">{poFor?.ticket_number}</span>
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={createPo} className="space-y-6">
            <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl">
               <div className="text-emerald-800 font-medium mb-1">Authorization Details</div>
               <p className="text-sm text-emerald-600/80">
                 Spawns a purchase order for <span className="font-mono font-bold">${Number(poFor?.estimated_cost || 0).toFixed(2)}</span> against the
                 chosen expense account.
               </p>
            </div>
            
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Expense account (KFF)</Label>
              <Select value={poAccount} onValueChange={(val) => setPoAccount(val)} required>
                <SelectTrigger className="bg-slate-50 border-slate-200 font-mono"><SelectValue placeholder="Select account…" /></SelectTrigger>
                <SelectContent>
                  {combos.filter((c) => c.account_type === "E").map((c) => (
                    <SelectItem key={c.id} value={c.id} className="font-mono">{c.concatenated_segments}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <SheetFooter className="mt-8 pt-6 border-t border-slate-100 flex-col sm:flex-row gap-3 sm:space-x-0">
              <Button type="button" variant="outline" onClick={() => setPoFor(null)} className="w-full sm:w-auto">Cancel</Button>
              <Button type="submit" disabled={busy} className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white">
                 {busy ? "Generating…" : "Generate PO"}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
