"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { LoginResponse, Membership } from "@/lib/types";

interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  isSuperadmin: boolean;
  mustChangePassword: boolean;
}

interface AuthState {
  ready: boolean;
  token: string | null;
  user: AuthUser | null;
  memberships: Membership[];
  activeTenantId: string | null;
  login: (email: string, password: string) => Promise<boolean>;
  clearMustChange: () => void;
  logout: () => void;
  setActiveTenant: (tenantId: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);

const LS_KEY = "casa_harmony_auth";

interface Persisted {
  token: string;
  user: AuthUser;
  memberships: Membership[];
  activeTenantId: string | null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>("mock-token");
  const [user, setUser] = useState<AuthUser | null>({
    id: "mock-user-1",
    email: "demo@casaharmony.ai",
    fullName: "Demo User",
    isSuperadmin: true,
    mustChangePassword: false,
  });
  const [memberships, setMemberships] = useState<Membership[]>([
    {
      tenant_id: "tenant-1",
      tenant_name: "Sunnyvale HOA",
      tenant_slug: "sunnyvale",
      role_code: "SUPERADMIN",
      role_name: "Super Administrator",
    },
    {
      tenant_id: "tenant-2",
      tenant_name: "Oakridge HOA",
      tenant_slug: "oakridge",
      role_code: "ADMIN",
      role_name: "Administrator",
    }
  ]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>("tenant-1");

  useEffect(() => {
    // In mock mode, we immediately set ready to true
    setReady(true);
  }, []);

  function persist(p: Persisted | null) {
    if (p) localStorage.setItem(LS_KEY, JSON.stringify(p));
    else localStorage.removeItem(LS_KEY);
  }

  async function login(email: string, password: string) {
    const res = await apiFetch<LoginResponse>("/auth/login", {
      method: "POST",
      body: { email, password },
    });
    const authUser: AuthUser = {
      id: res.user_id,
      email: res.email,
      fullName: res.full_name,
      isSuperadmin: res.is_superadmin,
      mustChangePassword: Boolean(res.must_change_password),
    };
    const defaultTenant = res.memberships[0]?.tenant_id ?? null;
    setToken(res.access_token);
    setUser(authUser);
    setMemberships(res.memberships);
    setActiveTenantId(defaultTenant);
    persist({
      token: res.access_token,
      user: authUser,
      memberships: res.memberships,
      activeTenantId: defaultTenant,
    });
    return authUser.mustChangePassword;
  }

  function clearMustChange() {
    setUser((u) => {
      if (!u) return u;
      const next = { ...u, mustChangePassword: false };
      persist({ token: token!, user: next, memberships, activeTenantId });
      return next;
    });
  }

  function logout() {
    setToken(null);
    setUser(null);
    setMemberships([]);
    setActiveTenantId(null);
    persist(null);
  }

  function setActiveTenant(tenantId: string) {
    setActiveTenantId(tenantId);
    if (token && user) {
      persist({ token, user, memberships, activeTenantId: tenantId });
    }
  }

  return (
    <AuthContext.Provider
      value={{
        ready,
        token,
        user,
        memberships,
        activeTenantId,
        login,
        clearMustChange,
        logout,
        setActiveTenant,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
