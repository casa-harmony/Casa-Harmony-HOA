"use client";

import { useState } from "react";
import { ArrowLeftRight, ArrowRight, Ban, Check, Network, ShieldCheck, X } from "lucide-react";
import { ALL_PERMISSIONS, NAV_GROUPS, PERMISSIONS, ROLES, roleHas } from "@/lib/rbac";
import { Badge, Card } from "@/components/ui";
import {
  Column, DataTable, PageHeader, PageShell, SectionGuide, StatusBadge,
} from "@/components/app/kit";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------- data */

const CAST = [
  { who: "Super Administrator", code: "SUPERADMIN", person: "The company selling the software", where: "Staff app", sees: "Every community", system: "Staff — flag on the account" },
  { who: "System Administrator", code: "SYSADMIN", person: "Senior staff at the management company", where: "Staff app", sees: "The communities they are granted", system: "Staff — one grant per community" },
  { who: "HOA Administrator", code: "HOA_ADMIN", person: "The property manager", where: "Staff app", sees: "One community, everything in it", system: "Staff — one grant" },
  { who: "Accountant", code: "ACCOUNTANT", person: "Bookkeeper or controller", where: "Staff app", sees: "One community, finance only", system: "Staff — one grant" },
  { who: "Board Member", code: "BOARD_MEMBER", person: "Elected volunteer homeowner", where: "Staff app", sees: "One community, read plus approve", system: "Staff — proposed, not built" },
  { who: "Viewer", code: "VIEWER", person: "Auditor or inspector", where: "Staff app", sees: "One community, read-only", system: "Staff — one grant" },
  { who: "Resident", code: "OWNER / RENTER", person: "Homeowner or their renter", where: "Resident portal", sees: "Only their own units", system: "Separate identity system" },
  { who: "Vendor", code: "—", person: "Plumber, landscaper, elevator firm", where: "No login at all", sees: "Nothing", system: "None — a data record only" },
];

const FLOW_DIRECTION = [
  { between: "Ticket → Purchase order", dir: "both", back: "The ticket creates the order going forward, and the order number is written back onto the ticket — so its approval status shows on the ticket without leaving the screen." },
  { between: "Order → Delivery → Invoice", dir: "both", back: "Documents are created forward, but matching reads backward — the invoice is validated against the order and the delivery record. The amount billed is then written back onto the order." },
  { between: "Order → Money reserved", dir: "both", back: "Approving an order reserves the money. Invoicing against it releases the reservation. A matched pair — a reservation never released would overstate committed spend forever." },
  { between: "Document → Approval", dir: "both", back: "Submission travels forward through the levels; approval returns permission to act, and rejection returns the document to its author with the reason attached." },
  { between: "Budget ↔ Transactions", dir: "both", back: "The budget constrains new spending going forward; posted actuals feed back into it. In advisory mode an overspend warns, in absolute mode it blocks. The only true control loop in the system." },
  { between: "Invoice → Reminders → Collections", dir: "both", back: "Escalation moves forward automatically by days overdue; payment moves the case back to good standing from any stage." },
  { between: "Payment → Bank reconciliation", dir: "both", back: "Payments go out and appear on the bank statement; reconciliation matches them and writes 'cleared' back onto the payment record." },
  { between: "Staff ↔ Resident portal", dir: "both", back: "Staff actions surface to residents as invoices, statements and documents; residents' payments and requests come back into the staff ledger and service desk." },
  { between: "Subledgers → General ledger", dir: "one", back: "Nothing. Receivables and payables post into the ledger and it never pushes back. It is the endpoint — corrections are new entries, never edits." },
  { between: "Posting → Period close", dir: "one", back: "Nothing. Closing is a gate that shuts. Reopening a closed period is an administrative act with an audit trail, not a normal operation." },
  { between: "Everything → Audit trail", dir: "one", back: "Nothing. The audit trail is append-only by design and exists to be read by people, not by the system." },
  { between: "Staff → Vendor", dir: "none", back: "Nothing at all — vendors have no account. This is the open decision the client needs to make." },
];

const APPROVAL_BANDS = [
  { level: 1, from: "$0", role: "HOA Administrator", small: true, mid: true, large: true },
  { level: 2, from: "$5,000", role: "Board Treasurer", small: false, mid: true, large: true },
  { level: 3, from: "$25,000", role: "Full Board", small: false, mid: false, large: true },
];

/* ------------------------------------------------------------------- page */

