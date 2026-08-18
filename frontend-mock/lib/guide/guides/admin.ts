/**
 * Platform administration and the service desk.
 *
 * Two of these — data migration and going live — are the only genuinely
 * irreversible things in the product, so both guides spend more words on the
 * consequences than on the clicks.
 */
import type { Guide } from "../types";

export const raiseTicket: Guide = {
  id: "raise-ticket",
  title: "Log something a resident reported",
  summary: "Record a problem, complaint or request so it can be tracked and costed.",
  requires: ["ticket.manage"],
  category: "Service desk",
  estimatedMinutes: 2,
  steps: [
    {
      route: "/service-desk",
      title: "Everything reported, in one place",
      body:
        "Normally these arrive from residents through the portal. Staff log them here when somebody phones, emails or stops them in the car park.",
    },
    {
      target: { text: "New ticket", role: "button" },
      title: "Log it",
      body: "Click here.",
      advanceOn: "click",
    },
    {
      target: { text: "Subject", role: "field" },
      title: "What is wrong",
      body:
        "One line, specific enough that somebody reading the list in a fortnight knows what it means. 'Sprinkler head broken at pool gate' beats 'sprinkler issue'.",
      prefill: "Sprinkler head broken at pool gate",
    },
    {
      target: { text: "Category", role: "field" },
      title: "What kind of thing it is",
      body:
        "Maintenance, complaint, request or violation. This drives the reporting the board sees, and violations follow a different path from repairs.",
    },
    {
      target: { text: "Priority", role: "field" },
      title: "How urgent",
      body:
        "High priority surfaces on the dashboard as needing attention today. Use it sparingly or it stops meaning anything.",
    },
    {
      title: "What happens next",
      body:
        "If it costs money, the ticket gets a contractor and an estimate attached and becomes a purchase order — that is the moment it enters the money-out cycle. Ask the assistant for 'send a job to a contractor'.",
    },
  ],
};

export const importData: Guide = {
  id: "import-data",
  title: "Import a community's existing records",
  summary:
    "Bring homeowners, balances, vendors and history across from whatever system came before.",
  requires: ["data.migrate"],
  category: "Getting started",
  estimatedMinutes: 6,
  steps: [
    {
      route: "/migration",
      title: "The onboarding tool",
      body:
        "A new community arrives with years of records in a spreadsheet. This loads them in one reversible batch rather than by hand.",
      note:
        "This is the most destructive capability in the product, which is why the permission is granted narrowly.",
    },
    {
      target: { text: "What are you importing", role: "field" },
      title: "Pick the record type",
      body:
        "Each type has its own template and its own validation. Order matters: homeowners before their balances, vendors before their open invoices — a balance with no owner to attach to will simply fail.",
    },
    {
      target: { text: "Drop a CSV", role: "any" },
      title: "Upload the file",
      body:
        "CSV or Excel. Every row is validated before anything is written, so a bad file cannot half-import.",
    },
    {
      title: "Dry run first, always",
      body:
        "Run it without committing and read the result. Rows that fail validation are quarantined and reported while the rest would still load — the report tells you exactly which rows need fixing and why, before anything touches the database.",
    },
    {
      title: "Rollback has a deadline",
      body:
        "A committed batch can be rolled back completely — every row it created is removed, and nothing else. But only until the community goes live. After that, residents have paid and vendors have been paid against those records, and reversing the import would destroy real transactions.",
      note:
        "So: get the imports right during preparation. Once you go live this safety net is gone deliberately.",
    },
  ],
};

export const goLive: Guide = {
  id: "go-live",
  title: "Take a community live",
  summary:
    "Work the readiness checklist and understand exactly what changes the moment you flip it.",
  requires: ["compliance.manage"],
  category: "Getting started",
  estimatedMinutes: 5,
  steps: [
    {
      route: "/go-live",
      title: "Is this community ready for real money?",
      body:
        "Until you go live the community is a rehearsal: the payment gateway is in test mode, no real money moves, and imports can still be undone.",
    },
    {
      target: { text: "Checks passing", role: "any" },
      title: "The automated checks",
      body:
        "These are computed live from the data — balanced batches, a configured chart of accounts, audit logging, period controls. They pass or fail on their own; you cannot tick them.",
    },
    {
      target: { text: "Human sign-off", role: "any" },
      title: "The ones only you can answer",
      body:
        "Backups, key rotation, TLS, reviewing who has access. Nothing in the software can verify these, which is exactly why they are listed separately and need a person to confirm them.",
      note:
        "The rotation items matter more than they look. Any credential shared during the build — cloud keys, source-control tokens, the initial superadmin password — should be rotated before real money is involved.",
    },
    {
      title: "What flipping it actually does",
      body:
        "The gateway switches to live and real money starts moving. Imports can no longer be rolled back. Scheduled jobs start running against real residents. The audit trail becomes the compliance record. From then on, corrections are new postings — never edits to history.",
      note: "There is no undo. Work the checklist honestly before you do this.",
    },
  ],
};

