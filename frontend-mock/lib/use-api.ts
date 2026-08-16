"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";
import { useAuth } from "@/app/providers";

/**
 * Read an endpoint, re-reading whenever the active community changes or the
 * demo store is written to. Every list page in the app uses this.
 */
export function useApi<T>(path: string | null, initial: T) {
  const { activeTenantId, revision } = useAuth();
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    apiFetch<T>(path, { tenantId: activeTenantId })
      .then((d) => {
        if (alive) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => alive && setError(e?.message ?? "Failed to load"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path, activeTenantId, revision, tick]);

  return { data, loading, error, reload };
}

/**
 * Write helper — POST/PATCH/DELETE with the active community attached.
 * Every list on screen re-reads afterwards: in mock mode the store notifies
 * on write, and in live mode `apiFetch` itself notifies (see
 * `subscribeToLiveWrites` in lib/api.ts) — both feed the same `revision`.
 */
export function useMutate() {
  const { activeTenantId } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);

  const mutate = useCallback(
    async <T,>(path: string, method: string, body?: unknown): Promise<T> => {
      setBusy(path);
      try {
        return await apiFetch<T>(path, {
          method,
          body,
          tenantId: activeTenantId,
        });
      } finally {
        setBusy(null);
      }
    },
    [activeTenantId]
  );

  return { mutate, busy };
}
