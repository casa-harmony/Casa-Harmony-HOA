"use client";

import { useState } from "react";
import {
  AlertCircle, CalendarClock, CheckCircle2, Clock, Mail, Play, Presentation,
  Receipt, Timer,
} from "lucide-react";
import { useAuth } from "../../providers";
import { useApi, useMutate } from "@/lib/use-api";
import { Alert, Badge, Button, Card, Switch } from "@/components/ui";
import {
  Column, DataTable, EmptyState, PageHeader, PageShell, SectionGuide, StatCard,
  StatGrid, StatusBadge, relTime, shortDate,
} from "@/components/app/kit";

const JOBS = [
  {
    key: "monthly_statements",
    name: "Monthly statements",
    icon: Mail,
    what: "Generates every unit's statement and emails it to the resident.",
    when: "1st of each month",
    configKey: "statements_enabled",
  },
  {
    key: "board_packet",
    name: "Board packet",
    icon: Presentation,
    what: "Assembles the monthly financial pack and notifies every board member.",
    when: "5th of each month",
    configKey: "board_packet_enabled",
  },
  {
    key: "dunning_run",
    name: "Dunning run",
    icon: AlertCircle,
    what: "Finds overdue accounts, sends reminder notices and escalates stages.",
    when: "10th of each month",
    configKey: "dunning_enabled",
  },
  {
    key: "late_fees",
    name: "Late fees",
    icon: Receipt,
    what: "Applies the community's late-fee rule to every overdue balance.",
    when: "15th of each month",
    configKey: "late_fees_enabled",
  },
];

export default function SchedulerPage() {
  const { can } = useAuth();
  const { data: runs } = useApi<any[]>("/scheduler/runs", []);
  const { data: config } = useApi<any>("/scheduler/config", null);
  const { mutate } = useMutate();
  const [flash, setFlash] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const succeeded = runs.filter((r) => r.status === "SUCCESS").length;
  const failed = runs.filter((r) => r.status === "FAILED").length;

  async function runNow(job: (typeof JOBS)[number]) {
    setRunning(job.key);
    await mutate(`/scheduler/run/${job.key}`, "POST");
    setRunning(null);
    setFlash(
      `${job.name} ran successfully. A notification has been posted to the inbox — check the bell.`
    );
    setTimeout(() => setFlash(null), 6000);
  }

  const columns: Column<any>[] = [
    {
      key: "job",
      header: "Job",
      render: (r) => (
        <span className="font-medium">
          {r.job_name.replace(/_/g, " ").toLowerCase()}
        </span>
      ),
    },
    {
      key: "trigger",
      header: "Started by",
      render: (r) => (
        <Badge tone={r.trigger === "MANUAL" ? "info" : "neutral"}>
          {r.trigger === "MANUAL" ? "Run by hand" : "Schedule"}
        </Badge>
      ),
    },
    { key: "status", header: "Result", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "summary",
      header: "What happened",
      render: (r) => (
        <span className="text-xs text-muted-foreground">{r.summary}</span>
      ),
    },
    {
      key: "dur",
      header: "Took",
      numeric: true,
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {(r.duration_ms / 1000).toFixed(1)}s
        </span>
      ),
    },
    {
      key: "when",
      header: "When",
      render: (r) => (
        <span className="text-xs text-muted-foreground">
          {relTime(r.started_at)}
        </span>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="Scheduled Jobs"
        description="The work the system does on its own every month, without anybody needing to remember."
      />

      <SectionGuide
        what="Automation. Four recurring jobs run on a schedule so the routine monthly cycle happens whether or not staff are in the office — statements, the board pack, overdue reminders and late fees."
        who="Administrators configure the schedule. Anybody with access can see the run history, which matters when a resident claims they never received a statement."
        how={[
          "Each job has a switch and a day of the month it runs on.",
          "The job runs automatically at that time and records what it did.",
          "Any job can also be run by hand at any moment — useful for a demo, or to re-send after fixing a problem.",
          "Every run is logged with its result, a summary and how long it took.",
          "A failed run is kept in the history rather than hidden, so it can be investigated and re-run.",
        ]}
        flow="These jobs drive the receivables side: statements go to residents, dunning escalates unpaid accounts into Collections, and the board packet lands in every board member's inbox."
      />

      {flash && <Alert kind="success">{flash}</Alert>}

      <StatGrid>
        <StatCard label="Jobs configured" value={JOBS.length} tone="primary" icon={Timer} />
        <StatCard label="Runs recorded" value={runs.length} icon={Clock} />
        <StatCard label="Succeeded" value={succeeded} tone="success" icon={CheckCircle2} />
        <StatCard label="Failed" value={failed} tone={failed ? "danger" : "success"} icon={AlertCircle} />
      </StatGrid>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider">
          The four scheduled jobs
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {JOBS.map((job) => {
            const Icon = job.icon;
            const enabled = config?.[job.configKey] ?? true;
            const last = runs.find((r) => r.job_name.toLowerCase() === job.key);
            return (
              <Card key={job.key} padded={false}>
                <div className="flex items-start gap-3 border-b px-5 py-4">
                  <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{job.name}</p>
                      {enabled ? (
                        <Badge tone="success">On</Badge>
                      ) : (
                        <Badge tone="neutral">Off</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {job.what}
                    </p>
                    <p className="mt-1.5 flex items-center gap-1 text-2xs text-muted-foreground">
                      <CalendarClock className="h-3 w-3" />
                      Runs on the {job.when}
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0 text-xs text-muted-foreground">
                    {last ? (
                      <>
                        Last run {relTime(last.started_at)} ·{" "}
                        <span className={last.status === "SUCCESS" ? "text-success" : "text-destructive"}>
                          {last.status === "SUCCESS" ? "succeeded" : "failed"}
                        </span>
                      </>
                    ) : (
                      "Never run"
                    )}
                  </div>
                  {can("scheduler.manage") && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={running === job.key}
                      onClick={() => runNow(job)}
                    >
                      <Play className="h-3.5 w-3.5" />
                      {running === job.key ? "Running…" : "Run now"}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider">
          Run history
        </h2>
        <DataTable
          rows={runs}
          columns={columns}
          empty={<EmptyState icon={Clock} title="No runs recorded yet" />}
        />
      </section>
    </PageShell>
  );
}
