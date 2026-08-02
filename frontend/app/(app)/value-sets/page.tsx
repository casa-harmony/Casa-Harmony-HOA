"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch } from "@/lib/api";
import type { ValueSet, ValueSetValue } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

const ACCOUNT_TYPES = ["", "A", "L", "O", "R", "E"];

export default function ValueSetsPage() {
  const { token, activeTenantId } = useAuth();
  const [sets, setSets] = useState<ValueSet[]>([]);
  const [selected, setSelected] = useState<ValueSet | null>(null);
  const [values, setValues] = useState<ValueSetValue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [vsForm, setVsForm] = useState({
    code: "",
    name: "",
    validation_type: "INDEPENDENT",
    format_type: "CHAR",
    max_size: 25,
    numbers_only: false,
  });
  const [valForm, setValForm] = useState({ value: "", description: "", account_type: "" });

  async function loadSets() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      setSets(await apiFetch<ValueSet[]>("/coa/value-sets", { token, tenantId: activeTenantId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load value sets");
    } finally {
      setLoading(false);
    }
  }

  async function loadValues(vs: ValueSet) {
    setSelected(vs);
    try {
      setValues(
        await apiFetch<ValueSetValue[]>(`/coa/value-sets/${vs.id}/values`, {
          token,
          tenantId: activeTenantId,
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load values");
    }
  }

  useEffect(() => {
    loadSets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTenantId]);

  async function createSet(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch("/coa/value-sets", {
        method: "POST",
        token,
        tenantId: activeTenantId,
        body: {
          code: vsForm.code.toUpperCase(),
          name: vsForm.name,
          validation_type: vsForm.validation_type,
          format_type: vsForm.format_type,
          max_size: Number(vsForm.max_size),
          uppercase_only: vsForm.format_type === "CHAR",
          zero_fill: false,
          numbers_only: vsForm.numbers_only,
        },
      });
      setOpen(false);
      setVsForm({
        code: "",
        name: "",
        validation_type: "INDEPENDENT",
        format_type: "CHAR",
        max_size: 25,
        numbers_only: false,
      });
      await loadSets();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create value set");
    } finally {
      setBusy(false);
    }
  }

  async function addValue(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    try {
      await apiFetch(`/coa/value-sets/${selected.id}/values`, {
        method: "POST",
        token,
        tenantId: activeTenantId,
        body: {
          value: valForm.value,
          description: valForm.description || undefined,
          enabled: true,
          summary_flag: false,
          allow_posting: true,
          account_type: valForm.account_type || undefined,
        },
      });
      setValForm({ value: "", description: "", account_type: "" });
      await loadValues(selected);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add value");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Value Sets</h1>
          <p className="text-sm text-slate-500">
            Validation domains for COA segments (independent value lists).
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>+ New Value Set</Button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">All Value Sets</h2>
          {loading ? (
            <Spinner />
          ) : sets.length === 0 ? (
            <p className="text-sm text-slate-500">No value sets defined.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {sets.map((v) => (
                <li key={v.id}>
                  <button
                    onClick={() => loadValues(v)}
                    className={`flex w-full items-center justify-between py-2 text-left text-sm ${
                      selected?.id === v.id ? "text-brand-700" : "text-slate-700"
                    }`}
                  >
                    <span>
                      <span className="font-mono">{v.code}</span> — {v.name}
                    </span>
                    <Badge>{v.validation_type}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">
            {selected ? `Values · ${selected.code}` : "Select a value set"}
          </h2>
          {selected && (
            <>
              <div className="scroll-thin mb-4 max-h-64 overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                      <th className="py-1 pr-3">Value</th>
                      <th className="py-1 pr-3">Description</th>
                      <th className="py-1 pr-3">Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {values.map((val) => (
                      <tr key={val.id} className="border-b border-slate-100">
                        <td className="py-1 pr-3 font-mono">{val.value}</td>
                        <td className="py-1 pr-3 text-slate-500">{val.description}</td>
                        <td className="py-1 pr-3">
                          {val.account_type ? (
                            <Badge tone={val.account_type}>{val.account_type}</Badge>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <form onSubmit={addValue} className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    placeholder="Value"
                    value={valForm.value}
                    onChange={(e) => setValForm({ ...valForm, value: e.target.value })}
                    required
                  />
                  <Input
                    placeholder="Description"
                    value={valForm.description}
                    onChange={(e) =>
                      setValForm({ ...valForm, description: e.target.value })
                    }
                  />
                  <Select
                    value={valForm.account_type}
                    onChange={(e) =>
                      setValForm({ ...valForm, account_type: e.target.value })
                    }
                  >
                    {ACCOUNT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t || "Acct type —"}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={busy}>
                    Add Value
                  </Button>
                </div>
              </form>
            </>
          )}
        </Card>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="New Value Set">
        <form onSubmit={createSet} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Code</Label>
              <Input
                value={vsForm.code}
                onChange={(e) => setVsForm({ ...vsForm, code: e.target.value })}
                placeholder="HOA_FUND"
                required
              />
            </div>
            <div>
              <Label>Name</Label>
              <Input
                value={vsForm.name}
                onChange={(e) => setVsForm({ ...vsForm, name: e.target.value })}
                required
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Validation</Label>
              <Select
                value={vsForm.validation_type}
                onChange={(e) =>
                  setVsForm({ ...vsForm, validation_type: e.target.value })
                }
              >
                {["INDEPENDENT", "NONE", "DEPENDENT", "TABLE"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Format</Label>
              <Select
                value={vsForm.format_type}
                onChange={(e) =>
                  setVsForm({
                    ...vsForm,
                    format_type: e.target.value,
                    numbers_only: e.target.value === "NUMBER",
                  })
                }
              >
                {["CHAR", "NUMBER"].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Max size</Label>
              <Input
                type="number"
                min={1}
                max={240}
                value={vsForm.max_size}
                onChange={(e) =>
                  setVsForm({ ...vsForm, max_size: Number(e.target.value) })
                }
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
