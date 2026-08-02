"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch } from "@/lib/api";
import type { Homeowner, Resident, ResidentUnit } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Residents</h1>
          <p className="text-sm text-slate-500">
            Owner & renter portal logins. One login can hold multiple units.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>+ New Resident</Button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}
      <Card>
        {loading ? (
          <Spinner />
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-2 pr-3">Username</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Units</th>
                <th className="py-2 pr-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {residents.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono">{r.username}</td>
                  <td className="py-2 pr-3 font-medium text-slate-700">{r.full_name}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={r.resident_type === "OWNER" ? "A" : "R"}>{r.resident_type}</Badge>
                  </td>
                  <td className="py-2 pr-3">{r.unit_count}</td>
                  <td className="py-2 pr-3 text-right">
                    <Button variant="secondary" onClick={() => openLinks(r)}>Units</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New Resident Login">
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
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
          <div className="grid grid-cols-2 gap-3">
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
          <div className="grid grid-cols-2 gap-3">
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
                  <span className="font-mono">Unit {u.unit_number}</span>
                  {u.is_primary && <Badge tone="A">primary</Badge>}
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
