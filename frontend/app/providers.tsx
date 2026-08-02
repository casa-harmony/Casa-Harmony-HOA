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
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const p: Persisted = JSON.parse(raw);
        setToken(p.token);
        setUser(p.user);
        setMemberships(p.memberships);
        setActiveTenantId(p.activeTenantId);
      }
    } catch {
      /* ignore corrupt storage */
    }
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
