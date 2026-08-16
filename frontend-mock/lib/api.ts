/**
 * The app's single data access point.
 *
 * Every screen calls `apiFetch` (usually through `useApi` / `useMutate`), and
 * this module decides where that call actually goes:
 *
 *   NEXT_PUBLIC_DATA_MODE=mock   → lib/mock-data/mock-api.ts, in-browser store
 *   NEXT_PUBLIC_DATA_MODE=live   → the FastAPI backend at NEXT_PUBLIC_API_BASE
 *
 * Keeping both behind one signature is what lets the client demo and the real
 * product ship from the same 45 screens. `mock` stays the default so an
 * unconfigured build is always the safe, self-contained demo.
 */

import { ApiError } from "./api-error";
import { mockDownloadFile, mockFetch, type FetchOpts } from "./mock-data/mock-api";

export { ApiError };
export type { FetchOpts };

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/v1";

export type DataMode = "mock" | "live";

export const DATA_MODE: DataMode =
  process.env.NEXT_PUBLIC_DATA_MODE === "live" ? "live" : "mock";

export const isLive = DATA_MODE === "live";

/* ------------------------------------------------------------------ session */

/**
 * The bearer token lives here rather than being threaded through every call,
 * because `useApi` reads endpoints without knowing about auth. AuthProvider
 * owns it; this module only reads it.
 */
const TOKEN_KEY = "casa_token";
let memoryToken: string | null = null;

const REFRESH_KEY = "casa_refresh_token";

export function setAuthToken(token: string | null): void {
  memoryToken = token;
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function getAuthToken(): string | null {
  if (memoryToken) return memoryToken;
  if (typeof window === "undefined") return null;
  memoryToken = window.localStorage.getItem(TOKEN_KEY);
  return memoryToken;
}

export function setRefreshToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) window.localStorage.setItem(REFRESH_KEY, token);
  else window.localStorage.removeItem(REFRESH_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(REFRESH_KEY);
}

/** Drop both tokens — used on sign-out and when a refresh fails. */
export function clearSessionTokens(): void {
  setAuthToken(null);
  setRefreshToken(null);
}

/**
 * One silent attempt to swap the refresh token for a fresh access token.
 * Returns true only when the server issued new tokens, which the caller then
 * uses to retry the original request.
 */
async function refreshSession(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch(buildUrl("/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
      credentials: "omit",
    });
    if (!res.ok) return false;
    const json = await res.json();
    if (!json?.access_token) return false;
    setAuthToken(json.access_token);
    setRefreshToken(json.refresh_token ?? null);
    return true;
  } catch {
    return false;
  }
}

/** Called when the server rejects our token, so the UI can bounce to /login. */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  onUnauthorized = fn;
}

/**
 * Notified after every successful live write (POST/PATCH/PUT/DELETE), so
 * `useApi()` reads elsewhere on screen can re-fetch. Mirrors mock-data/store's
 * `subscribe`, which does the equivalent job for the in-browser mock store —
 * live mode has no store to hook into, only these HTTP calls.
 */
const writeListeners = new Set<() => void>();

export function subscribeToLiveWrites(fn: () => void): () => void {
  writeListeners.add(fn);
  return () => writeListeners.delete(fn);
}

function notifyLiveWrite(): void {
  writeListeners.forEach((fn) => fn());
}

/* ------------------------------------------------------------ live transport */

function buildUrl(path: string): string {
  const base = API_BASE.replace(/\/$/, "");
  return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

function buildHeaders(opts: FetchOpts, hasBody: boolean): Headers {
  const headers = new Headers();
  if (hasBody) headers.set("Content-Type", "application/json");

  const token = opts.token ?? getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  // The backend selects the active HOA from this header; without it every
  // tenant-scoped query is evaluated against the nil tenant and returns
  // nothing. See backend/app/core/middleware.py.
  if (opts.tenantId) headers.set("X-Tenant-Id", opts.tenantId);

  return headers;
}

/**
 * Turn a FastAPI error body into a message worth showing a user.
 * FastAPI emits `{"detail": "..."}` for HTTPException and
 * `{"detail": [{loc, msg, type}, ...]}` for request validation failures.
 */
function messageFromDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((d: any) => {
        const field = Array.isArray(d?.loc) ? d.loc[d.loc.length - 1] : null;
        return field ? `${field}: ${d?.msg ?? ""}`.trim() : d?.msg;
      })
      .filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  return fallback;
}

async function liveFetch<T>(path: string, opts: FetchOpts, retried = false): Promise<T> {
  const method = (opts.method ?? "GET").toUpperCase();
  const hasBody = opts.body !== undefined && method !== "GET";

  let res: Response;
  try {
    res = await fetch(buildUrl(path), {
      method,
      headers: buildHeaders(opts, hasBody),
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      credentials: "omit",
    });
  } catch {
    // Network-level failure: DNS, CORS preflight rejection, server down.
    throw new ApiError(
      "Could not reach the server. Check that the API is running and that this origin is allowed by BACKEND_CORS_ORIGINS.",
      0
    );
  }

  if (res.status === 401) {
    // Calls carrying an explicit token (e.g. the resident portal's own JWT) are
    // not part of the staff session — leave them to their caller. Everything
    // else gets one silent refresh before the session is torn down, so a user
    // mid-work is not bounced to the sign-in screen by an expired access token.
    const sessionCall = !opts.token;
    if (sessionCall && !retried && (await refreshSession())) {
      return liveFetch<T>(path, opts, true);
    }
    if (sessionCall) {
      clearSessionTokens();
      onUnauthorized?.();
    }
  }

  if (!res.ok) {
    let detail: unknown;
    try {
      detail = (await res.json())?.detail;
    } catch {
      /* non-JSON error body — fall through to the status text */
    }
    throw new ApiError(
      messageFromDetail(detail, res.statusText || `Request failed (${res.status})`),
      res.status,
      detail
    );
  }

  if (method !== "GET") notifyLiveWrite();

  if (res.status === 204) return null as T;

  const text = await res.text();
  if (!text) return null as T;
  return JSON.parse(text) as T;
}

/* -------------------------------------------------------------- public API */

export async function apiFetch<T = unknown>(
  path: string,
  opts: FetchOpts = {}
): Promise<T> {
  return isLive ? liveFetch<T>(path, opts) : mockFetch<T>(path, opts);
}

/** Save a binary export (xlsx/pdf/docx) to disk. */
export async function downloadFile(
  path: string,
  token: string,
  tenantId: string,
  filename: string
): Promise<void> {
  if (!isLive) return mockDownloadFile(path, token, tenantId, filename);

  const res = await fetch(buildUrl(path), {
    method: "GET",
    headers: buildHeaders({ token, tenantId }, false),
    credentials: "omit",
  });

  if (res.status === 401) {
    setAuthToken(null);
    onUnauthorized?.();
  }
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = (await res.json())?.detail;
    } catch {
      /* binary or empty error body */
    }
    throw new ApiError(
      messageFromDetail(detail, `Export failed (${res.status})`),
      res.status,
      detail
    );
  }

  // Prefer the server's own filename when it sends one.
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^\";]+)"?/i.exec(disposition);
  const name = match ? decodeURIComponent(match[1]) : filename;

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadExport(
  structureId: string,
  token: string,
  tenantId: string,
  filename = "chart_of_accounts.xlsx"
): Promise<void> {
  return downloadFile(
    `/coa/structures/${structureId}/export`,
    token,
    tenantId,
    filename
  );
}
