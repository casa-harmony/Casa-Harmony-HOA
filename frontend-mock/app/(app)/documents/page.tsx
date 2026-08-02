"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch, downloadFile, API_BASE } from "@/lib/api";
import type { DocumentAttachment } from "@/lib/types";
import { Alert, Button, Card, Input, Label, Select, Spinner } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileText, Download, Trash2, FileOutput, FileSpreadsheet, FileIcon } from "lucide-react";

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

      <Card className="shadow-sm border-slate-200 rounded-xl overflow-hidden p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-700 uppercase tracking-wide">Upload New Document</h2>
        <form onSubmit={upload} className="grid items-end gap-3 md:grid-cols-[160px_1fr_1fr_auto]">
          <div>
            <Label>Entity type</Label>
            <Select value={form.entity_type} onChange={(e) => setForm({ ...form, entity_type: e.target.value })}>
              {ENTITIES.map((x) => <option key={x}>{x}</option>)}
            </Select>
          </div>
          <div><Label>Entity ID (uuid)</Label><Input value={form.entity_id} onChange={(e) => setForm({ ...form, entity_id: e.target.value })} placeholder="paste record id" /></div>
          <div><Label className="text-slate-600">File</Label><input ref={fileRef} type="file" className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" /></div>
          <Button type="submit" disabled={busy === "upload"} className="bg-indigo-600 hover:bg-indigo-700 text-white">
            {busy === "upload" ? "Uploading…" : "Upload"}
          </Button>
        </form>
      </Card>

      <Card className="shadow-sm border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          {loading ? (
             <div className="flex justify-center p-12"><Spinner /></div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="font-semibold text-slate-600 w-1/3">Filename</TableHead>
                  <TableHead className="font-semibold text-slate-600">Entity</TableHead>
                  <TableHead className="font-semibold text-slate-600">Type</TableHead>
                  <TableHead className="font-semibold text-slate-600 text-right">Size</TableHead>
                  <TableHead className="font-semibold text-slate-600">Uploaded</TableHead>
                  <TableHead className="font-semibold text-slate-600 text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.length === 0 && (
                   <TableRow>
                      <TableCell colSpan={6} className="h-32 text-center text-slate-500 font-medium">
                         No documents yet.
                      </TableCell>
                   </TableRow>
                )}
                {docs.map((d) => (
                  <TableRow key={d.id} className="hover:bg-slate-50 transition-colors">
                    <TableCell className="font-medium text-slate-800">
                      <div className="flex items-center gap-2">
                        {d.content_type.includes("pdf") ? <FileText className="h-4 w-4 text-rose-500" /> : 
                         d.content_type.includes("word") ? <FileIcon className="h-4 w-4 text-blue-500" /> :
                         d.content_type.includes("excel") || d.content_type.includes("spreadsheet") ? <FileSpreadsheet className="h-4 w-4 text-emerald-500" /> :
                         <FileOutput className="h-4 w-4 text-slate-400" />}
                        {d.filename}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                         <Badge variant="secondary" className="bg-indigo-50 text-indigo-700">{d.entity_type}</Badge> 
                         <span className="font-mono text-xs text-slate-400">{d.entity_id.slice(0, 8)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 truncate max-w-[150px]">{d.content_type.split("/").pop()}</TableCell>
                    <TableCell className="text-right font-mono font-medium text-slate-600">{(d.size_bytes / 1024).toFixed(1)} KB</TableCell>
                    <TableCell className="text-xs font-medium text-slate-600">{new Date(d.created_at).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" className="h-8 w-8 p-1 text-slate-500 hover:text-indigo-600" onClick={() => downloadFile(`/documents/${d.id}/download`, token!, activeTenantId!, d.filename)} title="Download">
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" className="h-8 w-8 p-1 text-slate-500 hover:text-rose-600" onClick={() => remove(d.id)} disabled={busy === d.id} title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </Card>
    </div>
  );
}
