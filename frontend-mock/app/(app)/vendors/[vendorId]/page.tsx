"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../../providers";
import { apiFetch } from "@/lib/api";
import type { Vendor } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Spinner } from "@/components/ui";

interface Site { id: string; site_code: string; site_name: string | null; pay_site: boolean; purchasing_site: boolean; city: string | null; state: string | null; }
interface Contact { id: string; first_name: string; last_name: string; title: string | null; email: string | null; phone: string | null; }
interface Bank { id: string; bank_name: string; routing_number: string | null; account_number_masked: string | null; account_type: string; is_primary: boolean; }

export default function VendorDetailPage() {
  const { vendorId } = useParams<{ vendorId: string }>();
  const { token, activeTenantId } = useAuth();
  const [v, setV] = useState<Vendor | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [banks, setBanks] = useState<Bank[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"" | "site" | "contact" | "bank">("");
  const [busy, setBusy] = useState(false);

  const [site, setSite] = useState({ site_code: "", site_name: "", city: "", state: "", pay_site: true, purchasing_site: true });
  const [contact, setContact] = useState({ first_name: "", last_name: "", title: "", email: "", phone: "" });
  const [bank, setBank] = useState({ bank_name: "", routing_number: "", account_number: "", account_type: "CHECKING", is_primary: true });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [vd, s, c, b] = await Promise.all([
        apiFetch<Vendor>(`/vendors/${vendorId}`, { token, tenantId: activeTenantId }),
        apiFetch<Site[]>(`/vendors/${vendorId}/sites`, { token, tenantId: activeTenantId }),
        apiFetch<Contact[]>(`/vendors/${vendorId}/contacts`, { token, tenantId: activeTenantId }),
        apiFetch<Bank[]>(`/vendors/${vendorId}/bank-accounts`, { token, tenantId: activeTenantId }),
      ]);
      setV(vd); setSites(s); setContacts(c); setBanks(b);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId, vendorId]);

  async function save(resource: string, body: unknown, reset: () => void) {
    setBusy(true); setError(null);
    try {
      if (resource === "sites") await apiFetch(`/vendors/${vendorId}/sites`, { method: "POST", token, tenantId: activeTenantId, body });
      else if (resource === "contacts") await apiFetch(`/vendors/${vendorId}/contacts`, { method: "POST", token, tenantId: activeTenantId, body });
      else if (resource === "bank-accounts") await apiFetch(`/vendors/${vendorId}/bank-accounts`, { method: "POST", token, tenantId: activeTenantId, body });
      else throw new Error("Unknown resource: " + resource);
      setModal(""); reset(); await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally { setBusy(false); }
  }

  if (loading) return <Spinner />;
  if (!v) return <Alert kind="error">{error || "Not found"}</Alert>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/vendors" className="text-xs text-brand-600">← Vendors</Link>
        <h1 className="text-xl font-bold text-slate-800">{v.name}</h1>
        <p className="text-sm text-slate-500">
          {v.vendor_number} · <Badge tone="A">{v.status}</Badge>
          {v.is_1099 && <> · <Badge tone="L">{v.income_tax_type || "1099"}</Badge></>}
          {v.email && <> · {v.email}</>}
        </p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Sites</h2>
          <Button variant="secondary" onClick={() => setModal("site")}>+ Site</Button>
        </div>
        {sites.length === 0 ? <p className="text-xs text-slate-400">No sites.</p> : (
          <table className="w-full text-left text-sm">
            <thead><tr className="text-xs uppercase text-slate-400"><th className="py-1 pr-3">Code</th><th className="py-1 pr-3">Name</th><th className="py-1 pr-3">Location</th><th className="py-1 pr-3">Purpose</th></tr></thead>
            <tbody>{sites.map((s) => (
              <tr key={s.id} className="border-t border-slate-100">
                <td className="py-1 pr-3 font-mono">{s.site_code}</td>
                <td className="py-1 pr-3">{s.site_name || "—"}</td>
                <td className="py-1 pr-3">{[s.city, s.state].filter(Boolean).join(", ") || "—"}</td>
                <td className="py-1 pr-3 text-xs">{[s.pay_site && "Pay", s.purchasing_site && "Purchasing"].filter(Boolean).join(" · ")}</td>
              </tr>))}</tbody>
          </table>
        )}
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Contacts</h2>
          <Button variant="secondary" onClick={() => setModal("contact")}>+ Contact</Button>
        </div>
        {contacts.length === 0 ? <p className="text-xs text-slate-400">No contacts.</p> :
          contacts.map((c) => (
            <div key={c.id} className="border-t border-slate-100 py-1 text-sm">
              {c.first_name} {c.last_name}{c.title && ` · ${c.title}`}{c.email && ` · ${c.email}`}{c.phone && ` · ${c.phone}`}
            </div>))}
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-700">Bank Accounts (disbursement)</h2>
          <Button variant="secondary" onClick={() => setModal("bank")}>+ Bank</Button>
        </div>
        {banks.length === 0 ? <p className="text-xs text-slate-400">No bank accounts.</p> :
          banks.map((b) => (
            <div key={b.id} className="border-t border-slate-100 py-1 text-sm">
              {b.bank_name} · {b.account_type} · <span className="font-mono">{b.account_number_masked}</span>
              {b.routing_number && ` · RTN ${b.routing_number}`}{b.is_primary && <> · <Badge tone="A">primary</Badge></>}
            </div>))}
      </Card>

      <Modal open={modal === "site"} onClose={() => setModal("")} title="New Site">
        <form onSubmit={(e) => { e.preventDefault(); save("sites", { ...site, site_name: site.site_name || undefined, city: site.city || undefined, state: site.state || undefined }, () => setSite({ site_code: "", site_name: "", city: "", state: "", pay_site: true, purchasing_site: true })); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Site code</Label><Input value={site.site_code} onChange={(e) => setSite({ ...site, site_code: e.target.value })} required placeholder="MAIN" /></div>
            <div><Label>Name</Label><Input value={site.site_name} onChange={(e) => setSite({ ...site, site_name: e.target.value })} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>City</Label><Input value={site.city} onChange={(e) => setSite({ ...site, city: e.target.value })} /></div>
            <div><Label>State</Label><Input value={site.state} onChange={(e) => setSite({ ...site, state: e.target.value })} /></div>
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={site.pay_site} onChange={(e) => setSite({ ...site, pay_site: e.target.checked })} /> Pay site</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={site.purchasing_site} onChange={(e) => setSite({ ...site, purchasing_site: e.target.checked })} /> Purchasing site</label>
          </div>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add Site"}</Button>
        </form>
      </Modal>

      <Modal open={modal === "contact"} onClose={() => setModal("")} title="New Contact">
        <form onSubmit={(e) => { e.preventDefault(); save("contacts", { ...contact, title: contact.title || undefined, email: contact.email || undefined, phone: contact.phone || undefined }, () => setContact({ first_name: "", last_name: "", title: "", email: "", phone: "" })); }} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>First name</Label><Input value={contact.first_name} onChange={(e) => setContact({ ...contact, first_name: e.target.value })} required /></div>
            <div><Label>Last name</Label><Input value={contact.last_name} onChange={(e) => setContact({ ...contact, last_name: e.target.value })} required /></div>
          </div>
          <div><Label>Title</Label><Input value={contact.title} onChange={(e) => setContact({ ...contact, title: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Email</Label><Input value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} /></div>
            <div><Label>Phone</Label><Input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></div>
          </div>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add Contact"}</Button>
        </form>
      </Modal>

      <Modal open={modal === "bank"} onClose={() => setModal("")} title="New Bank Account">
        <form onSubmit={(e) => { e.preventDefault(); save("bank-accounts", { ...bank, routing_number: bank.routing_number || undefined }, () => setBank({ bank_name: "", routing_number: "", account_number: "", account_type: "CHECKING", is_primary: true })); }} className="space-y-3">
          <p className="text-xs text-slate-500">The account number is encrypted at rest; only the last four are shown afterward.</p>
          <div><Label>Bank name</Label><Input value={bank.bank_name} onChange={(e) => setBank({ ...bank, bank_name: e.target.value })} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Routing #</Label><Input value={bank.routing_number} onChange={(e) => setBank({ ...bank, routing_number: e.target.value })} /></div>
            <div><Label>Account #</Label><Input value={bank.account_number} onChange={(e) => setBank({ ...bank, account_number: e.target.value })} required /></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bank.is_primary} onChange={(e) => setBank({ ...bank, is_primary: e.target.checked })} /> Primary account</label>
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add Bank"}</Button>
        </form>
      </Modal>
    </div>
  );
}
