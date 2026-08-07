/**
 * In-memory demo store.
 *
 * The original mock returned the same fixed payload for every request, so
 * nothing could be created or changed. This holds a mutable copy of the seed
 * per community, persists it to localStorage so a demo survives a refresh,
 * and notifies subscribers when anything changes.
 */

import { DATA, TENANTS, type TenantData } from "./seed";

const LS_KEY = "casa_demo_store_v1";

type Store = Record<string, TenantData>;

let store: Store | null = null;
const listeners = new Set<() => void>();

function fresh(): Store {
  return JSON.parse(JSON.stringify(DATA));
}

function load(): Store {
  if (typeof window === "undefined") return fresh();
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      // Guard against a stale shape from an older build.
      if (parsed && TENANTS.every((t) => parsed[t.id]?.tickets)) return parsed;
    }
  } catch {
    /* fall through to a fresh copy */
  }
  return fresh();
}

function persist() {
  if (typeof window === "undefined" || !store) return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch {
    /* quota — the demo still works in memory */
  }
}

export function getStore(): Store {
  if (!store) store = load();
  return store;
}

export function tenantData(tenantId: string | null | undefined): TenantData {
  const s = getStore();
  return s[tenantId ?? TENANTS[0].id] ?? s[TENANTS[0].id];
}

export function commit() {
  persist();
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Wipe every change and return to the pristine demo dataset. */
export function resetStore() {
  store = fresh();
  persist();
  listeners.forEach((fn) => fn());
}

/* --------------------------------------------------------------- utilities */

let counter = 0;
export function nextId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Push a notification into a community's inbox.
 *
 * This is what makes "assign a ticket and watch it land in the other user's
 * inbox" work live in the demo, with no server involved.
 */
export function pushNotification(
  tenantId: string,
  n: {
    category: string;
    message: string;
    entity_type?: string;
    entity_id?: string | null;
    recipient_role_code?: string | null;
  }
) {
  const d = tenantData(tenantId);
  d.notifications.unshift({
    id: nextId("notif"),
    category: n.category,
    message: n.message,
    entity_type: n.entity_type ?? null,
    entity_id: n.entity_id ?? null,
    recipient_role_code: n.recipient_role_code ?? null,
    is_read: false,
    created_at: nowIso(),
  });
}
