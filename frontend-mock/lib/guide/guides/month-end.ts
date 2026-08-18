/**
 * Closing the month and reporting on it.
 *
 * The recurring misunderstanding these guides exist to fix: the subledgers are
 * not the accounts. Billing a homeowner or entering a vendor invoice creates a
 * *draft* journal, and until somebody submits, approves and posts that batch,
 * none of it reaches the financial statements. People assume the numbers are
 * live and then cannot work out why the board report looks empty.
 */
import type { Guide } from "../types";

export const postToLedger: Guide = {
  id: "post-to-ledger",
  title: "Post the month's entries to the ledger",
  summary:
    "Take the draft journals that billing and payables produced and make them permanent.",
  requires: ["gl.batch.approve"],
  category: "Month end",
  estimatedMinutes: 4,
  steps: [
    {
      route: "/gl",
      title: "Where everything ends up",
      body:
        "Every subledger — receivables, payables, cash — feeds journal batches into here. The ledger never pushes back: it is the endpoint, and corrections are new entries rather than edits.",
    },
    {
      title: "What is waiting to be posted?",
      body: "Checking this community's journal batches.",
      branch: {
        async decide(ctx) {
          const batches = await ctx.read<any[]>("/gl/batches");
          const draft = (batches ?? []).filter((b) => b.status !== "POSTED");
          return draft.length > 0 ? "has-drafts" : "all-posted";
        },
        options: {
          "has-drafts": [
            {
              title: "There are batches waiting",
              body:
                "Each batch shows its debit and credit totals. They must be equal — an unbalanced batch cannot post, and the system will not let it.",
            },
          ],
          "all-posted": [
            {
              title: "Everything is already posted",
              body:
                "No drafts waiting. If you were expecting some, the likely cause is that this month's assessments have not been accounted yet — that happens on the Receivables screen, not here.",
            },
          ],
        },
      },
    },
    {
      title: "Submit, approve, post",
      body:
        "Three deliberate steps, not one button. Submitting says the batch is ready; approving is a second person agreeing; posting writes it into the balances permanently. The separation is what makes the books defensible.",
      note:
        "The same person can often do all three in a small community, but each action is recorded separately against their name.",
    },
    {
      target: { text: "Trial Balance", role: "button" },
      title: "Check it balances",
      body:
        "Total debits must equal total credits. If they do, the month's bookkeeping is internally consistent — this is the single quickest check that nothing has gone wrong.",
    },
    {
      target: { text: "Financials", role: "button" },
      title: "Produce the statements",
      body:
        "Balance sheet and statement of revenues and expenses, split by fund, ready to circulate to the board.",
      note:
        "Once the period is closed these numbers are frozen and cannot change — which is exactly what makes them safe to hand out.",
    },
  ],
};

export const runReport: Guide = {
  id: "run-report",
  title: "Run a report",
  summary: "Produce any of the standard reports for a chosen accounting period.",
  requires: ["report.read"],
  category: "Month end",
  estimatedMinutes: 2,
  steps: [
    {
      route: "/reports",
      title: "Everything the platform can produce",
      body:
        "Forty-odd standard reports across finance, receivables, payables, compliance and the resident portal. Nothing here is built by hand — pick one and run it.",
    },
    {
      target: { text: "Period", role: "field" },
      title: "Choose the period first",
      body:
        "Reports are generated from posted ledger data for the period you select, which is why they always agree with the books.",
    },
    {
      title: "Then pick a format",
      body:
        "PDF for circulating and filing, XLSX when somebody needs to work with the numbers. Use the search box or the category chips to find the report you want.",
      note:
        "A report for a closed period will never change. That is what makes it safe to send to a board member or an auditor.",
    },
  ],
};

export const readBoardDashboard: Guide = {
  id: "read-board-dashboard",
  title: "Understand the board dashboard",
  summary:
    "Read the community's financial position the way the board sees it — written for volunteers.",
  requires: ["report.read"],
  category: "Month end",
  estimatedMinutes: 3,
  steps: [
    {
      route: "/board",
      title: "The position, in plain English",
      body:
        "This screen deliberately avoids accounting language. It is what gets assembled into the monthly board packet.",
    },
    {
      target: { text: "Total cash", role: "any" },
      title: "Cash, split by fund",
      body:
        "Operating and reserve combined at the top, then separated below. The split matters: reserve money is not available for day-to-day costs, so a healthy total can still hide an operating shortfall.",
    },
    {
      target: { text: "Reserve funded", role: "any" },
      title: "Reserve funding",
      body:
        "How the reserve balance compares to what the reserve study says it should be. A persistently low figure is the number that turns into a special assessment a few years later.",
    },
    {
      target: { text: "How long money has been owed", role: "any" },
      title: "Arrears by age",
      body:
        "The further right the money sits, the less likely it is ever collected. Movement rightward month on month is the early warning that collections have stalled.",
    },
    {
      title: "Where it comes from",
      body:
        "Every figure is derived from posted ledger data. If something looks wrong or empty here, the usual cause is that this month's batches have not been posted yet rather than a problem with the number itself.",
    },
  ],
};

export const reconcileBank: Guide = {
  id: "reconcile-bank",
  title: "Reconcile the bank account",
  summary:
    "Match the bank statement against the books and explain any difference.",
  requires: ["cash.manage"],
  category: "Month end",
  estimatedMinutes: 5,
  steps: [
    {
      route: "/cash",
      title: "Books versus reality",
      body:
        "The ledger says what should be in the bank. The statement says what is. Reconciliation explains the gap — and an unexplained gap is how errors and fraud are found.",
    },
    {
      target: { text: "Import Statement", role: "button" },
      title: "Load the statement",
      body: "Upload the CSV or spreadsheet the bank provides.",
      advanceOn: "click",
    },
    {
      target: { text: "Statement date", role: "field" },
      title: "The statement's closing date",
      body: "Usually the last day of the month.",
    },
    {
      target: { text: "Closing", role: "field" },
      title: "The closing balance",
      body:
        "Straight off the statement. This is the figure the reconciliation has to arrive at — if it does not, something is missing.",
    },
    {
      title: "Then match the lines",
      body:
        "Match each statement line to the payment or receipt it corresponds to. What is left over is genuinely outstanding — cheques that have not cleared, deposits in transit — and that is the legitimate difference between the two balances.",
      note:
        "A line you cannot match to anything is worth stopping on. It is either a missing entry or a transaction nobody recorded.",
    },
  ],
};
