"use client";

/**
 * Points out that the guide exists.
 *
 * The walkthroughs are the most useful thing in the product for someone who has
 * never run an HOA ledger before, and they are also the easiest thing to miss —
 * a single floating button in a corner. So we say it out loud: once when
 * somebody first arrives, then at most once a day after that.
 *
 * Deliberately *not* once per page load. The timestamp is written the moment
 * the nudge appears rather than when it is dismissed, so moving around the app
 * during a session never brings it back; only the next day does.
 *
 * State lives in localStorage keyed by user, because it is a per-person UI
 * preference with no business meaning — nothing here belongs in the database,
 * and a different login on the same browser deserves its own first run.
 */

import { useCallback, useEffect, useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { useAuth } from "@/app/providers";
import { useGuide } from "./GuideProvider";

const STORE_KEY = "casa_guide_nudge_v1";
/** How long before we mention it again. */
const REPEAT_AFTER_MS = 24 * 60 * 60 * 1000;
/** Let the page settle first — a callout that races the first paint reads as a bug. */
const APPEAR_DELAY_MS = 1200;

type Seen = Record<string, { lastShownAt: number; count: number }>;

function readSeen(): Seen {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Seen) : {};
  } catch {
    return {};
  }
}

function writeSeen(next: Seen): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* private browsing, quota — the nudge is not worth failing over */
  }
}

export function GuideNudge() {
  const { ready, signedIn, user } = useAuth();
  const { openPanel, panelOpen, guide } = useGuide();
  const [visible, setVisible] = useState(false);
  const [firstTime, setFirstTime] = useState(true);

  // Anonymous fallback keeps the browser from being nudged forever if a build
  // ever renders this without a resolved user.
  const key = user?.id ?? "anonymous";

  const remember = useCallback(() => {
    const seen = readSeen();
    const prev = seen[key];
    writeSeen({
      ...seen,
      [key]: { lastShownAt: Date.now(), count: (prev?.count ?? 0) + 1 },
    });
  }, [key]);

  useEffect(() => {
    if (!ready || !signedIn) return;
    // Never talk over a walkthrough that is already running or open.
    if (guide || panelOpen) return;

    const seen = readSeen()[key];
    if (seen && Date.now() - seen.lastShownAt < REPEAT_AFTER_MS) return;

    setFirstTime(!seen);
    const t = setTimeout(() => {
      setVisible(true);
      // Written on appearance, not on dismissal: navigating around during this
      // session must not summon it again.
      remember();
    }, APPEAR_DELAY_MS);
    return () => clearTimeout(t);
  }, [ready, signedIn, key, guide, panelOpen, remember]);

  // A guide starting is the strongest possible signal the message landed.
  useEffect(() => {
    if (guide || panelOpen) setVisible(false);
  }, [guide, panelOpen]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 right-5 z-[81] w-[min(20rem,calc(100vw-2.5rem))] rounded-xl border bg-card p-4 shadow-xl"
    >
      <button
        onClick={() => setVisible(false)}
        aria-label="Dismiss"
        className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="flex gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
          <HelpCircle className="h-4 w-4" />
        </span>
        <div className="min-w-0 pr-4">
          <p className="text-sm font-semibold text-foreground">
            {firstTime ? "Not sure where to start?" : "The guide is still here"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {firstTime
              ? "Show me how walks you through real tasks — billing a community, paying a vendor, closing a period — step by step, on your own data."
              : "Any time you are unsure of a task, Show me how will walk you through it on your own data."}
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => {
                setVisible(false);
                openPanel();
              }}
              className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Show me how
            </button>
            <button
              onClick={() => setVisible(false)}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
