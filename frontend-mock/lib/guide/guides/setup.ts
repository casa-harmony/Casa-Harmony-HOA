/**
 * The configuration a community needs before it can take or spend money.
 *
 * These are the guides people need exactly once per community and then never
 * again — which is precisely why nobody remembers how to do them. Ordering
 * matters here more than anywhere else in the product: a bank account with no
 * GL cash account behind it, or an invoice dated into a period nobody opened,
 * fails in ways whose error message does not name the real cause.
 */
import type { Guide } from "../types";

export const addBankAccount: Guide = {
  id: "add-bank-account",
  title: "Add a bank account",
  summary:
    "Register the account the community's money actually sits in, so payments and reconciliation have somewhere to go.",
  requires: ["cash.manage"],
  category: "Getting started",
  estimatedMinutes: 3,
  steps: [
    {
      route: "/cash",
      title: "Where the real money lives",
      body:
        "Every payment out and every deposit in is drawn from one of these. Until at least one exists you cannot pay a contractor, so this is usually the second thing done in a new community.",
    },
    {
      target: { text: "Bank Account", role: "button" },
      title: "Add one",
      body: "Click here to open the form.",
      advanceOn: "click",
    },
    {
      target: { text: "Account code", role: "field" },
      title: "A short code for it",
      body: "Your own reference — how staff will pick it out of a list.",
      prefill: "OPER-01",
    },
    {
      target: { text: "Name", role: "field" },
      title: "What to call it",
      body: "The name people recognise, e.g. 'Operating Account'.",
      prefill: "Operating Account",
    },
    {
      target: { text: "Fund", role: "field" },
      title: "Operating or Reserve",
      body:
        "This is the important one. Reserve money is legally separate from operating money in most associations, and this field is what keeps the two from being spent interchangeably.",
      note:
        "Get this wrong and reserve funds can be spent on day-to-day costs without anything obviously breaking. It is worth double-checking.",
    },
    {
      target: { text: "Bank name", role: "field" },
      title: "The bank",
      body: "Appears on payment records and the reconciliation screen.",
      prefill: "JPMorgan Chase Bank",
    },
    {
      target: { text: "Account #", role: "field" },
      title: "The account number",
      body:
        "Encrypted at rest, and only ever shown to staff as its last four digits. Nobody using this system afterwards can read the full number back out of it.",
    },
    {
      target: { text: "GL cash account", role: "field" },
      title: "Which ledger account it posts to",
      body:
        "Links this bank account to the chart of accounts, so a payment leaving here lands in the right place in the books automatically.",
      note:
        "If this list is empty the chart of accounts has not been set up yet — that has to come first.",
    },
  ],
};

export const openPeriod: Guide = {
  id: "open-period",
  title: "Open an accounting period",
  summary:
    "Make a month available to post into — and understand why closing one is permanent.",
  requires: ["gl.period.manage"],
  category: "Month end",
  estimatedMinutes: 2,
  steps: [
    {
      route: "/periods",
      title: "The calendar the books run on",
      body:
        "Every posting lands in a period. Open ones accept postings; future ones do not yet; closed ones reject them permanently. This is the control that makes last month's financial statements trustworthy.",
    },
    {
      target: { text: "Open / create period", role: "any" },
      title: "Open a month",
      body:
        "Pick the month and year and open it. A community is created with a full year already laid out, so most of the time this is only needed when you roll into a new year.",
    },
    {
      title: "Before you close anything",
      body:
        "Closing is a one-way gate. Once a period is closed, nothing can post into it — no corrections, no late invoices, no adjustments. That is the point: it is what stops last quarter's numbers changing after the board has seen them.",
      note:
        "Corrections after a close are made as new, dated entries in the current period. Never by reopening and editing history.",
    },
    {
      target: { text: "Year-end close", role: "any" },
      title: "Year-end is different",
      body:
        "Rolling forward moves the year's surplus or deficit into retained earnings and starts the new year's books. Do it once, after the final month of the year is closed and the accountant is satisfied.",
    },
  ],
};

