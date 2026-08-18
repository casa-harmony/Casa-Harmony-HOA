/**
 * Send a reported problem out to a contractor.
 *
 * This is the guide that justified the whole branching design. "Assign the job
 * to a vendor" is two completely different procedures depending on whether the
 * community has any vendors on file yet, and the reader has no way of knowing
 * which situation they are in until someone looks. So the guide looks, and
 * detours through creating a vendor only when it has to.
 */
import type { Guide } from "../types";

export const assignTicketToVendor: Guide = {
  id: "assign-ticket-to-vendor",
  title: "Send a reported problem out to a contractor",
  summary:
    "Take a service ticket, attach the contractor who will fix it and what it should cost, then raise the purchase order.",
  requires: ["ticket.manage"],
  category: "Service desk",
  estimatedMinutes: 4,
  steps: [
    {
      route: "/service-desk",
      title: "Everything residents have reported",
      body:
        "Each row is something somebody reported — a leak, a broken gate, a complaint. Work that costs money leaves this screen and becomes a purchase order.",
      branch: {
        async decide(ctx) {
          const tickets = await ctx.read<any[]>("/service-desk/tickets");
          const open = (tickets ?? []).filter(
            (t) => t.status !== "CLOSED" && t.status !== "RESOLVED"
          );
          return open.length > 0 ? "has-tickets" : "no-tickets";
        },
        options: {
          "no-tickets": [
            {
              target: '[data-tour="tickets-new"]',
              title: "There is nothing open to assign yet",
              body:
                "No open tickets, so there is no job to send out. Raise one here first — in normal use these arrive from residents through the portal rather than being typed in by staff.",
              advanceOn: "click",
            },
            {
              title: "Fill in what was reported",
              body:
                "Give it a subject, pick the unit it relates to and save. Then ask the assistant for this guide again and it will pick up from the assignment step.",
            },
          ],
          "has-tickets": [
            {
              target: '[data-tour="tickets-table"]',
              title: "Open the one you want to send out",
              body: "Click any ticket in the list to open its full record.",
              advanceOn: "click",
            },
          ],
        },
      },
    },
    {
      title: "Who is going to do the work?",
      body: "Before assigning, the guide is checking which contractors this community already has on file.",
      branch: {
        async decide(ctx) {
          const vendors = await ctx.read<any[]>("/vendors");
          const active = (vendors ?? []).filter(
            (v) => String(v.status).toUpperCase() === "ACTIVE"
          );
          return active.length > 0 ? "have-vendors" : "no-vendors";
        },
        options: {
          /* ---- the detour: no contractors on file yet ------------------- */
          "no-vendors": [
            {
              route: "/vendors",
              target: '[data-tour="vendors-new"]',
              title: "No contractors on file yet",
              body:
                "This community has no vendors set up, so there is nobody to assign the job to. That has to be fixed first — it only takes a moment, and you do it once per contractor.",
              advanceOn: "click",
              note:
                "A vendor is a record, not a login. Contractors do not sign in to this system; you are creating the file that invoices and payments hang off.",
            },
            {
              target: '[data-tour="vendor-name"]',
              title: "The contractor's name",
              body: "The trading name you would write on a cheque.",
              prefill: "GreenLeaf Landscaping LLC",
            },
            {
              target: '[data-tour="vendor-trade"]',
              title: "What they do",
              body:
                "Their trade — landscaping, plumbing, elevators. This is what you filter by later when you are looking for somebody to handle a job.",
              prefill: "Landscaping",
            },
            {
              target: '[data-tour="vendor-terms"]',
              title: "Payment terms",
              body:
                "How long after invoicing they expect to be paid. This sets the due date on every invoice from them, which in turn drives the cash forecast.",
            },
            {
              target: '[data-tour="vendor-create-submit"]',
              title: "Save the contractor",
              body: "Add them, and they become selectable on the ticket.",
              advanceOn: "click",
            },
            {
              route: "/service-desk",
              target: '[data-tour="tickets-table"]',
              title: "Back to the ticket",
              body:
                "Now that a contractor exists, reopen the ticket you were working on and carry on.",
              advanceOn: "click",
            },
          ],
          /* ---- the normal path ----------------------------------------- */
          "have-vendors": [
            {
              title: "Contractors are already on file",
              body:
                "This community has vendors set up, so you can pick one directly — no detour needed.",
            },
          ],
        },
      },
    },
    {
      target: '[data-tour="ticket-assign"]',
      title: "Attach a contractor",
      body:
        "This is the moment the ticket stops being a complaint and becomes money the community is about to spend.",
      advanceOn: "click",
    },
    {
      target: '[data-tour="ticket-vendor-select"]',
      title: "Choose who is doing the work",
      body: "Pick the contractor from the list.",
    },
    {
      target: '[data-tour="ticket-estimate"]',
      title: "What is it expected to cost?",
      body:
        "An estimate, not an invoice. This figure decides how many people have to approve the job — a small repair may need only the manager, a large one may need the board.",
      note:
        "Approval thresholds are configured per community on the Approvals screen. If none are set, the job approves automatically.",
    },
    {
      target: '[data-tour="ticket-assign-submit"]',
      title: "Assign it",
      body:
        "The ticket moves to In Progress and the contractor is now on the record.",
      advanceOn: "click",
    },
    {
      target: '[data-tour="ticket-create-po"]',
      title: "Turn it into a purchase order",
      body:
        "This is the commitment to spend. Once raised, the order goes for approval, the money is reserved against the budget, and the contractor's eventual invoice will be matched against it before a penny is paid.",
      note:
        "From here the job follows the money-out cycle: approve, record the work as received, match the invoice, pay. Ask the assistant for 'pay a contractor's invoice' to continue.",
    },
  ],
};
