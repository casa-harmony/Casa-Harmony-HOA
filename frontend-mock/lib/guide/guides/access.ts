/**
 * Getting people into the system — staff on one side, residents on the other.
 *
 * These two are deliberately separate guides even though they look similar,
 * because they are separate identity systems and confusing them is the single
 * most common mistake: a staff account is one login across the whole platform
 * with a role granted per community, while a resident is scoped to one
 * community and signs in at a different address entirely.
 */
import type { Guide } from "../types";

export const createUser: Guide = {
  id: "create-user",
  title: "Give a staff member access",
  summary:
    "Create a login for a manager, accountant or auditor and choose what they are allowed to do.",
  requires: ["user.manage"],
  category: "People & access",
  estimatedMinutes: 3,
  steps: [
    {
      route: "/users",
      title: "Everyone who can sign in",
      body:
        "Staff accounts, and what each one is allowed to touch. One person has a single login for the whole platform — their powers are granted separately for each community they work on.",
    },
    {
      target: { text: "Create user", role: "button" },
      title: "Add the person",
      body: "Click here to open the form.",
      advanceOn: "click",
    },
    {
      target: { text: "Full Name", role: "field" },
      title: "Their name",
      body: "As it should appear on approvals and in the audit trail.",
      prefill: "Sarah Chen",
    },
    {
      target: { text: "Email Address", role: "field" },
      title: "Their email",
      body:
        "This is their username. If this person already has an account on the platform, using the same email adds this community to their existing login rather than creating a second one.",
      prefill: "sarah@pinecrest.org",
    },
    {
      target: { text: "Job Title", role: "field" },
      title: "Job title",
      body:
        "Free text, shown next to their name. Useful when two people hold the same role but do different jobs.",
    },
    {
      target: { text: "Assigned Role", role: "field" },
      title: "This is the important one",
      body:
        "The role decides everything they can see and do. An Accountant sees the finances but not the service desk; an HOA Administrator runs the community day to day; a Viewer can read and change nothing.",
      note:
        "Not sure which to pick? The Roles, Access & Flow screen lists exactly what each role can and cannot do, in plain English.",
    },
    {
      target: { text: "Assigned Community", role: "field" },
      title: "Which community",
      body:
        "The role above applies only to the community you pick here. The same person can be an administrator in one and read-only in another.",
    },
    {
      target: { text: "Create user", role: "button" },
      title: "Create the account",
      body:
        "They can sign in straight away and will be asked to set their own password the first time.",
      advanceOn: "click",
      note:
        "There is a superadmin checkbox on this form. It grants access to every community on the platform and should be reserved for your own staff — never a client's.",
    },
  ],
};

export const inviteResident: Guide = {
  id: "invite-resident",
  title: "Invite a resident to the portal",
  summary:
    "Give a homeowner or tenant a login so they can see their balance, pay online and report problems.",
  requires: ["resident.manage"],
  prerequisites: ["add-homeowner"],
  category: "People & access",
  estimatedMinutes: 4,
  steps: [
    {
      route: "/residents",
      title: "Residents and the units they hold",
      body:
        "A resident is a portal login. A unit is the account their money runs through. The two are linked but separate — which is what lets one landlord with three condos hold a single login and see all three.",
    },
    {
      title: "First, is there a unit to link them to?",
      body: "Checking whether this community has any homeowner accounts set up yet.",
      branch: {
        async decide(ctx) {
          const owners = await ctx.read<any[]>("/subledger/homeowners");
          return owners && owners.length > 0 ? "has-units" : "no-units";
        },
        options: {
          "no-units": [
            {
              route: "/receivables",
              title: "No unit accounts exist yet",
              body:
                "A portal login on its own shows a resident nothing — the balance, statements and payment history all hang off a unit account. Create the homeowner account first on this screen, then come back.",
              note:
                "Ask the assistant for 'add a homeowner' and it will walk you through that, then return here.",
            },
          ],
          "has-units": [
            {
              target: { text: "Units & balances", role: "button" },
              title: "The units are already here",
              body:
                "This tab lists the unit accounts you can link a resident to. Good — you can go ahead and create the login.",
            },
          ],
        },
      },
    },
    {
      route: "/residents",
      target: { text: "Invite resident", role: "button" },
      title: "Create the portal login",
      body: "Click here to start.",
      advanceOn: "click",
    },
    {
      target: { text: "Full name", role: "field" },
      title: "Their name",
      body: "As you would address them on a letter.",
      prefill: "John Smith",
    },
    {
      target: { text: "Username", role: "field" },
      title: "The name they sign in with",
      body:
        "Unique within this community only — another community can have its own 'jsmith'. Residents sign in with the community, this username, and their password.",
      prefill: "jsmith",
    },
    {
      target: { text: "Type", role: "field" },
      title: "Owner or renter",
      body:
        "Owners see assessments and the full ledger. Renters see only what their landlord's arrangement allows.",
    },
    {
      target: { text: "Sign-in code by", role: "field" },
      title: "How they get their one-time code",
      body:
        "Residents get a code by email or text each time they sign in, rather than using an authenticator app — it is the option most likely to work for every age group in a community.",
    },
    {
      target: { text: "Invite resident", role: "button" },
      title: "Send the invitation",
      body:
        "They receive an email with a single-use link to set their own password. You never see or set it.",
      advanceOn: "click",
    },
    {
      target: { text: "Add unit", role: "button" },
      title: "Now link them to their unit",
      body:
        "This is the step people forget. Until a resident is linked to a unit they can sign in and see nothing at all. Use this to attach their account.",
      note:
        "A resident can hold several units — add each one and they will all appear on their dashboard.",
    },
  ],
};

export const uploadDocument: Guide = {
  id: "upload-document",
  title: "Upload a document and decide who sees it",
  summary:
    "Put a file on record — governing documents, minutes, contracts — and control whether residents can read it.",
  requires: ["document.manage"],
  category: "People & access",
  estimatedMinutes: 2,
  steps: [
    {
      route: "/documents",
      title: "Everything the community holds on file",
      body:
        "Governing documents, budgets, contracts, meeting minutes, photographs. Each one carries its own visibility setting.",
    },
    {
      target: { text: "Drop files here", role: "any" },
      title: "Add the file",
      body:
        "Drag a file onto this area, or click it to browse. PDFs, Word, Excel and images are all accepted.",
    },
    {
      target: { text: "Who can see this file", role: "any" },
      title: "The setting that matters",
      body:
        "Staff-only keeps the file internal. Visible to residents publishes it to every resident portal in this community immediately — there is no per-resident sharing, so treat it as publishing.",
      note:
        "Anything with an individual's financial details or personal data should stay staff-only. Governing documents, approved minutes and budgets are the usual candidates for resident visibility.",
    },
  ],
};
