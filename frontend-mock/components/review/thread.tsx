"use client";

/**
 * The card that opens off a dot: read the thread, or write the first comment.
 *
 * Deliberately styled apart from the ERP mock — violet, rounded, floating —
 * so nobody reviewing the design mistakes the commenting tool for part of the
 * product.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, Paperclip, RotateCcw, Send, Trash2, X } from "lucide-react";
import { REVIEW_UI_ATTR } from "@/lib/review/anchor";
import { humanSize } from "@/lib/review/cloudinary";
import { uploadFile } from "@/lib/review/client";
import type { ReviewAttachment, ReviewPin } from "@/lib/review/types";
import { useReview, type Draft } from "./provider";

const CARD_W = 360;
const Z_CARD = 2147483100;

type Pending = Omit<ReviewAttachment, "id">;

function shortTime(iso: string): string {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Keep the card on screen next to its dot. */
function useCardPosition(at: { x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({
    left: -9999,
    top: -9999,
    width: CARD_W,
  });

  useEffect(() => {
    const place = () => {
      const h = ref.current?.offsetHeight ?? 320;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const wide = vw > 520;
      const width = wide ? CARD_W : vw - 24;
      const left = wide
        ? Math.min(Math.max(at.x + 22, 12), vw - width - 12)
        : 12;
      const top = Math.min(Math.max(at.y - 24, 12), Math.max(12, vh - h - 12));
      setStyle({ left, top, width });
    };
    place();
    const id = window.setTimeout(place, 0); // re-measure once content lands
    window.addEventListener("resize", place);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", place);
    };
  }, [at.x, at.y]);

  return { ref, style };
}

