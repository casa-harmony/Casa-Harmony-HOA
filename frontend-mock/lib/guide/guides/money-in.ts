/**
 * Collecting money from homeowners: billing, receipts, chasing arrears.
 *
 * This is the cycle that runs every month whether anyone remembers it or not,
 * so the guides here lean on explaining *order*: a billing plan has to exist
 * before assessments can run, assessments have to be accounted before they
 * reach the ledger, and a receipt only reduces a balance if it is applied to
 * the invoice rather than just recorded.
 */
import type { Guide } from "../types";

export const addHomeowner: Guide = {
  id: "add-homeowner",
  title: "Add a homeowner and their unit",
  summary:
    "Create the account a unit's money runs through — the thing invoices, payments and balances hang off.",
  requires: ["ar.manage"],
  category: "Money in",
  estimatedMinutes: 3,
  steps: [
    {
      route: "/receivables",
      title: "The unit accounts",
      body:
        "One account per unit. This is the financial record — separate from the resident's portal login, because units outlive the people living in them.",
    },
    {
      target: { text: "Run Monthly Assessments", role: "button" },
      title: "What these accounts feed",
      body:
        "Once units exist, this button bills all of them in one go. Every unit you add here is a unit that gets billed each month, so the list needs to be right before the first run.",
    },
    {
      title: "Adding a unit",
      body:
        "Use the add control on this screen and give the unit its account number, the owner's name, the unit number and their email. The account number is your permanent reference for the unit — pick a scheme and stick to it.",
      note:
        "Importing a whole community at once? Don't type them in one by one — the Data Migration screen loads a spreadsheet in a single reversible batch. Ask the assistant for 'import data'.",
    },
  ],
};

export const createBillingPlan: Guide = {
  id: "create-billing-plan",
  title: "Set up the monthly dues",
  summary:
    "Define what every unit is charged each month, and which income account it lands in.",
  requires: ["ar.manage"],
  category: "Money in",
  estimatedMinutes: 4,
  steps: [
    {
      route: "/ar-billing",
      title: "What gets charged, and how often",
      body:
        "A billing plan is the standing instruction for a community's dues. Without one there is nothing for the monthly assessment run to raise.",
    },
    {
      target: { text: "Billing Plan", role: "button" },
      title: "Create the plan",
      body: "Click here to start a new one.",
      advanceOn: "click",
    },
    {
      target: { text: "Name", role: "field" },
      title: "Name it for the year",
      body:
        "Include the year — 'Monthly Assessment 2026'. You will create a new plan when the board approves next year's rates, and you will want to tell them apart.",
      prefill: "Monthly Assessment 2026",
    },
    {
      target: { text: "Type", role: "field" },
      title: "Regular dues or a special assessment",
      body:
        "A monthly fee recurs. A special assessment is a one-off — a roof replacement levied across every unit — and can be split into instalments.",
    },
    {
      target: { text: "Revenue lines", role: "any" },
      title: "Where the income is recorded",
      body:
        "Split the dues across income accounts and funds. The portion destined for reserves must be coded to the reserve fund here — this is the point at which operating and reserve money are separated, and it is very hard to unpick later.",
      note:
        "Percentages across the lines must total 100. The screen will not let you save otherwise.",
    },
    {
      target: { text: "Due days", role: "field" },
      title: "When it falls due",
      body:
        "Days from the invoice date. This sets the due date on every assessment raised, which in turn drives late fees, ageing buckets and collections.",
    },
  ],
};

export const runAssessments: Guide = {
  id: "run-assessments",
  title: "Bill this month's dues",
  summary:
    "Raise an invoice against every unit for the month, then get it into the ledger.",
  requires: ["ar.manage"],
  prerequisites: ["create-billing-plan"],
  category: "Money in",
  estimatedMinutes: 5,
  steps: [
    {
      title: "First, is there a plan to bill from?",
      body: "Checking whether this community has a billing plan set up.",
      branch: {
        async decide(ctx) {
          const plans = await ctx.read<any[]>("/ar-billing/plans");
          return plans && plans.length > 0 ? "has-plan" : "no-plan";
        },
        options: {
          "no-plan": [
            {
              route: "/ar-billing",
              target: { text: "Billing Plan", role: "button" },
              title: "There is no billing plan yet",
              body:
                "Nothing can be billed until the community's dues are defined. Set the plan up first — ask the assistant for 'set up the monthly dues' and it will walk you through it, then come back here.",
            },
          ],
          "has-plan": [
            {
              route: "/ar-billing",
              target: { text: "Run billing", role: "button" },
              title: "The plan is ready",
              body:
                "You can raise this month's charges from the plan here, or use the bulk run on the Receivables screen. Both do the same thing.",
            },
          ],
        },
      },
    },
    {
      route: "/receivables",
      target: { text: "Run Monthly Assessments", role: "button" },
      title: "Bill every unit at once",
      body:
        "This raises one invoice per unit for the month, using the amounts on the billing plan.",
      advanceOn: "click",
    },
    {
      title: "They are drafts, not yet in the books",
      body:
        "The invoices now exist and residents owe the money, but nothing has reached the general ledger. Accounting them is a separate, deliberate step — it gives you a chance to check the run before it becomes permanent.",
    },
    {
      target: { text: "Account Drafts", role: "button" },
      title: "Push them into the ledger",
      body:
        "This creates the journal entries — debit what homeowners owe, credit income. After this the money is visible on the board dashboard and the financial statements.",
      advanceOn: "click",
      note:
        "The journal arrives as a draft batch on the General Ledger screen. It still has to be submitted, approved and posted before it is final — ask the assistant for 'post the ledger' next.",
    },
  ],
};

