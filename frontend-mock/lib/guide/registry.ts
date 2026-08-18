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

export const GUIDES: Guide[] = [createCommunity, assignTicketToVendor];

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

/* ------------------------------------------------------------- the tree --- */

export const CHAT_ROOT = "root";

export const CHAT_TREE: Record<string, ChatNode> = {
  root: {
    id: "root",
    prompt: "What are you trying to do?",
    choices: [
      { label: "Set up something new", next: "setup" },
      { label: "Deal with a resident's problem", next: "service" },
      { label: "Money coming in from homeowners", next: "money-in" },
      { label: "Money going out to contractors", next: "money-out" },
    ],
  },

  setup: {
    id: "setup",
    prompt: "What needs setting up?",
    choices: [
      { label: "A whole new community", guideId: "create-community" },
      { label: "A staff member who needs access", next: "setup-staff" },
      { label: "A resident's portal login", next: "not-built" },
      { label: "← Back", next: "root" },
    ],
  },

  "setup-staff": {
    id: "setup-staff",
    prompt:
      "Is this the first person for a brand-new community, or somebody joining one that already runs?",
    choices: [
      {
        label: "First person — the community doesn't exist yet",
        guideId: "create-community",
      },
      { label: "Joining a community that already exists", next: "not-built" },
      { label: "← Back", next: "setup" },
    ],
  },

  service: {
    id: "service",
    prompt: "What kind of problem?",
    choices: [
      {
        label: "Something needs fixing and it will cost money",
        guideId: "assign-ticket-to-vendor",
      },
      { label: "A complaint or rule violation", next: "not-built" },
      { label: "← Back", next: "root" },
    ],
  },

  "money-in": {
    id: "money-in",
    prompt: "Which part of collecting from homeowners?",
    choices: [
      { label: "Bill this month's dues", next: "not-built" },
      { label: "Record a payment that arrived", next: "not-built" },
      { label: "Chase somebody who hasn't paid", next: "not-built" },
      { label: "← Back", next: "root" },
    ],
  },

  "money-out": {
    id: "money-out",
    prompt: "Which part of paying contractors?",
    choices: [
      {
        label: "Send a job out to a contractor",
        guideId: "assign-ticket-to-vendor",
      },
      { label: "Enter an invoice that arrived", next: "not-built" },
      { label: "Actually pay an approved invoice", next: "not-built" },
      { label: "← Back", next: "root" },
    ],
  },

  /* Honest dead end. Better than pretending to help and walking somebody into
   * a screen the guide has not been written for yet. */
  "not-built": {
    id: "not-built",
    prompt:
      "That guide has not been written yet — this is the first slice of the system. The two that work today are below.",
    choices: [
      { label: "Create a community", guideId: "create-community" },
      { label: "Send a job to a contractor", guideId: "assign-ticket-to-vendor" },
      { label: "← Start again", next: "root" },
    ],
  },
};
