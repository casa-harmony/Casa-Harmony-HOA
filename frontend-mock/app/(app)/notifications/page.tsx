"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "../../providers";
import { apiFetch } from "@/lib/api";
import type { Notification } from "@/lib/types";
import { Alert, Button, Card, Spinner } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Bell, AlertTriangle, AlertCircle, Info } from "lucide-react";

const VARIANT: Record<string, "destructive" | "default" | "secondary" | "outline"> = { BUDGET_OVERRUN: "destructive", HOLD: "secondary", INFO: "outline" };

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
                  <div className="mb-2 flex items-center gap-2">
                    {n.category === "BUDGET_OVERRUN" ? <AlertTriangle className="h-4 w-4 text-rose-500" /> :
                     n.category === "HOLD" ? <AlertCircle className="h-4 w-4 text-amber-500" /> :
                     <Info className="h-4 w-4 text-blue-500" />}
                    <Badge variant={VARIANT[n.category] || "outline"}>{n.category.replace("_", " ")}</Badge>
                    {!n.is_read && <span className="h-2 w-2 rounded-full bg-indigo-500" />}
                    <span className="text-xs font-medium text-slate-400">{new Date(n.created_at).toLocaleString()}</span>
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
