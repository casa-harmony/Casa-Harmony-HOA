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
  body?: unknown;
  token?: string | null;
  tenantId?: string | null;
}

function headers(opts: FetchOpts): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) h["Authorization"] = `Bearer ${opts.token}`;
  if (opts.tenantId) h["X-Tenant-Id"] = opts.tenantId;
  return h;
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: FetchOpts = {}
): Promise<T> {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 300));

  // Mock data router
  if (path === "/coa/structures") {
    return [{ id: "struct-1", name: "Standard Chart of Accounts" }] as any as T;
  }
  if (path === "/coa/value-sets") {
    return [
      { id: "vs-1", code: "DEPT", name: "Department" },
      { id: "vs-2", code: "FUND", name: "Fund" },
      { id: "vs-3", code: "ACCT", name: "Account" }
    ] as any as T;
  }
  if (path.startsWith("/coa/structures/") && path.endsWith("/combinations")) {
    return [
      { id: "combo-1", segment_values: "10-100-1000", description: "Operating Fund - Admin - Cash" },
      { id: "combo-2", segment_values: "10-200-5000", description: "Operating Fund - Maintenance - Supplies" },
      { id: "combo-3", segment_values: "20-100-2000", description: "Reserve Fund - Admin - Accounts Payable" },
      { id: "combo-4", segment_values: "20-300-6000", description: "Reserve Fund - Landscaping - Service" },
      { id: "combo-5", segment_values: "10-100-3000", description: "Operating Fund - Admin - HOA Dues" }
    ] as any as T;
  }
  if (path.startsWith("/coa/structures/")) {
    return {
      id: "struct-1",
      name: "Standard Chart of Accounts",
      segments: [
        { name: "Fund", length: 2 },
        { name: "Department", length: 3 },
        { name: "Account", length: 4 }
      ]
    } as any as T;
  }
  if (path.includes("/approvals/requests")) {
    return [
      { id: "app-1", status: "PENDING" },
      { id: "app-2", status: "PENDING" },
      { id: "app-3", status: "PENDING" },
      { id: "app-4", status: "PENDING" },
      { id: "app-5", status: "PENDING" },
      { id: "app-6", status: "PENDING" },
      { id: "app-7", status: "PENDING" }
    ] as any as T;
  }
  if (path.includes("/gl/batches")) {
    return [
      { id: "batch-1", status: "UNPOSTED" },
      { id: "batch-2", status: "UNPOSTED" },
      { id: "batch-3", status: "UNPOSTED" },
      { id: "batch-4", status: "UNPOSTED" },
      { id: "batch-5", status: "POSTED" }
    ] as any as T;
  }
  if (path.includes("/service-desk/tickets")) {
    return [
      { id: "tk-1", ticket_number: "SRV-1042", subject: "Water leaking from ceiling in lobby", category: "MAINTENANCE", priority: "HIGH", status: "OPEN", vendor_id: "vendor-1", estimated_cost: "450.00", created_at: "2024-03-10T09:00:00Z" },
      { id: "tk-2", ticket_number: "SRV-1043", subject: "Pool heater not working", category: "MAINTENANCE", priority: "MEDIUM", status: "IN_PROGRESS", vendor_id: "vendor-2", estimated_cost: "1200.00", created_at: "2024-03-09T14:30:00Z" },
      { id: "tk-3", ticket_number: "SRV-1044", subject: "Noise complaint - Unit 4B", category: "COMPLAINT", priority: "MEDIUM", status: "RESOLVED", created_at: "2024-03-08T22:15:00Z" },
      { id: "tk-4", ticket_number: "SRV-1045", subject: "Request for new pool key", category: "REQUEST", priority: "LOW", status: "CLOSED", created_at: "2024-03-05T10:00:00Z" },
      { id: "tk-5", ticket_number: "SRV-1046", subject: "Landscaping overgrowth near building 3", category: "MAINTENANCE", priority: "LOW", status: "OPEN", vendor_id: "vendor-1", estimated_cost: "250.00", created_at: "2024-03-11T08:00:00Z" },
    ] as any as T;
  }
  if (path.includes("/purchasing")) {
    return [
      { id: "po-1", status: "APPROVED" },
      { id: "po-2", status: "PENDING" },
      { id: "po-3", status: "PENDING" }
    ] as any as T;
  }
  if (path.includes("/subledger/aging")) {
    return { grand_total: 125430.50 } as any as T;
  }
  if (path === "/tenants") {
    return [
      { id: "tenant-1", name: "Sunnyvale HOA", slug: "sunnyvale" },
      { id: "tenant-2", name: "Oakridge HOA", slug: "oakridge" },
      { id: "tenant-3", name: "Pinecrest HOA", slug: "pinecrest" },
      { id: "tenant-4", name: "Lakeside HOA", slug: "lakeside" }
    ] as any as T;
  }
  if (path === "/vendors") {
    return [
      { id: "vendor-1", name: "Acme Landscaping" },
      { id: "vendor-2", name: "City Water Corp" },
      { id: "vendor-3", name: "Pro Security Services" }
    ] as any as T;
  }
  if (path === "/users") {
    return [
      { id: "user-1", email: "demo@casaharmony.ai", full_name: "Demo User", is_superadmin: true, is_active: true },
      { id: "user-2", email: "manager@casaharmony.ai", full_name: "Property Manager", is_superadmin: false, is_active: true },
      { id: "user-3", email: "board@casaharmony.ai", full_name: "Board Member", is_superadmin: false, is_active: true }
    ] as any as T;
  }
  if (path === "/roles") {
    return [
      { id: "role-1", code: "SUPERADMIN", is_system: true },
      { id: "role-2", code: "ADMIN", is_system: true },
      { id: "role-3", code: "MANAGER", is_system: true },
      { id: "role-4", code: "READ_ONLY", is_system: false }
    ] as any as T;
  }
  
  if (path === "/residents") {
    return [
      { id: "res-1", username: "sarahj101", full_name: "Sarah Jenkins", resident_type: "OWNER", unit_count: 1 },
      { id: "res-2", username: "mchen204", full_name: "Michael Chen", resident_type: "RENTER", unit_count: 1 },
      { id: "res-3", username: "robert.w", full_name: "Robert Williams", resident_type: "OWNER", unit_count: 2 },
    ] as any as T;
  }
  if (path === "/subledger/homeowners") {
    return [
      { id: "ho-1", account_number: "HO-101", first_name: "Sarah", last_name: "Jenkins", property_unit: "101" },
      { id: "ho-2", account_number: "HO-204", first_name: "Landlord", last_name: "LLC", property_unit: "204" },
      { id: "ho-3", account_number: "HO-305", first_name: "Robert", last_name: "Williams", property_unit: "305" },
      { id: "ho-4", account_number: "HO-306", first_name: "Robert", last_name: "Williams", property_unit: "306" },
    ] as any as T;
  }
  if (path.includes("/residents/") && path.endsWith("/units")) {
    return [
      { id: "ru-1", unit_number: "101", is_primary: true }
    ] as any as T;
  }
  
  if (path === "/documents") {
    return [
      { id: "doc-1", filename: "2024_Annual_Budget.pdf", entity_type: "BUDGET", entity_id: "bdg-2024", content_type: "application/pdf", size_bytes: 1450000, created_at: "2024-01-15T10:00:00Z" },
      { id: "doc-2", filename: "Q3_Board_Meeting_Minutes.docx", entity_type: "BOARD_MEETING", entity_id: "mtg-q3", content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size_bytes: 520000, created_at: "2024-03-01T14:30:00Z" },
      { id: "doc-3", filename: "Community_Rules_v2.pdf", entity_type: "HOA_RULES", entity_id: "rules-v2", content_type: "application/pdf", size_bytes: 2100000, created_at: "2023-11-20T09:15:00Z" },
      { id: "doc-4", filename: "Acme_Landscaping_Invoice_Mar.pdf", entity_type: "AP_INVOICE", entity_id: "inv-1029", content_type: "application/pdf", size_bytes: 340000, created_at: "2024-03-05T11:45:00Z" },
    ] as any as T;
  }

  if (path.includes("/notifications")) {
    return [
      { id: "notif-1", category: "BUDGET_OVERRUN", message: "Maintenance expense exceeded 90% of monthly budget", entity_type: "ApInvoice", is_read: false, created_at: "2024-03-12T10:00:00Z" },
      { id: "notif-2", category: "INFO", message: "New Service Ticket #SRV-1042 assigned to you", entity_type: "ServiceTicket", is_read: false, created_at: "2024-03-10T09:05:00Z" },
      { id: "notif-3", category: "HOLD", message: "Invoice #1029 placed on hold due to missing approval", entity_type: "ApInvoice", is_read: true, created_at: "2024-03-05T14:30:00Z" },
      { id: "notif-4", category: "INFO", message: "System maintenance scheduled for Friday 2AM", entity_type: "System", is_read: true, created_at: "2024-03-01T08:00:00Z" },
    ] as any as T;
  }

  if (path === "/vendors") {
    return [
      { id: "vend-1", name: "Acme Landscaping", vendor_number: "V1001", status: "ACTIVE" },
      { id: "vend-2", name: "City Water Works", vendor_number: "V1002", status: "ACTIVE" },
      { id: "vend-3", name: "Elevator Co.", vendor_number: "V1003", status: "ACTIVE" },
    ] as any as T;
  }

  if (path === "/payables") {
    return [
      { id: "inv-1", invoice_number: "INV-2024-01", amount: "4500.00", tax_amount: "0.00", match_status: "MATCHED", status: "PAID", invoice_date: "2024-02-15", vendor_id: "vend-1" },
      { id: "inv-2", invoice_number: "WATER-0324", amount: "1250.75", tax_amount: "50.00", match_status: "NOT_MATCHED", status: "APPROVED", invoice_date: "2024-03-10", vendor_id: "vend-2" },
      { id: "inv-3", invoice_number: "ELEV-998", amount: "2100.00", tax_amount: "100.00", match_status: "MATCH_EXCEPTION", status: "DRAFT", invoice_date: "2024-03-12", vendor_id: "vend-3", on_hold: true, hold_reason: "Price discrepancy" },
    ] as any as T;
  }

  if (path === "/budgeting/control") {
    return { id: "ctrl-1", mode: "ADVISORY", controlling_version_id: "bv-2024" } as any as T;
  }

  if (path === "/budgeting/versions") {
    return [
      { id: "bv-2024", name: "FY2024 Operating", fiscal_year: 2024, version_type: "ORIGINAL", status: "APPROVED", is_controlling: true },
      { id: "bv-2025", name: "FY2025 Operating", fiscal_year: 2025, version_type: "DRAFT", status: "DRAFT", is_controlling: false },
    ] as any as T;
  }
  
  if (path.match(/^\/budgeting\/versions\/[^\/]+$/)) {
    return {
      id: "bv-2024", name: "FY2024 Operating", fiscal_year: 2024, version_type: "ORIGINAL", status: "APPROVED", is_controlling: true,
      lines: [
        { id: "l1", code_combination_id: "cc-1", amount: "50000.00" },
        { id: "l2", code_combination_id: "cc-2", amount: "12000.00" },
      ]
    } as any as T;
  }

  if (path.match(/^\/budgeting\/versions\/[^\/]+\/vs-actual/)) {
    return [
      { code_combination_id: "cc-1", account: "01-100-5000", fund_value: "Operating", budget: "50000.00", actual: "48500.00", variance: "1500.00" },
      { code_combination_id: "cc-2", account: "01-200-6000", fund_value: "Operating", budget: "12000.00", actual: "15000.00", variance: "-3000.00" },
    ] as any as T;
  }

  // Default mock response for anything else (safe array to avoid map errors on unknown list endpoints)
  return [] as any as T;
}

/** Download any binary export endpoint and trigger a browser save. */
export async function downloadFile(
  path: string,
  token: string,
  tenantId: string,
  filename: string
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": tenantId },
  });
  if (!res.ok) throw new ApiError("Download failed", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Download the COA xlsx export and trigger a browser save. */
export async function downloadExport(
  structureId: string,
  token: string,
  tenantId: string,
  filename = "chart_of_accounts.xlsx"
): Promise<void> {
  const res = await fetch(
    `${API_BASE}/coa/structures/${structureId}/export`,
    { headers: { Authorization: `Bearer ${token}`, "X-Tenant-Id": tenantId } }
  );
  if (!res.ok) throw new ApiError("Export failed", res.status);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
