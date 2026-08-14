"use client";

/**
 * Demo auth.
 *
 * There is no real authentication here — you pick a persona and the app
 * re-renders as that person. The permission list carried on the session is the
 * same list the server checks, so what you can reach in the demo is what you
 * would be allowed to reach for real.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { PERSONAS, TENANTS, type Persona, type Tenant } from "@/lib/mock-data/seed";
import { permsFor, ROLES, roleHas, navFor } from "@/lib/rbac";
import { subscribe } from "@/lib/mock-data/store";
import { getAuthToken, isLive, setAuthToken, setUnauthorizedHandler } from "@/lib/api";
import {
  fetchMe,
  login as liveLogin,
  type LiveMembership,
} from "@/lib/auth-live";

interface Session {
  persona: Persona;
  tenantId: string;
}

/** The signed-in user in live mode, as the server describes them. */
interface LiveSession {
  userId: string;
  email: string;
  fullName: string | null;
  isSuperadmin: boolean;
  mustChangePassword: boolean;
  memberships: LiveMembership[];
  tenantId: string | null;
  /** Authoritative permission list for the active tenant, from /auth/me. */
  permissions: string[];
}

interface AuthState {
  ready: boolean;
  signedIn: boolean;
  persona: Persona | null;
  role: (typeof ROLES)[string] | null;
  permissions: string[];
  tenants: Tenant[];
  tenant: Tenant | null;
  activeTenantId: string | null;
  /** Bumps whenever the demo store mutates, so pages can re-fetch. */
  revision: number;
  can: (perm: string) => boolean;
  nav: ReturnType<typeof navFor>;
  signIn: (personaId: string, tenantId?: string) => void;
  /** Live mode only — real credential login. Rejects with ApiError on failure. */
  signInWithPassword: (
    email: string,
    password: string,
    mfaCode?: string
  ) => Promise<void>;
  switchPersona: (personaId: string) => void;
  setActiveTenant: (tenantId: string) => void;
  signOut: () => void;
  refresh: () => void;

  /* ---- compatibility shims -------------------------------------------
   * Pages written against the previous auth shape destructure these. They
   * are kept so every screen keeps compiling while sections are migrated
   * to `persona` / `can()`. Remove once no page references them.
   * ------------------------------------------------------------------ */
  token: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    isSuperadmin: boolean;
    mustChangePassword: boolean;
  } | null;
  memberships: {
    tenant_id: string;
    tenant_name: string;
    tenant_slug: string;
    role_code: string;
    role_name: string;
  }[];
  logout: () => void;
  clearMustChange: () => void;
}