export const apSetup: Guide = {
  id: "ap-setup",
  title: "Set up how you pay contractors",
  summary:
    "Payment terms, vendor types, and the tolerance that decides when an invoice gets held for review.",
  requires: ["ap.config"],
  category: "Getting started",
  estimatedMinutes: 4,
  steps: [
    {
      route: "/ap-setup",
      title: "The rules behind every vendor invoice",
      body:
        "Four small settings that decide when invoices are due, how vendors are grouped, and — most importantly — when the system refuses to pay one without a human looking at it.",
    },
    {
      target: { text: "Payment Terms", role: "any" },
      title: "Payment terms",
      body:
        "How long after invoicing a vendor expects to be paid. Net 30 means the due date is 30 days out. This drives the due dates on every invoice and therefore the cash forecast.",
    },
    {
      target: { text: "Vendor Types", role: "any" },
      title: "Vendor types",
      body:
        "Groupings — landscaping, plumbing, utilities. Used for reporting and for 1099 tax categorisation at year end.",
    },
    {
      target: { text: "Distribution Sets", role: "any" },
      title: "Distribution sets",
      body:
        "A saved split of a cost across several accounts. If the pool service is always 70% operating and 30% reserve, save that here once instead of typing it on every invoice.",
      note: "Optional. Skip it until you notice yourself typing the same split repeatedly.",
    },
    {
      target: { text: "Amount tolerance", role: "field" },
      title: "This is the real control",
      body:
        "How far a vendor's invoice may exceed the purchase order before the system holds it. Set it to zero and every penny of overage needs a human; set it high and overcharges get paid automatically.",
      note:
        "A few percent is typical. The held invoices appear on the Payables screen as match exceptions — they are not lost, just stopped.",
    },
    {
      target: { text: "Require receipt", role: "any" },
      title: "Three-way matching",
      body:
        "With this on, somebody must record that the work was actually delivered before the invoice can be paid. It is the control that stops paying for work that never happened.",
      note:
        "Sensible for physical goods. For services where nobody signs anything, communities often leave it off.",
    },
  ],
};

export const addValueSetValue: Guide = {
  id: "add-value-set-value",
  title: "Add a new account code value",
  summary:
    "Add a department, fund or expense category to the chart of accounts' building blocks.",
  requires: ["coa.valueset.manage"],
  category: "Getting started",
  estimatedMinutes: 3,
  steps: [
    {
      route: "/value-sets",
      title: "The building blocks of every account code",
      body:
        "An account code is assembled from segments — fund, department, expense category and so on. Each segment draws its allowed values from one of these lists, which is what stops somebody inventing a department that does not exist.",
    },
    {
      target: { text: "HOA_ACCT", role: "any" },
      title: "Pick the list to add to",
      body:
        "Natural Account is the expense or income category. Fund separates operating from reserve. Cost Center is the department. Choose the one your new value belongs to.",
    },
    {
      target: { text: "Add Value", role: "button" },
      title: "Add the value",
      body: "Click here once you have selected a list.",
      advanceOn: "click",
    },
    {
      target: { text: "Code", role: "field" },
      title: "The code",
      body:
        "Short and numeric by convention, and it should fit the numbering scheme already in use — look at the neighbouring values before inventing one.",
    },
    {
      target: { text: "Name", role: "field" },
      title: "What it means",
      body:
        "Plain English. This is what appears on reports, so write it for whoever reads the financial statements, not for the person entering it.",
    },
    {
      title: "One more step to be usable",
      body:
        "A new value on its own does not create a usable account code. The combination — fund + department + account together — has to exist before anything can post to it. That happens on the Chart of Accounts screen.",
      note:
        "If you enter an invoice and cannot find the account you just created, this is almost always why.",
    },
  ],
};
