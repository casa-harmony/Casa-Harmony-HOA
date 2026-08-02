"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../providers";
import { apiFetch } from "@/lib/api";
import type { Structure } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Spinner } from "@/components/ui";

export default function CoaPage() {
  const { token, activeTenantId } = useAuth();
  const [structures, setStructures] = useState<Structure[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ structure_code: "", title: "", description: "" });
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      setStructures(
        await apiFetch<Structure[]>("/coa/structures", { token, tenantId: activeTenantId })
      );
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load structures");
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
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/coa/structures", {
        method: "POST",
        token,
        tenantId: activeTenantId,
        body: {
          structure_code: form.structure_code.toUpperCase(),
          title: form.title,
          description: form.description || undefined,
        },
      });
      setOpen(false);
      setForm({ structure_code: "", title: "", description: "" });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create structure");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Chart of Accounts</h1>
          <p className="text-sm text-slate-500">
            Oracle-style Key Flexfield structures for this HOA.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>+ New Structure</Button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {loading ? (
        <Spinner />
      ) : structures.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-500">
            No COA structures yet. Create one to define account segments.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {structures.map((s) => (
            <Link key={s.id} href={`/coa/${s.id}`}>
              <Card className="transition hover:border-brand-300 hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-slate-400">
                    {s.structure_code}
                  </span>
                  <Badge tone={s.enabled ? "A" : "none"}>
                    {s.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
                <div className="mt-2 text-base font-semibold text-slate-800">
                  {s.title}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {s.description || "No description"}
                </p>
                <div className="mt-3 text-xs text-brand-600">
                  Separator “{s.segment_separator}” · Configure →
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New COA Structure">
        <form onSubmit={create} className="space-y-4">
          {error && <Alert kind="error">{error}</Alert>}
          <div>
            <Label htmlFor="code">Structure Code</Label>
            <Input
              id="code"
              placeholder="HOA_COA"
              value={form.structure_code}
              onChange={(e) => setForm({ ...form, structure_code: e.target.value })}
              required
            />
          </div>
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="HOA Chart of Accounts"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
            />
          </div>
          <div>
            <Label htmlFor="desc">Description</Label>
            <Input
              id="desc"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
