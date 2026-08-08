import "server-only";

import { randomUUID } from "node:crypto";
import { getSql } from "./db";
import type {
  NewMessageInput,
  NewPinInput,
  PinStatus,
  ReviewAttachment,
  ReviewMessage,
  ReviewPin,
} from "./types";

/* Rows come back untyped from postgres.js; these narrow them at the boundary. */
type PinRow = Omit<ReviewPin, "messages" | "created_at" | "resolved_at"> & {
  created_at: Date;
  resolved_at: Date | null;
};
type MessageRow = Omit<ReviewMessage, "attachments" | "created_at"> & { created_at: Date };
type AttachmentRow = ReviewAttachment & { message_id: string; bytes: string | number };

const MAX_BODY = 5000;
const MAX_ATTACHMENTS = 10;

function clean(value: unknown, max: number, fallback = ""): string {
  const s = typeof value === "string" ? value.trim() : "";
  return (s || fallback).slice(0, max);
}

function sanitizeAttachments(input: unknown): Omit<ReviewAttachment, "id">[] {
  if (!Array.isArray(input)) return [];
  return input.slice(0, MAX_ATTACHMENTS).flatMap((raw) => {
    const a = raw as Record<string, unknown>;
    const url = typeof a?.url === "string" ? a.url : "";
    // Only accept what Cloudinary would have returned to us.
    if (!/^https:\/\/res\.cloudinary\.com\//.test(url)) return [];
    const thumb = typeof a.thumb_url === "string" && a.thumb_url.startsWith("https://")
      ? a.thumb_url
      : null;
    return [
      {
        url,
        thumb_url: thumb,
        kind: a.kind === "image" ? ("image" as const) : ("file" as const),
        filename: clean(a.filename, 200, "attachment"),
        bytes: Number.isFinite(Number(a.bytes)) ? Math.max(0, Number(a.bytes)) : 0,
      },
    ];
  });
}

/** Validate the client payload for a new pin. Throws on anything unusable. */
export function parsePinInput(raw: unknown): NewPinInput {
  const b = (raw ?? {}) as Record<string, unknown>;
  const page_path = clean(b.page_path, 300);
  const anchor = clean(b.anchor, 2000);
  if (!page_path.startsWith("/") || !anchor) throw new Error("Missing page or anchor");
  const num = (v: unknown, min: number, max: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
  };
  return {
    page_path,
    anchor,
    anchor_label: clean(b.anchor_label, 200, "Section"),
    x_pct: num(b.x_pct, 0, 1),
    y_pct: num(b.y_pct, 0, 1),
    page_x: num(b.page_x, 0, 1e6),
    page_y: num(b.page_y, 0, 1e6),
    viewport_w: Math.round(num(b.viewport_w, 0, 1e5)),
    author: clean(b.author, 60, "Guest"),
    body: clean(b.body, MAX_BODY),
    attachments: sanitizeAttachments(b.attachments),
  };
}

export function parseMessageInput(raw: unknown): NewMessageInput {
  const b = (raw ?? {}) as Record<string, unknown>;
  const input = {
    author: clean(b.author, 60, "Guest"),
    body: clean(b.body, MAX_BODY),
    attachments: sanitizeAttachments(b.attachments),
  };
  if (!input.body && input.attachments.length === 0) throw new Error("Empty message");
  return input;
}

/** Load pins — every page, or just one route — with their threads attached. */
export async function loadPins(pagePath?: string | null): Promise<ReviewPin[]> {
  const sql = await getSql();
  const pins: PinRow[] = pagePath
    ? await sql`select * from review_pins where page_path = ${pagePath} order by created_at`
    : await sql`select * from review_pins order by created_at`;
  if (pins.length === 0) return [];

  const ids = pins.map((p) => p.id);
  const messages: MessageRow[] =
    await sql`select * from review_messages where pin_id in ${sql(ids)} order by created_at`;
  const msgIds = messages.map((m) => m.id);
  const attachments: AttachmentRow[] = msgIds.length
    ? await sql`select * from review_attachments where message_id in ${sql(msgIds)} order by created_at`
    : [];

  const byMessage = new Map<string, ReviewAttachment[]>();
  for (const a of attachments) {
    const list = byMessage.get(a.message_id) ?? [];
    list.push({
      id: a.id,
      url: a.url,
      thumb_url: a.thumb_url,
      kind: a.kind,
      filename: a.filename,
      bytes: Number(a.bytes) || 0,
    });
    byMessage.set(a.message_id, list);
  }

  const byPin = new Map<string, ReviewMessage[]>();
  for (const m of messages) {
    const list = byPin.get(m.pin_id) ?? [];
    list.push({
      id: m.id,
      pin_id: m.pin_id,
      author: m.author,
      body: m.body,
      created_at: m.created_at.toISOString(),
      attachments: byMessage.get(m.id) ?? [],
    });
    byPin.set(m.pin_id, list);
  }

  return pins.map((p) => ({
    ...p,
    created_at: p.created_at.toISOString(),
    resolved_at: p.resolved_at ? p.resolved_at.toISOString() : null,
    messages: byPin.get(p.id) ?? [],
  }));
}

async function loadOne(id: string): Promise<ReviewPin | null> {
  const sql = await getSql();
  const [row]: { page_path: string }[] =
    await sql`select page_path from review_pins where id = ${id}`;
  if (!row) return null;
  const pins = await loadPins(row.page_path);
  return pins.find((p) => p.id === id) ?? null;
}

async function insertMessage(pinId: string, input: NewMessageInput): Promise<void> {
  const sql = await getSql();
  const messageId = randomUUID();
  await sql`
    insert into review_messages (id, pin_id, author, body)
    values (${messageId}, ${pinId}, ${input.author}, ${input.body})
  `;
  for (const a of input.attachments) {
    await sql`
      insert into review_attachments (id, message_id, url, thumb_url, kind, filename, bytes)
      values (${randomUUID()}, ${messageId}, ${a.url}, ${a.thumb_url}, ${a.kind},
              ${a.filename}, ${a.bytes})
    `;
  }
}

export async function createPin(input: NewPinInput): Promise<ReviewPin> {
  const sql = await getSql();
  const id = randomUUID();
  await sql`
    insert into review_pins
      (id, page_path, anchor, anchor_label, x_pct, y_pct, page_x, page_y, viewport_w, author)
    values
      (${id}, ${input.page_path}, ${input.anchor}, ${input.anchor_label}, ${input.x_pct},
       ${input.y_pct}, ${input.page_x}, ${input.page_y}, ${input.viewport_w}, ${input.author})
  `;
  await insertMessage(id, {
    author: input.author,
    body: input.body,
    attachments: input.attachments,
  });
  const pin = await loadOne(id);
  if (!pin) throw new Error("Pin vanished after insert");
  return pin;
}

export async function addMessage(
  pinId: string,
  input: NewMessageInput
): Promise<ReviewPin | null> {
  const sql = await getSql();
  const [exists]: { id: string }[] = await sql`select id from review_pins where id = ${pinId}`;
  if (!exists) return null;
  await insertMessage(pinId, input);
  return loadOne(pinId);
}

export async function setStatus(
  pinId: string,
  status: PinStatus,
  actor: string
): Promise<ReviewPin | null> {
  const sql = await getSql();
  await sql`
    update review_pins
       set status = ${status},
           resolved_at = ${status === "resolved" ? new Date() : null},
           resolved_by = ${status === "resolved" ? actor.slice(0, 60) : null}
     where id = ${pinId}
  `;
  return loadOne(pinId);
}

export async function deletePin(pinId: string): Promise<void> {
  const sql = await getSql();
  await sql`delete from review_pins where id = ${pinId}`;
}
