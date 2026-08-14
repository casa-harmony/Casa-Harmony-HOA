"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle, ArrowRight, Building2, CheckCircle2, MessageSquare,
  Paperclip, Plus, Send, Ticket as TicketIcon, Upload, User,
} from "lucide-react";
import { useAuth } from "../../providers";
import { useApi, useMutate } from "@/lib/use-api";
import {
  Alert, Badge, Button, Card, Input, Label, Modal, Select, Textarea,
} from "@/components/ui";
import {
  Column, DataTable, DetailSheet, EmptyState, Facts, FilterChips, PageHeader,
  PageShell, SectionGuide, StatCard, StatGrid, StatusBadge, Timeline, Toolbar,
  money, relTime, shortDate,
} from "@/components/app/kit";
import { ChartCard, TicketMixChart } from "@/components/app/charts";

const CATEGORIES = ["MAINTENANCE", "COMPLAINT", "REQUEST", "VIOLATION"];
const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
const STATUSES = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

export default function ServiceDeskPage() {
  const { persona, can } = useAuth();
  const { data: tickets, loading } = useApi<any[]>("/service-desk/tickets", []);
  const { data: vendors } = useApi<any[]>("/vendors", []);
  const { data: homeowners } = useApi<any[]>("/subledger/homeowners", []);
  const { mutate } = useMutate();

  const [status, setStatus] = useState("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const ticket = tickets.find((t) => t.id === selected) ?? null;

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return tickets.filter((t) => {
      if (status !== "ALL" && t.status !== status) return false;
      if (!q) return true;
      return (
        t.subject.toLowerCase().includes(q) ||
        t.ticket_number.toLowerCase().includes(q) ||
        String(t.unit).includes(q) ||
        (t.reported_by ?? "").toLowerCase().includes(q)
      );
    });
  }, [tickets, status, search]);

  const counts = useMemo(
    () => ({
      ALL: tickets.length,
      OPEN: tickets.filter((t) => t.status === "OPEN").length,
      IN_PROGRESS: tickets.filter((t) => t.status === "IN_PROGRESS").length,
      RESOLVED: tickets.filter((t) => t.status === "RESOLVED").length,
      CLOSED: tickets.filter((t) => t.status === "CLOSED").length,
    }),
    [tickets]
  );

  const highOpen = tickets.filter(
    (t) => t.priority === "HIGH" && t.status !== "CLOSED" && t.status !== "RESOLVED"
  ).length;

  async function notify(msg: string) {
    setFlash(msg);
    setTimeout(() => setFlash(null), 4000);
  }

  const columns: Column<any>[] = [
    {
      key: "ref",
      header: "Ticket",
      render: (t) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{t.subject}</p>
          <p className="font-mono text-2xs text-muted-foreground">
            {t.ticket_number}
          </p>
        </div>
      ),
    },
    {
      key: "unit",
      header: "Unit",
      render: (t) => (
        <div>
          <p className="text-sm">{t.unit}</p>
          <p className="truncate text-2xs text-muted-foreground">
            {t.reported_by}
          </p>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (t) => (
        <span className="text-xs text-muted-foreground">
          {t.category.replace(/_/g, " ")}
        </span>
      ),
    },
    { key: "priority", header: "Priority", render: (t) => <StatusBadge status={t.priority} /> },
    { key: "status", header: "Status", render: (t) => <StatusBadge status={t.status} /> },
    {
      key: "vendor",
      header: "Vendor",
      render: (t) => {
        const v = vendors.find((x) => x.id === t.vendor_id);
        return v ? (
          <span className="text-xs">{v.name}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        );
      },
    },
    {
      key: "cost",
      header: "Estimate",
      numeric: true,
      render: (t) => (
        <span className="text-xs">
          {t.estimated_cost ? money(t.estimated_cost, 0) : "—"}
        </span>
      ),
    },
    {
      key: "age",
      header: "Raised",
      render: (t) => (
        <span className="text-xs text-muted-foreground">
          {relTime(t.created_at)}
        </span>
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Core Operations"
        title="Service Desk"
        description="Every problem, request, complaint and rule violation reported in this community — from first report through to the vendor being paid."
        actions={
          can("ticket.manage") && (
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" />
              New ticket
            </Button>
          )
        }
      />

      <SectionGuide
        what="The intake and tracking system for anything that needs doing. A resident reports a leak from the portal, or a staff member logs a complaint — it becomes a ticket that is triaged, assigned and driven to closed."
        who="Property managers run it day to day. Residents create tickets from their portal. Accountants have no access at all — try switching to David Lin and this screen disappears from the menu."
        how={[
          "A ticket is raised with a category, a priority and the unit it relates to.",
          "Staff triage it — set the priority, assign an owner, add notes to the thread.",
          "For work that costs money, a vendor and an estimate are attached.",
          "The ticket is converted into a purchase order, which enters the approval chain based on its amount.",
          "Once approved, the work is done, the vendor invoices, and the invoice is matched against that purchase order before payment.",
          "The ticket is resolved and closed, with the full history retained.",
        ]}
        flow="This is the front door of the money-out cycle. Service Desk → Purchasing → Receiving → Payables → Payments. The link runs both ways: the purchase order number is written back onto the ticket, so its approval status shows here without leaving the screen."
      />

      {flash && <Alert kind="success">{flash}</Alert>}

      <StatGrid>
        <StatCard label="Open" value={counts.OPEN} tone="primary" icon={TicketIcon} />
        <StatCard label="In progress" value={counts.IN_PROGRESS} tone="warning" />
        <StatCard
          label="High priority"
          value={highOpen}
          tone={highOpen ? "danger" : "success"}
          hint={highOpen ? "Needs attention today" : "Nothing urgent"}
          icon={AlertTriangle}
        />
        <StatCard label="Resolved this period" value={counts.RESOLVED} tone="success" icon={CheckCircle2} />
      </StatGrid>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard
          title="What residents are reporting"
          caption="Ticket volume by category, this community"
          table={{
            head: ["Category", "Tickets"],
            rows: CATEGORIES.map((c) => [
              c.replace(/_/g, " "),
              tickets.filter((t) => t.category === c).length,
            ]),
          }}
        >
          <TicketMixChart
            data={CATEGORIES.map((c) => ({
              label: c.charAt(0) + c.slice(1).toLowerCase(),
              count: tickets.filter((t) => t.category === c).length,
            }))}
          />
        </ChartCard>

        <ChartCard
          title="Where the work stands"
          caption="Every ticket by its current status"
          table={{
            head: ["Status", "Tickets"],
            rows: STATUSES.map((s) => [
              s.replace(/_/g, " "),
              tickets.filter((t) => t.status === s).length,
            ]),
          }}
        >
          <TicketMixChart
            data={STATUSES.map((s) => ({
              label: s
                .replace(/_/g, " ")
                .toLowerCase()
                .replace(/^./, (m) => m.toUpperCase()),
              count: tickets.filter((t) => t.status === s).length,
            }))}
          />
        </ChartCard>
      </div>

      <Toolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search by subject, number, unit or resident…"
        filters={
          <FilterChips
            value={status}
            onChange={setStatus}
            options={[
              { value: "ALL", label: "All", count: counts.ALL },
              { value: "OPEN", label: "Open", count: counts.OPEN },
              { value: "IN_PROGRESS", label: "In progress", count: counts.IN_PROGRESS },
              { value: "RESOLVED", label: "Resolved", count: counts.RESOLVED },
              { value: "CLOSED", label: "Closed", count: counts.CLOSED },
            ]}
          />
        }
      />

      <DataTable
        rows={filtered}
        columns={columns}
        onRowClick={(t) => setSelected(t.id)}
        empty={
          <EmptyState
            icon={TicketIcon}
            title={search || status !== "ALL" ? "No tickets match" : "No tickets yet"}
            description={
              search || status !== "ALL"
                ? "Try clearing the search or choosing a different status."
                : "Raise the first ticket to see it appear here."
            }
            action={
              can("ticket.manage") && (
                <Button onClick={() => setCreating(true)}>
                  <Plus className="h-4 w-4" />
                  New ticket
                </Button>
              )
            }
          />
        }
      />

      {ticket && (
        <TicketDrawer
          ticket={ticket}
          vendors={vendors}
          onClose={() => setSelected(null)}
          mutate={mutate}
          notify={notify}
          canManage={can("ticket.manage")}
          actor={persona?.full_name ?? "Staff"}
        />
      )}

      {creating && (
        <NewTicketModal
          homeowners={homeowners}
          onClose={() => setCreating(false)}
          onCreate={async (body) => {
            const t: any = await mutate("/service-desk/tickets", "POST", body);
            setCreating(false);
            notify(`Ticket ${t.ticket_number} created and added to the inbox.`);
            setSelected(t.id);
          }}
        />
      )}
    </PageShell>
  );
}

/* ============================================================ ticket drawer */

function TicketDrawer({
  ticket, vendors, onClose, mutate, notify, canManage, actor,
}: {
  ticket: any;
  vendors: any[];
  onClose: () => void;
  mutate: (p: string, m: string, b?: unknown) => Promise<any>;
  notify: (m: string) => void;
  canManage: boolean;
  actor: string;
}) {
  const { data: comments } = useApi<any[]>(
    `/service-desk/tickets/${ticket.id}/comments`,
    []
  );
  const [reply, setReply] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [vendorId, setVendorId] = useState(ticket.vendor_id ?? "");
  const [estimate, setEstimate] = useState(String(ticket.estimated_cost ?? ""));
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);

  const vendor = vendors.find((v) => v.id === ticket.vendor_id);

  const events = comments.map((c) => ({
    at: relTime(c.at),
    actor: `${c.author} · ${c.role}`,
    title: c.role === "System" ? c.body : c.body,
    tone: c.role === "System" ? ("primary" as const) : ("default" as const),
  }));

  async function send() {
    if (!reply.trim()) return;
    await mutate(`/service-desk/tickets/${ticket.id}/comments`, "POST", {
      author: actor,
      role: "Property Manager",
      body: reply.trim(),
    });
    setReply("");
  }

  async function assignVendor() {
    if (!vendorId) return;
    await mutate(`/service-desk/tickets/${ticket.id}`, "PATCH", {
      vendor_id: vendorId,
      estimated_cost: estimate ? Number(estimate) : null,
      status: "IN_PROGRESS",
    });
    setAssigning(false);
    const v = vendors.find((x) => x.id === vendorId);
    notify(
      `${ticket.ticket_number} assigned to ${v?.name}. A notification has been posted to the inbox — check the bell.`
    );
  }

  async function createPo() {
    const po = await mutate(
      `/service-desk/tickets/${ticket.id}/create-po`,
      "POST",
      { code_combination_id: "00000000-0000-0000-0000-000000000000" }
    );
    notify(
      `Purchase order ${po.po_number} raised and submitted for approval. It now appears on the Approvals screen.`
    );
  }

  async function setStatus(s: string) {
    await mutate(`/service-desk/tickets/${ticket.id}`, "PATCH", {
      status: s,
      actor,
    });
  }

  return (
    <DetailSheet
      open
      onClose={onClose}
      title={ticket.subject}
      subtitle={`${ticket.ticket_number} · Unit ${ticket.unit} · raised by ${ticket.reported_by}`}
      badge={<StatusBadge status={ticket.status} />}
      width="xl"
      footer={
        canManage && (
          <>
            {ticket.status !== "CLOSED" && (
              <Select
                value={ticket.status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-9 w-40"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            )}
            {ticket.vendor_id && !ticket.po_header_id && (
              <Button onClick={createPo}>
                Raise purchase order
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </>
        )
      }
    >
      <div className="space-y-6">
        <Facts
          items={[
            { label: "Category", value: ticket.category.replace(/_/g, " ") },
            { label: "Priority", value: <StatusBadge status={ticket.priority} /> },
            { label: "Assigned to", value: ticket.assigned_to ?? "Unassigned" },
            { label: "Raised", value: shortDate(ticket.created_at) },
            {
              label: "Vendor",
              value: vendor ? vendor.name : "Not assigned",
            },
            {
              label: "Estimate",
              value: ticket.estimated_cost ? money(ticket.estimated_cost) : "—",
            },
          ]}
        />

        <div>
          <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            Description
          </p>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {ticket.description || "No description was provided."}
          </p>
        </div>

        {/* ------------------------------------------------ vendor + spend */}
        <Card className="border-brass/30 bg-brass/[0.04]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-sm font-semibold">
                <Building2 className="h-4 w-4 text-brass" />
                Vendor &amp; spend
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Assigning a vendor moves this ticket into the money-out cycle.
              </p>
            </div>
            {canManage && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAssigning((a) => !a)}
              >
                {ticket.vendor_id ? "Reassign" : "Assign vendor"}
              </Button>
            )}
          </div>

          {assigning && (
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
              <div>
                <Label htmlFor="v">Vendor</Label>
                <Select
                  id="v"
                  value={vendorId}
                  onChange={(e) => setVendorId(e.target.value)}
                >
                  <option value="">Choose a vendor…</option>
                  {vendors
                    .filter((v) => v.status === "ACTIVE")
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} — {v.category}
                      </option>
                    ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="e">Estimate ($)</Label>
                <Input
                  id="e"
                  type="number"
                  value={estimate}
                  onChange={(e) => setEstimate(e.target.value)}
                  placeholder="450"
                />
              </div>
              <Button onClick={assignVendor} disabled={!vendorId}>
                Assign
              </Button>
            </div>
          )}

          {ticket.po_header_id && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-success/30 bg-success/8 px-3 py-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              <p className="text-xs text-muted-foreground">
                A purchase order has been raised from this ticket and is in the
                approval chain. The link is two-way — the order number is stored
                on this ticket.
              </p>
            </div>
          )}

          {!ticket.vendor_id && (
            <p className="mt-3 text-xs text-muted-foreground">
              No vendor assigned. Vendors have no login in the current build, so
              assignment is recorded here and the notification goes to the staff
              owner — see the Roles &amp; Flow screen for the three options.
            </p>
          )}
        </Card>

        {/* ---------------------------------------------------- attachments */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Paperclip className="h-3.5 w-3.5" />
            Attachments
          </p>
          <label className="surface-grid flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors hover:border-primary/50 hover:bg-accent/30">
            <Upload className="mb-1.5 h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">
              Drop photos or a quote here, or click to choose
            </span>
            <span className="mt-0.5 text-2xs text-muted-foreground">
              Held in the browser for this demo
            </span>
            <input
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []).map((f) => ({
                  name: f.name,
                  size: f.size,
                }));
                setFiles((prev) => [...prev, ...list]);
              }}
            />
          </label>
          {files.length > 0 && (
            <ul className="mt-2 space-y-1">
              {files.map((f, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between rounded-md border bg-muted/40 px-2.5 py-1.5 text-xs"
                >
                  <span className="truncate">{f.name}</span>
                  <span className="tabular shrink-0 text-muted-foreground">
                    {(f.size / 1024).toFixed(0)} KB
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* -------------------------------------------------------- history */}
        <div>
          <p className="mb-3 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5" />
            Activity &amp; conversation
          </p>
          <Timeline events={events} />

          {canManage && (
            <div className="mt-4 flex gap-2">
              <Textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Add a note to the thread…"
                className="min-h-[64px]"
              />
              <Button
                onClick={send}
                disabled={!reply.trim()}
                className="self-end"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </DetailSheet>
  );
}

/* ========================================================= new ticket modal */

function NewTicketModal({
  homeowners, onClose, onCreate,
}: {
  homeowners: any[];
  onClose: () => void;
  onCreate: (b: any) => Promise<void>;
}) {
  const [form, setForm] = useState({
    subject: "",
    description: "",
    category: "MAINTENANCE",
    priority: "MEDIUM",
    homeowner_id: homeowners[0]?.id ?? "",
  });
  const [busy, setBusy] = useState(false);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open
      onClose={onClose}
      title="Raise a service ticket"
      description="This creates a real record in the demo — it will appear in the list and post a notification to the inbox."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!form.subject.trim() || busy}
            onClick={async () => {
              setBusy(true);
              await onCreate(form);
              setBusy(false);
            }}
          >
            {busy ? "Creating…" : "Create ticket"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="s">Subject</Label>
          <Input
            id="s"
            value={form.subject}
            onChange={(e) => set("subject", e.target.value)}
            placeholder="e.g. Water leaking from lobby ceiling"
            autoFocus
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="c">Category</Label>
            <Select
              id="c"
              value={form.category}
              onChange={(e) => set("category", e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="p">Priority</Label>
            <Select
              id="p"
              value={form.priority}
              onChange={(e) => set("priority", e.target.value)}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="u">Unit / homeowner</Label>
          <Select
            id="u"
            value={form.homeowner_id}
            onChange={(e) => set("homeowner_id", e.target.value)}
          >
            {homeowners.map((h) => (
              <option key={h.id} value={h.id}>
                Unit {h.property_unit} — {h.first_name} {h.last_name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="d">Description</Label>
          <Textarea
            id="d"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="What is happening, where, and when was it first noticed?"
          />
        </div>
      </div>
    </Modal>
  );
}
