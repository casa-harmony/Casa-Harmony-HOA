/**
 * Spending the community's money: orders, deliveries, invoices, payments.
 *
 * The three-way match is the spine of this cycle and the thing most people
 * have never had explained to them: the order says what was agreed, the
 * receipt says what turned up, the invoice says what is being charged, and all
 * three have to agree before money moves. Every guide here is written to make
 * that visible rather than to click through it quickly.
 */
import type { Guide } from "../types";

export const addVendor: Guide = {
  id: "add-vendor",
  title: "Add a contractor",
  summary: "Put a supplier on file so they can be given work and paid.",
  requires: ["vendor.manage"],
  category: "Money out",
  estimatedMinutes: 2,
  steps: [
    {
      route: "/vendors",
      title: "Who the community buys from",
      body:
        "Landscapers, plumbers, elevator engineers. A vendor here is a record, not a login — contractors never sign in to this system.",
    },
    {
      target: { text: "Add vendor", role: "button" },
      title: "Add them",
      body: "Click here to open the form.",
      advanceOn: "click",
    },
    {
      target: { text: "Vendor name", role: "field" },
      title: "Their trading name",
      body: "The name you would write on a cheque.",
      prefill: "GreenLeaf Landscaping LLC",
    },
    {
      target: { text: "Trade", role: "field" },
      title: "What they do",
      body: "How you will find them later when looking for someone to handle a job.",
      prefill: "Landscaping",
    },
    {
      target: { text: "Payment terms", role: "field" },
      title: "When they expect to be paid",
      body:
        "Sets the due date on every invoice from them, which feeds the cash forecast and the payment run.",
    },
    {
      title: "Before year end: the W-9",
      body:
        "Contractors you pay over the IRS threshold need a 1099 at year end, and that needs their tax details on file. The Vendors list flags anyone missing paperwork — chase it when you set them up, not in January.",
    },
  ],
};

export const raisePurchaseOrder: Guide = {
  id: "raise-purchase-order",
  title: "Raise a purchase order",
  summary:
    "Commit to spending money before the work happens, and reserve it against the budget.",
  requires: ["po.manage"],
  prerequisites: ["add-vendor"],
  category: "Money out",
  estimatedMinutes: 4,
  steps: [
    {
      route: "/purchasing",
      title: "Commitments, before they become bills",
      body:
        "A purchase order is the community's promise to spend. Raising one reserves the money so it cannot be committed twice, and gives the eventual invoice something to be checked against.",
    },
    {
      target: { text: "New PO", role: "button" },
      title: "Start an order",
      body: "Click here.",
      advanceOn: "click",
    },
    {
      target: { text: "Vendor", role: "field" },
      title: "Who is doing the work",
      body:
        "Only active vendors appear. If the contractor is missing, they need adding first — ask the assistant for 'add a contractor'.",
    },
    {
      target: { text: "Order date", role: "field" },
      title: "When it was agreed",
      body: "Drives which accounting period the commitment lands in.",
    },
    {
      target: { text: "Item", role: "field" },
      title: "What is being bought",
      body:
        "Describe it as the vendor would on their invoice — it makes matching far easier three weeks later.",
      prefill: "Quarterly landscaping — front entrance and pool area",
    },
    {
      target: { text: "Account", role: "field" },
      title: "Which budget it comes out of",
      body:
        "The account code carries the fund, so this is where you decide whether the money comes from operating or reserves. It is checked against the budget when the order is approved.",
      note:
        "In absolute budget mode, an order that would exceed the budget line is blocked outright. In advisory mode it warns and lets you through.",
    },
    {
      target: { text: "Submit", role: "button" },
      title: "Send it for approval",
      body:
        "How many people must sign depends on the amount and the approval hierarchy configured for this community. Once fully approved the money is formally committed.",
      advanceOn: "click",
    },
  ],
};

export const recordDelivery: Guide = {
  id: "record-delivery",
  title: "Record that work was delivered",
  summary:
    "Confirm what actually turned up, so the invoice can be checked against it.",
  requires: ["po.receive"],
  prerequisites: ["raise-purchase-order"],
  category: "Money out",
  estimatedMinutes: 2,
  steps: [
    {
      route: "/receiving",
      title: "The middle leg of the three-way match",
      body:
        "The order said what was agreed. This says what actually arrived. Without it, nobody can tell the difference between work that was done and work that was merely invoiced.",
    },
    {
      target: { text: "New Receipt", role: "button" },
      title: "Record a delivery",
      body: "Click here.",
      advanceOn: "click",
    },
    {
      target: { text: "Purchase Order", role: "field" },
      title: "Which order it relates to",
      body: "Only approved orders appear here.",
    },
    {
      target: { text: "Received date", role: "field" },
      title: "When it arrived",
      body: "The date the work was actually done or the goods delivered.",
    },
    {
      target: { text: "Packing slip", role: "field" },
      title: "Their reference",
      body:
        "The delivery note or job sheet number. This is the paper trail an auditor follows, so record it even when it feels like busywork.",
      note:
        "Received less than was ordered? Record what actually arrived. A short delivery is exactly what the match is designed to catch.",
    },
  ],
};

