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

interface Session {
  persona: Persona;
  tenantId: string;
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

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
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
      setSession((prev) => {
        if (!prev || !prev.persona.tenant_ids.includes(tenantId)) return prev;
        const next = { ...prev, tenantId };
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const signOut = useCallback(() => {
    setSession(null);
    persist(null);
  }, [persist]);

  const value = useMemo<AuthState>(() => {
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
  }, [ready, session, revision, signIn, switchPersona, setActiveTenant, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
