/**
 * Types for the in-app guide.
 *
 * The guide exists because the people who run an HOA are not ERP operators.
 * Knowing *that* a screen exists is useless if you don't know it is step four
 * of seven and that steps one to three happen on other screens. So a guide is
 * a scripted walk across real screens, pointing at the real controls.
 *
 * Two rules shaped this design:
 *
 * 1. A guide never clicks for you. This system posts journals and issues
 *    payments; an automation that mis-fires is unrecoverable. The guide
 *    highlights and explains, the human acts. `prefill` may put example text
 *    into an input, but no guide ever presses a button that spends money,
 *    posts to the ledger, or deletes anything.
 *
 * 2. A guide branches on what is actually in the database, not on what the
 *    author assumed. "Assign this job to a vendor" is a different instruction
 *    depending on whether the community has any vendors yet, and the guide has
 *    to find that out at runtime — see `GuideBranch`.
 */

/** Everything a branch predicate is allowed to look at. */
export interface GuideContext {
  /** Read any API path with the active tenant attached. Never throws — resolves null on failure. */
  read: <T>(path: string) => Promise<T | null>;
  /** Permission check for the signed-in user, straight from /auth/me. */
  can: (permission: string) => boolean;
  activeTenantId: string | null;
}

/**
 * What a step points at.
 *
 * A raw string is a CSS selector, and in practice always a `data-tour`
 * attribute — never a class name or `nth-child`, which churn with styling and
 * rot the guide silently.
 *
 * The object form finds the control by what the reader actually sees. That
 * matters at this scale: the app has ~39 screens and several hundred controls,
 * and threading a hand-written attribute through every one of them is both a
 * huge diff and a standing maintenance cost. Matching on the visible label is
 * how a person finds the button anyway. Use `data-tour` where the text is
 * ambiguous or likely to change, text matching everywhere else.
 */
export type GuideTarget =
  | string
  | {
      /** Visible text — matched case-insensitively as a substring by default. */
      text: string;
      /**
       * Narrows the search:
       * - "button" — <button> or a link styled as an action
       * - "field"  — the input/select owned by a <label> with this text
       * - "any"    — any visible element (default)
       */
      role?: "button" | "field" | "any";
      /** Require the whole trimmed text to match rather than a substring. */
      exact?: boolean;
    };

export interface GuideStep {
  /**
   * Route this step happens on. The runner navigates here first and waits for
   * the page to settle. Omit to stay wherever the previous step ended.
   */
  route?: string;
  /** The control being explained. Omit for a step that is pure narration. */
  target?: GuideTarget;
  title: string;
  body: string;
  /**
   * How the runner leaves this step.
   * - "next"  — the reader presses Next (default)
   * - "click" — the reader clicks the highlighted control itself
   */
  advanceOn?: "next" | "click";
  /** Example text dropped into the highlighted input so the reader sees the shape of a real value. */
  prefill?: string;
  /** Shown in a muted footnote — the "why", for people who want to understand rather than copy. */
  note?: string;
  /**
   * Evaluated when the step is reached. Returning a key selects the next
   * sequence of steps from `branches`. This is what makes a guide adapt to the
   * live database rather than assume a happy path.
   */
  branch?: GuideBranch;
}

export interface GuideBranch {
  /** Inspect live state, return a key of `options`. */
  decide: (ctx: GuideContext) => Promise<string>;
  /** Steps spliced in for each outcome. */
  options: Record<string, GuideStep[]>;
}

export interface Guide {
  id: string;
  title: string;
  /** One line, plain English — this is what the chat suggests and what the catalogue lists. */
  summary: string;
  /** Permissions the reader must hold. A guide they cannot perform is never offered. */
  requires: string[];
  /** Guides that realistically have to happen first. Surfaced, not enforced. */
  prerequisites?: string[];
  category: GuideCategory;
  estimatedMinutes: number;
  steps: GuideStep[];
}

export type GuideCategory =
  | "Getting started"
  | "People & access"
  | "Money in"
  | "Money out"
  | "Service desk"
  | "Month end";

/* -------------------------------------------------- the rule-based chat --- */

/**
 * The chat is a decision tree, not a model. Every answer is authored, so it
 * cannot invent a procedure that does not exist — which matters when the wrong
 * answer means somebody mis-posts a ledger entry.
 */
export interface ChatNode {
  id: string;
  /** What the assistant asks at this point. */
  prompt: string;
  choices: ChatChoice[];
}

export interface ChatChoice {
  label: string;
  /** Follow-up question… */
  next?: string;
  /** …or the guide this answer lands on. */
  guideId?: string;
}
