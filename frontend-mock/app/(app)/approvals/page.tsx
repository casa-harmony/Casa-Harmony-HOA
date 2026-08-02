"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../providers";
import { apiFetch } from "@/lib/api";
import type { ApprovalHierarchy, ApprovalRequest, Role } from "@/lib/types";
import { Alert, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";

const DOC_ENDPOINT: Record<string, string> = {
  PO: "/purchasing",
  AP_INVOICE: "/payables",
};
const DOC_TYPES = ["PO", "AP_INVOICE", "CONTRACT", "GL_BATCH"];

export default function ApprovalsPage() {
  const { token, activeTenantId } = useAuth();
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [hierarchies, setHierarchies] = useState<ApprovalHierarchy[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfg, setCfg] = useState<{
    name: string;
    document_type: string;
    rules: { min_amount: string; max_amount: string; approver_role_id: string }[];
  }>({ name: "", document_type: "PO", rules: [{ min_amount: "0", max_amount: "", approver_role_id: "" }] });

  async function load() {
    if (!token || !activeTenantId) return;
    setLoading(true);
    try {
      const [reqs, hier, rls] = await Promise.all([
        apiFetch<ApprovalRequest[]>("/approvals/requests?status_filter=PENDING",
          { token, tenantId: activeTenantId }),
        apiFetch<ApprovalHierarchy[]>("/approvals/hierarchies", { token, tenantId: activeTenantId }),
        apiFetch<Role[]>("/roles", { token, tenantId: activeTenantId }),
      ]);
      setRequests(reqs);
      setHierarchies(hier);
      setRoles(rls);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load approvals");
    } finally {
      setLoading(false);
    }
  }

  async function createHierarchy(e: React.FormEvent) {
    e.preventDefault();
    setBusy("cfg");
    setError(null);
    try {
      await apiFetch("/approvals/hierarchies", {
        method: "POST", token, tenantId: activeTenantId,
        body: {
          name: cfg.name, document_type: cfg.document_type,
          rules: cfg.rules.map((r, i) => ({
            level_num: i + 1,
            min_amount: r.min_amount || "0",
            max_amount: r.max_amount ? r.max_amount : null,
            approver_role_id: r.approver_role_id,
          })),
        },
      });
      setCfgOpen(false);
      setCfg({ name: "", document_type: "PO", rules: [{ min_amount: "0", max_amount: "", approver_role_id: "" }] });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create hierarchy");
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, activeTenantId]);

  async function act(req: ApprovalRequest, approve: boolean) {
    const base = DOC_ENDPOINT[req.document_type];
    if (!base) {
      setError(`No action handler for ${req.document_type}`);
      return;
    }
    setBusy(req.id);
    setError(null);
    try {
      await apiFetch(`${base}/${req.document_id}/approve`, {
        method: "POST", token, tenantId: activeTenantId,
        body: { approve, comments: approve ? "Approved via dashboard" : "Rejected via dashboard" },
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Approvals</h1>
        <p className="text-sm text-slate-500">
          Pending multi-level approvals for purchase orders and invoices.
        </p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <Card>
        {loading ? (
          <Spinner />
        ) : requests.length === 0 ? (
          <p className="text-sm text-slate-500">No pending approvals. 🎉</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
                <th className="py-2 pr-3">Document</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Level</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className="py-2 pr-3"><Badge>{r.document_type}</Badge></td>
                  <td className="py-2 pr-3 font-medium">${Number(r.amount).toFixed(2)}</td>
                  <td className="py-2 pr-3">
                    {r.current_level} / {r.required_levels}
                  </td>
                  <td className="py-2 pr-3"><Badge tone="R">{r.status}</Badge></td>
                  <td className="py-2 pr-3">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" onClick={() => act(r, false)}
                        disabled={busy === r.id}>Reject</Button>
                      <Button onClick={() => act(r, true)} disabled={busy === r.id}>
                        {busy === r.id ? "…" : "Approve"}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-700">Approval Hierarchies</h2>
            <p className="text-xs text-slate-400">
              Amount-banded approval levels per document type.
            </p>
          </div>
          <Button variant="secondary" onClick={() => setCfgOpen(true)}>+ New Hierarchy</Button>
        </div>
        {hierarchies.length === 0 ? (
          <p className="text-sm text-slate-500">
            No hierarchies configured — documents auto-approve on submit.
          </p>
        ) : (
          <div className="space-y-3">
            {hierarchies.map((h) => (
              <div key={h.id} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-1 flex items-center gap-2">
                  <Badge>{h.document_type}</Badge>
                  <span className="text-sm font-medium text-slate-700">{h.name}</span>
                </div>
                <ul className="text-xs text-slate-500">
                  {h.rules.map((r) => (
                    <li key={r.level_num}>
                      Level {r.level_num}: ${Number(r.min_amount).toFixed(0)}
                      {r.max_amount ? `–$${Number(r.max_amount).toFixed(0)}` : "+"} →{" "}
                      {roles.find((x) => x.id === r.approver_role_id)?.name || "role"}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={cfgOpen} onClose={() => setCfgOpen(false)} title="New Approval Hierarchy">
        <form onSubmit={createHierarchy} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Name</Label><Input value={cfg.name}
              onChange={(e) => setCfg({ ...cfg, name: e.target.value })} required /></div>
            <div>
              <Label>Document type</Label>
              <Select value={cfg.document_type}
                onChange={(e) => setCfg({ ...cfg, document_type: e.target.value })}>
                {DOC_TYPES.map((d) => <option key={d}>{d}</option>)}
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Levels (lowest amount first)</Label>
            {cfg.rules.map((r, i) => (
              <div key={i} className="grid grid-cols-3 gap-2">
                <Input type="number" step="0.01" placeholder="Min $" value={r.min_amount}
                  onChange={(e) => {
                    const rules = [...cfg.rules];
                    rules[i] = { ...r, min_amount: e.target.value };
                    setCfg({ ...cfg, rules });
                  }} />
                <Input type="number" step="0.01" placeholder="Max $ (blank = ∞)" value={r.max_amount}
                  onChange={(e) => {
                    const rules = [...cfg.rules];
                    rules[i] = { ...r, max_amount: e.target.value };
                    setCfg({ ...cfg, rules });
                  }} />
                <Select value={r.approver_role_id} required
                  onChange={(e) => {
                    const rules = [...cfg.rules];
                    rules[i] = { ...r, approver_role_id: e.target.value };
                    setCfg({ ...cfg, rules });
                  }}>
                  <option value="">Approver role…</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </Select>
              </div>
            ))}
            <Button type="button" variant="secondary"
              onClick={() => setCfg({ ...cfg, rules: [...cfg.rules,
                { min_amount: "0", max_amount: "", approver_role_id: "" }] })}>
              + Add level
            </Button>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setCfgOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={busy === "cfg"}>
              {busy === "cfg" ? "Saving…" : "Create Hierarchy"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
