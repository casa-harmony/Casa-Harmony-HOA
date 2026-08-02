"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch } from "@/lib/api";
import type { Homeowner, Resident, ResidentUnit } from "@/lib/types";
import { Alert, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Users, Building, ShieldCheck, Mail, Smartphone } from "lucide-react";
import { motion } from "framer-motion";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";

export default function ResidentsPage() {
  const { token, activeTenantId } = useAuth();
  const [residents, setResidents] = useState<Resident[]>([]);
  const [homeowners, setHomeowners] = useState<Homeowner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkFor, setLinkFor] = useState<Resident | null>(null);
  const [units, setUnits] = useState<ResidentUnit[]>([]);
  const [form, setForm] = useState({
    username: "", password: "", full_name: "", resident_type: "OWNER",
    email: "", phone: "", mfa_channel: "EMAIL",
  });
  const [link, setLink] = useState({ homeowner_id: "", is_primary: true });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [res, homes] = await Promise.all([
        apiFetch<Resident[]>("/residents", { token, tenantId: activeTenantId }),
        apiFetch<Homeowner[]>("/subledger/homeowners", { token, tenantId: activeTenantId }),
      ]);
      setResidents(res);
      setHomeowners(homes);
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
      await apiFetch("/residents", {
        method: "POST", token, tenantId: activeTenantId,
        body: { ...form, email: form.email || undefined, phone: form.phone || undefined },
      });
      setOpen(false);
      setForm({ username: "", password: "", full_name: "", resident_type: "OWNER",
                email: "", phone: "", mfa_channel: "EMAIL" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create resident");
    } finally {
      setBusy(false);
    }
  }

  async function openLinks(r: Resident) {
    setLinkFor(r);
    setLink({ homeowner_id: "", is_primary: true });
    try {
      setUnits(await apiFetch<ResidentUnit[]>(`/residents/${r.id}/units`, { token, tenantId: activeTenantId }));
    } catch {
      setUnits([]);
    }
  }

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    if (!linkFor) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/residents/${linkFor.id}/units`, {
        method: "POST", token, tenantId: activeTenantId, body: link,
      });
      setMsg(`Unit linked to ${linkFor.username}.`);
      await openLinks(linkFor);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to link unit");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">Residents</h1>
          <p className="text-sm text-slate-500 mt-1">
            Owner & renter portal logins. One login can hold multiple units.
          </p>
        </div>
        <Button onClick={() => setOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm">+ New Resident</Button>
      </div>
      
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      {!loading && residents.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          <Card className="shadow-sm border-slate-200/60 rounded-xl overflow-hidden p-6 bg-white flex flex-col justify-center">
            <div className="flex items-center gap-4 mb-2">
              <div className="h-12 w-12 rounded-full bg-indigo-50 flex items-center justify-center">
                <Users className="h-6 w-6 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-500 uppercase tracking-wide">Total Logins</p>
                <p className="text-4xl font-black text-slate-800">{residents.length}</p>
              </div>
            </div>
          </Card>

          <Card className="shadow-sm border-slate-200/60 rounded-xl overflow-hidden p-6 bg-white md:col-span-2 flex items-center">
            <div className="w-1/2">
              <h3 className="text-sm font-semibold text-slate-700 mb-1">Demographics</h3>
              <p className="text-xs text-slate-500 max-w-[200px]">Breakdown of registered portal users by type.</p>
              
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-slate-600"><span className="h-2 w-2 rounded-full bg-indigo-500"></span> Owners</span>
                  <span className="font-semibold text-slate-800">{residents.filter(r => r.resident_type === "OWNER").length}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-slate-600"><span className="h-2 w-2 rounded-full bg-emerald-400"></span> Renters</span>
                  <span className="font-semibold text-slate-800">{residents.filter(r => r.resident_type === "RENTER").length}</span>
                </div>
              </div>
            </div>
            <div className="w-1/2 h-[120px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Pie
                    data={[
                      { name: "Owners", value: residents.filter(r => r.resident_type === "OWNER").length },
                      { name: "Renters", value: residents.filter(r => r.resident_type === "RENTER").length }
                    ]}
                    cx="50%" cy="50%" innerRadius={40} outerRadius={60}
                    paddingAngle={5}
                    dataKey="value"
                    stroke="none"
                  >
                    <Cell fill="#6366f1" />
                    <Cell fill="#34d399" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </motion.div>
      )}

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.5 }}>
        <Card className="shadow-sm border-slate-200 rounded-xl overflow-hidden bg-white">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex justify-center p-12"><Spinner /></div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="font-semibold text-slate-600">Username</TableHead>
                  <TableHead className="font-semibold text-slate-600">Name</TableHead>
                  <TableHead className="font-semibold text-slate-600">Type</TableHead>
                  <TableHead className="font-semibold text-slate-600">Units</TableHead>
                  <TableHead className="font-semibold text-slate-600 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {residents.length === 0 && (
                   <TableRow>
                      <TableCell colSpan={5} className="h-32 text-center text-slate-500 font-medium">
                         No residents found.
                      </TableCell>
                   </TableRow>
                )}
                {residents.map((r) => (
                  <TableRow key={r.id} className="hover:bg-slate-50 transition-colors">
                    <TableCell className="font-mono text-xs font-semibold text-slate-500 bg-slate-50/50">{r.username}</TableCell>
                    <TableCell className="font-bold text-slate-800">{r.full_name}</TableCell>
                    <TableCell>
                      <Badge variant={r.resident_type === "OWNER" ? "default" : "secondary"} className={r.resident_type === "OWNER" ? "bg-indigo-100 text-indigo-700 hover:bg-indigo-200" : ""}>{r.resident_type}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-slate-700">
                        <Building className="h-4 w-4 text-slate-400" />
                        <span className="font-mono font-medium">{r.unit_count}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" className="h-8 text-sm text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50" onClick={() => openLinks(r)}>Manage Units</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
      </motion.div>

      <Modal open={open} onClose={() => setOpen(false)} title="New Resident Login">
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Username</Label><Input value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })} required /></div>
            <div>
              <Label>Type</Label>
              <Select value={form.resident_type} onChange={(e) => setForm({ ...form, resident_type: e.target.value })}>
                <option value="OWNER">OWNER</option>
                <option value="RENTER">RENTER</option>
              </Select>
            </div>
          </div>
          <div><Label>Full name</Label><Input value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Temp password</Label><Input type="password" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} /></div>
            <div>
              <Label>MFA via</Label>
              <Select value={form.mfa_channel} onChange={(e) => setForm({ ...form, mfa_channel: e.target.value })}>
                <option value="EMAIL">Email code</option>
                <option value="SMS">Text (SMS) code</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><Label>Email{form.mfa_channel === "EMAIL" && " *"}</Label><Input value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><Label>Phone{form.mfa_channel === "SMS" && " *"}</Label><Input value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          </div>
          <p className="text-xs text-slate-400">
            Residents verify with a one-time code sent by {form.mfa_channel === "SMS" ? "text message" : "email"} — no authenticator app needed.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Create"}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!linkFor} onClose={() => setLinkFor(null)} title={`Units — ${linkFor?.username}`}>
        <div className="space-y-4">
          {units.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {units.map((u) => (
                <li key={u.id} className="flex justify-between rounded border border-slate-200 px-2 py-1">
                  <span className="font-mono text-slate-700">Unit {u.unit_number}</span>
                  {u.is_primary && <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Primary</Badge>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No units linked yet.</p>
          )}
          <form onSubmit={addLink} className="space-y-3 border-t border-slate-100 pt-3">
            <div>
              <Label>Link a unit (homeowner account)</Label>
              <Select value={link.homeowner_id}
                onChange={(e) => setLink({ ...link, homeowner_id: e.target.value })} required>
                <option value="">Select unit…</option>
                {homeowners.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.property_unit || h.account_number} — {h.first_name} {h.last_name}
                  </option>
                ))}
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" checked={link.is_primary}
                onChange={(e) => setLink({ ...link, is_primary: e.target.checked })} />
              Primary unit
            </label>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>{busy ? "Linking…" : "Link unit"}</Button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}
