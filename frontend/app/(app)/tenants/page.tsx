"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch } from "@/lib/api";
import type { Tenant } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Spinner } from "@/components/ui";

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function TenantsPage() {
  const { token, user, setActiveTenant } = useAuth();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    slug: "",
    legal_name: "",
    num_units: "",
    city: "",
    state: "",
    create_default_coa: true,
  });

  async function load() {
    if (!token) return;
    setLoading(true);
    try {
      setTenants(await apiFetch<Tenant[]>("/tenants", { token }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load tenants");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<Tenant>("/tenants", {
        method: "POST",
        token,
        body: {
          name: form.name,
          slug: form.slug || slugify(form.name),
          legal_name: form.legal_name || undefined,
          num_units: form.num_units ? Number(form.num_units) : undefined,
          city: form.city || undefined,
          state: form.state || undefined,
          create_default_coa: form.create_default_coa,
        },
      });
      // Refresh the HOA switcher and switch into the new HOA right away.
      window.dispatchEvent(new Event("casa:tenants-changed"));
      if (created?.id) setActiveTenant(created.id);
      setOpen(false);
      setForm({
        name: "",
        slug: "",
        legal_name: "",
        num_units: "",
        city: "",
        state: "",
        create_default_coa: true,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create HOA");
    } finally {
      setBusy(false);
    }
  }

  if (!user?.isSuperadmin) {
    return <Alert kind="info">Only the platform SUPERADMIN can manage HOAs.</Alert>;
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">HOAs (Tenants)</h1>
          <p className="text-sm text-slate-500">
            Provision and manage Homeowner Associations platform-wide.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>+ Create HOA</Button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <Card>
        {loading ? (
          <Spinner />
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Slug</th>
                  <th className="py-2 pr-3">Units</th>
                  <th className="py-2 pr-3">Location</th>
                  <th className="py-2 pr-3">Currency</th>
                  <th className="py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-medium text-slate-700">{t.name}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{t.slug}</td>
                    <td className="py-2 pr-3">{t.num_units ?? "—"}</td>
                    <td className="py-2 pr-3 text-slate-500">
                      {[t.city, t.state].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td className="py-2 pr-3">{t.functional_currency}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={t.status === "active" ? "A" : "L"}>{t.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Create HOA">
        <form onSubmit={create} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value, slug: slugify(e.target.value) })
                }
                required
              />
            </div>
            <div>
              <Label>Slug</Label>
              <Input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                required
              />
            </div>
          </div>
          <div>
            <Label>Legal name</Label>
            <Input
              value={form.legal_name}
              onChange={(e) => setForm({ ...form, legal_name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Units</Label>
              <Input
                type="number"
                value={form.num_units}
                onChange={(e) => setForm({ ...form, num_units: e.target.value })}
              />
            </div>
            <div>
              <Label>City</Label>
              <Input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
              />
            </div>
            <div>
              <Label>State</Label>
              <Input
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.create_default_coa}
              onChange={(e) =>
                setForm({ ...form, create_default_coa: e.target.checked })
              }
            />
            Provision default 6-segment Chart of Accounts
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create HOA"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
