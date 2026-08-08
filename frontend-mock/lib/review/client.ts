"use client";

import { thumbnailUrl } from "./cloudinary";
import type {
  NewMessageInput,
  NewPinInput,
  PinStatus,
  ReviewAttachment,
  ReviewBackend,
  ReviewPin,
} from "./types";

/**
 * Browser-side data access for review comments.
 *
 * Two backends behind one interface. `remote` talks to the API routes and
 * lands in Postgres — that is the real thing. `local` keeps everything in
 * localStorage and is what runs before a DATABASE_URL exists, so the feature
 * can be demoed and reviewed on a laptop with no infrastructure at all.
 */

const LOCAL_KEY = "casa_review_local_v1";
const MAX_LOCAL_ATTACHMENT = 1.5 * 1024 * 1024; // data URLs bloat localStorage fast

export interface ReviewStatus {
  configured: boolean;
  unlocked: boolean;
  storage: ReviewBackend;
  uploads: boolean;
}

export async function fetchStatus(): Promise<ReviewStatus> {
  const res = await fetch("/api/review/unlock", { cache: "no-store" });
  if (!res.ok) throw new Error("status-failed");
  return (await res.json()) as ReviewStatus;
}

export async function unlock(key: string): Promise<ReviewStatus> {
  const res = await fetch("/api/review/unlock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key }),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<ReviewStatus> & { error?: string };
  if (!res.ok) throw new Error(data.error || "unlock-failed");
  return {
    configured: true,
    unlocked: true,
    storage: data.storage ?? "local",
    uploads: !!data.uploads,
  };
}

export async function lock(): Promise<void> {
  await fetch("/api/review/unlock", { method: "DELETE" });
}

/* ------------------------------------------------------------- local store */

function readLocal(): ReviewPin[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const parsed = raw ? (JSON.parse(raw) as ReviewPin[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLocal(pins: ReviewPin[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(pins));
  } catch {
    /* quota — the session still works until reload */
  }
}

const localId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function withIds(attachments: Omit<ReviewAttachment, "id">[]): ReviewAttachment[] {
  return attachments.map((a) => ({ ...a, id: localId() }));
}

/* ----------------------------------------------------------------- reading */

export async function listPins(
  backend: ReviewBackend,
  pagePath?: string | null
): Promise<ReviewPin[]> {
  if (backend === "local") {
    const all = readLocal();
    return pagePath ? all.filter((p) => p.page_path === pagePath) : all;
  }
  const qs = pagePath ? `?path=${encodeURIComponent(pagePath)}` : "";
  const res = await fetch(`/api/review/pins${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as { pins: ReviewPin[] };
  return data.pins ?? [];
}

/* ----------------------------------------------------------------- writing */

export async function createPin(
  backend: ReviewBackend,
  input: NewPinInput
): Promise<ReviewPin> {
  if (backend === "local") {
    const now = new Date().toISOString();
    const id = localId();
    const pin: ReviewPin = {
      id,
      page_path: input.page_path,
      anchor: input.anchor,
      anchor_label: input.anchor_label,
      x_pct: input.x_pct,
      y_pct: input.y_pct,
      page_x: input.page_x,
      page_y: input.page_y,
      viewport_w: input.viewport_w,
      status: "open",
      author: input.author,
      created_at: now,
      resolved_at: null,
      resolved_by: null,
      messages: [
        {
          id: localId(),
          pin_id: id,
          author: input.author,
          body: input.body,
          created_at: now,
          attachments: withIds(input.attachments),
        },
      ],
    };
    writeLocal([...readLocal(), pin]);
    return pin;
  }

  const res = await fetch("/api/review/pins", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as { pin: ReviewPin }).pin;
}

export async function addMessage(
  backend: ReviewBackend,
  pinId: string,
  input: NewMessageInput
): Promise<ReviewPin> {
  if (backend === "local") {
    const pins = readLocal();
    const pin = pins.find((p) => p.id === pinId);
    if (!pin) throw new Error("not-found");
    pin.messages.push({
      id: localId(),
      pin_id: pinId,
      author: input.author,
      body: input.body,
      created_at: new Date().toISOString(),
      attachments: withIds(input.attachments),
    });
    writeLocal(pins);
    return pin;
  }

  const res = await fetch(`/api/review/pins/${pinId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as { pin: ReviewPin }).pin;
}

export async function setStatus(
  backend: ReviewBackend,
  pinId: string,
  status: PinStatus,
  actor: string
): Promise<ReviewPin> {
  if (backend === "local") {
    const pins = readLocal();
    const pin = pins.find((p) => p.id === pinId);
    if (!pin) throw new Error("not-found");
    pin.status = status;
    pin.resolved_at = status === "resolved" ? new Date().toISOString() : null;
    pin.resolved_by = status === "resolved" ? actor : null;
    writeLocal(pins);
    return pin;
  }

  const res = await fetch(`/api/review/pins/${pinId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, actor }),
  });
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as { pin: ReviewPin }).pin;
}

export async function deletePin(backend: ReviewBackend, pinId: string): Promise<void> {
  if (backend === "local") {
    writeLocal(readLocal().filter((p) => p.id !== pinId));
    return;
  }
  const res = await fetch(`/api/review/pins/${pinId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(String(res.status));
}

/* --------------------------------------------------------------- uploading */

interface UploadTicket {
  cloudName: string;
  apiKey: string;
  folder: string;
  timestamp: number;
  signature: string;
  endpoint: string;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("read-failed"));
    reader.readAsDataURL(file);
  });
}

/**
 * Send one file to Cloudinary and describe it for the thread.
 *
 * Without Cloudinary credentials small images are inlined as data URLs so the
 * flow still works end to end; anything larger is rejected with a clear reason
 * rather than silently blowing the localStorage quota.
 */
export async function uploadFile(file: File): Promise<Omit<ReviewAttachment, "id">> {
  const ticketRes = await fetch("/api/review/upload", { method: "POST" });

  if (ticketRes.status === 503) {
    if (!file.type.startsWith("image/")) {
      throw new Error("Connect Cloudinary to attach files other than images.");
    }
    if (file.size > MAX_LOCAL_ATTACHMENT) {
      throw new Error("Connect Cloudinary to attach files larger than 1.5 MB.");
    }
    return {
      url: await readAsDataUrl(file),
      thumb_url: null,
      kind: "image",
      filename: file.name,
      bytes: file.size,
    };
  }
  if (!ticketRes.ok) throw new Error("Upload is unavailable right now.");

  const ticket = (await ticketRes.json()) as UploadTicket;
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", ticket.apiKey);
  form.append("timestamp", String(ticket.timestamp));
  form.append("folder", ticket.folder);
  form.append("signature", ticket.signature);

  const res = await fetch(ticket.endpoint, { method: "POST", body: form });
  if (!res.ok) throw new Error("Cloudinary rejected the upload.");
  const data = (await res.json()) as {
    secure_url: string;
    resource_type: string;
    bytes: number;
  };
  const kind = data.resource_type === "image" ? "image" : "file";
  return {
    url: data.secure_url,
    thumb_url: kind === "image" ? thumbnailUrl(data.secure_url) : null,
    kind,
    filename: file.name,
    bytes: data.bytes ?? file.size,
  };
}