export const configureGateway: Guide = {
  id: "configure-gateway",
  title: "Set up online payments",
  summary: "Let residents pay by card or bank transfer, and decide who absorbs the fee.",
  requires: ["payment.manage"],
  category: "Getting started",
  estimatedMinutes: 3,
  steps: [
    {
      route: "/gateway",
      title: "How residents pay online",
      body:
        "Card and bank transfer, the processing cost of each, and a record of every attempt including the failures.",
    },
    {
      target: { text: "Who pays the fee", role: "any" },
      title: "The decision worth making deliberately",
      body:
        "Either the community absorbs the processing fee or it is passed to the resident paying. Passing it on is legal in most places but not everywhere, and residents notice — this is a board decision, not an operational one.",
    },
    {
      target: { text: "Card details stored", role: "any" },
      title: "Why card numbers are never here",
      body:
        "Cards go straight to the processor, which returns a token — a reference that can only charge that same card through that same account. The token is what gets stored, so a breach of this database exposes no card data at all.",
    },
    {
      title: "Test mode until go-live",
      body:
        "While the community is in preparation, no real money moves however convincing the screen looks. Switching to live is one of the items on the go-live checklist.",
    },
  ],
};

export const scheduledJobs: Guide = {
  id: "scheduled-jobs",
  title: "Let the system do the monthly chores",
  summary:
    "Statements, board packets, dunning and late fees, run automatically on a schedule.",
  requires: ["scheduler.manage"],
  category: "Month end",
  estimatedMinutes: 2,
  steps: [
    {
      route: "/scheduler",
      title: "The four recurring jobs",
      body:
        "Statements on the 1st, the board packet on the 5th, dunning on the 10th, late fees on the 15th. Each can be on or off per community.",
    },
    {
      target: { text: "Run now", role: "button" },
      title: "Test one before trusting it",
      body:
        "Run a job by hand first and read the result. These send real emails to real residents once the community is live, so it is worth knowing exactly what a run produces before it happens unattended.",
      note:
        "Late fees and dunning both touch money and tempers. Confirm the rules behind them are what the board actually agreed before switching them on.",
    },
    {
      title: "The run history is the proof",
      body:
        "Every run is recorded with what it did and whether it succeeded. When a resident insists they never got a statement, this is where you look.",
    },
  ],
};

export const createBudget: Guide = {
  id: "create-budget",
  title: "Set the year's budget",
  summary:
    "Enter what the board approved and choose whether the system enforces it.",
  requires: ["budget.manage"],
  category: "Month end",
  estimatedMinutes: 5,
  steps: [
    {
      route: "/budgets",
      title: "The plan the year is measured against",
      body:
        "A budget version is one complete set of numbers. Keeping the original approved version alongside later revisions is what lets you show the board what changed.",
    },
    {
      target: { text: "New Version", role: "button" },
      title: "Start a version",
      body: "Click here.",
      advanceOn: "click",
    },
    {
      target: { text: "Fiscal year", role: "field" },
      title: "Which year",
      body: "The year these numbers apply to.",
    },
    {
      target: { text: "Annual amount", role: "field" },
      title: "Enter the lines",
      body:
        "An annual figure per account, spread across the periods. Reserve contributions are budgeted like any other line — and coding them to the wrong fund is the mistake that quietly under-funds reserves for a year.",
    },
    {
      target: { text: "Mode", role: "field" },
      title: "How hard should it bite?",
      body:
        "Advisory warns when a purchase would exceed the budget but lets it through. Absolute blocks it outright.",
      note:
        "Start advisory. Absolute stops people working the moment a line runs out, and in a community where the manager cannot then reach a board member, that means a genuine emergency repair does not get ordered.",
    },
    {
      target: { text: "Controlling version", role: "field" },
      title: "Which version is enforced",
      body:
        "Only the controlling version is checked against spending. Draft revisions sit alongside it without affecting anything until you promote one.",
    },
  ],
};
