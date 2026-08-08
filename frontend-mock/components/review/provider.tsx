"use client";

/**
 * Review mode state.
 *
 * The layer is dormant until someone arrives with the passcode — no requests,
 * no UI, nothing in the DOM. That is what keeps the deployed mock an ordinary
 * website for everyone else.
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
import { usePathname } from "next/navigation";
import * as api from "@/lib/review/client";
import type { NewPinInput, ReviewBackend, ReviewPin } from "@/lib/review/types";

type Phase = "dormant" | "checking" | "passcode" | "ready";

/** A spot chosen on the page, waiting for the client to write something. */
export interface Draft {
  anchor: string;
  anchor_label: string;
  x_pct: number;
  y_pct: number;
  page_x: number;
  page_y: number;
  viewport_w: number;
}

interface ReviewState {
  phase: Phase;
  backend: ReviewBackend;
  uploads: boolean;
  error: string | null;
  busy: boolean;

  /** Pins on the current route. */
  pins: ReviewPin[];
  /** Every pin in the project, for the "all comments" list. */
  allPins: ReviewPin[];
  pathname: string;

  /** Master switch inside review mode — off means the plain site. */
  commentsOn: boolean;
  showResolved: boolean;
  placing: boolean;
  draft: Draft | null;
  openPinId: string | null;
  panelOpen: boolean;
  author: string;

  setCommentsOn: (on: boolean) => void;
  setShowResolved: (on: boolean) => void;
  setPlacing: (on: boolean) => void;
  setDraft: (draft: Draft | null) => void;
  setOpenPinId: (id: string | null) => void;
  setPanelOpen: (open: boolean) => void;
  setAuthor: (name: string) => void;

  submitPasscode: (key: string) => Promise<boolean>;
  createPin: (input: Omit<NewPinInput, "page_path" | "author">) => Promise<void>;
  reply: (pinId: string, body: string, attachments: NewPinInput["attachments"]) => Promise<void>;
  toggleResolved: (pin: ReviewPin) => Promise<void>;
  removePin: (pinId: string) => Promise<void>;
  refresh: () => Promise<void>;
  leave: () => Promise<void>;
}

const Ctx = createContext<ReviewState | null>(null);

const ENROLLED_KEY = "casa_review_on_v1";
const AUTHOR_KEY = "casa_review_author_v1";
const COMMENTS_KEY = "casa_review_visible_v1";

