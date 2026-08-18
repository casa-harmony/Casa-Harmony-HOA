"use client";

/**
 * Runs a guide across the real application.
 *
 * The awkward part of a cross-screen walkthrough is that the thing you want to
 * point at usually does not exist yet at the moment you decide to point at it:
 * the route has to change, the page has to mount, `useApi` has to come back,
 * and only then does the button appear. So each step resolves in a small
 * sequence — navigate, wait for the element, then highlight — with a timeout so
 * a missing target degrades into a readable message instead of a dead overlay.
 *
 * Branches are resolved when the step is reached rather than when the guide is
 * authored, because the whole point is to react to what is actually in this
 * community's database right now.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/app/providers";
import { apiFetch } from "@/lib/api";
import { getGuide } from "@/lib/guide/registry";
import type { Guide, GuideStep } from "@/lib/guide/types";

/** Survives the navigations a guide performs; deliberately not localStorage. */
const SESSION_KEY = "casa_guide_progress_v1";

interface GuideState {
  guide: Guide | null;
  /** Steps with every branch already resolved and spliced in. */
  steps: GuideStep[];
  index: number;
  /** Element the current step points at, once it has been found. */
  targetEl: HTMLElement | null;
  /** True while navigating, resolving a branch, or waiting for the target. */
  resolving: boolean;
  /** Set when a target never turned up — the step still shows, just unanchored. */
  targetMissing: boolean;
  panelOpen: boolean;
}

interface GuideApi extends GuideState {
  start: (guideId: string) => void;
  next: () => void;
  back: () => void;
  stop: () => void;
  openPanel: () => void;
  closePanel: () => void;
}

const Ctx = createContext<GuideApi | null>(null);

export function useGuide(): GuideApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useGuide must be used inside GuideProvider");
  return ctx;
}

/** Poll for an element, because React may not have painted it yet. */
function waitForElement(selector: string, timeoutMs = 8000): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const found = document.querySelector<HTMLElement>(selector);
    if (found?.offsetParent !== null && found) return resolve(found);

    const started = Date.now();
    const tick = window.setInterval(() => {
      const el = document.querySelector<HTMLElement>(selector);
      // offsetParent is null for display:none — a mounted-but-hidden modal field.
      if (el && el.offsetParent !== null) {
        window.clearInterval(tick);
        resolve(el);
      } else if (Date.now() - started > timeoutMs) {
        window.clearInterval(tick);
        resolve(null);
      }
    }, 120);
  });
}

export function GuideProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { can, activeTenantId } = useAuth();

  const [guide, setGuide] = useState<Guide | null>(null);
  const [steps, setSteps] = useState<GuideStep[]>([]);
  const [index, setIndex] = useState(0);
  const [targetEl, setTargetEl] = useState<HTMLElement | null>(null);
  const [resolving, setResolving] = useState(false);
  const [targetMissing, setTargetMissing] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  /** Guards against a slow step resolution landing after the user moved on. */
  const runToken = useRef(0);

  const ctxForBranch = useMemo(
    () => ({
      can,
      activeTenantId,
      async read<T>(path: string): Promise<T | null> {
        try {
          return await apiFetch<T>(path, { tenantId: activeTenantId ?? undefined });
        } catch {
          // A branch must never break the guide; unknown state falls through
          // to the option the author treated as the safe default.
          return null;
        }
      },
    }),
    [can, activeTenantId]
  );

  /* ---------------------------------------------------------- persistence */

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { guideId: string; index: number };
      const g = getGuide(saved.guideId);
      if (!g) return;
      setGuide(g);
      setSteps(g.steps);
      setIndex(saved.index);
    } catch {
      /* nothing worth recovering */
    }
  }, []);

  useEffect(() => {
    if (!guide) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ guideId: guide.id, index })
    );
  }, [guide, index]);

  /* ------------------------------------------------------- step resolution */

  const step: GuideStep | null = steps[index] ?? null;

  useEffect(() => {
    if (!guide || !step) return;

    const token = ++runToken.current;
    let cancelled = false;
    setResolving(true);
    setTargetMissing(false);
    setTargetEl(null);

    (async () => {
      // 1. A branch rewrites the remainder of the guide before anything else.
      if (step.branch) {
        let key: string;
        try {
          key = await step.branch.decide(ctxForBranch);
        } catch {
          key = Object.keys(step.branch.options)[0];
        }
        if (cancelled || token !== runToken.current) return;

        const chosen = step.branch.options[key] ?? [];
        const { branch: _dropped, ...bare } = step;
        setSteps((prev) => [
          ...prev.slice(0, index),
          bare,
          ...chosen,
          ...prev.slice(index + 1),
        ]);
        // The spliced-in copy of this step has no branch, so the effect reruns
        // once and then proceeds down the navigate/highlight path below.
        return;
      }

      // 2. Get onto the right screen.
      if (step.route && step.route !== pathname) {
        router.push(step.route);
        return; // pathname change reruns this effect
      }

      // 3. Narration step — nothing to anchor to.
      if (!step.target) {
        if (!cancelled && token === runToken.current) setResolving(false);
        return;
      }

      // 4. Wait for the control to exist.
      const el = await waitForElement(step.target);
      if (cancelled || token !== runToken.current) return;

      if (!el) {
        setTargetMissing(true);
        setResolving(false);
        return;
      }

      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTargetEl(el);
      setResolving(false);

      if (step.prefill) {
        const field = el as HTMLInputElement;
        if ("value" in field && !field.value) {
          field.focus();
          field.placeholder = step.prefill;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [guide, step, index, pathname, router, ctxForBranch]);

  /* --------------------------------------- let the reader's own click pass */

  useEffect(() => {
    if (!step || step.advanceOn !== "click" || !targetEl) return;
    const onClick = () => setIndex((i) => Math.min(i + 1, steps.length - 1));
    targetEl.addEventListener("click", onClick, { once: true });
    return () => targetEl.removeEventListener("click", onClick);
  }, [step, targetEl, steps.length]);

  /* ------------------------------------------------------------------ api */

  const start = useCallback((guideId: string) => {
    const g = getGuide(guideId);
    if (!g) return;
    setGuide(g);
    setSteps(g.steps);
    setIndex(0);
    setPanelOpen(false);
  }, []);

  const stop = useCallback(() => {
    runToken.current++;
    setGuide(null);
    setSteps([]);
    setIndex(0);
    setTargetEl(null);
    setResolving(false);
    setTargetMissing(false);
  }, []);

  const next = useCallback(() => {
    setIndex((i) => {
      if (i >= steps.length - 1) {
        // Finished — tear down on the next tick so the UI can settle.
        setTimeout(() => stop(), 0);
        return i;
      }
      return i + 1;
    });
  }, [steps.length, stop]);

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  const value: GuideApi = {
    guide,
    steps,
    index,
    targetEl,
    resolving,
    targetMissing,
    panelOpen,
    start,
    next,
    back,
    stop,
    openPanel: () => setPanelOpen(true),
    closePanel: () => setPanelOpen(false),
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
