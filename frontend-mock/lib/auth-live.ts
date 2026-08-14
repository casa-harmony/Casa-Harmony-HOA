/**
 * Real authentication against the FastAPI backend.
 *
 * Only used when NEXT_PUBLIC_DATA_MODE=live. The shapes here mirror
 * backend/app/schemas/auth.py exactly — if that file changes, this one must.
 *
 * Two things the UI must respect and cannot decide for itself:
 *   - `permissions` comes from the server, per active tenant. The local RBAC
 *     table in lib/rbac.ts is for nav/labels only; it is never the authority.
 *   - `X-Tenant-Id` selects the HOA. The server re-derives what that user may
 *     see for that tenant on every request; switching tenants client-side
 *     grants nothing on its own.
 */

import { apiFetch, setAuthToken } from "./api";

export interface LiveMembership {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  role_code: string;
  role_name: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user_id: string;
  email: string;
  full_name: string | null;
  is_superadmin: boolean;
  must_change_password: boolean;
  memberships: LiveMembership[];
}

export interface MeResponse {
  user_id: string;
  email: string;
  full_name: string | null;
  is_superadmin: boolean;
  must_change_password: boolean;
  active_tenant_id: string | null;
  permissions: string[];
}

/** Thrown when the account has TOTP enabled and no code was supplied. */
export class MfaRequiredError extends Error {
  constructor() {
    super("MFA code required");
    this.name = "MfaRequiredError";
  }
}

export async function login(
  email: string,
  password: string,
  mfaCode?: string
): Promise<LoginResponse> {
  const res = await apiFetch<LoginResponse>("/auth/login", {
    method: "POST",
    body: { email, password, mfa_code: mfaCode || null },
  });
  setAuthToken(res.access_token);
  return res;
}

/**
 * Re-read the session for a given tenant. This is the call that returns the
 * permission list the UI gates on, so it must be re-run on every tenant switch.
 */
export async function fetchMe(tenantId: string | null): Promise<MeResponse> {
  return apiFetch<MeResponse>("/auth/me", { tenantId });
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
  tenantId: string | null
): Promise<void> {
  await apiFetch("/auth/change-password", {
    method: "POST",
    tenantId,
    body: { current_password: currentPassword, new_password: newPassword },
  });
}

export function logout(): void {
  setAuthToken(null);
}
