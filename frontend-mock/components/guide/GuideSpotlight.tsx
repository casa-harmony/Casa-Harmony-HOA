"use client";

/**
 * The overlay: dims the screen, cuts a hole around the control being explained,
 * and parks a card next to it.
 *
 * Built rather than pulled in (driver.js, joyride) because the cutout is one
 * box-shadow and the positioning is one clamp, while the repo's rule is to
 * reach for the local kit before adding a dependency. Swapping in a library
 * later only touches this file — the runner and the guide content do not care.
 */

import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useGuide } from "./GuideProvider";

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 6;
const CARD_W = 380;
const GAP = 14;

export function GuideSpotlight() {
  const { guide, steps, index, targetEl, resolving, targetMissing, next, back, stop } =
    useGuide();
  const [rect, setRect] = useState<Rect | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Track the target through scrolling and layout shifts.
  useLayoutEffect(() => {
    if (!targetEl) {
      setRect(null);
      return;
    }
    const measure = () => {
      const r = targetEl.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    const id = window.setInterval(measure, 300); // catches modal open/close reflows
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      window.clearInterval(id);
    };
  }, [targetEl]);

  if (!mounted || !guide) return null;
  const step = steps[index];
  if (!step) return null;

  const isLast = index === steps.length - 1;
  const total = steps.length;

  /* Card sits under the target, flipping above when there is no room, and
   * centres itself when the step has nothing to point at. */
  let cardStyle: React.CSSProperties;
  if (rect) {
    const below = rect.top + rect.height + GAP;
    const roomBelow = window.innerHeight - below > 260;
    const left = Math.min(
      Math.max(GAP, rect.left + rect.width / 2 - CARD_W / 2),
      window.innerWidth - CARD_W - GAP
    );
    cardStyle = roomBelow
      ? { top: below, left, width: CARD_W }
      : { bottom: window.innerHeight - rect.top + GAP, left, width: CARD_W };
  } else {
    cardStyle = {
      bottom: 96,
      left: "50%",
      transform: "translateX(-50%)",
      width: CARD_W,
    };
  }

  // z-[200] deliberately: Modal and DetailSheet are both z-[100], and a guide
  // has to be able to point at controls that live inside them.
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[200]">
      {/* dim + cutout */}
      {rect ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(2, 6, 23, 0.55)",
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-foreground/45" />
      )}

      {/* step card */}
      <div
        className={cn(
          "pointer-events-auto absolute rounded-xl border bg-card p-4 shadow-2xl",
          "max-w-[calc(100vw-2rem)]"
        )}
        style={cardStyle}
      >
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-2xs font-semibold uppercase tracking-wider text-primary">
              {guide.title}
            </p>
            <h3 className="mt-0.5 text-sm font-semibold">{step.title}</h3>
          </div>
          <button
            onClick={stop}
            aria-label="Close guide"
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>

        {step.note && (
          <p className="mt-2 rounded-lg bg-accent/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {step.note}
          </p>
        )}

        {resolving && (
          <p className="mt-2 text-xs text-muted-foreground">Finding it…</p>
        )}

        {targetMissing && (
          <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
            That control isn&apos;t on screen right now — it may need something
            created first, or the screen may have moved on. You can still read
            the step and continue.
          </p>
        )}

        <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
          <span className="text-2xs text-muted-foreground">
            Step {index + 1} of {total}
          </span>
          <div className="flex items-center gap-2">
            {index > 0 && (
              <Button variant="ghost" size="sm" onClick={back}>
                Back
              </Button>
            )}
            {step.advanceOn === "click" ? (
              <span className="text-2xs font-medium text-primary">
                Click the highlighted control
              </span>
            ) : (
              <Button size="sm" onClick={next}>
                {isLast ? (
                  <>
                    Finish <Check className="h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    Next <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
