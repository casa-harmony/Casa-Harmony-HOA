/**
 * Which walkthrough answers which setup warning.
 *
 * The readiness banner already names what is missing and where to go; the guide
 * is the part that says *how*. Mapping is on the missing item rather than the
 * stage, because one stage can be blocked by several different things — Master
 * Data is unfinished whether you are short a bank account, payment terms or an
 * approval hierarchy, and those are three unrelated tasks.
 *
 * Anything unmatched simply gets no button. A guide that walks you somewhere
 * irrelevant is worse than no guide at all.
 */
import { getGuide } from "./registry";

/** Matched case-insensitively against the warning text, first hit wins. */
const BY_MISSING: [RegExp, string][] = [
  [/membership/i, "create-user"],
  [/chart of accounts|retained earnings/i, "add-value-set-value"],
  [/accounting period/i, "open-period"],
  [/bank account/i, "add-bank-account"],
  [/payment term/i, "ap-setup"],
  [/approval hierarchy/i, "configure-approvals"],
  [/resident/i, "add-homeowner"],
  [/billing plan/i, "create-billing-plan"],
  [/not activated/i, "go-live"],
];

/** Fallback when the specific wording is unrecognised but the stage is known. */
const BY_STAGE: Record<string, string> = {
  IDENTITY: "create-user",
  LEDGER: "add-value-set-value",
  CALENDAR: "open-period",
  MASTERS: "add-bank-account",
  SUBLEDGER: "add-homeowner",
  LIVE: "go-live",
};

/**
 * The guide id for a readiness warning, or null when nothing fits.
 *
 * Verified against the registry before being returned, so a guide that gets
 * renamed or removed degrades into a missing button rather than a dead one.
 */
export function guideForReadiness(
  stageId: string,
  missing: string | undefined
): string | null {
  const candidate =
    (missing && BY_MISSING.find(([re]) => re.test(missing))?.[1]) ??
    BY_STAGE[stageId] ??
    null;
  return candidate && getGuide(candidate) ? candidate : null;
}
