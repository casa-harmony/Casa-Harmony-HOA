"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile, API_BASE } from "@/lib/api";
import type { DocumentAttachment } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Select, Spinner } from "@/components/ui";

const ENTITIES = ["AR_INVOICE", "AP_INVOICE", "PO", "ASSET", "RESERVE_STUDY", "HOMEOWNER", "OTHER"];

export default function DocumentsPage() {
  const { token, activeTenantId } = useAuth();
  const [docs, setDocs] = useState<DocumentAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({ entity_type: "AR_INVOICE", entity_id: "", notes: "" });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      setDocs(await apiFetch<DocumentAttachment[]>("/documents", { token, tenantId: activeTenantId }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const f = fileRef.current?.files?.[0];
    if (!f || !form.entity_id) { setError("Pick a file and enter the entity ID."); return; }
    setBusy("upload"); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("entity_type", form.entity_type);
      fd.append("entity_id", form.entity_id);
      if (form.notes) fd.append("notes", form.notes);
      const res = await fetch(`${API_BASE}/documents`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": activeTenantId! }, body: fd });
      if (!res.ok) throw new Error((await res.json()).detail || "Upload failed");
      setForm({ entity_type: form.entity_type, entity_id: "", notes: "" });
      if (fileRef.current) fileRef.current.value = "";
      setMsg("Uploaded."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(null); }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this document?")) return;
    setBusy(id); setError(null);
    try {
      await apiFetch(`/documents/${id}`, { method: "DELETE", token, tenantId: activeTenantId });
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Delete failed"); }
    finally { setBusy(null); }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Documents</h1>
          <p className="text-sm text-slate-500">Attach supporting files to invoices, POs, assets, and more.</p>
        </div>
        <Button variant="secondary" onClick={() => downloadFile("/documents/index/export", token!, activeTenantId!, "document_index.xlsx")}>Index xlsx</Button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {msg && <Alert kind="success">{msg}</Alert>}

      <Card>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Upload</h2>
        <form onSubmit={upload} className="grid items-end gap-3 md:grid-cols-[160px_1fr_1fr_auto]">
          <div>
            <Label>Entity type</Label>
            <Select value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })}>
              {ENTITIES.map((x) => <option key={x}>{x}</option>)}
            </Select>
          </div>
          <div><Label>Entity ID (uuid)</Label><Input value={form.entity_id} onChange={(e) => setForm({ ...form, entity_id: e.target.value })} placeholder="paste record id" /></div>
          <div><Label>File</Label><input ref={fileRef} type="file" className="block w-full text-sm" /></div>
          <Button type="submit" disabled={busy === "upload"}>{busy === "upload" ? "…" : "Upload"}</Button>
        </form>
      </Card>

      <Card>
        {loading ? <Spinner /> : (
          <table className="w-full text-left text-sm">
            <thead><tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
              <th className="py-1 pr-3">Filename</th><th className="py-1 pr-3">Entity</th>
              <th className="py-1 pr-3">Type</th><th className="py-1 pr-3 text-right">Size</th>
              <th className="py-1 pr-3">Uploaded</th><th className="py-1 pr-3 text-right">Action</th></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id} className="border-b border-slate-100">
                  <td className="py-1 pr-3 font-medium">{d.filename}</td>
                  <td className="py-1 pr-3"><Badge>{d.entity_type}</Badge> <span className="font-mono text-xs text-slate-400">{d.entity_id.slice(0, 8)}</span></td>
                  <td className="py-1 pr-3 text-xs text-slate-500">{d.content_type}</td>
                  <td className="py-1 pr-3 text-right">{(d.size_bytes / 1024).toFixed(1)} KB</td>
                  <td className="py-1 pr-3 text-xs">{new Date(d.created_at).toLocaleDateString()}</td>
                  <td className="py-1 pr-3 text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => downloadFile(`/documents/${d.id}/download`, token!, activeTenantId!, d.filename)}>Download</Button>
                      <Button variant="secondary" onClick={() => remove(d.id)} disabled={busy === d.id}>Delete</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && <tr><td colSpan={6} className="py-2 text-slate-400">No documents yet.</td></tr>}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
