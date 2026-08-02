"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../providers";
import { apiFetch } from "@/lib/api";
import type { Notification } from "@/lib/types";
import { Alert, Badge, Button, Card, Spinner } from "@/components/ui";

const TONE: Record<string, string> = { BUDGET_OVERRUN: "L", HOLD: "O", INFO: "none" };

export default function NotificationsPage() {
  const { token, activeTenantId } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadOnly, setUnreadOnly] = useState(false);

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const rows = await apiFetch<Notification[]>(
        `/notifications${unreadOnly ? "?unread_only=true" : ""}`, { token, tenantId: activeTenantId });
      setItems(rows); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [token, activeTenantId, unreadOnly]);

  async function markRead(id: string) {
    await apiFetch(`/notifications/${id}/read`, { method: "POST", token, tenantId: activeTenantId });
    await load();
  }

  const link = (n: Notification) =>
    n.entity_type === "ApInvoice" ? "/payables" : n.entity_type === "PoHeader" ? "/purchasing" : null;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Notifications & Alerts</h1>
          <p className="text-sm text-slate-500">Budget overruns, holds, and board/staff alerts.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only
        </label>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <Card>
        {loading ? <Spinner /> : items.length === 0 ? (
          <p className="text-sm text-slate-500">No notifications.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((n) => (
              <div key={n.id} className={`flex items-start justify-between gap-4 py-3 ${n.is_read ? "opacity-60" : ""}`}>
                <div>
                  <div className="mb-1 flex items-center gap-2">
                    <Badge tone={TONE[n.category] || "none"}>{n.category}</Badge>
                    {!n.is_read && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                    <span className="text-xs text-slate-400">{new Date(n.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-sm text-slate-700">{n.message}</p>
                  {link(n) && <Link href={link(n)!} className="text-xs text-brand-600">View →</Link>}
                </div>
                {!n.is_read && <Button variant="secondary" onClick={() => markRead(n.id)}>Mark read</Button>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