export const enterVendorInvoice: Guide = {
  id: "enter-vendor-invoice",
  title: "Enter a bill from a contractor",
  summary: "Record an invoice that arrived and let the system check it against the order.",
  requires: ["ap.manage"],
  category: "Money out",
  estimatedMinutes: 4,
  steps: [
    {
      route: "/payables",
      title: "Bills waiting to be dealt with",
      body:
        "Everything a contractor has invoiced, and where each one has got to. Nothing here has been paid yet.",
    },
    {
      target: { text: "Enter invoice", role: "button" },
      title: "Record the bill",
      body: "Click here.",
      advanceOn: "click",
    },
    {
      target: { text: "Vendor", role: "field" },
      title: "Who sent it",
      body: "Pick the contractor. Only active vendors are listed.",
    },
    {
      target: { text: "Invoice number", role: "field" },
      title: "Their invoice number",
      body:
        "Exactly as printed on the invoice. This is what stops the same bill being paid twice when it gets emailed again a fortnight later.",
    },
    {
      target: { text: "Invoice date", role: "field" },
      title: "The date on the invoice",
      body: "Their date, not today's. Combined with payment terms it sets the due date.",
    },
    {
      target: { text: "GL date", role: "field" },
      title: "Which month it belongs to",
      body:
        "The accounting period the cost lands in. Usually the month the work was done, which is not always the month the invoice arrived — and it must be an open period.",
    },
    {
      target: { text: "Against a purchase order", role: "field" },
      title: "Link it to the order",
      body:
        "This is what turns on the three-way match. The system compares the invoice to the order and the delivery record, and holds it if they disagree beyond the tolerance you configured.",
      note:
        "Entering it with no order means no automatic check at all — fine for a utility bill, risky for contracted work.",
    },
    {
      target: { text: "Net amount", role: "field" },
      title: "The amount",
      body: "Before tax. The total is calculated for you.",
    },
    {
      target: { text: "GL account", role: "field" },
      title: "Which account it hits",
      body:
        "Where the cost is recorded. If the invoice is matched to an order, this normally follows the order's coding.",
    },
  ],
};

export const approveAndPay: Guide = {
  id: "approve-and-pay",
  title: "Approve and pay a contractor",
  summary: "Get an invoice signed off and actually send the money.",
  requires: ["ap.pay"],
  prerequisites: ["enter-vendor-invoice"],
  category: "Money out",
  estimatedMinutes: 4,
  steps: [
    {
      route: "/approvals",
      title: "What is waiting on a signature",
      body:
        "Invoices and orders above the configured amounts wait here. Each approval is recorded with who signed, at what level, when, and any comment they left.",
      branch: {
        async decide(ctx) {
          const reqs = await ctx.read<any[]>("/approvals/requests");
          return reqs && reqs.length > 0 ? "pending" : "none";
        },
        options: {
          none: [
            {
              title: "Nothing is waiting right now",
              body:
                "No pending approvals. Either everything is signed off, or the amounts fall below the thresholds set for this community and approve automatically.",
              note:
                "If no hierarchy is configured for a document type, documents of that type approve on their own. Worth checking that is what you intended.",
            },
          ],
          pending: [
            {
              target: { text: "Approve", role: "button" },
              title: "Sign it off",
              body:
                "Approving advances it one level. When the last required level signs, the document takes effect. One rejection ends the request outright and sends it back to whoever raised it.",
            },
          ],
        },
      },
    },
    {
      route: "/payables",
      title: "Check for holds before paying",
      body:
        "An invoice on hold cannot be paid. Holds come from the three-way match disagreeing, or from somebody stopping it deliberately — either way it is a question that needs answering, not an obstacle to route around.",
    },
    {
      route: "/payments",
      title: "Send the money",
      body:
        "Approved invoices are paid from here, drawn from a specific bank account — which decides which fund the money leaves.",
    },
    {
      title: "Then reconcile it",
      body:
        "A payment is not finished when it is issued. It appears on the bank statement days later, and matching it there marks it cleared. Until then it is outstanding, and the community's real cash position is lower than the ledger suggests.",
      note: "Ask the assistant for 'reconcile the bank account' when the statement arrives.",
    },
  ],
};

export const configureApprovals: Guide = {
  id: "configure-approvals",
  title: "Decide who has to approve what",
  summary:
    "Set the amounts at which an order or invoice needs a second — or third — signature.",
  requires: ["approval.config"],
  category: "Money out",
  estimatedMinutes: 4,
  steps: [
    {
      route: "/approvals",
      title: "The spending controls",
      body:
        "Approval rules are per community, not hard-coded. The amount on a document decides how many people must sign it.",
    },
    {
      target: { text: "New Hierarchy", role: "button" },
      title: "Create a set of rules",
      body: "One hierarchy per document type — purchase orders, vendor invoices, work orders.",
      advanceOn: "click",
    },
    {
      target: { text: "Document type", role: "field" },
      title: "What it applies to",
      body: "Each document type gets its own ladder.",
    },
    {
      target: { text: "Levels", role: "any" },
      title: "The ladder",
      body:
        "Each level has an amount it applies from, and a role that signs it. A $400 order might need only the manager; $6,000 the treasurer as well; $40,000 the full board.",
      note:
        "Levels are assigned to roles, not named people — anyone holding that role can sign. There is no delegation or out-of-office cover today, so a level whose role has one holder is a bottleneck when they are away.",
    },
    {
      title: "The gap worth knowing about",
      body:
        "If no hierarchy exists for a document type, documents of that type approve automatically. Convenient for a small community, dangerous for a large one — and it fails silently, so nobody notices until an audit.",
    },
  ],
};
