"use client";

/**
 * The assistant: a scripted conversation that narrows to one guide.
 *
 * It reads as a chat because that is the interaction people already know, but
 * every question and every answer is authored (see `lib/guide/registry.ts`).
 * Nothing here can invent a procedure, which is the point — in a system that
 * posts to a ledger, a plausible-sounding wrong answer is worse than no answer.
 */

import { useMemo, useState } from "react";
import {
  Check, HelpCircle, MessageSquare, PlayCircle, RotateCcw, TriangleAlert, X,
} from "lucide-react";
import { Badge, Button } from "@/components/ui";
import {
  CHAT_ROOT,
  CHAT_TREE,
  guidesByCategory,
  guidesFor,
  unmetPrerequisites,
} from "@/lib/guide/registry";
import type { Guide } from "@/lib/guide/types";
import { useAuth } from "@/app/providers";
import { useGuide } from "./GuideProvider";

interface Turn {
  question: string;
  answer: string;
}

export function GuidePanel() {
  const { panelOpen, closePanel, start, completed } = useGuide();
  const { can } = useAuth();
  const [nodeId, setNodeId] = useState(CHAT_ROOT);
  const [trail, setTrail] = useState<Turn[]>([]);
  const [suggested, setSuggested] = useState<Guide | null>(null);

  const available = useMemo(() => guidesFor(can), [can]);
  const byCategory = useMemo(() => guidesByCategory(can), [can]);
  const node = CHAT_TREE[nodeId];
  const missing = suggested ? unmetPrerequisites(suggested, completed) : [];

  function reset() {
    setNodeId(CHAT_ROOT);
    setTrail([]);
    setSuggested(null);
  }

  function choose(label: string, next?: string, guideId?: string) {
    setTrail((t) => [...t, { question: node.prompt, answer: label }]);
    if (guideId) {
      const g = available.find((x) => x.id === guideId);
      // Offered but not permitted shouldn't happen (the tree is filtered), but
      // failing closed beats walking somebody into a 403.
      setSuggested(g ?? null);
      if (!g) setNodeId("not-permitted");
      return;
    }
    if (next) setNodeId(next);
  }

  if (!panelOpen) return null;

  return (
    <div className="fixed inset-0 z-[190] flex justify-end">
      <div
        className="absolute inset-0 bg-foreground/30 backdrop-blur-sm"
        onClick={closePanel}
      />
      <aside className="relative flex h-full w-full max-w-[420px] flex-col border-l bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
              <MessageSquare className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold">Show me how</h2>
              <p className="text-2xs text-muted-foreground">
                Answer a couple of questions and it will walk you through it
              </p>
            </div>
          </div>
          <button
            onClick={closePanel}
            aria-label="Close"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto scroll-thin px-5 py-4">
          {/* what has been asked and answered so far */}
          {trail.map((t, i) => (
            <div key={i} className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t.question}</p>
              <p className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground">
                {t.answer}
              </p>
            </div>
          ))}

          {suggested ? (
            <div className="rounded-xl border bg-accent/30 p-4">
              <p className="text-xs text-muted-foreground">
                Here is the walkthrough for that:
              </p>
              <h3 className="mt-1.5 text-sm font-semibold">{suggested.title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {suggested.summary}
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <Badge tone="neutral">{suggested.category}</Badge>
                <span className="text-2xs text-muted-foreground">
                  about {suggested.estimatedMinutes} min
                </span>
                {completed.includes(suggested.id) && (
                  <span className="flex items-center gap-1 text-2xs text-success">
                    <Check className="h-3 w-3" /> done before
                  </span>
                )}
              </div>

              {/* Surfaced, never enforced — the reader may well have done the
                  prerequisite outside the guide, and blocking them on that
                  would be worse than a warning they can read and dismiss. */}
              {missing.length > 0 && (
                <div className="mt-3 rounded-lg border border-warning/40 bg-warning/8 p-2.5">
                  <p className="flex items-center gap-1.5 text-2xs font-semibold text-warning">
                    <TriangleAlert className="h-3 w-3" />
                    Usually done first
                  </p>
                  <div className="mt-1.5 space-y-1">
                    {missing.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setSuggested(p)}
                        className="block w-full text-left text-2xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {p.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <Button
                className="mt-3.5 w-full"
                onClick={() => start(suggested.id)}
              >
                <PlayCircle className="h-4 w-4" />
                Start walkthrough
              </Button>
              <button
                onClick={reset}
                className="mt-2 w-full text-center text-2xs text-muted-foreground hover:text-foreground"
              >
                Ask something else
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-sm">{node.prompt}</p>
              <div className="space-y-1.5">
                {node.choices.map((c) => (
                  <button
                    key={c.label}
                    onClick={() => choose(c.label, c.next, c.guideId)}
                    className="w-full rounded-lg border px-3 py-2.5 text-left text-xs font-medium transition-colors hover:border-primary/50 hover:bg-accent/40"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* every guide this person is allowed to run, for people who would
            rather scan a list than answer questions */}
        <footer className="border-t px-5 py-3.5">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
              All walkthroughs ({available.length})
            </p>
            {trail.length > 0 && (
              <button
                onClick={reset}
                className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="h-3 w-3" />
                Start again
              </button>
            )}
          </div>
          <div className="max-h-56 space-y-2 overflow-y-auto scroll-thin">
            {Array.from(byCategory.entries()).map(([category, guides]) => (
              <div key={category}>
                <p className="px-2 pb-0.5 pt-1 text-2xs font-medium text-muted-foreground/70">
                  {category}
                </p>
                {guides.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => start(g.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent/50"
                  >
                    {completed.includes(g.id) ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                    ) : (
                      <PlayCircle className="h-3.5 w-3.5 shrink-0 text-primary" />
                    )}
                    <span className="truncate">{g.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </footer>
      </aside>
    </div>
  );
}

/** Floating entry point, present on every screen. */
export function GuideLauncher() {
  const { openPanel, guide } = useGuide();
  if (guide) return null; // a walkthrough is already running

  return (
    <button
      onClick={openPanel}
      className="fixed bottom-5 right-5 z-[80] flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg transition-transform hover:scale-105"
    >
      <HelpCircle className="h-4 w-4" />
      Show me how
    </button>
  );
}
