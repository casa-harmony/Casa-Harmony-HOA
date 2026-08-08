"use client";

/**
 * The floating control for review mode: the on/off switch the client uses,
 * the "add comment" button, and the list of everything said so far.
 */

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  Eye,
  EyeOff,
  ListChecks,
  LogOut,
  MessageSquarePlus,
  X,
} from "lucide-react";
import { REVIEW_UI_ATTR } from "@/lib/review/anchor";
import type { ReviewPin } from "@/lib/review/types";
import { useReview } from "./provider";

const Z_BAR = 2147483300;

function Passcode() {
  const { submitPasscode, busy, error } = useReview();
  const [key, setKey] = useState("");

  return (
    <div
      {...{ [REVIEW_UI_ATTR]: "" }}
      className="fixed inset-0 grid place-items-center bg-slate-900/50 p-4 backdrop-blur-sm"
      style={{ zIndex: Z_BAR }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitPasscode(key);
        }}
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Review mode
        </h2>
        <p className="pt-1 text-xs text-slate-500">
          Enter the passcode to leave comments on this preview.
        </p>
        <input
          autoFocus
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Passcode"
          className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-violet-400 dark:border-slate-700 dark:bg-slate-950"
        />
        {error && <p className="pt-2 text-xs text-rose-600">{error}</p>}
        <button
          type="submit"
          disabled={busy || !key}
          className="mt-3 w-full rounded-lg bg-violet-600 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          Unlock
        </button>
      </form>
    </div>
  );
}

function PinRow({ pin, index, onPick }: { pin: ReviewPin; index: number; onPick: () => void }) {
  const first = pin.messages[0];
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="flex w-full gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <span
          className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white"
          style={{ background: pin.status === "resolved" ? "#059669" : "#7c3aed" }}
        >
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-slate-700 dark:text-slate-200">
            {first?.body || "(attachment only)"}
          </span>
          <span className="block truncate text-[10px] text-slate-400">
            {pin.author} · {pin.anchor_label}
          </span>
        </span>
      </button>
    </li>
  );
}

function Panel() {
  const { allPins, pathname, setPanelOpen, setOpenPinId, showResolved } = useReview();

  const { here, elsewhere } = useMemo(() => {
    const shown = allPins.filter((p) => showResolved || p.status !== "resolved");
    const here = shown.filter((p) => p.page_path === pathname);
    const grouped = new Map<string, ReviewPin[]>();
    for (const p of shown) {
      if (p.page_path === pathname) continue;
      grouped.set(p.page_path, [...(grouped.get(p.page_path) ?? []), p]);
    }
    return { here, elsewhere: [...grouped.entries()].sort() };
  }, [allPins, pathname, showResolved]);

  return (
    <div
      {...{ [REVIEW_UI_ATTR]: "" }}
      className="fixed bottom-20 right-4 flex max-h-[70vh] w-80 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      style={{ zIndex: Z_BAR }}
    >
      <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          Comments · {allPins.length}
        </p>
        <button
          type="button"
          onClick={() => setPanelOpen(false)}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Close list"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div className="overflow-y-auto p-1.5">
        <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
          This page
        </p>
        {here.length === 0 ? (
          <p className="px-2 pb-2 text-xs text-slate-400">Nothing here yet.</p>
        ) : (
          <ul>
            {here.map((pin, i) => (
              <PinRow
                key={pin.id}
                pin={pin}
                index={i}
                onPick={() => {
                  setOpenPinId(pin.id);
                  setPanelOpen(false);
                }}
              />
            ))}
          </ul>
        )}

        {elsewhere.map(([path, pins]) => (
          <div key={path}>
            <p className="flex items-center justify-between px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {path}
              <Link
                href={path}
                onClick={() => setPanelOpen(false)}
                className="normal-case text-violet-600 hover:underline"
              >
                open
              </Link>
            </p>
            <ul>
              {pins.map((pin, i) => (
                <PinRow key={pin.id} pin={pin} index={i} onPick={() => setPanelOpen(false)} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Toolbar() {
  const {
    phase, commentsOn, setCommentsOn, placing, setPlacing, panelOpen, setPanelOpen,
    showResolved, setShowResolved, pins, allPins, backend, leave, error,
  } = useReview();

  if (phase === "passcode") return <Passcode />;
  if (phase !== "ready") return null;

  const openCount = pins.filter((p) => p.status !== "resolved").length;

  return (
    <>
      {panelOpen && commentsOn && <Panel />}

      <div
        {...{ [REVIEW_UI_ATTR]: "" }}
        className="fixed bottom-4 right-4 flex items-center gap-1 rounded-full border border-slate-200 bg-white/95 p-1 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95"
        style={{ zIndex: Z_BAR }}
      >
        <button
          type="button"
          onClick={() => setCommentsOn(!commentsOn)}
          title={commentsOn ? "Turn commenting off" : "Turn commenting on"}
          className={
            "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
            (commentsOn
              ? "bg-violet-600 text-white"
              : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800")
          }
        >
          {commentsOn ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          Review
          {commentsOn && openCount > 0 && (
            <span className="rounded-full bg-white/25 px-1.5 text-[10px]">{openCount}</span>
          )}
        </button>

        {commentsOn && (
          <>
            <button
              type="button"
              onClick={() => setPlacing(!placing)}
              title="Drop a comment on the page"
              className={
                "rounded-full p-2 " +
                (placing
                  ? "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300"
                  : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800")
              }
            >
              <MessageSquarePlus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setPanelOpen(!panelOpen)}
              title="All comments"
              className="rounded-full p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <ListChecks className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowResolved(!showResolved)}
              title={showResolved ? "Hide resolved" : "Show resolved"}
              className={
                "rounded-full p-2 " +
                (showResolved
                  ? "text-emerald-600"
                  : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800")
              }
            >
              <Check className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void leave()}
              title="Leave review mode on this browser"
              className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {(error || backend === "local") && commentsOn && (
        <p
          {...{ [REVIEW_UI_ATTR]: "" }}
          className="fixed bottom-16 right-4 rounded-lg bg-amber-100 px-2.5 py-1 text-[11px] text-amber-900 shadow dark:bg-amber-950 dark:text-amber-200"
          style={{ zIndex: Z_BAR }}
        >
          {error ?? `Saved on this browser only (${allPins.length}) — no database connected.`}
        </p>
      )}
    </>
  );
}