function AttachmentChips({
  items,
  onRemove,
}: {
  items: Pending[];
  onRemove?: (index: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-2">
      {items.map((a, i) => (
        <div
          key={`${a.url}-${i}`}
          className="group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800"
        >
          {a.kind === "image" ? (
            <a href={a.url} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.thumb_url ?? a.url}
                alt={a.filename}
                className="h-16 w-24 object-cover"
              />
            </a>
          ) : (
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="flex h-16 w-24 flex-col justify-center gap-0.5 px-2 text-[10px] text-slate-600 dark:text-slate-300"
            >
              <Paperclip className="h-3.5 w-3.5" />
              <span className="truncate font-medium">{a.filename}</span>
              <span className="text-slate-400">{humanSize(a.bytes)}</span>
            </a>
          )}
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="absolute right-0.5 top-0.5 hidden rounded-full bg-slate-900/80 p-0.5 text-white group-hover:block"
              aria-label={`Remove ${a.filename}`}
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

/** Text box + attach button, shared by "new comment" and "reply". */
function Composer({
  placeholder,
  submitLabel,
  onSubmit,
  autoFocus,
}: {
  placeholder: string;
  submitLabel: string;
  onSubmit: (body: string, attachments: Pending[]) => Promise<void>;
  autoFocus?: boolean;
}) {
  const { author, setAuthor, busy } = useReview();
  const [body, setBody] = useState("");
  const [name, setName] = useState(author);
  const [items, setItems] = useState<Pending[]>([]);
  const [uploading, setUploading] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const attach = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setProblem(null);
    setUploading((n) => n + files.length);
    for (const file of Array.from(files)) {
      try {
        const uploaded = await uploadFile(file);
        setItems((prev) => [...prev, uploaded]);
      } catch (err) {
        setProblem(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }, []);

  const send = async () => {
    if (!body.trim() && items.length === 0) return;
    if (!author && name.trim()) setAuthor(name);
    try {
      await onSubmit(body.trim(), items);
      setBody("");
      setItems([]);
    } catch {
      /* the provider surfaces the error */
    }
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void attach(e.dataTransfer.files);
      }}
    >
      {!author && (
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          className="mb-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-violet-400 dark:border-slate-700 dark:bg-slate-900"
        />
      )}
      <textarea
        autoFocus={autoFocus}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={3}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void send();
        }}
        className="w-full resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm outline-none focus:border-violet-400 dark:border-slate-700 dark:bg-slate-900"
      />
      <AttachmentChips
        items={items}
        onRemove={(i) => setItems((prev) => prev.filter((_, idx) => idx !== i))}
      />
      {problem && <p className="pt-1.5 text-[11px] text-rose-600">{problem}</p>}
      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          {uploading > 0 ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Paperclip className="h-3.5 w-3.5" />
          )}
          {uploading > 0 ? "Uploading…" : "Attach"}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void attach(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || uploading > 0 || (!body.trim() && items.length === 0)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function Shell({
  at,
  title,
  subtitle,
  onClose,
  actions,
  children,
}: {
  at: { x: number; y: number };
  title: string;
  subtitle?: string;
  onClose: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { ref, style } = useCardPosition(at);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      {...{ [REVIEW_UI_ATTR]: "" }}
      ref={ref}
      style={{ ...style, zIndex: Z_CARD }}
      className="fixed max-h-[75vh] overflow-y-auto rounded-2xl border border-violet-200 bg-white text-slate-900 shadow-2xl dark:border-violet-900/60 dark:bg-slate-900 dark:text-slate-100"
    >
      <header className="flex items-start gap-2 border-b border-slate-100 px-3.5 py-2.5 dark:border-slate-800">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">{title}</p>
          {subtitle && (
            <p className="truncate text-[11px] text-slate-400" title={subtitle}>
              {subtitle}
            </p>
          )}
        </div>
        {actions}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="px-3.5 py-3">{children}</div>
    </div>
  );
}

/** Writing the first comment on a freshly dropped dot. */
export function DraftCard({ draft, at }: { draft: Draft; at: { x: number; y: number } }) {
  const { createPin, setDraft } = useReview();
  return (
    <Shell
      at={at}
      title="New comment"
      subtitle={draft.anchor_label}
      onClose={() => setDraft(null)}
    >
      <Composer
        autoFocus
        placeholder="What should change here?"
        submitLabel="Comment"
        onSubmit={(body, attachments) => createPin({ ...draft, body, attachments })}
      />
    </Shell>
  );
}

/** Reading an existing thread and replying to it. */
export function ThreadCard({ pin, at, index }: { pin: ReviewPin; at: { x: number; y: number }; index: number }) {
  const { reply, toggleResolved, removePin, setOpenPinId } = useReview();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const resolved = pin.status === "resolved";

  return (
    <Shell
      at={at}
      title={`Comment ${index + 1}${resolved ? " · resolved" : ""}`}
      subtitle={pin.anchor_label}
      onClose={() => setOpenPinId(null)}
      actions={
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => void toggleResolved(pin)}
            title={resolved ? "Reopen" : "Mark resolved"}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 dark:hover:bg-slate-800"
          >
            {resolved ? <RotateCcw className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => (confirmDelete ? void removePin(pin.id) : setConfirmDelete(true))}
            title={confirmDelete ? "Click again to delete" : "Delete thread"}
            className={
              "rounded-md p-1 hover:bg-slate-100 dark:hover:bg-slate-800 " +
              (confirmDelete ? "text-rose-600" : "text-slate-400 hover:text-rose-600")
            }
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      }
    >
      <ol className="space-y-3">
        {pin.messages.map((m) => (
          <li key={m.id}>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold">{m.author}</span>
              <span className="text-[10px] text-slate-400">{shortTime(m.created_at)}</span>
            </div>
            {m.body && (
              <p className="whitespace-pre-wrap break-words pt-0.5 text-sm text-slate-700 dark:text-slate-200">
                {m.body}
              </p>
            )}
            <AttachmentChips items={m.attachments} />
          </li>
        ))}
      </ol>
      <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
        <Composer
          placeholder="Reply…"
          submitLabel="Reply"
          onSubmit={(body, attachments) => reply(pin.id, body, attachments)}
        />
      </div>
    </Shell>
  );
}
