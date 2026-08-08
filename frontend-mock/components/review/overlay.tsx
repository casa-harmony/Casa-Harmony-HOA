"use client";

/**
 * The dots on the page, and the crosshair that drops them.
 *
 * Positions are recomputed every animation frame from the anchor element's
 * current box. That is what lets a dot stay glued to "the total in this card"
 * while the page scrolls, resizes, or re-renders with different data.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { REVIEW_UI_ATTR, anchorFromPoint, pinPosition } from "@/lib/review/anchor";
import type { ReviewPin } from "@/lib/review/types";
import { useReview } from "./provider";
import { DraftCard, ThreadCard } from "./thread";

const Z_PINS = 2147483000;
const Z_CAPTURE = 2147483200;

/** Placement key for the dot that is being written but not yet saved. */
export const DRAFT_ID = "__draft__";

interface Placed {
  x: number;
  y: number;
  orphan: boolean;
}

/** The minimum a thing needs for us to place it on screen. */
type Anchored = {
  id: string;
  anchor: string;
  x_pct: number;
  y_pct: number;
  page_x: number;
  page_y: number;
};

/** Track where every visible pin should sit right now. */
function usePlacements(pins: Anchored[], active: boolean): Record<string, Placed> {
  const [placed, setPlaced] = useState<Record<string, Placed>>({});
  const latest = useRef(placed);
  latest.current = placed;

  useEffect(() => {
    if (!active || pins.length === 0) {
      if (Object.keys(latest.current).length) setPlaced({});
      return;
    }
    let frame = 0;
    const tick = () => {
      const next: Record<string, Placed> = {};
      for (const pin of pins) {
        const pos = pinPosition(pin);
        if (pos) next[pin.id] = pos;
      }
      const prev = latest.current;
      const keys = Object.keys(next);
      const changed =
        keys.length !== Object.keys(prev).length ||
        keys.some((k) => {
          const a = next[k];
          const b = prev[k];
          return !b || Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5;
        });
      if (changed) setPlaced(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [pins, active]);

  return placed;
}

function Dot({
  pin,
  index,
  at,
  open,
  onClick,
}: {
  pin: ReviewPin;
  index: number;
  at: Placed;
  open: boolean;
  onClick: () => void;
}) {
  const resolved = pin.status === "resolved";
  const replies = pin.messages.length;
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${pin.author}: ${pin.messages[0]?.body?.slice(0, 80) ?? ""}`}
      className="group pointer-events-auto absolute grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full rounded-bl-sm text-[11px] font-semibold text-white shadow-lg ring-2 ring-white/90 transition-transform hover:scale-110 dark:ring-slate-900/80"
      style={{
        left: at.x,
        top: at.y,
        background: resolved ? "#059669" : "#7c3aed",
        opacity: at.orphan ? 0.6 : 1,
        outline: open ? "3px solid rgba(124,58,237,0.35)" : "none",
        outlineOffset: 2,
      }}
    >
      {index + 1}
      {replies > 1 && (
        <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-slate-900 px-1 text-[9px] text-white ring-1 ring-white dark:bg-white dark:text-slate-900 dark:ring-slate-900">
          {replies}
        </span>
      )}
    </button>
  );
}

/** Full-screen click catcher used while placing a new pin. */
function CaptureLayer() {
  const { setDraft, setPlacing } = useReview();
  const [hover, setHover] = useState<DOMRect | null>(null);
  const [label, setLabel] = useState("");

  const onMove = useCallback((e: React.MouseEvent) => {
    const found = anchorFromPoint(e.clientX, e.clientY);
    if (!found) {
      setHover(null);
      setLabel("");
      return;
    }
    setHover(found.el.getBoundingClientRect());
    setLabel(found.label);
  }, []);

  const onClick = useCallback(
    (e: React.MouseEvent) => {
      const found = anchorFromPoint(e.clientX, e.clientY);
      if (!found) return;
      const r = found.el.getBoundingClientRect();
      setDraft({
        anchor: found.selector,
        anchor_label: found.label,
        x_pct: r.width ? (e.clientX - r.left) / r.width : 0.5,
        y_pct: r.height ? (e.clientY - r.top) / r.height : 0.5,
        page_x: e.clientX + window.scrollX,
        page_y: e.clientY + window.scrollY,
        viewport_w: window.innerWidth,
      });
      setPlacing(false);
    },
    [setDraft, setPlacing]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPlacing(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPlacing]);

  return (
    <div
      {...{ [REVIEW_UI_ATTR]: "" }}
      className="fixed inset-0 cursor-crosshair"
      style={{ zIndex: Z_CAPTURE }}
      onMouseMove={onMove}
      onClick={onClick}
    >
      {hover && (
        <div
          className="pointer-events-none absolute rounded-md border-2 border-violet-500/80 bg-violet-500/10"
          style={{ left: hover.left, top: hover.top, width: hover.width, height: hover.height }}
        />
      )}
      <div className="pointer-events-none fixed left-1/2 top-4 -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2 text-xs font-medium text-white shadow-xl backdrop-blur">
        Click anywhere to leave a comment{label ? ` · ${label}` : ""} — Esc to cancel
      </div>
    </div>
  );
}

export function PinLayer() {
  const { pins, showResolved, commentsOn, placing, draft, openPinId, setOpenPinId } = useReview();

  const visible = pins.filter((p) => showResolved || p.status !== "resolved");
  const tracked = React.useMemo<Anchored[]>(
    () => (draft ? [...visible, { id: DRAFT_ID, ...draft }] : visible),
    // `visible` is derived fresh each render; depending on its contents keeps
    // the animation loop from restarting on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, visible.map((p) => `${p.id}:${p.status}`).join(",")]
  );
  const placements = usePlacements(tracked, commentsOn && !placing);

  // Numbering follows creation order across every pin on the page, so a
  // resolved comment does not renumber the ones after it.
  const numberOf = new Map(pins.map((p, i) => [p.id, i]));
  const openPin = pins.find((p) => p.id === openPinId) ?? null;

  return (
    <>
      {commentsOn && !placing && (
        <div
          {...{ [REVIEW_UI_ATTR]: "" }}
          className="pointer-events-none fixed inset-0"
          style={{ zIndex: Z_PINS }}
        >
          {visible.map((pin) => {
            const at = placements[pin.id];
            if (!at) return null;
            return (
              <Dot
                key={pin.id}
                pin={pin}
                index={numberOf.get(pin.id) ?? 0}
                at={at}
                open={openPinId === pin.id}
                onClick={() => setOpenPinId(openPinId === pin.id ? null : pin.id)}
              />
            );
          })}
          {draft && placements[DRAFT_ID] && (
            <span
              className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full rounded-bl-sm bg-violet-600 shadow-lg ring-2 ring-white dark:ring-slate-900"
              style={{ left: placements[DRAFT_ID].x, top: placements[DRAFT_ID].y }}
            />
          )}
        </div>
      )}
      {placing && <CaptureLayer />}

      {draft && !placing && (
        <DraftCard draft={draft} at={placements[DRAFT_ID] ?? centreOfScreen()} />
      )}
      {openPin && !placing && !draft && (
        <ThreadCard
          pin={openPin}
          index={numberOf.get(openPin.id) ?? 0}
          at={placements[openPin.id] ?? centreOfScreen()}
        />
      )}
    </>
  );
}

/** Fallback anchor for a card whose dot is currently off-screen or hidden. */
function centreOfScreen(): Placed {
  if (typeof window === "undefined") return { x: 0, y: 0, orphan: true };
  return { x: window.innerWidth / 2, y: 140, orphan: true };
}