export const recordReceipt: Guide = {
  id: "record-receipt",
  title: "Record a payment from a homeowner",
  summary:
    "Enter a cheque or transfer that has arrived and apply it against what they owe.",
  requires: ["ar.receipt.manage"],
  category: "Money in",
  estimatedMinutes: 3,
  steps: [
    {
      route: "/receivables",
      title: "Find the unit that paid",
      body:
        "Payments are recorded against the unit account, not the person — which is what keeps the history straight when a property changes hands.",
    },
    {
      target: { text: "Receipt", role: "button" },
      title: "Open the receipt form",
      body: "Use the Receipt action on the row for the unit that paid.",
      advanceOn: "click",
    },
    {
      target: { text: "Amount", role: "field" },
      title: "How much arrived",
      body: "The actual amount received, even if it does not match what was owed.",
    },
    {
      target: { text: "Method", role: "field" },
      title: "How it arrived",
      body:
        "Cheque, bank transfer or card. This is what the bank reconciliation later matches against the statement, so it is worth getting right.",
    },
    {
      target: { text: "Date", role: "field" },
      title: "The date it was received",
      body:
        "Use the date the money actually arrived, not today. Ageing, late fees and the period it posts into all key off this.",
    },
    {
      title: "Applying it is what clears the balance",
      body:
        "A receipt that is recorded but not applied to an invoice leaves the homeowner still showing as owing. Apply it to the outstanding invoice and the balance drops and the invoice moves to PAID.",
      note:
        "Partial payments are fine — apply what arrived and the invoice keeps the remainder outstanding.",
    },
  ],
};

export const chaseArrears: Guide = {
  id: "chase-arrears",
  title: "Chase somebody who has not paid",
  summary:
    "Work an overdue account up the ladder — reminder, payment plan, and eventually a lien.",
  requires: ["collections.manage"],
  category: "Money in",
  estimatedMinutes: 5,
  steps: [
    {
      route: "/collections",
      title: "Who is behind, and by how long",
      body:
        "Balances bucketed by age. The further right a figure sits, the harder it becomes to collect — which is the whole argument for chasing early rather than politely waiting.",
    },
    {
      title: "How far along is this account?",
      body: "Checking whether there are already open collection cases in this community.",
      branch: {
        async decide(ctx) {
          const cases = await ctx.read<any[]>("/collections/cases");
          return cases && cases.length > 0 ? "has-cases" : "no-cases";
        },
        options: {
          "no-cases": [
            {
              target: { text: "Open case", role: "button" },
              title: "Start with a case",
              body:
                "Opening a case is the formal record that this debt is being pursued. Everything after — notices, plans, liens — hangs off it, and it is what an attorney will ask for if it ever goes that far.",
            },
          ],
          "has-cases": [
            {
              title: "Cases are already open here",
              body:
                "Some accounts are already being pursued. Escalate an existing case rather than opening a second one against the same unit.",
            },
          ],
        },
      },
    },
    {
      target: { text: "Payment Plan", role: "button" },
      title: "Agree instalments",
      body:
        "Most arrears are resolved here rather than legally. A plan records what they agreed to pay and when, and the system tracks whether they keep to it.",
    },
    {
      target: { text: "Total amount", role: "field" },
      title: "What they owe in total",
      body: "The full arrears the plan covers.",
    },
    {
      target: { text: "Installments", role: "field" },
      title: "Split into payments",
      body:
        "How many payments, and how far apart. Keep it realistic — a plan somebody defaults on immediately is worse than no plan, because it delays the escalation.",
    },
    {
      target: { text: "Lien", role: "button" },
      title: "The last resort",
      body:
        "A lien is a legal claim against the home itself. It is always a human decision, usually needs board approval, and often needs an attorney — the system records it, it does not decide it.",
      note:
        "Paying in full at any stage closes the case and returns the account to good standing. Every rung of this ladder has a way back down.",
    },
  ],
};

export const runStatements: Guide = {
  id: "run-statements",
  title: "Send everyone their statement",
  summary: "Generate and email every homeowner's statement in one batch.",
  requires: ["ar.manage"],
  category: "Money in",
  estimatedMinutes: 2,
  steps: [
    {
      route: "/statements",
      title: "The monthly mailout",
      body:
        "One statement per unit showing what was charged, what was paid and what is outstanding — emailed, with a portal link to pay.",
    },
    {
      target: { text: "As of", role: "field" },
      title: "The cut-off date",
      body:
        "Balances are calculated as at this date. Normally the last day of the month you are billing for.",
    },
    {
      target: { text: "Run batch", role: "button" },
      title: "Send them",
      body:
        "Generates every statement and emails it. Homeowners who opted out, or who have no email on file, are skipped and listed in the delivery log so you know who needs a paper copy.",
      note:
        "This is one of the four jobs that can run automatically each month — see Scheduled Jobs if you would rather not remember to do it.",
    },
  ],
};
