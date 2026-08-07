/**
 * Demo API layer.
 *
 * Nothing leaves the browser. `apiFetch` routes against the mutable store in
 * lib/mock-data/store.ts and honours the HTTP method, so create / edit /
 * approve / delete all behave the way they will against the real server.
 */

import { PERSONAS, TENANTS } from "./mock-data/seed";
import { ROLES } from "./rbac";
import {
  commit,
  nextId,
  nowIso,
  pushNotification,
  tenantData,
} from "./mock-data/store";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/v1";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

interface FetchOpts {
  method?: string;
  body?: any;
  token?: string | null;
  tenantId?: string | null;
}

/** Simulated latency — low enough to feel snappy in a live demo. */
const LATENCY = 140;

export async function apiFetch<T = unknown>(
  path: string,
  opts: FetchOpts = {}
): Promise<T> {
  await new Promise((r) => setTimeout(r, LATENCY));

  const method = (opts.method ?? "GET").toUpperCase();
  const tenantId = opts.tenantId ?? TENANTS[0].id;
  const body = opts.body ?? {};
  const d = tenantData(tenantId);

  // Strip any query string for matching; keep it for filters.
  const [rawPath, qs] = path.split("?");
  const q = new URLSearchParams(qs ?? "");
  const p = rawPath.replace(/\/$/, "");
  const seg = p.split("/").filter(Boolean);

  const result = route<T>({ p, seg, q, method, body, d, tenantId });

  if (method !== "GET") commit();
  return result;
}

interface Ctx {
  p: string;
  seg: string[];
  q: URLSearchParams;
  method: string;
  body: any;
  d: ReturnType<typeof tenantData>;
  tenantId: string;
}

