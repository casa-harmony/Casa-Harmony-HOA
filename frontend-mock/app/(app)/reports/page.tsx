"use client";

import { useMemo, useState } from "react";
import { BarChart3, Download, FileSpreadsheet, FileText, Search } from "lucide-react";
import { useAuth } from "../../providers";
import { useApi } from "@/lib/use-api";
import { downloadFile } from "@/lib/api";
import { Alert, Badge, Button, Card, Label, Select } from "@/components/ui";
import {
  EmptyState, FilterChips, PageHeader, PageShell, SectionGuide, StatCard,
  StatGrid, Toolbar,
} from "@/components/app/kit";

export default function ReportsPage() {
  const { activeTenantId, token } = useAuth();
  const { data: reports } = useApi<any[]>("/reports/catalog", []);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("ALL");
  const [period, setPeriod] = useState("JUL-2026");
  const [flash, setFlash] = useState<string | null>(null);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    reports.forEach((r) => m.set(r.category, (m.get(r.category) ?? 0) + 1));
    return Array.from(m.entries());
  }, [reports]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return reports.filter((r) => {
      if (category !== "ALL" && r.category !== category) return false;
      return (
        !q ||
        r.name.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q)
      );
    });
  }, [reports, category, search]);

  async function run(report: any, format: string) {
    setFlash(`Generating ${report.name} for ${period}…`);
    await downloadFile(
      `/reports/${report.id}?period=${period}&format=${format}`,
      token,
      activeTenantId ?? "",
      `${report.id}-${period}.${format.toLowerCase()}`
    );
    setFlash(
      `${report.name} generated. The demo produces a placeholder file; the live server returns the real document.`
    );
    setTimeout(() => setFlash(null), 6000);
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="Reports"
        description="Every standard report the platform produces, ready to run for any accounting period and export as PDF or spreadsheet."
        actions={
          <div className="flex items-center gap-2">
            <Label className="mb-0">Period</Label>
            <Select
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="h-9 w-36"
            >
              {["JUL-2026", "JUN-2026", "MAY-2026", "APR-2026", "MAR-2026"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          </div>
        }
      />

      <SectionGuide
        what="The report library. Rather than building reports by hand, staff pick one from this catalogue, choose an accounting period, and export it."
        who="Anyone holding the reporting permission — managers, accountants and board members. The accountant runs these monthly; the board reads the output."
        how={[
          "Choose an accounting period at the top of the screen.",
          "Pick a report and the format you want it in.",
          "The report is generated from posted ledger data, so it always agrees with the books.",
          "Reports for a closed period never change, which is what makes them safe to circulate.",
          "The board packet bundles several of these into one document automatically each month.",
        ]}
        flow="Reads from the General Ledger and the subledgers. Nothing here writes anything back — reports are a one-way view of what has already been posted."
      />

      {flash && <Alert kind="info">{flash}</Alert>}

      <StatGrid>
        <StatCard label="Reports available" value={reports.length} tone="primary" icon={BarChart3} />
        <StatCard label="Categories" value={categories.length} />
        <StatCard label="Current period" value={period} />
        <StatCard label="Export formats" value="PDF · XLSX" icon={Download} />
      </StatGrid>

      <Toolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search reports…"
        filters={
          <FilterChips
            value={category}
            onChange={setCategory}
            options={[
              { value: "ALL", label: "All", count: reports.length },
              ...categories.map(([c, n]) => ({ value: c, label: c, count: n })),
            ]}
          />
        }
      />

      {filtered.length === 0 ? (
        <EmptyState icon={Search} title="No reports match" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((r) => (
            <Card key={r.id} padded={false} className="flex flex-col">
              <div className="flex-1 px-5 py-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{r.name}</p>
                  <Badge tone="neutral" className="shrink-0">
                    {r.category}
                  </Badge>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {r.description}
                </p>
              </div>
              <div className="flex gap-2 border-t px-5 py-3">
                {(r.formats ?? []).map((f: string) => (
                  <Button
                    key={f}
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => run(r, f)}
                  >
                    {f === "PDF" ? (
                      <FileText className="h-3.5 w-3.5" />
                    ) : (
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                    )}
                    {f}
                  </Button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