export function ReviewProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/";
  const [phase, setPhase] = useState<Phase>("dormant");
  const [backend, setBackend] = useState<ReviewBackend>("local");
  const [uploads, setUploads] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [allPins, setAllPins] = useState<ReviewPin[]>([]);
  const [commentsOn, setCommentsOnState] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openPinId, setOpenPinId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [author, setAuthorState] = useState("");

  const backendRef = useRef(backend);
  backendRef.current = backend;

  // The name is often set in the same click that posts the first comment, so
  // reads go through a ref — state would still be empty at that point.
  const authorRef = useRef(author);
  authorRef.current = author;

  /* ---------------------------------------------------------- bootstrapping */

  useEffect(() => {
    let cancelled = false;

    const stored = localStorage.getItem(AUTHOR_KEY);
    if (stored) setAuthorState(stored);
    setCommentsOnState(localStorage.getItem(COMMENTS_KEY) !== "0");

    const params = new URLSearchParams(window.location.search);
    const hasParam = params.has("review");
    const paramValue = params.get("review") ?? "";
    const enrolled = localStorage.getItem(ENROLLED_KEY) === "1";

    if (!hasParam && !enrolled) return; // stay invisible

    const stripParam = () => {
      params.delete("review");
      const qs = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash
      );
    };

    setPhase("checking");
    (async () => {
      try {
        const status = await api.fetchStatus();
        if (cancelled) return;
        if (!status.configured) {
          localStorage.removeItem(ENROLLED_KEY);
          setPhase("dormant");
          return;
        }
        if (status.unlocked) {
          setBackend(status.storage);
          setUploads(status.uploads);
          localStorage.setItem(ENROLLED_KEY, "1");
          setPhase("ready");
          if (hasParam) stripParam();
          return;
        }
        // Not unlocked. A passcode in the link unlocks straight away.
        if (paramValue && paramValue !== "1" && paramValue !== "on") {
          try {
            const next = await api.unlock(paramValue);
            if (cancelled) return;
            setBackend(next.storage);
            setUploads(next.uploads);
            localStorage.setItem(ENROLLED_KEY, "1");
            setPhase("ready");
            stripParam();
            return;
          } catch {
            /* fall through to the prompt */
          }
        }
        if (hasParam) {
          stripParam();
          setPhase("passcode");
        } else {
          localStorage.removeItem(ENROLLED_KEY);
          setPhase("dormant");
        }
      } catch {
        if (!cancelled) setPhase("dormant");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------------------------------------------------ pins */

  const refresh = useCallback(async () => {
    if (phase !== "ready") return;
    try {
      const pins = await api.listPins(backendRef.current, null);
      setAllPins(pins);
      setError(null);
    } catch (err) {
      const code = err instanceof Error ? err.message : "";
      if (code === "401") {
        localStorage.removeItem(ENROLLED_KEY);
        setPhase("passcode");
      } else if (code === "503") {
        // No database configured — keep working against localStorage.
        setBackend("local");
        setAllPins(await api.listPins("local", null));
      } else {
        setError("Could not load comments.");
      }
    }
  }, [phase]);

  useEffect(() => {
    void refresh();
  }, [refresh, backend]);

  const pins = useMemo(
    () => allPins.filter((p) => p.page_path === pathname),
    [allPins, pathname]
  );

  // Close anything transient when the route changes.
  useEffect(() => {
    setOpenPinId(null);
    setDraft(null);
    setPlacing(false);
  }, [pathname]);

  /* --------------------------------------------------------------- actions */

  const setAuthor = useCallback((name: string) => {
    const trimmed = name.trim().slice(0, 60);
    authorRef.current = trimmed;
    setAuthorState(trimmed);
    localStorage.setItem(AUTHOR_KEY, trimmed);
  }, []);

  const setCommentsOn = useCallback((on: boolean) => {
    setCommentsOnState(on);
    localStorage.setItem(COMMENTS_KEY, on ? "1" : "0");
    if (!on) {
      setPlacing(false);
      setDraft(null);
      setOpenPinId(null);
    }
  }, []);

  const submitPasscode = useCallback(async (key: string) => {
    setBusy(true);
    setError(null);
    try {
      const status = await api.unlock(key);
      setBackend(status.storage);
      setUploads(status.uploads);
      localStorage.setItem(ENROLLED_KEY, "1");
      setPhase("ready");
      return true;
    } catch {
      setError("That passcode is not right.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  /** Optimistically fold a server response back into the list. */
  const upsert = useCallback((pin: ReviewPin) => {
    setAllPins((prev) => {
      const idx = prev.findIndex((p) => p.id === pin.id);
      if (idx === -1) return [...prev, pin];
      const next = [...prev];
      next[idx] = pin;
      return next;
    });
  }, []);

  const createPin = useCallback(
    async (input: Omit<NewPinInput, "page_path" | "author">) => {
      setBusy(true);
      try {
        const pin = await api.createPin(backendRef.current, {
          ...input,
          page_path: pathname,
          author: authorRef.current || "Guest",
        });
        upsert(pin);
        setDraft(null);
        setOpenPinId(pin.id);
        setError(null);
      } catch {
        setError("Could not save that comment.");
        throw new Error("create-failed");
      } finally {
        setBusy(false);
      }
    },
    [pathname, upsert]
  );

  const reply = useCallback(
    async (pinId: string, body: string, attachments: NewPinInput["attachments"]) => {
      setBusy(true);
      try {
        const pin = await api.addMessage(backendRef.current, pinId, {
          author: authorRef.current || "Guest",
          body,
          attachments,
        });
        upsert(pin);
        setError(null);
      } catch {
        setError("Could not post that reply.");
        throw new Error("reply-failed");
      } finally {
        setBusy(false);
      }
    },
    [upsert]
  );

  const toggleResolved = useCallback(
    async (pin: ReviewPin) => {
      const next = pin.status === "resolved" ? "open" : "resolved";
      try {
        upsert(await api.setStatus(backendRef.current, pin.id, next, authorRef.current || "Guest"));
      } catch {
        setError("Could not update that comment.");
      }
    },
    [upsert]
  );

  const removePin = useCallback(async (pinId: string) => {
    try {
      await api.deletePin(backendRef.current, pinId);
      setAllPins((prev) => prev.filter((p) => p.id !== pinId));
      setOpenPinId(null);
    } catch {
      setError("Could not delete that comment.");
    }
  }, []);

  const leave = useCallback(async () => {
    await api.lock().catch(() => {});
    localStorage.removeItem(ENROLLED_KEY);
    setPhase("dormant");
    setAllPins([]);
  }, []);

  const value = useMemo<ReviewState>(
    () => ({
      phase,
      backend,
      uploads,
      error,
      busy,
      pins,
      allPins,
      pathname,
      commentsOn,
      showResolved,
      placing,
      draft,
      openPinId,
      panelOpen,
      author,
      setCommentsOn,
      setShowResolved,
      setPlacing,
      setDraft,
      setOpenPinId,
      setPanelOpen,
      setAuthor,
      submitPasscode,
      createPin,
      reply,
      toggleResolved,
      removePin,
      refresh,
      leave,
    }),
    [
      phase, backend, uploads, error, busy, pins, allPins, pathname, commentsOn,
      showResolved, placing, draft, openPinId, panelOpen, author, setCommentsOn,
      setAuthor, submitPasscode, createPin, reply, toggleResolved, removePin,
      refresh, leave,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useReview(): ReviewState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useReview must be used inside ReviewProvider");
  return ctx;
}
