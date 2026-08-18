/**
 * Day zero: the very first thing anyone does on the platform.
 *
 * Branches on whether the platform is empty, because the wording that helps a
 * first-time superadmin ("nothing exists yet, this is where it starts") is
 * patronising once they run twelve communities.
 */
import type { Guide } from "../types";

export const createCommunity: Guide = {
  id: "create-community",
  title: "Create a community and its first administrator",
  summary:
    "Set up a new HOA on the platform and give one person the keys to run it.",
  requires: ["tenant.create"],
  category: "Getting started",
  estimatedMinutes: 3,
  steps: [
    {
      route: "/tenants",
      title: "This is the top of the system",
      body:
        "Every HOA on the platform lives here, and each one is completely sealed off from the others. Everything else you do — residents, invoices, the ledger — happens inside one of these.",
      branch: {
        async decide(ctx) {
          const tenants = await ctx.read<any[]>("/tenants");
          return tenants && tenants.length > 0 ? "existing" : "empty";
        },
        options: {
          empty: [
            {
              target: '[data-tour="tenants-stat-count"]',
              title: "Nothing here yet",
              body:
                "The platform is empty. Creating the first community is what turns this from an installed system into a working one.",
            },
          ],
          existing: [
            {
              target: '[data-tour="tenants-stat-count"]',
              title: "What you already run",
              body:
                "These are the communities on the platform today. Adding another does not touch any of them — the new one starts with its own books, its own residents and its own staff access.",
            },
          ],
        },
      },
    },
    {
      target: '[data-tour="tenants-new"]',
      title: "Start a new community",
      body: "Click here to open the form.",
      advanceOn: "click",
    },
    {
      target: '[data-tour="tenant-name"]',
      title: "Name it as the residents know it",
      body:
        "This name appears on statements, notices and the resident portal, so use the name people actually recognise rather than the legal entity.",
      prefill: "Willow Creek Estates",
    },
    {
      target: '[data-tour="tenant-admin-email"]',
      title: "Who will run this community?",
      body:
        "This is usually the property manager. They get an account created for them and they become the first person able to sign in to this community.",
      prefill: "manager@willowcreek.org",
      note:
        "One person, one login, across the whole platform. If this email already belongs to a staff member, they simply gain access to this community too.",
    },
    {
      target: '[data-tour="tenant-admin-password"]',
      title: "A starting password",
      body:
        "Eight characters or more. They are forced to change it the first time they sign in, so this is only ever a handover password — send it to them separately from the email address.",
    },
    {
      target: '[data-tour="tenant-units"]',
      title: "Units and dues",
      body:
        "The number of units and the standard monthly dues. These drive the billing plan and the occupancy figures on the dashboard, and you can change them later.",
    },
    {
      target: '[data-tour="tenant-create-submit"]',
      title: "Create it",
      body:
        "When you press this, the community is created with a full chart of accounts, its funds, and an accounting period for every month — ready to take money.",
      advanceOn: "click",
      note:
        "This is the one step the guide will not press for you. Check the name and the administrator's email first: both are awkward to change afterwards.",
    },
    {
      title: "Done — and what happens next",
      body:
        "The community exists and its administrator can sign in. From here the usual order is: add the homeowners, set up the billing plan, then run the first month's assessments. Ask the assistant for 'add a homeowner' when you are ready.",
    },
  ],
};