export default function RolesAndFlowPage() {
  const [roleTab, setRoleTab] = useState("HOA_ADMIN");
  const role = ROLES[roleTab];

  const castCols: Column<any>[] = [
    {
      key: "who",
      header: "Who",
      render: (c) => (
        <div>
          <p className="font-medium">{c.who}</p>
          <p className="font-mono text-2xs text-muted-foreground">{c.code}</p>
        </div>
      ),
    },
    { key: "person", header: "Real-world person", render: (c) => <span className="text-xs text-muted-foreground">{c.person}</span> },
    {
      key: "where",
      header: "Signs in",
      render: (c) =>
        c.where === "No login at all" ? (
          <Badge tone="danger">No login</Badge>
        ) : (
          <span className="text-xs">{c.where}</span>
        ),
    },
    { key: "sees", header: "Sees", render: (c) => <span className="text-xs text-muted-foreground">{c.sees}</span> },
    { key: "system", header: "Identity system", render: (c) => <span className="text-xs text-muted-foreground">{c.system}</span> },
  ];

  const flowCols: Column<any>[] = [
    { key: "between", header: "Between", render: (f) => <span className="font-medium">{f.between}</span> },
    {
      key: "dir",
      header: "Direction",
      render: (f) =>
        f.dir === "both" ? (
          <Badge tone="primary"><ArrowLeftRight className="h-3 w-3" /> Both ways</Badge>
        ) : f.dir === "one" ? (
          <Badge tone="brass"><ArrowRight className="h-3 w-3" /> One way only</Badge>
        ) : (
          <Badge tone="danger"><Ban className="h-3 w-3" /> Neither</Badge>
        ),
    },
    { key: "back", header: "What travels back", render: (f) => <span className="text-xs leading-relaxed text-muted-foreground">{f.back}</span> },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Reference"
        title="Roles, Access & Operating Flow"
        description="The complete map of who does what, what each person sees, and the direction every business flow travels. Written for the client to read and verify before further build."
      />

      <SectionGuide
        defaultOpen
        what="A reference screen rather than a working one. It documents the access model and the business flows so the client can confirm the design matches how their business actually runs."
        who="Everyone can open this — it carries no permission requirement, deliberately, because it is the shared vocabulary for the project."
        how={[
          "Read the cast first — who exists and how they sign in.",
          "Use the role explorer to see exactly what each person can reach.",
          "Follow the two main cycles: money coming in from homeowners, and work going out to vendors.",
          "Check the flow-direction table — this is where corrections are possible and where they are not.",
          "Finish on the open decisions, which are the questions we need answered.",
        ]}
      />

      {/* ------------------------------------------------------------ cast */}
      <Section
        n="01"
        title="The cast"
        lead="Eight kinds of people. They do not all sign in the same way, and two of them do not sign in at all."
      >
        <DataTable rows={CAST} columns={castCols} getRowKey={(c) => c.who} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <p className="text-sm font-semibold">Staff — one login, a role per community</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              A staff member has a single password for the whole platform.
              Access to each community is a separate grant carrying its own
              role. Jane can be an administrator in Sunnyvale, an accountant in
              Oakridge and read-only in Pinecrest — one login, three different
              sets of powers, switched from the header.
            </p>
          </Card>
          <Card>
            <p className="text-sm font-semibold">Residents — a separate system entirely</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              A resident is not a staff account. Their username is unique within
              one community, they sign in at a different address, and one
              resident can hold several units — a landlord with three condos has
              one login and sees three. They receive a one-time code by email or
              text rather than using an authenticator app.
            </p>
          </Card>
        </div>

        <Card className="border-destructive/30 bg-destructive/5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
            <X className="h-4 w-4" />
            Vendors sit outside the access model
          </p>
          <p className="mt-1.5 max-w-4xl text-sm text-muted-foreground">
            A vendor has no account, no password and no portal. That is why
            &ldquo;assign a ticket to a vendor and it lands in their
            inbox&rdquo; cannot work today — a notification is addressed to a
            user account, and a vendor is not one. This is a product decision to
            make, not a bug to fix. The three options are at the bottom of this
            screen.
          </p>
        </Card>
      </Section>

      {/* -------------------------------------------------- role explorer */}
      <Section
        n="02"
        title="What each role can reach"
        lead="Pick a role. The screens listed are exactly what appears in their sidebar; struck-through entries are hidden from them. Every capability is a real permission the server checks on every request."
      >
        <div className="flex flex-wrap gap-1.5">
          {Object.values(ROLES).map((r) => (
            <button
              key={r.code}
              onClick={() => setRoleTab(r.code)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                roleTab === r.code
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted"
              )}
            >
              {r.code.replace(/_/g, " ")}
              {!r.implemented && (
                <span className="rounded bg-warning/20 px-1 text-[10px] text-warning">
                  proposed
                </span>
              )}
            </button>
          ))}
        </div>

        {role && (
          <Card padded={false}>
            <div className="border-b bg-muted/40 px-5 py-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold">{role.name}</h3>
                {!role.implemented && <Badge tone="warning">Not yet on the server</Badge>}
              </div>
              <p className="mt-1.5 max-w-4xl text-sm text-muted-foreground">
                {role.blurb}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 p-5 lg:grid-cols-2">
              <div>
                <p className="mb-2.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Screens they can open
                </p>
                <div className="space-y-2.5">
                  {NAV_GROUPS.map((g) => (
                    <div key={g.title}>
                      <p className="mb-1 text-2xs font-semibold uppercase tracking-wider text-muted-foreground/60">
                        {g.title}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {g.items.filter((i) => !i.disabled).map((i) => {
                          const ok = i.perm === null || roleHas(role.code, i.perm);
                          return (
                            <span
                              key={i.href}
                              className={cn(
                                "rounded border px-1.5 py-0.5 text-[11px]",
                                ok
                                  ? "border-primary/30 bg-primary/10 font-medium text-primary"
                                  : "border-border bg-muted text-muted-foreground/45 line-through"
                              )}
                            >
                              {i.label}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-5">
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-success">
                    <Check className="h-3.5 w-3.5" /> What they can do
                  </p>
                  <ul className="space-y-1.5">
                    {role.can.map((c) => (
                      <li key={c} className="grid grid-cols-[14px_1fr] gap-2 text-sm text-muted-foreground">
                        <Check className="mt-1 h-3.5 w-3.5 text-success" />
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="mb-2 flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-wider text-destructive">
                    <X className="h-3.5 w-3.5" /> What they cannot do
                  </p>
                  <ul className="space-y-1.5">
                    {role.cannot.map((c) => (
                      <li key={c} className="grid grid-cols-[14px_1fr] gap-2 text-sm text-muted-foreground">
                        <X className="mt-1 h-3.5 w-3.5 text-destructive/70" />
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="border-t p-5">
              <p className="mb-2.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                Every permission the server checks —{" "}
                {role.perms === "*" ? "all granted" : `${role.perms.length} of ${ALL_PERMISSIONS.length} granted`}
              </p>
              <div className="flex flex-wrap gap-1">
                {ALL_PERMISSIONS.map((p) => {
                  const granted = roleHas(role.code, p);
                  return (
                    <code
                      key={p}
                      title={PERMISSIONS[p]?.[1]}
                      className={cn(
                        "cursor-help rounded border px-1.5 py-0.5 font-mono text-[10px]",
                        granted
                          ? "border-primary/30 bg-primary/10 text-primary"
                          : "border-border bg-muted text-muted-foreground/40 line-through"
                      )}
                    >
                      {p}
                    </code>
                  );
                })}
              </div>
            </div>
          </Card>
        )}
      </Section>

      {/* -------------------------------------------------- the two cycles */}
      <Section
        n="03"
        title="The two cycles"
        lead="Money comes in from homeowners on one side. Work goes out to vendors on the other. Both meet in the general ledger."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <CycleCard
            title="Money in — Receivables"
            tone="primary"
            steps={[
              ["Billing plan", "The monthly dues rate set for each unit"],
              ["Assessment invoice", "Raised automatically against every unit each month"],
              ["Statement sent", "Emailed to the resident, visible in their portal"],
              ["Payment received", "By card or bank transfer, applied to their balance"],
              ["If unpaid — late fee", "Applied by rule after the grace period"],
              ["Reminder notices", "Escalating letters at set days overdue"],
              ["Payment plan", "Agreed instalments, tracked individually"],
              ["Lien filed", "A legal claim on the home — always a human decision"],
            ]}
            note="Paying in full at any stage closes the case and returns the account to good standing. Every rung has a way back down."
          />
          <CycleCard
            title="Work out — Payables"
            tone="brass"
            steps={[
              ["Service ticket", "A resident reports a problem"],
              ["Vendor assigned", "With an estimated cost"],
              ["Purchase order", "The commitment to spend, coded to a fund"],
              ["Approval", "How many signatures depends on the amount"],
              ["Money reserved", "Set aside so it cannot be spent twice"],
              ["Work received", "Recorded and inspected on site"],
              ["Vendor invoice", "Matched against the order and the delivery"],
              ["Payment issued", "Drawn from a bank account, posted to the ledger"],
            ]}
            note="The three-way match is the control: the order, the delivery record and the invoice must agree within tolerance, or the invoice is held and cannot be paid."
          />
        </div>

        <Card className="border-primary/25 bg-accent/40">
          <p className="text-sm font-semibold">Where they meet</p>
          <p className="mt-1.5 max-w-4xl text-sm text-muted-foreground">
            Both cycles post into the general ledger, split by fund. The ledger
            feeds the budget, which in turn constrains new spending — the one
            genuine control loop in the system. It also feeds the board
            dashboard and every report. Once a month is closed, its numbers are
            frozen and cannot be altered, which is what makes the financial
            statements defensible.
          </p>
        </Card>
      </Section>

      {/* ---------------------------------------------------- approvals */}
      <Section
        n="04"
        title="How approvals work"
        lead="Approvals are configured per community, not hard-coded. The amount of the document decides how many people must sign."
      >
        <Card padded={false}>
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  {["Level", "Applies from", "Who approves", "A $400 order", "A $6,000 order", "A $40,000 order"].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {APPROVAL_BANDS.map((b) => (
                  <tr key={b.level} className="border-b last:border-0">
                    <td className="tabular px-4 py-3">{b.level}</td>
                    <td className="tabular px-4 py-3">{b.from}</td>
                    <td className="px-4 py-3 font-medium">{b.role}</td>
                    {[b.small, b.mid, b.large].map((need, i) => (
                      <td key={i} className="px-4 py-3">
                        {need ? (
                          <Badge tone="success">Required</Badge>
                        ) : (
                          <Badge tone="neutral">Skipped</Badge>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-muted/40">
                  <td colSpan={3} className="px-4 py-3 text-sm font-semibold">
                    Signatures needed
                  </td>
                  <td className="tabular px-4 py-3 font-semibold">1</td>
                  <td className="tabular px-4 py-3 font-semibold">2</td>
                  <td className="tabular px-4 py-3 font-semibold">3</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
            Illustrative thresholds — each community sets its own. These numbers
            are one of the decisions we need from the client.
          </p>
        </Card>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Card>
            <p className="text-sm font-semibold">The climb</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              A document is submitted and advances one level at a time. Each
              approver's decision is recorded with their name, the level, the
              time and their comments. When the last required level signs, the
              document takes effect.
            </p>
          </Card>
          <Card className="border-destructive/30 bg-destructive/5">
            <p className="text-sm font-semibold text-destructive">The single exit</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              One decline ends the request immediately and returns the document
              to its author with the reason. There is no partial rejection and
              no send-back-a-level — the author fixes it and resubmits from the
              start.
            </p>
          </Card>
        </div>

        <Card className="border-warning/40 bg-warning/5">
          <p className="text-sm font-semibold text-warning">Worth confirming</p>
          <ul className="mt-1.5 space-y-1 text-sm text-muted-foreground">
            <li>· If no hierarchy is configured for a document type, documents of that type approve <strong>automatically</strong>. Convenient for a small community, dangerous for a large one.</li>
            <li>· Levels are assigned to <strong>roles, not named people</strong>. Anyone holding that role can sign. There is no delegation and no out-of-office substitute today.</li>
          </ul>
        </Card>
      </Section>

      {/* -------------------------------------------------- flow direction */}
      <Section
        n="05"
        title="Which flows go both ways"
        lead="This determines what can be corrected later and what cannot. Most document flows travel forward; a smaller set genuinely loops back, and the loops are where the business logic lives."
      >
        <DataTable rows={FLOW_DIRECTION} columns={flowCols} getRowKey={(f) => f.between} />

        <Card className="border-primary/25 bg-accent/40">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />
            The rule underneath all of it
          </p>
          <p className="mt-1.5 max-w-4xl text-sm text-muted-foreground">
            <strong className="text-foreground">Operational documents can be corrected; accounting records cannot.</strong>{" "}
            A ticket can be reassigned, an order revised before approval, an
            invoice held and released. But once something posts to the ledger it
            is permanent, and once a month is closed it is frozen. Every
            correction after that point is a new, dated, attributed entry. That
            distinction is what makes the financial statements defensible to an
            auditor.
          </p>
        </Card>
      </Section>

      {/* ----------------------------------------------------- decisions */}
      <Section
        n="06"
        title="Decisions we need from you"
        lead="Each of these changes what gets built. Answering them now is far cheaper than answering them later."
      >
        <Card padded={false}>
          <div className="border-b bg-muted/40 px-5 py-3.5">
            <p className="text-sm font-semibold">1. How should vendors participate?</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The largest question — it materially changes scope.
            </p>
          </div>
          <div className="grid grid-cols-1 divide-y lg:grid-cols-3 lg:divide-x lg:divide-y-0">
            <Option
              letter="A"
              name="Email only"
              cost="Small"
              tone="success"
              gets="An email when a job is assigned, with a link to a single read-only page showing the work order."
              fits="Vendors are small local contractors who will never log into a system."
            />
            <Option
              letter="B"
              name="A vendor portal"
              cost="Large"
              tone="danger"
              gets="Their own login — see assigned jobs, accept or decline, update progress, upload photos and quotes, submit invoices."
              fits="Vendors are recurring contractors and you want to stop chasing them by phone."
            />
            <Option
              letter="C"
              name="Internal only"
              cost="Mostly built"
              tone="success"
              gets="Nothing. Assigning a vendor is a record; the inbox notification goes to the staff member who owns the ticket."
              fits="Staff will always contact vendors directly themselves."
            />
          </div>
          <p className="border-t px-5 py-3 text-sm text-muted-foreground">
            <strong className="text-foreground">Our recommendation:</strong> build
            option C now since it is close to working already, and treat option B
            as a separately quoted phase — it is a third identity system
            alongside staff and residents.
          </p>
        </Card>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Decision
            n="2"
            title="Should board members get a proper role?"
            body="Today the only read-only role sees the chart of accounts and nothing else. A board member realistically needs to read the budget, the financial reports, the board dashboard, open tickets and community documents — and change none of it. The server already refers to a board-member role when it sends the monthly packet, but the role was never defined. Confirm the scope and it becomes a small addition."
          />
          <Decision
            n="3"
            title="What should the approval thresholds be?"
            body="The engine is fully configurable but somebody has to supply the numbers. At what amount does an order need the treasurer, and at what amount the full board? Your existing spending policy is the answer. Also confirm whether a document with no configured hierarchy should approve automatically, as it does now, or be blocked until rules are set."
          />
          <Decision
            n="4"
            title="How strict should budget control be?"
            body="Advisory mode warns when a purchase would exceed the budget but lets it through. Absolute mode blocks it outright. Advisory is the safer starting point — absolute will stop people working the moment a budget line runs out."
          />
          <Decision
            n="5"
            title="What are the matching tolerances?"
            body="How far may a vendor's invoice exceed the agreed order before it is held for review — a percentage, a flat amount, or zero? And must a delivery always be recorded before payment, or only for physical goods? These numbers decide how much manual review your accounting team faces every month."
          />
        </div>
      </Section>
    </PageShell>
  );
}

/* ---------------------------------------------------------------- pieces */

function Section({
  n, title, lead, children,
}: {
  n: string;
  title: string;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4 border-t pt-6">
      <div className="flex gap-3">
        <span className="mt-1 font-mono text-xs font-semibold text-primary">{n}</span>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 max-w-4xl text-sm leading-relaxed text-muted-foreground">
            {lead}
          </p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function CycleCard({
  title, tone, steps, note,
}: {
  title: string;
  tone: "primary" | "brass";
  steps: [string, string][];
  note: string;
}) {
  const accent = tone === "primary" ? "text-primary" : "text-brass";
  const dot = tone === "primary" ? "bg-primary" : "bg-brass";
  return (
    <Card padded={false}>
      <div className="border-b px-5 py-3.5">
        <h3 className={cn("text-sm font-semibold", accent)}>{title}</h3>
      </div>
      <ol className="relative space-y-3 px-5 py-4 pl-9">
        <span className="absolute inset-y-5 left-[22px] w-px bg-border" aria-hidden />
        {steps.map(([label, detail], i) => (
          <li key={label} className="relative">
            <span
              className={cn(
                "absolute -left-[18px] top-1.5 h-2 w-2 rounded-full ring-4 ring-card",
                dot
              )}
              aria-hidden
            />
            <p className="text-sm font-medium">{label}</p>
            <p className="text-xs text-muted-foreground">{detail}</p>
          </li>
        ))}
      </ol>
      <p className="border-t bg-muted/40 px-5 py-3 text-xs leading-relaxed text-muted-foreground">
        {note}
      </p>
    </Card>
  );
}

function Option({
  letter, name, cost, tone, gets, fits,
}: {
  letter: string;
  name: string;
  cost: string;
  tone: string;
  gets: string;
  fits: string;
}) {
  return (
    <div className="p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-xs font-bold">
          {letter}
        </span>
        <p className="text-sm font-semibold">{name}</p>
        <Badge tone={tone as any}>{cost}</Badge>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{gets}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">Fits when:</span> {fits}
      </p>
    </div>
  );
}

function Decision({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <Card className="border-brass/30 bg-brass/[0.04]">
      <p className="text-sm font-semibold">
        <span className="text-brass">{n}.</span> {title}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </Card>
  );
}
