"use client";

import { useState } from "react";
import {
  ArrowRightLeft, CheckCircle2, Database, FileUp, RotateCcw, TriangleAlert,
  Upload,
} from "lucide-react";
import { useAuth } from "../../providers";
import { useApi, useMutate } from "@/lib/use-api";
import { Alert, Badge, Button, Card, Label, Select } from "@/components/ui";
import {
  Column, DataTable, EmptyState, PageHeader, PageShell, SectionGuide, StatCard,
  StatGrid, StatusBadge, shortDate,
} from "@/components/app/kit";
import { cn } from "@/lib/utils";

export default function MigrationPage() {
  const { can } = useAuth();
  const { data: batches } = useApi<any[]>("/migration/batches", []);
  const { data: entities } = useApi<
    { entity_type: string; label: string }[]
  >("/migration/entities", []);
  const { mutate } = useMutate();

  const [entity, setEntity] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const totalRows = batches.reduce((s, b) => s + b.row_count, 0);
  const totalFailed = batches.reduce((s, b) => s + b.failed, 0);
  const completed = batches.filter((b) => b.status === "COMPLETED").length;

  const columns: Column<any>[] = [
    { key: "entity", header: "What was imported", render: (b) => <span className="font-medium">{b.entity}</span> },
    { key: "rows", header: "Rows", numeric: true, render: (b) => b.row_count.toLocaleString() },
    {
      key: "ok",
      header: "Loaded",
      numeric: true,
      render: (b) => <span className="text-success">{b.succeeded.toLocaleString()}</span>,
    },
    {
      key: "fail",
      header: "Quarantined",
      numeric: true,
      render: (b) =>
        b.failed > 0 ? (
          <span className="font-semibold text-destructive">{b.failed}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    { key: "status", header: "Status", render: (b) => <StatusBadge status={b.status} /> },
    { key: "when", header: "Imported", render: (b) => <span className="text-xs text-muted-foreground">{shortDate(b.imported_at)}</span> },
    { key: "by", header: "By", render: (b) => <span className="text-xs text-muted-foreground">{b.imported_by}</span> },
    {
      key: "act",
      header: "",
      render: (b) =>
        b.can_rollback && b.status === "COMPLETED" && can("data.migrate") ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await mutate(`/migration/batches/${b.id}/rollback`, "POST");
              setFlash(`${b.entity} import rolled back — every row from that batch has been removed.`);
              setTimeout(() => setFlash(null), 5000);
            }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Roll back
          </Button>
        ) : null,
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="Data Migration"
        description="Bringing a community's history across from whatever system it used before — and being able to undo it cleanly if something is wrong."
      />

      <SectionGuide
        what="The onboarding tool. A new community arrives with years of records in a spreadsheet or an old system: homeowners, outstanding balances, vendors, historical ledger entries, fixed assets. This is how those get in."
        who="Platform staff and senior administrators only. It is the most destructive capability in the product, so the permission is granted narrowly."
        how={[
          "Choose what kind of records you are importing and upload the file.",
          "Every row is validated before anything is written — nothing is imported halfway.",
          "Rows that fail validation are quarantined and reported, and the rest still load.",
          "The whole import is recorded as one batch with a name against it.",
          "A batch can be rolled back in full, which removes every row it created and nothing else.",
          "Once a community goes live, rollback is disabled to protect real transactions.",
        ]}
        flow="Feeds every other section — homeowners land in Residents, balances in Receivables, vendors in Vendors, history in the General Ledger. This is a one-way load, but each batch is individually reversible until go-live."
      />

      {flash && <Alert kind="success">{flash}</Alert>}

      <StatGrid>
        <StatCard label="Batches imported" value={batches.length} tone="primary" icon={Database} />
        <StatCard label="Rows loaded" value={totalRows.toLocaleString()} icon={ArrowRightLeft} />
        <StatCard label="Completed cleanly" value={completed} tone="success" icon={CheckCircle2} />
        <StatCard
          label="Quarantined rows"
          value={totalFailed}
          tone={totalFailed ? "warning" : "success"}
          hint={totalFailed ? "Reviewed and handled" : "None"}
          icon={TriangleAlert}
        />
      </StatGrid>

      {can("data.migrate") && (
        <Card padded={false}>
          <div className="border-b px-5 py-3.5">
            <h3 className="text-sm font-semibold">Import a file</h3>
            <p className="text-xs text-muted-foreground">
              CSV or Excel. Every row is validated before anything is written.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-[240px_1fr_auto] lg:items-end">
            <div>
              <Label htmlFor="ent">What are you importing?</Label>
              <Select id="ent" value={entity} onChange={(e) => setEntity(e.target.value)}>
                <option value="">Choose…</option>
                {entities.map((e) => (
                  <option key={e.entity_type} value={e.entity_type}>
                    {e.label}
                  </option>
                ))}
              </Select>
            </div>

            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const f = e.dataTransfer.files?.[0];
                if (f) setFile(f);
              }}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border-2 border-dashed px-4 py-3 transition-colors",
                dragging ? "border-primary bg-primary/10" : "hover:border-primary/50 hover:bg-accent/30"
              )}
            >
              <FileUp className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {file ? file.name : "Drop a CSV or Excel file here"}
                </span>
                <span className="block text-2xs text-muted-foreground">
                  {file
                    ? `${(file.size / 1024).toFixed(0)} KB ready to validate`
                    : "or click to browse"}
                </span>
              </span>
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>

            <Button
              disabled={!entity || !file}
              onClick={() => {
                setFlash(
                  `${file?.name} validated against the ${entity} template. In the live product the rows would now be loaded as a reversible batch.`
                );
                setFile(null);
                setEntity("");
                setTimeout(() => setFlash(null), 7000);
              }}
            >
              <Upload className="h-4 w-4" />
              Validate &amp; import
            </Button>
          </div>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider">
          Import history
        </h2>
        <DataTable
          rows={batches}
          columns={columns}
          empty={<EmptyState icon={Database} title="Nothing imported yet" />}
        />
      </section>

      <Card className="border-warning/40 bg-warning/5">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-warning">
          <TriangleAlert className="h-4 w-4" />
          Why rollback stops at go-live
        </p>
        <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">
          Before a community goes live, an import can be undone completely
          because nothing else has happened yet. Once it is live, residents have
          paid and vendors have been paid against those records — reversing an
          import would silently destroy real transactions. From that point
          corrections are made as normal accounting entries instead.
        </p>
      </Card>
    </PageShell>
  );
}
