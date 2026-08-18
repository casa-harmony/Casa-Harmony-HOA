/**
 * The guide catalogue, and the decision tree the assistant walks.
 *
 * There is deliberately no language model here. The set of things you can do
 * in an ERP is finite and known, and a wrong answer means somebody mis-posts a
 * ledger entry — so every question and every answer below is authored. The
 * assistant narrows by asking, the same way a colleague would.
 */
import type { ChatNode, Guide } from "./types";
import { createCommunity } from "./guides/create-community";
import { assignTicketToVendor } from "./guides/assign-ticket-to-vendor";
import { createUser, inviteResident, uploadDocument } from "./guides/access";
import {
  addBankAccount,
  addValueSetValue,
  apSetup,
  openPeriod,
} from "./guides/setup";
import {
  addHomeowner,
  chaseArrears,
  createBillingPlan,
  recordReceipt,
  runAssessments,
  runStatements,
} from "./guides/money-in";
import {
  addVendor,
  approveAndPay,
  configureApprovals,
  enterVendorInvoice,
  raisePurchaseOrder,
  recordDelivery,
} from "./guides/money-out";
import {
  postToLedger,
  readBoardDashboard,
  reconcileBank,
  runReport,
} from "./guides/month-end";
import {
  configureGateway,
  createBudget,
  goLive,
  importData,
  raiseTicket,
  scheduledJobs,
} from "./guides/admin";

export const GUIDES: Guide[] = [
  // Getting started
  createCommunity,
  importData,
  addBankAccount,
  apSetup,
  addValueSetValue,
  configureGateway,
  goLive,
  // People & access
  createUser,
  inviteResident,
  uploadDocument,
  // Service desk
  raiseTicket,
  assignTicketToVendor,
  // Money in
  addHomeowner,
  createBillingPlan,
  runAssessments,
  recordReceipt,
  runStatements,
  chaseArrears,
  // Money out
  addVendor,
  raisePurchaseOrder,
  recordDelivery,
  enterVendorInvoice,
  approveAndPay,
  configureApprovals,
  // Month end
  postToLedger,
  openPeriod,
  reconcileBank,
  runReport,
  readBoardDashboard,
  createBudget,
  scheduledJobs,
];

export function getGuide(id: string): Guide | undefined {
  return GUIDES.find((g) => g.id === id);
}

/**
 * Only offer what this person is actually allowed to do. An accountant asking
 * for help should never be walked to a button that 403s.
 */
export function guidesFor(can: (p: string) => boolean): Guide[] {
  return GUIDES.filter((g) => g.requires.every(can));
}

export function guidesByCategory(can: (p: string) => boolean) {
  const out = new Map<string, Guide[]>();
  for (const g of guidesFor(can)) {
    const list = out.get(g.category) ?? [];
    list.push(g);
    out.set(g.category, list);
  }
  return out;
}

/** Prerequisites the reader has not marked done yet. */
export function unmetPrerequisites(guide: Guide, completed: string[]): Guide[] {
  return (guide.prerequisites ?? [])
    .filter((id) => !completed.includes(id))
    .map(getGuide)
    .filter((g): g is Guide => !!g);
}

/* ------------------------------------------------------------- the tree --- */

export const CHAT_ROOT = "root";

