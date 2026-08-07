"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import {
  Download, Eye, File, FileImage, FileSpreadsheet, FileText, Files, Lock,
  Trash2, Upload, Users,
} from "lucide-react";
import { useAuth } from "../../providers";
import { useApi, useMutate } from "@/lib/use-api";
import { Alert, Badge, Button, Card, Label, Select } from "@/components/ui";
import {
  DetailSheet, EmptyState, Facts, FilterChips, PageHeader, PageShell,
  SectionGuide, StatCard, StatGrid, Toolbar, relTime, shortDate,
} from "@/components/app/kit";
import { cn } from "@/lib/utils";

const VISIBILITY = [
  { value: "STAFF", label: "Staff only", icon: Lock, tone: "neutral" },
  { value: "BOARD", label: "Board", icon: Users, tone: "brass" },
  { value: "RESIDENTS", label: "All residents", icon: Eye, tone: "success" },
];

function iconFor(mime: string) {
  if (mime.startsWith("image/")) return FileImage;
  if (mime.includes("spreadsheet") || mime.includes("excel")) return FileSpreadsheet;
  if (mime.includes("pdf") || mime.includes("word")) return FileText;
  return File;
}

function sizeOf(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const { can, persona } = useAuth();
  const { data: documents } = useApi<any[]>("/documents", []);
  const { mutate } = useMutate();

  const [search, setSearch] = useState("");
  const [type, setType] = useState("ALL");
  const [selected, setSelected] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const doc = documents.find((d) => d.id === selected) ?? null;

  const types = useMemo(() => {
    const set = new Map<string, number>();
    documents.forEach((d) => set.set(d.entity_type, (set.get(d.entity_type) ?? 0) + 1));
    return Array.from(set.entries());
  }, [documents]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return documents.filter((d) => {
      if (type !== "ALL" && d.entity_type !== type) return false;
      return !q || d.filename.toLowerCase().includes(q);
    });
  }, [documents, type, search]);

  const totalSize = documents.reduce((s, d) => s + d.size_bytes, 0);
  const residentVisible = documents.filter((d) => d.visibility === "RESIDENTS").length;

  const upload = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files);
      for (const f of list) {
        const created: any = await mutate("/documents", "POST", {
          filename: f.name,
          entity_type: "GENERAL",
          content_type: f.type || "application/octet-stream",
          size_bytes: f.size,
          uploaded_by: persona?.full_name ?? "Staff",
          visibility: "STAFF",
        });
        if (f.type.startsWith("image/")) {
          setPreviews((p) => ({ ...p, [created.id]: URL.createObjectURL(f) }));
        }
      }
      setFlash(
        `${list.length} file${list.length > 1 ? "s" : ""} uploaded. In the live product the bytes go to encrypted storage; here they stay in your browser.`
      );
      setTimeout(() => setFlash(null), 6000);
    },
    [mutate, persona]
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Core Operations"
        title="Documents"
        description="Every file the community holds — governing documents, budgets, contracts, meeting minutes, invoices and photographs — with control over who can see each one."
        actions={
          can("document.manage") && (
            <Button onClick={() => inputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Upload files
            </Button>
          )
        }
      />

      <SectionGuide
        what="The community's filing cabinet. A file is never loose — it is always attached to something: a ticket, an invoice, a purchase order, an asset, a board meeting, a specific homeowner, or the community itself."
        who="Staff upload and organise. Board members read board papers. Residents see only what has been published to them — their own statements and the community-wide documents like the rulebook."
        how={[
          "Drop a file anywhere on this screen, or use the upload button.",
          "Choose what the file belongs to — that attachment is what makes it findable later from the ticket or invoice it relates to.",
          "Set who can see it: staff only, the board, or every resident.",
          "Files are stored under an opaque key rather than their filename, so nothing can be reached by guessing a web address.",
          "Every download is permission-checked and recorded in the audit trail.",
        ]}
        flow="Documents attach outward to every other section. The same mechanism serves a photo on a service ticket, a signed contract on a purchase order, and a homeowner's monthly statement in their portal."
      />

      {flash && <Alert kind="success">{flash}</Alert>}

      <StatGrid>
        <StatCard label="Files held" value={documents.length} tone="primary" icon={Files} />
        <StatCard label="Total size" value={sizeOf(totalSize)} />
        <StatCard label="Visible to residents" value={residentVisible} tone="success" icon={Eye} />
        <StatCard label="Categories" value={types.length} />
      </StatGrid>

      {/* ------------------------------------------------------- drop zone */}
      {can("document.manage") && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files?.length) upload(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "surface-grid flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragging
              ? "border-primary bg-primary/10"
              : "border-border hover:border-primary/50 hover:bg-accent/30"
          )}
        >
          <div className="mb-2.5 flex h-11 w-11 items-center justify-center rounded-full border bg-card">
            <Upload className={cn("h-5 w-5", dragging ? "text-primary" : "text-muted-foreground")} />
          </div>
          <p className="text-sm font-semibold">
            {dragging ? "Release to upload" : "Drop files here to upload"}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            PDF, Word, Excel, images — or click to browse
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) upload(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
      )}

      <Toolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search files by name…"
        filters={
          <FilterChips
            value={type}
            onChange={setType}
            options={[
              { value: "ALL", label: "All", count: documents.length },
              ...types.map(([t, c]) => ({
                value: t,
                label: t.replace(/_/g, " ").toLowerCase(),
                count: c,
              })),
            ]}
          />
        }
      />

      {/* ------------------------------------------------------- file grid */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={Files}
          title="No documents match"
          description="Clear the search, or drop a file above to add one."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((d) => {
            const Icon = iconFor(d.content_type);
            const vis = VISIBILITY.find((v) => v.value === d.visibility);
            return (
              <button
                key={d.id}
                onClick={() => setSelected(d.id)}
                className="group flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-accent/20"
              >
                <div className="flex h-24 items-center justify-center overflow-hidden border-b bg-muted/40">
                  {previews[d.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={previews[d.id]}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Icon className="h-8 w-8 text-muted-foreground/50" />
                  )}
                </div>
                <div className="flex flex-1 flex-col p-3">
                  <p className="line-clamp-2 text-sm font-medium leading-snug">
                    {d.filename}
                  </p>
                  <p className="mt-1 text-2xs text-muted-foreground">
                    {sizeOf(d.size_bytes)} · {relTime(d.created_at)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <Badge tone="neutral" className="text-[10px]">
                      {d.entity_type.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                    {vis && (
                      <Badge tone={vis.tone as any} className="text-[10px]">
                        {vis.label}
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {doc && (
        <DetailSheet
          open
          onClose={() => setSelected(null)}
          title={doc.filename}
          subtitle={`${sizeOf(doc.size_bytes)} · uploaded by ${doc.uploaded_by}`}
          badge={
            <Badge
              tone={
                (VISIBILITY.find((v) => v.value === doc.visibility)?.tone as any) ??
                "neutral"
              }
            >
              {VISIBILITY.find((v) => v.value === doc.visibility)?.label}
            </Badge>
          }
          footer={
            <>
              <Button variant="secondary">
                <Download className="h-4 w-4" />
                Download
              </Button>
              {can("document.manage") && (
                <Button
                  variant="danger"
                  onClick={async () => {
                    await mutate(`/documents/${doc.id}`, "DELETE");
                    setSelected(null);
                    setFlash("File removed.");
                    setTimeout(() => setFlash(null), 3000);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-6">
            {previews[doc.id] && (
              <div className="overflow-hidden rounded-lg border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previews[doc.id]} alt="" className="w-full" />
              </div>
            )}

            <Facts
              items={[
                { label: "Attached to", value: doc.entity_type.replace(/_/g, " ") },
                { label: "File type", value: doc.content_type },
                { label: "Size", value: sizeOf(doc.size_bytes) },
                { label: "Uploaded", value: shortDate(doc.created_at) },
                { label: "Uploaded by", value: doc.uploaded_by },
              ]}
            />

            {can("document.manage") && (
              <div>
                <Label htmlFor="vis">Who can see this file</Label>
                <Select
                  id="vis"
                  value={doc.visibility}
                  onChange={(e) =>
                    mutate(`/documents`, "POST", {}).then(() => {})
                  }
                  disabled
                >
                  {VISIBILITY.map((v) => (
                    <option key={v.value} value={v.value}>
                      {v.label}
                    </option>
                  ))}
                </Select>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Changing visibility instantly changes what residents see in
                  their portal.
                </p>
              </div>
            )}

            <Card className="border-primary/25 bg-accent/40">
              <p className="text-sm font-semibold">How this file is protected</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                <li>· Stored under a random key, not its filename</li>
                <li>· Every download checks the requester's permission</li>
                <li>· Access is written to the audit trail</li>
                <li>· Belongs to this community only and cannot be reached from another</li>
              </ul>
            </Card>
          </div>
        </DetailSheet>
      )}
    </PageShell>
  );
}
