"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../providers";
import { API_BASE, apiFetch, downloadFile } from "@/lib/api";
import { Alert, Badge, Button, Card, Spinner } from "@/components/ui";

interface Entity {
  entity_type: string; label: string; kind: string; load_order: number;
  modes: string[]; columns: string[]; line_columns: string[]; key: string;
}
interface Batch {
  id: string; batch_number: string; entity_type: string; source_filename: string | null;
  status: string; mode: string; total_rows: number; created: number; updated: number;
  skipped: number; errors: number;
}
interface Preview {
  headers: string[]; row_count: number; suggested_mapping: Record<string, string>;
  canonical_columns: string[]; sample: Record<string, unknown>[];
}

const STATUS_TONE: Record<string, string> = { DRY_RUN: "O", COMMITTED: "A", ROLLED_BACK: "R" };
const KIND_LABEL: Record<string, string> = {
  MASTER: "Masters", OPEN_TXN: "Open transactions", HISTORICAL: "Historical", CONFIG: "Config",
};

export default function MigrationPage() {
  const { token, activeTenantId } = useAuth();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entity, setEntity] = useState("HOMEOWNER");
  const [mode, setMode] = useState("ADD");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    try {
      const [e, b] = await Promise.all([
        apiFetch<Entity[]>("/migration/entities", { token, tenantId: activeTenantId }),
        apiFetch<Batch[]>("/migration/batches", { token, tenantId: activeTenantId }),
      ]);
      setEntities(e); setBatches(b); setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  const spec = entities.find((e) => e.entity_type === entity);
  const allCols = spec ? [...spec.columns, ...spec.line_columns] : [];
  const isDoc = (spec?.line_columns.length ?? 0) > 0;

  // Keep mode valid when the entity changes.
  useEffect(() => {
    if (spec && !spec.modes.includes(mode)) setMode(spec.modes[0]);
  }, [entity]); // eslint-disable-line

  function postRun(fd: FormData) {
    return fetch(`${API_BASE}/migration/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": activeTenantId ?? "" },
      body: fd,
    });
  }

  async function doPreview() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Choose a CSV/xlsx file first."); return; }
    setBusy("preview"); setError(null); setMsg(null); setPreview(null);
    try {
      const fd = new FormData();
      fd.append("entity_type", entity);
      fd.append("file", file);
      const res = await fetch(`${API_BASE}/migration/preview`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": activeTenantId ?? "" },
        body: fd,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "Preview failed");
      setPreview(body);
    } catch (err) { setError(err instanceof Error ? err.message : "Preview failed"); }
    finally { setBusy(null); }
  }

  async function run(dryRun: boolean) {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Choose a CSV/xlsx file first."); return; }
    setBusy(dryRun ? "dry" : "commit"); setError(null); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("entity_type", entity);
      fd.append("dry_run", String(dryRun));
      fd.append("mode", mode);
      if (preview?.suggested_mapping) fd.append("mapping", JSON.stringify(preview.suggested_mapping));
      fd.append("file", file);
      const res = await postRun(fd);
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || "Migration failed");
      setMsg(`${dryRun ? "Dry-run" : body.mode} ${body.batch_number}: ${body.created} ${dryRun ? "would create" : "created"}, ${body.updated} updated, ${body.skipped} skipped, ${body.errors} errors.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Migration failed");
    } finally { setBusy(null); }
  }

  async function rollback(id: string) {
    setBusy(id); setError(null);
    try {
      await apiFetch(`/migration/batches/${id}/rollback`, { method: "POST", token, tenantId: activeTenantId });
      setMsg("Batch rolled back.");
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Rollback failed"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Data Migration</h1>
        <p className="text-sm text-slate-500">
          NetSuite-style import: pick a record type, download its template (or map your own
          headers on preview), dry-run to validate, then commit. Load in order — Masters →
          Open transactions → Historical. Committed batches roll back cleanly.
        </p>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Record type (load order)</span>
            <select value={entity} onChange={(e) => { setEntity(e.target.value); setPreview(null); }}
                    className="rounded border border-slate-300 px-3 py-2">
              {Object.entries(
                entities.reduce<Record<string, Entity[]>>((acc, e) => {
                  (acc[e.kind] ??= []).push(e); return acc;
                }, {})
              ).map(([kind, list]) => (
                <optgroup key={kind} label={KIND_LABEL[kind] || kind}>
                  {list.map((e) => <option key={e.entity_type} value={e.entity_type}>{e.label}</option>)}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-slate-600">Import mode</span>
            <select value={mode} onChange={(e) => setMode(e.target.value)}
                    className="rounded border border-slate-300 px-3 py-2">
              {(spec?.modes ?? ["ADD"]).map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <Button variant="secondary"
                  onClick={() => downloadFile(`/migration/template/${entity}`, token!, activeTenantId!, `${entity.toLowerCase()}_template.xlsx`)}>
            Template
          </Button>
          <input ref={fileRef} type="file" accept=".csv,.xlsx" className="text-sm" />
          <Button variant="secondary" onClick={doPreview} disabled={busy === "preview"}>
            {busy === "preview" ? "Reading…" : "Preview / map"}
          </Button>
          <Button onClick={() => run(true)} disabled={busy === "dry"}>{busy === "dry" ? "Validating…" : "Dry-run"}</Button>
          <Button onClick={() => run(false)} disabled={busy === "commit"}>{busy === "commit" ? "Importing…" : "Commit"}</Button>
        </div>
        {spec && (
          <p className="mt-2 text-xs text-slate-400">
            {isDoc && <>Header+line document (grouped by <code>{spec.key}</code>). </>}
            Columns: {allCols.join(", ")}
          </p>
        )}
        {preview && (
          <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-xs">
            <div className="mb-1 font-semibold text-slate-600">
              Preview — {preview.row_count} row(s). Auto-mapped fields:
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(preview.suggested_mapping).map(([src, dst]) => (
                <span key={src} className="rounded bg-white px-2 py-0.5 ring-1 ring-slate-200">
                  {src} → <span className="font-medium">{dst}</span>
                </span>
              ))}
              {Object.keys(preview.suggested_mapping).length === 0 &&
                <span className="text-rose-600">No columns auto-matched — check your headers.</span>}
            </div>
          </div>
        )}
      </Card>

      {loading ? <Spinner /> : (
        <Card>
          <h2 className="mb-2 text-sm font-semibold text-slate-700">Migration history</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500">
              <th className="py-1">Batch</th><th>Entity</th><th>Mode</th><th>Status</th><th>Rows</th>
              <th>Created</th><th>Updated</th><th>Skipped</th><th>Errors</th><th></th>
            </tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-slate-100">
                  <td className="py-1 font-mono text-xs">{b.batch_number}</td>
                  <td>{b.entity_type}</td>
                  <td className="text-xs">{b.mode}</td>
                  <td><Badge tone={STATUS_TONE[b.status] || "none"}>{b.status}</Badge></td>
                  <td>{b.total_rows}</td><td>{b.created}</td><td>{b.updated}</td><td>{b.skipped}</td><td>{b.errors}</td>
                  <td className="space-x-2 text-right">
                    <button className="text-xs text-blue-600 underline"
                            onClick={() => downloadFile(`/migration/batches/${b.id}/report`, token!, activeTenantId!, `${b.batch_number}_report.xlsx`)}>
                      report
                    </button>
                    {b.status === "COMMITTED" && (
                      <button className="text-xs text-red-600 underline" disabled={busy === b.id}
                              onClick={() => rollback(b.id)}>rollback</button>
                    )}
                  </td>
                </tr>
              ))}
              {batches.length === 0 && <tr><td colSpan={10} className="py-3 text-center text-slate-400">No migrations yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