export const CHAT_TREE: Record<string, ChatNode> = {
  root: {
    id: "root",
    prompt: "What are you trying to do?",
    choices: [
      { label: "Set up something for the first time", next: "setup" },
      { label: "Deal with a resident or their problem", next: "resident" },
      { label: "Money coming in from homeowners", next: "money-in" },
      { label: "Money going out to contractors", next: "money-out" },
      { label: "Close the month / reporting", next: "month-end" },
    ],
  },

  /* ---------------------------------------------------------------- setup */
  setup: {
    id: "setup",
    prompt: "What needs setting up?",
    choices: [
      { label: "A whole new community", guideId: "create-community" },
      { label: "Load existing records from another system", guideId: "import-data" },
      { label: "Somebody who needs to sign in", next: "setup-people" },
      { label: "Financial configuration", next: "setup-finance" },
      { label: "Take this community live", guideId: "go-live" },
      { label: "← Back", next: "root" },
    ],
  },
  "setup-people": {
    id: "setup-people",
    prompt: "Staff, or a resident?",
    choices: [
      { label: "A staff member — manager, accountant, auditor", guideId: "create-user" },
      { label: "A resident who needs portal access", guideId: "invite-resident" },
      { label: "← Back", next: "setup" },
    ],
  },
  "setup-finance": {
    id: "setup-finance",
    prompt: "Which part?",
    choices: [
      { label: "A bank account", guideId: "add-bank-account" },
      { label: "How we pay contractors (terms, tolerances)", guideId: "ap-setup" },
      { label: "Who has to approve spending", guideId: "configure-approvals" },
      { label: "An account code / category", guideId: "add-value-set-value" },
      { label: "Online card payments", guideId: "configure-gateway" },
      { label: "This year's budget", guideId: "create-budget" },
      { label: "← Back", next: "setup" },
    ],
  },

  /* ------------------------------------------------------------- resident */
  resident: {
    id: "resident",
    prompt: "What about them?",
    choices: [
      { label: "They reported something broken", next: "resident-problem" },
      { label: "They need a portal login", guideId: "invite-resident" },
      { label: "They have not paid", guideId: "chase-arrears" },
      { label: "They paid — record it", guideId: "record-receipt" },
      { label: "Add them as a new owner / unit", guideId: "add-homeowner" },
      { label: "Share a document with residents", guideId: "upload-document" },
      { label: "← Back", next: "root" },
    ],
  },
  "resident-problem": {
    id: "resident-problem",
    prompt: "Where are you in dealing with it?",
    choices: [
      { label: "It needs logging first", guideId: "raise-ticket" },
      {
        label: "It is logged — send it to a contractor",
        guideId: "assign-ticket-to-vendor",
      },
      { label: "← Back", next: "resident" },
    ],
  },

  /* -------------------------------------------------------------- money in */
  "money-in": {
    id: "money-in",
    prompt: "Which part of collecting from homeowners?",
    choices: [
      { label: "Bill this month's dues", guideId: "run-assessments" },
      { label: "Set up what everyone gets charged", guideId: "create-billing-plan" },
      { label: "Record a payment that arrived", guideId: "record-receipt" },
      { label: "Send everyone their statement", guideId: "run-statements" },
      { label: "Chase somebody who is behind", guideId: "chase-arrears" },
      { label: "Add a new owner / unit", guideId: "add-homeowner" },
      { label: "← Back", next: "root" },
    ],
  },

  /* ------------------------------------------------------------- money out */
  "money-out": {
    id: "money-out",
    prompt: "Where are you in the process?",
    choices: [
      { label: "Need to add the contractor first", guideId: "add-vendor" },
      { label: "Agreeing work — raise an order", guideId: "raise-purchase-order" },
      { label: "The work has been done", guideId: "record-delivery" },
      { label: "A bill arrived", guideId: "enter-vendor-invoice" },
      { label: "Approve and actually pay it", guideId: "approve-and-pay" },
      { label: "Send a reported problem to a contractor", guideId: "assign-ticket-to-vendor" },
      { label: "← Back", next: "root" },
    ],
  },

  /* ------------------------------------------------------------- month end */
  "month-end": {
    id: "month-end",
    prompt: "What are you closing or checking?",
    choices: [
      { label: "Post everything to the ledger", guideId: "post-to-ledger" },
      { label: "Match the bank statement", guideId: "reconcile-bank" },
      { label: "Open or close an accounting period", guideId: "open-period" },
      { label: "Run a report", guideId: "run-report" },
      { label: "Understand the board dashboard", guideId: "read-board-dashboard" },
      { label: "Automate the monthly chores", guideId: "scheduled-jobs" },
      { label: "← Back", next: "root" },
    ],
  },

  /* Reached only when a guide is filtered out by permission. */
  "not-permitted": {
    id: "not-permitted",
    prompt:
      "Your role does not have access to that part of the system, so there is nothing useful this guide could walk you through. Somebody with the right permission needs to do it.",
    choices: [{ label: "← Start again", next: "root" }],
  },
};