const AuthContext = createContext<AuthState | null>(null);
const LS_KEY = "casa_demo_session_v1";
const LIVE_KEY = "casa_live_session_v1";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [live, setLive] = useState<LiveSession | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (isLive) return; // live mode restores from the token instead — see below
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { personaId: string; tenantId: string };
        const persona = PERSONAS.find((p) => p.id === parsed.personaId);
        if (persona) {
          const tenantId = persona.tenant_ids.includes(parsed.tenantId)
            ? parsed.tenantId
            : persona.tenant_ids[0];
          setSession({ persona, tenantId });
        }
      }
    } catch {
      /* start signed out */
    }
    setReady(true);
  }, []);

  /**
   * Live mode: rehydrate from the stored bearer token. /auth/me both validates
   * the token and returns the permission list for the active tenant, so a
   * revoked or expired token lands the user back on /login rather than in a
   * shell that looks signed in.
   *
   * Memberships are cached locally because /auth/me does not return them; they
   * are only tenant names the user already belongs to, and every request is
   * still authorised server-side against X-Tenant-Id.
   */
  useEffect(() => {
    if (!isLive) return;
    let alive = true;

    (async () => {
      const token = getAuthToken();
      if (!token) {
        if (alive) setReady(true);
        return;
      }
      try {
        const raw = localStorage.getItem(LIVE_KEY);
        const cached = raw
          ? (JSON.parse(raw) as { memberships: LiveMembership[]; tenantId: string | null })
          : { memberships: [], tenantId: null };

        const me = await fetchMe(cached.tenantId);
        if (!alive) return;
        setLive({
          userId: me.user_id,
          email: me.email,
          fullName: me.full_name,
          isSuperadmin: me.is_superadmin,
          mustChangePassword: me.must_change_password,
          memberships: cached.memberships,
          tenantId: cached.tenantId ?? cached.memberships[0]?.tenant_id ?? null,
          permissions: me.permissions,
        });
      } catch {
        // Bad or expired token — drop it and start signed out.
        setAuthToken(null);
        localStorage.removeItem(LIVE_KEY);
      } finally {
        if (alive) setReady(true);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // A 401 from anywhere in the app tears the session down here.
  useEffect(() => {
    if (!isLive) return;
    setUnauthorizedHandler(() => {
      setLive(null);
      try {
        localStorage.removeItem(LIVE_KEY);
      } catch {
        /* private browsing */
      }
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Any write through the demo API bumps the revision so pages re-read.
  useEffect(() => subscribe(() => setRevision((r) => r + 1)), []);

  const persist = useCallback((s: Session | null) => {
    if (s) {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ personaId: s.persona.id, tenantId: s.tenantId })
      );
    } else {
      localStorage.removeItem(LS_KEY);
    }
  }, []);

  const signIn = useCallback(
    (personaId: string, tenantId?: string) => {
      const persona = PERSONAS.find((p) => p.id === personaId);
      if (!persona) return;
      const next: Session = {
        persona,
        tenantId:
          tenantId && persona.tenant_ids.includes(tenantId)
            ? tenantId
            : persona.tenant_ids[0],
      };
      setSession(next);
      persist(next);
    },
    [persist]
  );

  const persistLive = useCallback((s: LiveSession | null) => {
    try {
      if (s) {
        localStorage.setItem(
          LIVE_KEY,
          JSON.stringify({ memberships: s.memberships, tenantId: s.tenantId })
        );
      } else {
        localStorage.removeItem(LIVE_KEY);
      }
    } catch {
      /* private browsing — the session simply won't survive a reload */
    }
  }, []);

  const signInWithPassword = useCallback(
    async (email: string, password: string, mfaCode?: string) => {
      const res = await liveLogin(email, password, mfaCode);
      const tenantId = res.memberships[0]?.tenant_id ?? null;
      // The token is set; ask the server what this user may do in that HOA.
      const me = await fetchMe(tenantId);
      const next: LiveSession = {
        userId: res.user_id,
        email: res.email,
        fullName: res.full_name,
        isSuperadmin: res.is_superadmin,
        mustChangePassword: res.must_change_password,
        memberships: res.memberships,
        tenantId,
        permissions: me.permissions,
      };
      setLive(next);
      persistLive(next);
    },
    [persistLive]
  );

  const switchPersona = useCallback(
    (personaId: string) => {
      const persona = PERSONAS.find((p) => p.id === personaId);
      if (!persona) return;
      setSession((prev) => {
        const tenantId =
          prev && persona.tenant_ids.includes(prev.tenantId)
            ? prev.tenantId
            : persona.tenant_ids[0];
        const next = { persona, tenantId };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const setActiveTenant = useCallback(
    (tenantId: string) => {
      if (isLive) {
        // Permissions are per-tenant, so the switch is not complete until the
        // server has told us what this user may do in the new HOA.
        setLive((prev) => {
          if (!prev || !prev.memberships.some((m) => m.tenant_id === tenantId)) {
            return prev;
          }
          const next = { ...prev, tenantId };
          persistLive(next);
          fetchMe(tenantId)
            .then((me) =>
              setLive((cur) =>
                cur && cur.tenantId === tenantId
                  ? { ...cur, permissions: me.permissions }
                  : cur
              )
            )
            .catch(() => {
              /* a 401 is handled by the unauthorized handler */
            });
          return next;
        });
        return;
      }
      setSession((prev) => {
        if (!prev || !prev.persona.tenant_ids.includes(tenantId)) return prev;
        const next = { ...prev, tenantId };
        persist(next);
        return next;
      });
    },
    [persist, persistLive]
  );

  const signOut = useCallback(() => {
    if (isLive) {
      setAuthToken(null);
      setLive(null);
      persistLive(null);
      return;
    }
    setSession(null);
    persist(null);
  }, [persist, persistLive]);

  const value = useMemo<AuthState>(() => {
    if (isLive) {
      const roleCode =
        live?.memberships.find((m) => m.tenant_id === live.tenantId)?.role_code ?? "";
      const tenants: Tenant[] = (live?.memberships ?? []).map((m) => ({
        id: m.tenant_id,
        name: m.tenant_name,
        slug: m.tenant_slug,
      })) as Tenant[];
      const tenant = tenants.find((t) => t.id === live?.tenantId) ?? null;
      // The server's permission list is the authority here, not lib/rbac.ts.
      const permissions = live?.permissions ?? [];
      const permSet = new Set(permissions);

      return {
        ready,
        signedIn: !!live,
        persona: null,
        role: roleCode ? ROLES[roleCode] ?? null : null,
        permissions,
        tenants,
        tenant,
        activeTenantId: live?.tenantId ?? null,
        revision,
        can: (perm: string) =>
          !!live && (live.isSuperadmin || permSet.has(perm)),
        nav: live ? navFor(roleCode) : [],
        signIn,
        signInWithPassword,
        switchPersona,
        setActiveTenant,
        signOut,
        refresh: () => setRevision((r) => r + 1),

        token: getAuthToken() ?? "",
        user: live
          ? {
              id: live.userId,
              email: live.email,
              fullName: live.fullName ?? live.email,
              isSuperadmin: live.isSuperadmin,
              mustChangePassword: live.mustChangePassword,
            }
          : null,
        memberships: live?.memberships ?? [],
        logout: signOut,
        clearMustChange: () =>
          setLive((prev) => (prev ? { ...prev, mustChangePassword: false } : prev)),
      };
    }

    const persona = session?.persona ?? null;
    const roleCode = persona?.role_code ?? "";
    const permissions = persona ? permsFor(roleCode) : [];
    const tenants = persona
      ? TENANTS.filter((t) => persona.tenant_ids.includes(t.id))
      : [];
    const tenant = tenants.find((t) => t.id === session?.tenantId) ?? null;

    return {
      ready,
      signedIn: !!session,
      persona,
      role: persona ? ROLES[roleCode] ?? null : null,
      permissions,
      tenants,
      tenant,
      activeTenantId: session?.tenantId ?? null,
      revision,
      can: (perm: string) => (persona ? roleHas(roleCode, perm) : false),
      nav: persona ? navFor(roleCode) : [],
      signIn,
      signInWithPassword,
      switchPersona,
      setActiveTenant,
      signOut,
      refresh: () => setRevision((r) => r + 1),

      /* compatibility shims — see the interface for why these exist */
      token: "demo-token",
      user: persona
        ? {
            id: persona.id,
            email: persona.email,
            fullName: persona.full_name,
            isSuperadmin: persona.is_superadmin,
            mustChangePassword: false,
          }
        : null,
      memberships: tenants.map((t) => ({
        tenant_id: t.id,
        tenant_name: t.name,
        tenant_slug: t.slug,
        role_code: roleCode,
        role_name: ROLES[roleCode]?.name ?? roleCode,
      })),
      logout: signOut,
      clearMustChange: () => {},
    };
  }, [
    ready,
    session,
    live,
    revision,
    signIn,
    signInWithPassword,
    switchPersona,
    setActiveTenant,
    signOut,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
