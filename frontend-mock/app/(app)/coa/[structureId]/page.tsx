"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../providers";
import { apiFetch, downloadExport } from "@/lib/api";
import type {
  CodeCombination,
  Qualifier,
  Segment,
  StructureDetail,
  ValueSet,
} from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

const QUALIFIERS: Qualifier[] = [
  "balancing",
  "natural_account",
  "cost_center",
  "fund",
  "intercompany",
  "management",
  "secondary_tracking",
  "none",
];

export default function StructureDetailPage() {
  const { structureId } = useParams<{ structureId: string }>();
  const { token, activeTenantId } = useAuth();

  const [detail, setDetail] = useState<StructureDetail | null>(null);
  const [valueSets, setValueSets] = useState<ValueSet[]>([]);
  const [combos, setCombos] = useState<CodeCombination[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [segOpen, setSegOpen] = useState(false);
  const [segForm, setSegForm] = useState({
    segment_number: 1,
    name: "",
    prompt: "",
    value_set_id: "",
    qualifier: "none" as Qualifier,
    required: true,
  });
  const [comboValues, setComboValues] = useState<Record<number, string>>({});
  const [comboError, setComboError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadAll() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [d, vs, cc] = await Promise.all([
        apiFetch<StructureDetail>(`/coa/structures/${structureId}`, {
          token,
          tenantId: activeTenantId,
        }),
        apiFetch<ValueSet[]>("/coa/value-sets", { token, tenantId: activeTenantId }),
        apiFetch<CodeCombination[]>(`/coa/structures/${structureId}/combinations`, {
          token,
          tenantId: activeTenantId,
        }),
      ]);
      setDetail(d);
      setValueSets(vs);
      setCombos(cc);
      setSegForm((f) => ({ ...f, segment_number: d.segments.length + 1 }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTenantId, structureId]);

  async function addSegment(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/coa/structures/${structureId}/segments`, {
        method: "POST",
        token,
        tenantId: activeTenantId,
        body: {
          segment_number: Number(segForm.segment_number),
          name: segForm.name,
          prompt: segForm.prompt || segForm.name,
          value_set_id: segForm.value_set_id || null,
          qualifier: segForm.qualifier,
          displayed: true,
          enabled: true,
          required: segForm.required,
        },
      });
      setSegOpen(false);
      setSegForm({
        segment_number: 1,
        name: "",
        prompt: "",
        value_set_id: "",
        qualifier: "none",
        required: true,
      });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add segment");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSegment(id: string) {
    if (!confirm("Delete this segment?")) return;
    try {
      await apiFetch(`/coa/segments/${id}`, {
        method: "DELETE",
        token,
        tenantId: activeTenantId,
      });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function buildCombination(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setComboError(null);
    try {
      const segments: Record<string, string> = {};
      for (const s of detail?.segments ?? []) {
        segments[String(s.segment_number)] = comboValues[s.segment_number] ?? "";
      }
      await apiFetch(`/coa/structures/${structureId}/combinations`, {
        method: "POST",
        token,
        tenantId: activeTenantId,
        body: { segments, allow_posting: true, enabled: true },
      });
      setComboValues({});
      await loadAll();
    } catch (e) {
      setComboError(e instanceof Error ? e.message : "Validation failed");
    } finally {
      setBusy(false);
    }
  }

  async function onExport() {
    if (!token || !activeTenantId || !detail) return;
    try {
      await downloadExport(
        detail.id,
        token,
        activeTenantId,
        `coa_${detail.structure_code}.xlsx`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  }

  if (loading) return <Spinner />;
  if (!detail) return <Alert kind="error">{error || "Not found"}</Alert>;

  const vsName = (id: string | null) =>
    id ? valueSets.find((v) => v.id === id)?.code ?? "—" : "(free-form)";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/coa" className="text-xs text-brand-600">
            ← Chart of Accounts
          </Link>
          <h1 className="text-xl font-bold text-slate-800">{detail.title}</h1>
          <p className="font-mono text-xs text-slate-400">
            {detail.structure_code} · separator “{detail.segment_separator}”
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onExport}>
            ⬇ Export to Excel
          </Button>
          <Button onClick={() => setSegOpen(true)}>+ Add Segment</Button>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Segments */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Segments ({detail.segments.length})
        </h2>
        <div className="scroll-thin overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-2 pr-3">#</th>
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Prompt</th>
                <th className="py-2 pr-3">Column</th>
                <th className="py-2 pr-3">Qualifier</th>
                <th className="py-2 pr-3">Value Set</th>
                <th className="py-2 pr-3">Required</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {detail.segments.map((s: Segment) => (
                <tr key={s.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3 font-mono">{s.segment_number}</td>
                  <td className="py-2 pr-3 font-medium text-slate-700">{s.name}</td>
                  <td className="py-2 pr-3 text-slate-500">{s.prompt}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-slate-400">
                    {s.column_name}
                  </td>
                  <td className="py-2 pr-3">
                    <Badge tone={s.qualifier}>{s.qualifier}</Badge>
                  </td>
                  <td className="py-2 pr-3 font-mono text-xs">{vsName(s.value_set_id)}</td>
                  <td className="py-2 pr-3">{s.required ? "Yes" : "No"}</td>
                  <td className="py-2 pr-3 text-right">
                    <button
                      onClick={() => deleteSegment(s.id)}
                      className="text-xs text-rose-500 hover:underline"
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Build a combination */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Build Code Combination
        </h2>
        {comboError && (
          <div className="mb-3">
            <Alert kind="error">{comboError}</Alert>
          </div>
        )}
        <form onSubmit={buildCombination} className="space-y-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            {detail.segments.map((s) => (
              <div key={s.id}>
                <Label>{s.prompt}</Label>
                <Input
                  placeholder={s.name}
                  value={comboValues[s.segment_number] ?? ""}
                  onChange={(e) =>
                    setComboValues({ ...comboValues, [s.segment_number]: e.target.value })
                  }
                />
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || detail.segments.length === 0}>
              {busy ? "Validating…" : "Create Combination"}
            </Button>
          </div>
        </form>
      </Card>

      {/* Existing combinations */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">
          Code Combinations ({combos.length})
        </h2>
        {combos.length === 0 ? (
          <p className="text-sm text-slate-500">No combinations yet.</p>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                  <th className="py-2 pr-3">Concatenated</th>
                  <th className="py-2 pr-3">Fund</th>
                  <th className="py-2 pr-3">Natural Acct</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3">Posting</th>
                </tr>
              </thead>
              <tbody>
                {combos.map((c) => (
                  <tr key={c.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3 font-mono">{c.concatenated_segments}</td>
                    <td className="py-2 pr-3">{c.fund_value || "—"}</td>
                    <td className="py-2 pr-3">{c.natural_account_value || "—"}</td>
                    <td className="py-2 pr-3">
                      {c.account_type ? (
                        <Badge tone={c.account_type}>{c.account_type}</Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-3">{c.allow_posting ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add segment modal */}
      <Modal open={segOpen} onClose={() => setSegOpen(false)} title="Add Segment">
        <form onSubmit={addSegment} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Segment #</Label>
              <Input
                type="number"
                min={1}
                max={15}
                value={segForm.segment_number}
                onChange={(e) =>
                  setSegForm({ ...segForm, segment_number: Number(e.target.value) })
                }
                required
              />
            </div>
            <div>
              <Label>Qualifier</Label>
              <Select
                value={segForm.qualifier}
                onChange={(e) =>
                  setSegForm({ ...segForm, qualifier: e.target.value as Qualifier })
                }
              >
                {QUALIFIERS.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label>Name</Label>
            <Input
              value={segForm.name}
              onChange={(e) => setSegForm({ ...segForm, name: e.target.value })}
              placeholder="Cost Center"
              required
            />
          </div>
          <div>
            <Label>Prompt</Label>
            <Input
              value={segForm.prompt}
              onChange={(e) => setSegForm({ ...segForm, prompt: e.target.value })}
              placeholder="Cost Center"
            />
          </div>
          <div>
            <Label>Value Set</Label>
            <Select
              value={segForm.value_set_id}
              onChange={(e) => setSegForm({ ...segForm, value_set_id: e.target.value })}
            >
              <option value="">(free-form / none)</option>
              {valueSets.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.code} — {v.name}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={segForm.required}
              onChange={(e) => setSegForm({ ...segForm, required: e.target.checked })}
            />
            Required segment
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setSegOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add Segment"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