function route<T>(c: Ctx): T {
  const { p, seg, method, body, d, tenantId } = c;
  const ok = <R>(v: R) => v as unknown as T;

  /* ------------------------------------------------------------ platform */

  if (p === "/tenants") return ok(TENANTS);
  if (p === "/personas") return ok(PERSONAS);

  if (p === "/users") {
    return ok(
      PERSONAS.map((u) => ({
        id: u.id,
        email: u.email,
        full_name: u.full_name,
        title: u.title,
        role_code: u.role_code,
        is_superadmin: u.is_superadmin,
        is_active: true,
        tenant_ids: u.tenant_ids,
        last_login_at: nowIso(),
      }))
    );
  }

  /* ------------------------------------------------------- service desk */

  if (p === "/service-desk/tickets") {
    if (method === "POST") {
      const ho = d.homeowners.find((h: any) => h.id === body.homeowner_id);
      const ticket = {
        id: nextId("tk"),
        ticket_number: `SRV-${1100 + d.tickets.length}`,
        subject: body.subject ?? "Untitled request",
        description: body.description ?? "",
        category: body.category ?? "MAINTENANCE",
        priority: body.priority ?? "MEDIUM",
        status: "OPEN",
        homeowner_id: body.homeowner_id ?? null,
        reported_by: ho ? `${ho.first_name} ${ho.last_name}` : "Staff",
        unit: ho?.property_unit ?? "—",
        assigned_to: body.assigned_to ?? null,
        vendor_id: body.vendor_id ?? null,
        estimated_cost: body.estimated_cost ?? null,
        po_header_id: null,
        created_at: nowIso(),
        updated_at: nowIso(),
        sla_due: null,
      };
      d.tickets.unshift(ticket);
      d.ticketComments[ticket.id] = [];
      pushNotification(tenantId, {
        category: "INFO",
        message: `New service ticket ${ticket.ticket_number} — ${ticket.subject}`,
        entity_type: "ServiceTicket",
        entity_id: ticket.id,
      });
      return ok(ticket);
    }
    return ok(d.tickets);
  }

  // /service-desk/tickets/:id  and sub-actions
  if (seg[0] === "service-desk" && seg[1] === "tickets" && seg[2]) {
    const t = d.tickets.find((x: any) => x.id === seg[2]);
    if (!t) throw new ApiError("Ticket not found", 404);

    if (seg[3] === "comments") {
      if (method === "POST") {
        const comment = {
          id: nextId("c"),
          author: body.author ?? "Staff",
          role: body.role ?? "Property Manager",
          at: nowIso(),
          body: body.body ?? "",
        };
        (d.ticketComments[t.id] ||= []).push(comment);
        t.updated_at = nowIso();
        return ok(comment);
      }
      return ok(d.ticketComments[t.id] ?? []);
    }

    if (seg[3] === "assign-vendor" && method === "POST") {
      const v = d.vendors.find((x: any) => x.id === body.vendor_id);
      t.vendor_id = body.vendor_id;
      t.estimated_cost = body.estimated_cost ?? t.estimated_cost;
      t.status = "IN_PROGRESS";
      t.updated_at = nowIso();
      (d.ticketComments[t.id] ||= []).push({
        id: nextId("c"),
        author: body.actor ?? "Property Manager",
        role: "System",
        at: nowIso(),
        body: `Assigned to ${v?.name ?? "vendor"}${
          body.estimated_cost ? ` with an estimate of $${body.estimated_cost}` : ""
        }.`,
      });
      pushNotification(tenantId, {
        category: "INFO",
        message: `${t.ticket_number} assigned to ${v?.name ?? "a vendor"}`,
        entity_type: "ServiceTicket",
        entity_id: t.id,
      });
      return ok(t);
    }

    if (seg[3] === "convert-to-po" && method === "POST") {
      const v = d.vendors.find((x: any) => x.id === t.vendor_id);
      const amount = Number(t.estimated_cost ?? body.amount ?? 0);
      const po = {
        id: nextId("po"),
        po_number: `PO-${2500 + d.purchaseOrders.length}`,
        vendor_id: t.vendor_id,
        vendor_name: v?.name ?? "Vendor",
        description: t.subject,
        document_type: "STANDARD",
        order_date: nowIso().slice(0, 10),
        amount,
        amount_limit: amount,
        amount_billed: 0,
        status: "PENDING",
        fund: body.fund ?? "Operating",
        account: body.account ?? "10-200-5000",
        approvals_required: amount > 5000 ? 2 : 1,
        approvals_done: 0,
      };
      d.purchaseOrders.unshift(po);
      t.po_header_id = po.id;
      t.updated_at = nowIso();
      d.approvalRequests.unshift({
        id: nextId("appr"),
        document_type: "PO",
        document_id: po.id,
        document_number: po.po_number,
        description: po.description,
        vendor_name: po.vendor_name,
        amount: po.amount,
        status: "PENDING",
        current_level: 1,
        required_levels: po.approvals_required,
        submitted_by: body.actor ?? "Property Manager",
        submitted_at: nowIso(),
      });
      (d.ticketComments[t.id] ||= []).push({
        id: nextId("c"),
        author: body.actor ?? "Property Manager",
        role: "System",
        at: nowIso(),
        body: `Converted to purchase order ${po.po_number} and submitted for approval.`,
      });
      pushNotification(tenantId, {
        category: "APPROVAL",
        message: `${po.po_number} (${po.vendor_name}) is awaiting approval`,
        entity_type: "PoHeader",
        entity_id: po.id,
        recipient_role_code: amount > 5000 ? "BOARD_MEMBER" : null,
      });
      return ok(po);
    }

    if (method === "PATCH") {
      const before = t.status;
      Object.assign(t, body, { updated_at: nowIso() });
      if (body.status && body.status !== before) {
        (d.ticketComments[t.id] ||= []).push({
          id: nextId("c"),
          author: body.actor ?? "Property Manager",
          role: "System",
          at: nowIso(),
          body: `Status changed from ${before} to ${body.status}.`,
        });
      }
      return ok(t);
    }
    return ok(t);
  }

  /* ------------------------------------------------------------ vendors */

  if (p === "/vendors") {
    if (method === "POST") {
      const v = {
        id: nextId("vend"),
        vendor_number: `V${2000 + d.vendors.length}`,
        name: body.name ?? "New vendor",
        category: body.category ?? "General",
        status: "ACTIVE",
        payment_terms: body.payment_terms ?? "Net 30",
        email: body.email ?? "",
        phone: body.phone ?? "",
        ytd_spend: 0,
        open_pos: 0,
        onboarded: nowIso().slice(0, 10),
        w9_on_file: false,
        insurance_expires: null,
      };
      d.vendors.unshift(v);
      return ok(v);
    }
    return ok(d.vendors);
  }
  if (seg[0] === "vendors" && seg[1]) {
    const v = d.vendors.find((x: any) => x.id === seg[1]);
    if (!v) throw new ApiError("Vendor not found", 404);
    if (method === "PATCH") {
      Object.assign(v, body);
      return ok(v);
    }
    return ok(v);
  }

  /* ---------------------------------------------------------- residents */

  if (p === "/residents") {
    if (method === "POST") {
      const r = {
        id: nextId("res"),
        username: body.username ?? "new.resident",
        full_name: body.full_name ?? "New Resident",
        resident_type: body.resident_type ?? "OWNER",
        email: body.email ?? "",
        phone: body.phone ?? "",
        is_active: true,
        mfa_channel: body.mfa_channel ?? "EMAIL",
        unit_count: 1,
        last_login: null,
        homeowner_id: body.homeowner_id ?? null,
      };
      d.residents.unshift(r);
      return ok(r);
    }
    return ok(d.residents);
  }
  if (seg[0] === "residents" && seg[1]) {
    const r = d.residents.find((x: any) => x.id === seg[1]);
    if (!r) throw new ApiError("Resident not found", 404);
    if (method === "PATCH") {
      Object.assign(r, body);
      return ok(r);
    }
    return ok(r);
  }

  if (p === "/subledger/homeowners") return ok(d.homeowners);
  if (p === "/subledger/aging") return ok(d.aging);

  /* ---------------------------------------------------------- documents */

  if (p === "/documents") {
    if (method === "POST") {
      const doc = {
        id: nextId("doc"),
        filename: body.filename ?? "Untitled",
        entity_type: body.entity_type ?? "GENERAL",
        entity_id: body.entity_id ?? null,
        content_type: body.content_type ?? "application/octet-stream",
        size_bytes: body.size_bytes ?? 0,
        uploaded_by: body.uploaded_by ?? "Staff",
        created_at: nowIso(),
        visibility: body.visibility ?? "STAFF",
        notes: body.notes ?? null,
      };
      d.documents.unshift(doc);
      return ok(doc);
    }
    return ok(d.documents);
  }
  if (seg[0] === "documents" && seg[1] && method === "DELETE") {
    const i = d.documents.findIndex((x: any) => x.id === seg[1]);
    if (i >= 0) d.documents.splice(i, 1);
    return ok({ deleted: true });
  }

  /* ------------------------------------------------------ notifications */

  if (p === "/notifications") return ok(d.notifications);
  if (p === "/notifications/read-all" && method === "POST") {
    d.notifications.forEach((n: any) => (n.is_read = true));
    return ok(d.notifications);
  }
  if (seg[0] === "notifications" && seg[2] === "read" && method === "POST") {
    const n = d.notifications.find((x: any) => x.id === seg[1]);
    if (n) n.is_read = true;
    return ok(n ?? {});
  }

  /* --------------------------------------------------------- purchasing */

  if (p === "/purchasing") return ok(d.purchaseOrders);
  if (seg[0] === "purchasing" && seg[1]) {
    const po = d.purchaseOrders.find((x: any) => x.id === seg[1]);
    if (!po) throw new ApiError("Purchase order not found", 404);
    if (seg[2] === "submit" && method === "POST") {
      po.status = "PENDING";
      d.approvalRequests.unshift({
        id: nextId("appr"),
        document_type: "PO",
        document_id: po.id,
        document_number: po.po_number,
        description: po.description,
        vendor_name: po.vendor_name,
        amount: po.amount,
        status: "PENDING",
        current_level: 1,
        required_levels: po.approvals_required,
        submitted_by: body.actor ?? "Staff",
        submitted_at: nowIso(),
      });
      return ok(po);
    }
    if (seg[2] === "close" && method === "POST") {
      po.status = "CLOSED";
      return ok(po);
    }
    return ok(po);
  }

  if (p === "/receiving") return ok(d.receipts);

  /* ----------------------------------------------------------- payables */

  if (p === "/payables") {
    if (method === "POST") {
      const v = d.vendors.find((x: any) => x.id === body.vendor_id);
      const amount = Number(body.amount ?? 0);
      const inv = {
        id: nextId("inv"),
        invoice_number: body.invoice_number ?? `INV-${9000 + d.payables.length}`,
        vendor_id: body.vendor_id,
        vendor_name: v?.name ?? "Vendor",
        po_header_id: body.po_header_id ?? null,
        po_number:
          d.purchaseOrders.find((x: any) => x.id === body.po_header_id)?.po_number ??
          null,
        invoice_date: body.invoice_date ?? nowIso().slice(0, 10),
        gl_date: body.invoice_date ?? nowIso().slice(0, 10),
        due_date: body.due_date ?? null,
        amount,
        tax_amount: Math.round(amount * 0.0725 * 100) / 100,
        status: "DRAFT",
        match_status: body.po_header_id ? "MATCHED" : "NOT_MATCHED",
        on_hold: false,
        hold_reason: null,
        fund: body.fund ?? "Operating",
        account: body.account ?? "10-200-5000",
        description: body.description ?? "",
      };
      d.payables.unshift(inv);
      return ok(inv);
    }
    return ok(d.payables);
  }
  if (seg[0] === "payables" && seg[1]) {
    const inv = d.payables.find((x: any) => x.id === seg[1]);
    if (!inv) throw new ApiError("Invoice not found", 404);
    const action = seg[2];
    if (method === "POST" && action) {
      if (action === "submit") {
        inv.status = "PENDING";
        d.approvalRequests.unshift({
          id: nextId("appr"),
          document_type: "AP_INVOICE",
          document_id: inv.id,
          document_number: inv.invoice_number,
          description: inv.description,
          vendor_name: inv.vendor_name,
          amount: inv.amount,
          status: "PENDING",
          current_level: 1,
          required_levels: inv.amount > 10000 ? 2 : 1,
          submitted_by: body.actor ?? "Accountant",
          submitted_at: nowIso(),
        });
        pushNotification(tenantId, {
          category: "APPROVAL",
          message: `Invoice ${inv.invoice_number} (${inv.vendor_name}) awaiting approval`,
          entity_type: "ApInvoice",
          entity_id: inv.id,
        });
      }
      if (action === "approve") inv.status = "APPROVED";
      if (action === "cancel") inv.status = "CANCELLED";
      if (action === "hold") {
        inv.on_hold = true;
        inv.hold_reason = body.reason ?? "Placed on hold";
        pushNotification(tenantId, {
          category: "HOLD",
          message: `Invoice ${inv.invoice_number} placed on hold — ${inv.hold_reason}`,
          entity_type: "ApInvoice",
          entity_id: inv.id,
        });
      }
      if (action === "release-hold") {
        inv.on_hold = false;
        inv.hold_reason = null;
      }
      if (action === "pay") {
        inv.status = "PAID";
        d.apPayments.unshift({
          id: nextId("pay"),
          payment_number: `PMT-${6000 + d.apPayments.length}`,
          vendor_id: inv.vendor_id,
          vendor_name: inv.vendor_name,
          invoice_id: inv.id,
          invoice_number: inv.invoice_number,
          amount: inv.amount + inv.tax_amount,
          payment_date: nowIso().slice(0, 10),
          method: body.method ?? "ACH",
          reference: `ACH-${9500 + d.apPayments.length}`,
          status: "COMPLETED",
          bank_account: d.bankAccounts[0]?.name ?? "Operating",
          cleared: false,
        });
      }
      return ok(inv);
    }
    if (method === "PATCH") {
      Object.assign(inv, body);
      return ok(inv);
    }
    return ok(inv);
  }

  if (p === "/ap-payments") return ok(d.apPayments);
  if (seg[0] === "ap-payments" && seg[1] && seg[2] && method === "POST") {
    const pay = d.apPayments.find((x: any) => x.id === seg[1]);
    if (!pay) throw new ApiError("Payment not found", 404);
    if (seg[2] === "void") pay.status = "CANCELLED";
    if (seg[2] === "clear") pay.cleared = true;
    return ok(pay);
  }

  /* ---------------------------------------------------------- approvals */

  if (p === "/approvals/requests") return ok(d.approvalRequests);
  if (p === "/approvals/hierarchies") return ok(d.approvalHierarchies);
  if (seg[0] === "approvals" && seg[1] === "requests" && seg[2] && seg[3]) {
    const r = d.approvalRequests.find((x: any) => x.id === seg[2]);
    if (!r) throw new ApiError("Request not found", 404);
    if (seg[3] === "approve") {
      if (r.current_level >= r.required_levels) {
        r.status = "APPROVED";
        const po = d.purchaseOrders.find((x: any) => x.id === r.document_id);
        if (po) {
          po.status = "APPROVED";
          po.approvals_done = r.required_levels;
        }
        const inv = d.payables.find((x: any) => x.id === r.document_id);
        if (inv) inv.status = "APPROVED";
        pushNotification(tenantId, {
          category: "INFO",
          message: `${r.document_number} approved`,
          entity_type: r.document_type,
          entity_id: r.document_id,
        });
      } else {
        r.current_level += 1;
      }
    }
    if (seg[3] === "reject") {
      r.status = "REJECTED";
      const po = d.purchaseOrders.find((x: any) => x.id === r.document_id);
      if (po) po.status = "DRAFT";
      pushNotification(tenantId, {
        category: "INFO",
        message: `${r.document_number} was rejected — returned to its author`,
        entity_type: r.document_type,
        entity_id: r.document_id,
      });
    }
    return ok(r);
  }

  /* ---------------------------------------------------------- financials */

  if (p === "/cash/bank-accounts") return ok(d.bankAccounts);
  if (p === "/gl/batches") return ok(d.glBatches);
  if (seg[0] === "gl" && seg[1] === "batches" && seg[2]) {
    const b = d.glBatches.find((x: any) => x.id === seg[2]);
    if (!b) throw new ApiError("Batch not found", 404);
    if (seg[3] === "post" && method === "POST") b.status = "POSTED";
    if (seg[3] === "submit" && method === "POST") b.status = "PENDING";
    return ok(b);
  }
  if (p === "/periods") return ok(d.periods);
  if (seg[0] === "periods" && seg[1] && seg[2] && method === "POST") {
    const per = d.periods.find((x: any) => x.period_name === seg[1] || x.id === seg[1]);
    if (!per) throw new ApiError("Period not found", 404);
    if (seg[2] === "close") {
      per.status = "CLOSED";
      per.closed_at = nowIso();
      per.closed_by = body.actor ?? "Accountant";
    }
    if (seg[2] === "open") {
      per.status = "OPEN";
      per.closed_at = null;
      per.closed_by = null;
    }
    return ok(per);
  }

  if (p === "/budgeting/versions") return ok(d.budgetVersions);
  if (p === "/budgeting/lines") return ok(d.budgetLines);
  if (p === "/budgeting/control")
    return ok({ id: "ctrl-1", mode: "ADVISORY", controlling_version_id: d.budgetVersions[0]?.id });

  if (p === "/fixed-assets/assets") return ok(d.fixedAssets);

  /* --------------------------------------------------------- collections */

  if (p === "/collections/cases") return ok(d.delinquency);
  if (p === "/collections/payment-plans") return ok(d.paymentPlans);
  if (p === "/collections/liens") return ok(d.liens);

  /* ------------------------------------------------------------ gateway */

  if (p === "/gateway/transactions") return ok(d.gatewayTxns);
  if (p === "/gateway/config")
    return ok({
      provider: "Stripe",
      mode: "TEST",
      card_enabled: true,
      ach_enabled: true,
      card_fee_pct: 2.9,
      card_fee_flat: 0.3,
      ach_fee_flat: 1.5,
      pass_fees_to_resident: true,
    });
  if (seg[0] === "gateway" && seg[1] === "transactions" && seg[3] === "refund") {
    const tx = d.gatewayTxns.find((x: any) => x.id === seg[2]);
    if (tx) tx.status = "REFUNDED";
    return ok(tx ?? {});
  }

  /* ---------------------------------------------------------- scheduler */

  if (p === "/scheduler/runs") return ok(d.schedulerRuns);
  if (p === "/scheduler/config")
    return ok({
      statements_enabled: true,
      statements_day: 1,
      board_packet_enabled: true,
      board_packet_day: 5,
      dunning_enabled: true,
      dunning_day: 10,
      late_fees_enabled: true,
      late_fees_day: 15,
    });
  if (seg[0] === "scheduler" && seg[1] === "run" && seg[2] && method === "POST") {
    const job = seg[2].toUpperCase();
    const run = {
      id: nextId("run"),
      job_name: job,
      status: "SUCCESS",
      trigger: "MANUAL",
      summary: `${job.replace(/_/g, " ").toLowerCase()} completed successfully`,
      started_at: nowIso(),
      duration_ms: 900 + Math.floor(Math.random() * 1800),
    };
    d.schedulerRuns.unshift(run);
    pushNotification(tenantId, {
      category: "INFO",
      message: `${job.replace(/_/g, " ")} finished — ${run.summary}`,
      entity_type: "Scheduler",
    });
    return ok(run);
  }

  /* ---------------------------------------------------------- migration */

  if (p === "/migration/batches") return ok(d.migrationBatches);
  if (p === "/migration/entities")
    return ok([
      "Homeowners", "Open AR balances", "Vendors", "Historical GL",
      "Fixed assets", "Open AP invoices", "Documents",
    ]);
  if (seg[0] === "migration" && seg[2] === "rollback" && method === "POST") {
    const b = d.migrationBatches.find((x: any) => x.id === seg[1]);
    if (b) b.status = "ROLLED_BACK";
    return ok(b ?? {});
  }

  /* -------------------------------------------------------------- board */

  if (p === "/board/exec-dashboard") return ok(d.boardDashboard);
  if (p === "/board/cash-flow-forecast") return ok(d.cashForecast);

  /* --------------------------------------------------------- compliance */

  if (p === "/compliance/checklist") {
    const summary = d.compliance.items.reduce(
      (acc: any, i: any) => {
        acc[i.status] = (acc[i.status] ?? 0) + 1;
        return acc;
      },
      { PASS: 0, WARN: 0, FAIL: 0, INFO: 0 }
    );
    return ok({ ...d.compliance, summary });
  }
  if (p === "/compliance/go-live/status")
    return ok({
      is_live: false,
      went_live_at: null,
      last_validation_at: nowIso(),
      last_validation_passed: false,
    });

  /* ------------------------------------------------------------ reports */

  if (p === "/reports/catalog")
    return ok([
      { id: "trial-balance", name: "Trial Balance", category: "Ledger", formats: ["PDF", "XLSX"], description: "Every account with its debit and credit totals for a period." },
      { id: "balance-sheet", name: "Balance Sheet", category: "Ledger", formats: ["PDF", "XLSX"], description: "Assets, liabilities and fund balances as at a date." },
      { id: "income-statement", name: "Income & Expense", category: "Ledger", formats: ["PDF", "XLSX"], description: "Revenue and expenditure for a period, by fund." },
      { id: "budget-vs-actual", name: "Budget vs Actual", category: "Ledger", formats: ["PDF", "XLSX"], description: "Every budget line against what was actually spent." },
      { id: "ar-aging", name: "AR Ageing", category: "Receivables", formats: ["PDF", "XLSX"], description: "Outstanding homeowner balances bucketed by age." },
      { id: "delinquency", name: "Delinquency Report", category: "Receivables", formats: ["PDF"], description: "Every account in collections and its current stage." },
      { id: "ap-aging", name: "AP Ageing", category: "Payables", formats: ["PDF", "XLSX"], description: "Outstanding vendor invoices bucketed by due date." },
      { id: "vendor-spend", name: "Vendor Spend (1099)", category: "Payables", formats: ["PDF", "XLSX"], description: "Year-to-date spend per vendor for tax reporting." },
      { id: "reserve-study", name: "Reserve Funding Status", category: "Reserves", formats: ["PDF"], description: "Reserve balance against the professional funding schedule." },
      { id: "service-requests", name: "Service Request Summary", category: "Operations", formats: ["PDF", "XLSX"], description: "Ticket volume, resolution time and category breakdown." },
      { id: "board-packet", name: "Monthly Board Packet", category: "Board", formats: ["PDF"], description: "The complete financial pack assembled for a board meeting." },
      { id: "audit-trail", name: "Audit Trail Export", category: "Compliance", formats: ["XLSX"], description: "Every recorded change over a date range." },
    ]);

  /* ------------------------------------------------- resident portal */

  if (seg[0] === "portal") {
    const residentId = c.q.get("resident") ?? body.resident_id ?? "";
    const resident =
      d.residents.find((r: any) => r.id === residentId) ?? d.residents[0];
    const unitsFor = (r: any) => {
      // A resident holds one unit, except the seeded multi-unit landlord.
      const own = d.homeowners.filter((h: any) => h.id === r?.homeowner_id);
      if (r?.unit_count > 1) {
        const extra = d.homeowners.filter(
          (h: any) => h.id !== r.homeowner_id && h.last_name === r.full_name.split(" ")[1]
        );
        return [...own, ...extra].slice(0, r.unit_count);
      }
      return own;
    };

    if (seg[1] === "residents") return ok(d.residents);

    if (seg[1] === "me") return ok(resident ?? null);

    if (seg[1] === "units") {
      const units = unitsFor(resident);
      if (seg[2]) {
        const unit = d.homeowners.find((h: any) => h.id === seg[2]);
        if (!unit) throw new ApiError("Unit not found", 404);

        if (seg[3] === "invoices") {
          return ok(
            Array.from({ length: 6 }, (_, i) => {
              const paid = i > 0 || unit.balance === 0;
              const dt = new Date();
              dt.setMonth(dt.getMonth() - i);
              return {
                id: `${unit.id}-inv-${i}`,
                invoice_number: `AS-${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, "0")}-${unit.property_unit}`,
                description: "Monthly assessment",
                period: dt.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
                due_date: new Date(dt.getFullYear(), dt.getMonth(), 1).toISOString().slice(0, 10),
                amount: unit.monthly_dues,
                paid_amount: paid ? unit.monthly_dues : 0,
                balance: paid ? 0 : unit.monthly_dues,
                status: paid ? "PAID" : "DUE",
              };
            })
          );
        }

        if (seg[3] === "receipts") {
          return ok(
            Array.from({ length: 5 }, (_, i) => {
              const dt = new Date();
              dt.setMonth(dt.getMonth() - (i + 1));
              return {
                id: `${unit.id}-rcpt-${i}`,
                receipt_number: `RCP-${4000 + i}`,
                paid_on: dt.toISOString().slice(0, 10),
                amount: unit.monthly_dues,
                method: i % 3 === 0 ? "Bank transfer" : "Card ••4242",
              };
            })
          );
        }

        if (seg[3] === "documents") {
          return ok(
            d.documents
              .filter((x: any) => x.visibility === "RESIDENTS")
              .concat([
                {
                  id: `${unit.id}-stmt`,
                  filename: `Statement — Unit ${unit.property_unit}.pdf`,
                  entity_type: "STATEMENT",
                  content_type: "application/pdf",
                  size_bytes: 184_000,
                  created_at: nowIso(),
                  visibility: "RESIDENTS",
                },
              ])
          );
        }
        if (seg[3]) throw new ApiError(`Unknown portal sub-resource: ${seg[3]}`, 404);
        return ok(unit);
      }

      return ok(
        units.map((u: any) => ({
          homeowner_id: u.id,
          unit_number: u.property_unit,
          account_number: u.account_number,
          balance: u.balance,
          monthly_dues: u.monthly_dues,
          status: u.status,
          is_primary: u.id === resident?.homeowner_id,
        }))
      );
    }

    if (seg[1] === "dashboard") {
      const units = unitsFor(resident);
      const balance = units.reduce((s: number, u: any) => s + u.balance, 0);
      return ok({
        resident_name: resident?.full_name ?? "Resident",
        resident_type: resident?.resident_type ?? "OWNER",
        unit_count: units.length,
        total_balance: balance,
        next_due_amount: units.reduce((s: number, u: any) => s + u.monthly_dues, 0),
        next_due_date: new Date(
          new Date().getFullYear(),
          new Date().getMonth() + 1,
          1
        )
          .toISOString()
          .slice(0, 10),
        open_tickets: d.tickets.filter(
          (t: any) =>
            units.some((u: any) => u.id === t.homeowner_id) &&
            t.status !== "CLOSED"
        ).length,
      });
    }

    if (seg[1] === "tickets") {
      const units = unitsFor(resident);
      if (method === "POST") {
        const unit = units[0];
        const ticket = {
          id: nextId("tk"),
          ticket_number: `SRV-${1200 + d.tickets.length}`,
          subject: body.subject ?? "Request from resident portal",
          description: body.description ?? "",
          category: body.category ?? "MAINTENANCE",
          priority: "MEDIUM",
          status: "OPEN",
          homeowner_id: unit?.id ?? null,
          reported_by: resident?.full_name ?? "Resident",
          unit: unit?.property_unit ?? "—",
          assigned_to: null,
          vendor_id: null,
          estimated_cost: null,
          po_header_id: null,
          created_at: nowIso(),
          updated_at: nowIso(),
          sla_due: null,
        };
        d.tickets.unshift(ticket);
        d.ticketComments[ticket.id] = [
          {
            id: nextId("c"),
            author: resident?.full_name ?? "Resident",
            role: "Resident",
            at: nowIso(),
            body: body.description ?? "Submitted through the resident portal.",
          },
        ];
        pushNotification(tenantId, {
          category: "INFO",
          message: `New portal request ${ticket.ticket_number} — ${ticket.subject}`,
          entity_type: "ServiceTicket",
          entity_id: ticket.id,
        });
        return ok(ticket);
      }
      return ok(
        d.tickets.filter((t: any) =>
          units.some((u: any) => u.id === t.homeowner_id)
        )
      );
    }

    if (seg[1] === "notifications") {
      return ok(
        d.notifications
          .filter((n: any) => !n.recipient_role_code)
          .slice(0, 5)
          .map((n: any) => ({ ...n, message: n.message }))
      );
    }

    if (seg[1] === "collections") {
      const units = unitsFor(resident);
      return ok({
        payment_plans: d.paymentPlans.filter((p: any) =>
          units.some((u: any) => u.id === p.homeowner_id)
        ),
        liens: d.liens.filter((l: any) =>
          units.some((u: any) => u.id === l.homeowner_id)
        ),
      });
    }
  }

  /* ------------------------------------------------- chart of accounts */

  if (p === "/coa/structures")
    return ok([{ id: "struct-1", name: "Standard Chart of Accounts", segment_count: 3 }]);
  if (p === "/coa/value-sets")
    return ok([
      { id: "vs-1", code: "FUND", name: "Fund", value_count: 2, validation_type: "Independent" },
      { id: "vs-2", code: "DEPT", name: "Department", value_count: 6, validation_type: "Independent" },
      { id: "vs-3", code: "ACCT", name: "Account", value_count: 42, validation_type: "Independent" },
    ]);
  if (seg[0] === "coa" && seg[1] === "structures" && seg[2] && seg[3] === "combinations")
    return ok([
      { id: "cc-1", segment_values: "10-100-1000", description: "Operating · Admin · Cash", enabled: true },
      { id: "cc-2", segment_values: "10-200-5000", description: "Operating · Maintenance · Supplies", enabled: true },
      { id: "cc-3", segment_values: "10-300-5100", description: "Operating · Landscaping · Service", enabled: true },
      { id: "cc-4", segment_values: "20-300-6000", description: "Reserve · Roofing · Capital", enabled: true },
      { id: "cc-5", segment_values: "10-100-3000", description: "Operating · Admin · HOA Dues Revenue", enabled: true },
      { id: "cc-6", segment_values: "20-300-6100", description: "Reserve · Paving · Capital", enabled: true },
    ]);
  if (seg[0] === "coa" && seg[1] === "structures" && seg[2])
    return ok({
      id: "struct-1",
      name: "Standard Chart of Accounts",
      segments: [
        { name: "Fund", length: 2, qualifier: "fund", value_set: "FUND" },
        { name: "Department", length: 3, qualifier: "cost_center", value_set: "DEPT" },
        { name: "Account", length: 4, qualifier: "natural_account", value_set: "ACCT" },
      ],
    });

  if (p === "/roles")
    return ok(
      Object.values(ROLES).map((r) => ({
        id: `role-${r.code}`,
        code: r.code,
        name: r.name,
        is_system: true,
        permission_count: r.perms === "*" ? 42 : r.perms.length,
      }))
    );

  /* ------------------------------------------------------------- ledger */

  if (p === "/gl/posting-runs")
    return ok(
      d.glBatches
        .filter((b: any) => b.status === "POSTED")
        .map((b: any, i: number) => ({
          id: `run-${i}`,
          period_name: b.period_name,
          batches: 1,
          total_debit: b.total_debit,
          total_credit: b.total_credit,
          posted_at: b.created_at,
          posted_by: "David Lin",
        }))
    );

  if (seg[0] === "budgeting" && seg[1] === "versions" && seg[2] && seg[3] === "vs-actual")
    return ok(
      d.budgetLines.map((b: any) => ({
        code_combination_id: b.id,
        account: b.account,
        name: b.name,
        fund_value: b.fund,
        budget: String(b.budget),
        actual: String(b.actual),
        variance: String(b.variance),
      }))
    );
  if (seg[0] === "budgeting" && seg[1] === "versions" && seg[2])
    return ok({
      ...(d.budgetVersions.find((v: any) => v.id === seg[2]) ?? d.budgetVersions[0]),
      lines: d.budgetLines.map((b: any) => ({
        id: b.id,
        code_combination_id: b.id,
        account: b.account,
        amount: String(b.budget),
      })),
    });

  /* --------------------------------------------------------------- cash */

  if (p === "/cash/position")
    return ok(
      d.bankAccounts.map((b: any) => ({
        bank_account_id: b.id,
        name: b.name,
        fund: b.fund,
        balance: String(b.balance),
        unreconciled: b.unreconciled_items,
      }))
    );
  if (p === "/cash/statements")
    return ok(
      d.bankAccounts.map((b: any, i: number) => ({
        id: `${b.id}-stmt`,
        bank_account_id: b.id,
        bank_account_name: b.name,
        statement_date: b.last_reconciled,
        opening_balance: String(Math.round(b.balance * 0.94)),
        closing_balance: String(b.balance),
        line_count: 28 + i * 6,
        matched: 28 + i * 6 - b.unreconciled_items,
        status: b.unreconciled_items === 0 ? "RECONCILED" : "PENDING",
      }))
    );

  /* ------------------------------------------------------ fixed assets */

  if (p === "/fixed-assets/reserve-studies")
    return ok([
      {
        id: `${tenantId}-rs-1`,
        name: "2025 Reserve Study",
        study_year: 2025,
        prepared_by: "Meridian Reserve Advisors",
        funded_pct: d.boardDashboard.reserve_funded_pct,
        recommended_annual: 74_000,
        actual_annual: Math.round(74_000 * (d.boardDashboard.reserve_funded_pct / 100)),
        status: "APPROVED",
      },
    ]);
  if (seg[0] === "fixed-assets" && seg[1] === "reserve-studies" && seg[3] === "vs-actual")
    return ok(
      d.fixedAssets.map((a: any) => ({
        component: a.name,
        category: a.category,
        replacement_cost: String(a.cost),
        remaining_life: a.remaining_life,
        funded: String(a.reserve_funded),
        shortfall: String(Math.max(0, a.cost - a.reserve_funded)),
      }))
    );

  /* ------------------------------------------------------ encumbrances */

  if (p === "/encumbrance" || p === "/encumbrance/commitments")
    return ok(
      d.purchaseOrders
        .filter((po: any) => po.status === "APPROVED")
        .map((po: any) => ({
          id: `${po.id}-enc`,
          po_header_id: po.id,
          po_number: po.po_number,
          vendor_name: po.vendor_name,
          fund: po.fund,
          account: po.account,
          committed: String(po.amount),
          relieved: String(po.amount_billed),
          outstanding: String(po.amount - po.amount_billed),
          status: po.amount_billed >= po.amount ? "RELIEVED" : "OUTSTANDING",
        }))
    );
  if (p === "/encumbrance/settings")
    return ok({ enabled: true, relieve_on: "INVOICE_MATCH", reserve_at: "PO_APPROVAL" });

  /* -------------------------------------------------------- AR billing */

  if (p === "/ar-billing/plans")
    return ok([
      {
        id: `${tenantId}-plan-monthly`,
        name: "Standard Monthly Assessment",
        plan_type: "MONTHLY_FEE",
        status: "ACTIVE",
        units_assigned: d.homeowners.length,
        lines: [
          { fund_value: "Operating", account: "10-100-3000", amount: "0.80" },
          { fund_value: "Reserve", account: "20-100-3100", amount: "0.20" },
        ],
      },
    ]);
  if (p === "/ar-billing/late-fee-rule")
    return ok({
      id: "lfr-1",
      fee_type: "FLAT",
      amount: "25.00",
      grace_days: 10,
      fund_value: "Operating",
      active: true,
    });

  /* -------------------------------------------------------- statements */

  if (p === "/statements/runs")
    return ok(
      d.schedulerRuns
        .filter((r: any) => r.job_name === "MONTHLY_STATEMENTS")
        .map((r: any, i: number) => ({
          id: `${tenantId}-stmt-run-${i}`,
          as_of: r.started_at.slice(0, 10),
          generated: d.homeowners.length,
          delivered: d.homeowners.length - (i === 0 ? 2 : 0),
          failed: i === 0 ? 2 : 0,
          status: r.status,
          run_at: r.started_at,
        }))
    );
  if (seg[0] === "statements" && seg[1] === "runs" && seg[3] === "deliveries")
    return ok(
      d.homeowners.slice(0, 8).map((h: any, i: number) => ({
        id: `${h.id}-del`,
        unit: h.property_unit,
        name: `${h.first_name} ${h.last_name}`,
        email: h.email,
        channel: "EMAIL",
        status: i === 3 ? "FAILED" : "DELIVERED",
        detail: i === 3 ? "Mailbox full" : "Opened",
      }))
    );
  if (p === "/statements/run" && method === "POST") {
    const run = {
      id: nextId("stmt"),
      job_name: "MONTHLY_STATEMENTS",
      status: "SUCCESS",
      trigger: "MANUAL",
      summary: `${d.homeowners.length} statements generated`,
      started_at: nowIso(),
      duration_ms: 2400,
    };
    d.schedulerRuns.unshift(run);
    return ok(run);
  }

  /* ----------------------------------------------------------- dunning */

  if (p === "/dunning/rules")
    return ok([
      { id: "dr-1", name: "First reminder", days_past_due: 15, action: "REMINDER", escalate_to_stage: null, attach_statement: true, active: true },
      { id: "dr-2", name: "Second notice", days_past_due: 30, action: "REMINDER", escalate_to_stage: null, attach_statement: true, active: true },
      { id: "dr-3", name: "Offer payment plan", days_past_due: 60, action: "ESCALATE", escalate_to_stage: "PAYMENT_PLAN", attach_statement: true, active: true },
      { id: "dr-4", name: "Refer for lien", days_past_due: 120, action: "ESCALATE", escalate_to_stage: "LIEN", attach_statement: false, active: true },
    ]);
  if (p === "/dunning/logs")
    return ok(
      d.delinquency.map((c: any, i: number) => ({
        id: `${c.id}-log`,
        unit: c.unit,
        name: c.name,
        days_past_due: c.days_past_due,
        action: c.days_past_due > 60 ? "ESCALATE" : "REMINDER",
        status: "SENT",
        balance: c.balance,
        sent_at: c.last_notice,
      }))
    );

  /* ------------------------------------------------------- collections */

  if (p === "/collections/aging") return ok(d.aging);

  /* ------------------------------------------------------------- fallback */

  return ok([]);
}

/* ------------------------------------------------------- file "downloads" */

/** In the demo there is no server, so a download produces a readable stub. */
export async function downloadFile(
  path: string,
  _token: string,
  _tenantId: string,
  filename: string
): Promise<void> {
  await new Promise((r) => setTimeout(r, 400));
  const blob = new Blob(
    [
      `Casa Harmony — demo export\n\n` +
        `File: ${filename}\nEndpoint: ${path}\nGenerated: ${new Date().toISOString()}\n\n` +
        `This is a placeholder produced by the front-end demo build.\n` +
        `Against the live server this endpoint returns the real document.\n`,
    ],
    { type: "text/plain" }
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/\.(pdf|xlsx|docx)$/i, ".txt");
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadExport(
  structureId: string,
  token: string,
  tenantId: string,
  filename = "chart_of_accounts.xlsx"
): Promise<void> {
  return downloadFile(
    `/coa/structures/${structureId}/export`,
    token,
    tenantId,
    filename
  );
}
