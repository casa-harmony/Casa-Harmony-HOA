/**
 * Review mode — the shapes shared between the browser and the API routes.
 *
 * A "pin" is one dot dropped on the page. It owns a thread of messages, and
 * each message can carry attachments. Nothing here is part of the ERP demo
 * data; review comments live in their own tables so the mock stays disposable.
 */

export type PinStatus = "open" | "resolved";

export interface ReviewAttachment {
  id: string;
  url: string;
  thumb_url: string | null;
  kind: "image" | "file";
  filename: string;
  bytes: number;
}

export interface ReviewMessage {
  id: string;
  pin_id: string;
  author: string;
  body: string;
  created_at: string;
  attachments: ReviewAttachment[];
}

export interface ReviewPin {
  id: string;
  page_path: string;
  /** CSS path back to the element the dot was dropped on. */
  anchor: string;
  /** Human hint ("Card · Cash on hand") shown when the anchor no longer exists. */
  anchor_label: string;
  /** Where inside the anchor's box the dot sits, 0–1. */
  x_pct: number;
  y_pct: number;
  /** Document coordinates at drop time — the fallback when the anchor is gone. */
  page_x: number;
  page_y: number;
  viewport_w: number;
  status: PinStatus;
  author: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  messages: ReviewMessage[];
}

/** Payload for creating a pin together with its opening message. */
export interface NewPinInput {
  page_path: string;
  anchor: string;
  anchor_label: string;
  x_pct: number;
  y_pct: number;
  page_x: number;
  page_y: number;
  viewport_w: number;
  author: string;
  body: string;
  attachments: Omit<ReviewAttachment, "id">[];
}

export interface NewMessageInput {
  author: string;
  body: string;
  attachments: Omit<ReviewAttachment, "id">[];
}

/** Where comments are being read from and written to. */
export type ReviewBackend = "remote" | "local";
