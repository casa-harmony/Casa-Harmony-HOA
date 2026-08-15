/**
 * Real-backend portal authentication for homeowners (NEXT_PUBLIC_DATA_MODE=live).
 *
 * The portal is a separate identity domain from the staff app: residents log in
 * with slug + username + password (plus an email/SMS one-time code when MFA is
 * on) and receive a scoped `resident` JWT. That token is stored here under its
 * own key (`casa_portal_token`) so it never collides with the staff token, and
 * it is what every /portal/* call sends as the bearer token — the backend binds
 * RLS to the resident's HOA from the token itself, so no X-Tenant-Id is needed.
 *
 * Shapes mirror backend/app/schemas/resident.py; if that file changes, this one
 * must too.
 */

import { API_BASE, ApiError } from "./api";

export const PORTAL_TOKEN_KEY = "casa_portal_token";

export function getPortalToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(PORTAL_TOKEN_KEY);
}

export async function portalCommunities() {
  const res = await fetch(`${API_BASE}/portal/communities`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to load communities: ${res.statusText}`);
  }
  return res.json();
}

export function setPortalToken(token: string): void {
  window.localStorage.setItem(PORTAL_TOKEN_KEY, token);
}

export function clearPortalToken(): void {
  window.localStorage.removeItem(PORTAL_TOKEN_KEY);
}

export interface PortalResident {
  id: string;
  username: string;
  full_name: string | null;
  resident_type: string;
  must_change_password: boolean;
}

export interface PortalLoginResult {
  mfa_required: boolean;
  access_token?: string;
  challenge_id?: string;
  channel?: string;
  destination_masked?: string;
  resident?: PortalResident;
}

export interface PortalTokenResult {
  access_token: string;
  resident: PortalResident;
}

async function portalPost<T>(path: string, body: unknown): Promise<T> {
  // API_BASE already ends in /api/v1 (see lib/api.ts), so paths are relative
  // to it — never prefix them with /api/v1 again or every call 404s.
  const base = (API_BASE ?? "").replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "omit",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (json as any)?.detail;
    const msg =
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
        ? detail.map((d: any) => d?.msg ?? "").join("; ")
        : res.statusText || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, detail);
  }
  return json as T;
}

/** Step 1: verify the password; returns either a token or an MFA challenge. */
export async function portalLogin(
  slug: string,
  username: string,
  password: string
): Promise<PortalLoginResult> {
  return portalPost<PortalLoginResult>("/portal/login", {
    hoa_slug: slug.trim().toLowerCase(),
    username: username.trim(),
    password,
  });
}

/** Step 2: confirm the one-time code and receive the resident token. */
export async function portalVerify(
  challengeId: string,
  code: string
): Promise<PortalTokenResult> {
  return portalPost<PortalTokenResult>("/portal/login/verify", {
    challenge_id: challengeId,
    code: code.trim(),
  });
}

/** Set a password from the one-time link emailed by the staff invite. */
export async function portalAcceptInvite(
  token: string,
  newPassword: string
): Promise<{ status: string }> {
  return portalPost<{ status: string }>("/portal/accept-invite", {
    token,
    new_password: newPassword,
  });
}

/** Request a one-time reset code (always 200 — no account enumeration). */
export async function portalForgotPassword(
  slug: string,
  username: string
): Promise<{
  status: string;
  challenge_id?: string;
  channel?: string;
  destination_masked?: string;
  dev_otp?: string;
}> {
  return portalPost("/portal/forgot-password", {
    hoa_slug: slug.trim().toLowerCase(),
    username: username.trim(),
  });
}

/** Complete the reset with the one-time code and a new password. */
export async function portalResetPassword(
  challengeId: string,
  code: string,
  newPassword: string
): Promise<{ status: string }> {
  return portalPost<{ status: string }>("/portal/reset-password", {
    challenge_id: challengeId,
    code: code.trim(),
    new_password: newPassword,
  });
}
