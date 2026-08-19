/**
 * Roles, permissions and navigation — mirrored from the backend's
 * app/core/permissions.py so the demo tells the truth about access.
 *
 * Anything added here must exist on the server too.
 */

export type PermissionCode = string;

/** code -> [category, plain-English description shown in the UI] */
export const PERMISSIONS: Record<PermissionCode, [string, string]> = {
  "tenant.create": ["Platform", "Create new communities"],
  "tenant.read": ["Platform", "View community details"],
  "tenant.update": ["Platform", "Update community configuration"],
  "tenant.suspend": ["Platform", "Suspend or reactivate communities"],

  "user.manage": ["Security", "Create and manage staff accounts"],
  "role.manage": ["Security", "Create and assign roles"],
  "membership.manage": ["Security", "Grant or revoke community access"],
  "approval.config": ["Security", "Configure approval hierarchies"],

  "coa.read": ["Chart of Accounts", "View the chart of accounts"],
  "coa.structure.manage": ["Chart of Accounts", "Change the account code structure"],
  "coa.segment.manage": ["Chart of Accounts", "Define and order account segments"],
  "coa.valueset.manage": ["Chart of Accounts", "Manage value sets and their values"],
  "coa.combination.manage": ["Chart of Accounts", "Create and validate account codes"],
  "coa.export": ["Chart of Accounts", "Export the chart of accounts"],

  "audit.read": ["Audit", "Read the audit trail"],

  "ticket.manage": ["Service Desk", "Create and manage service tickets"],
  "resident.manage": ["Residents", "Manage resident logins and unit links"],
  "document.manage": ["Documents", "Upload, view and manage documents"],

  "vendor.manage": ["Masters", "Manage vendors and suppliers"],
  "bank.manage": ["Masters", "Manage banks and bank accounts"],

  "po.manage": ["Procurement", "Create and edit purchase orders"],
  "po.approve": ["Procurement", "Approve purchase orders"],
  "po.receive": ["Procurement", "Record and inspect deliveries"],

  "ap.manage": ["Payables", "Enter and edit vendor invoices"],
  "ap.approve": ["Payables", "Approve vendor invoices"],
  "ap.pay": ["Payables", "Create, void and stop payments"],
  "ap.config": ["Payables", "Configure terms, methods and distribution sets"],

  "ar.manage": ["Receivables", "Manage homeowner accounts and billing"],
  "ar.receipt.manage": ["Receivables", "Record homeowner payments"],
  "collections.manage": ["Receivables", "Delinquency, payment plans, liens"],

  "cash.manage": ["Cash", "Bank accounts, statements and reconciliation"],
  "fa.manage": ["Fixed Assets", "Fixed assets, depreciation, reserve studies"],

  "budget.manage": ["Ledger", "Create and edit budget versions"],
  "budget.approve": ["Ledger", "Approve budgets and set budgetary control"],
  "gl.journal.manage": ["Ledger", "Create GL journal entries"],
  "gl.batch.manage": ["Ledger", "Prepare GL journal batches"],
  "gl.batch.approve": ["Ledger", "Approve and post GL journal batches"],
  "gl.period.manage": ["Ledger", "Open and close accounting periods"],
  "report.read": ["Ledger", "Run financial reports"],

  "payment.manage": ["Payments", "Payment gateway and card tokenisation"],
  "privacy.manage": ["Compliance", "Process privacy and data-subject requests"],
  "compliance.manage": ["Compliance", "Go-live checklist, health and compliance"],
  "scheduler.manage": ["Platform", "Configure scheduled jobs"],
  "data.migrate": ["Platform", "Import and roll back legacy data"],
};

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS);

/* ------------------------------------------------------------------ roles */

const SYSADMIN_PERMS = [
  "tenant.read", "tenant.update",
  "user.manage", "role.manage", "membership.manage",
  "coa.structure.manage", "coa.segment.manage", "coa.valueset.manage",
  "coa.combination.manage", "coa.read", "coa.export",
  "audit.read", "gl.journal.manage", "ar.manage", "payment.manage",
  "privacy.manage", "vendor.manage", "bank.manage", "ap.config",
  "po.manage", "po.approve", "ap.manage", "ap.approve", "ap.pay",
  "po.receive", "cash.manage", "fa.manage", "document.manage",
  "collections.manage", "scheduler.manage", "ar.receipt.manage",
  "gl.batch.manage", "gl.batch.approve", "gl.period.manage", "report.read",
  "ticket.manage", "approval.config", "budget.manage", "budget.approve",
  "compliance.manage", "resident.manage", "data.migrate",
];

const HOA_ADMIN_PERMS = [
  "user.manage", "membership.manage",
  "coa.segment.manage", "coa.valueset.manage", "coa.combination.manage",
  "coa.read", "coa.export", "audit.read",
  "gl.journal.manage", "ar.manage", "payment.manage",
  "vendor.manage", "bank.manage", "ap.config",
  "po.manage", "po.approve", "ap.manage", "ap.approve", "ap.pay", "po.receive",
  "cash.manage", "fa.manage", "document.manage", "collections.manage",
  "scheduler.manage", "ar.receipt.manage",
  "gl.batch.manage", "gl.batch.approve", "gl.period.manage", "report.read",
  "ticket.manage", "approval.config", "budget.manage", "budget.approve",
  "compliance.manage", "resident.manage", "data.migrate",
];

const ACCOUNTANT_PERMS = [
  "coa.valueset.manage", "coa.combination.manage", "coa.read", "coa.export",
  "gl.journal.manage", "ar.manage",
  "vendor.manage", "bank.manage", "po.manage", "po.receive", "ap.manage",
  "ar.receipt.manage", "gl.batch.manage", "gl.batch.approve",
  "gl.period.manage", "report.read", "budget.manage", "budget.approve",
  "ap.pay", "ap.config", "cash.manage", "fa.manage", "document.manage",
  "collections.manage", "scheduler.manage",
];

/**
 * BOARD_MEMBER does not exist on the server yet — it is referenced by the
 * scheduled board-packet job but was never defined in SYSTEM_ROLES.
 * Included here as the proposed shape for the client to approve.
 */
const BOARD_MEMBER_PERMS = [
  "coa.read", "report.read", "budget.manage",
  "document.manage", "ticket.manage",
  "po.approve", "ap.approve", "compliance.manage",
];

export interface RoleDef {
  code: string;
  name: string;
  blurb: string;
  scope: string;
  perms: "*" | string[];
  /** Whether this role exists on the server today. */
  implemented: boolean;
  can: string[];
  cannot: string[];
}

export const ROLES: Record<string, RoleDef> = {
  SUPERADMIN: {
    code: "SUPERADMIN",
    name: "Platform Super Administrator",
    blurb:
      "You — the company that sells and operates the platform. Normally held only by your own team, never by a client.",
    scope: "Every community on the platform",
    perms: "*",
    implemented: true,
    can: [
      "Create a brand-new community and set it up from nothing",
      "Suspend or reactivate any community",
      "Enter any community and act with full powers",
      "See the platform-wide audit trail",
    ],
    cannot: ["Nothing — this role implicitly holds every permission"],
  },
  SYSADMIN: {
    code: "SYSADMIN",
    name: "System Administrator",
    blurb:
      "Senior staff at the management company who oversee several communities — an operations director or regional manager.",
    scope: "Several communities",
    perms: SYSADMIN_PERMS,
    implemented: true,
    can: [
      "Work across every community they are granted, switching between them",
      "Create staff accounts and grant them roles",
      "Change the account code structure itself, not just its values",
      "Handle privacy and data-subject requests",
    ],
    cannot: [
      "Create a brand-new community",
      "Suspend a community",
      "Reach a community they have not been granted",
    ],
  },
  HOA_ADMIN: {
    code: "HOA_ADMIN",
    name: "HOA Administrator",
    blurb:
      "The property manager responsible for one community. In daily use this is the busiest role in the product.",
    scope: "One community",
    perms: HOA_ADMIN_PERMS,
    implemented: true,
    can: [
      "Run the service desk end to end — triage, assign, close",
      "Approve purchase orders and vendor invoices",
      "Configure who approves what, and at which amounts",
      "Manage resident portal accounts and their unit links",
    ],
    cannot: [
      "See or touch any other community",
      "Change the underlying account code structure",
      "Handle privacy and data-subject requests",
    ],
  },
  ACCOUNTANT: {
    code: "ACCOUNTANT",
    name: "Accountant / Controller",
    blurb:
      "The bookkeeper who keeps the community's books. Deliberately able to prepare financial work but not to authorise it.",
    scope: "One community",
    perms: ACCOUNTANT_PERMS,
    implemented: true,
    can: [
      "Enter purchase orders, vendor invoices and homeowner receipts",
      "Post journal batches and close accounting periods",
      "Reconcile bank accounts and manage fixed assets",
      "Build budgets and run every financial report",
    ],
    cannot: [
      "Approve a purchase order or vendor invoice — separation of duties",
      "Touch the service desk",
      "Create staff accounts or change anyone's role",
      "Configure the approval rules that govern their own work",
    ],
  },
  BOARD_MEMBER: {
    code: "BOARD_MEMBER",
    name: "Board Member",
    blurb:
      "An elected volunteer homeowner on the board. The server already notifies this role when the monthly board packet is produced — but the role itself was never defined, so nobody can hold it yet.",
    scope: "One community",
    perms: BOARD_MEMBER_PERMS,
    implemented: false,
    can: [
      "Read the budget and every financial report",
      "Read the board dashboard and cash-flow forecast",
      "Read open tickets and community documents",
      "Approve spending above a configured threshold",
    ],
    cannot: [
      "Edit any financial record",
      "Manage staff accounts or residents",
      "Enter invoices or issue payments",
    ],
  },
  VIEWER: {
    code: "VIEWER",
    name: "Viewer (read-only)",
    blurb:
      "Intended for auditors and inspectors. As built it is far narrower than that intent — see the note on the Roles & Flow screen.",
    scope: "One community",
    perms: ["coa.read"],
    implemented: true,
    can: ["View the chart of accounts"],
    cannot: [
      "View the budget",
      "View any financial report",
      "View the board dashboard",
      "View tickets, documents or anything operational",
    ],
  },
};

export function roleHas(roleCode: string, perm: PermissionCode): boolean {
  const role = ROLES[roleCode];
  if (!role) return false;
  if (role.perms === "*") return true;
  return role.perms.includes(perm);
}

export function permsFor(roleCode: string): string[] {
  const role = ROLES[roleCode];
  if (!role) return [];
  return role.perms === "*" ? ALL_PERMISSIONS : role.perms;
}

/* ------------------------------------------------------------- navigation */

export interface NavItem {
  href: string;
  label: string;
  /** Required permission. null = always visible. */
  perm: PermissionCode | null;
  /** Client's current MVP priority — surfaced with a marker in the sidebar. */
  priority?: boolean;
  /**
   * Out of the current demo scope. Hidden from the sidebar entirely; the screen
   * itself is untouched and still works if reached directly by URL.
   * Remove the flag to bring the item back into the menu.
   */
  disabled?: boolean;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/**
 * Groups, order and labels mirror the real application's sidebar —
 * frontend/app/(app)/layout.tsx. Keep the two in step: the demo is only
 * honest if the menu matches what the client will actually be handed.
 *
 * The only addition is the Reference group, which points at the two screens
 * that exist to explain the demo itself.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Core Operations",
    items: [
      { href: "/dashboard", label: "Dashboard", perm: null, priority: true },
      { href: "/service-desk", label: "Service Desk", perm: "ticket.manage", priority: true },
      { href: "/residents", label: "Residents", perm: "resident.manage", priority: true },
      { href: "/documents", label: "Documents", perm: "document.manage", priority: true },
      { href: "/notifications", label: "Notifications", perm: null, priority: true },
      { href: "/inbox", label: "Test Inbox", perm: "tenant.create", priority: true },
    ],
  },
  {
    title: "Financial Setup",
    items: [
      { href: "/coa", label: "Chart of Accounts", perm: "coa.read" },
      { href: "/value-sets", label: "Value Sets", perm: "coa.valueset.manage" },
      { href: "/vendors", label: "Vendors", perm: "vendor.manage", priority: true },
      { href: "/ap-setup", label: "AP Setup", perm: "ap.config" },
      { href: "/cash", label: "Cash & Bank Rec", perm: "cash.manage" },
      { href: "/budgets", label: "Budgets", perm: "budget.manage" },
      { href: "/fixed-assets", label: "Fixed Assets", perm: "fa.manage" },
    ],
  },
  {
    title: "Accounts Payable",
    items: [
      { href: "/purchasing", label: "Purchasing (PO)", perm: "po.manage" },
      { href: "/receiving", label: "Receiving", perm: "po.receive" },
      { href: "/encumbrance", label: "Encumbrances", perm: "po.manage" },
      { href: "/payables", label: "Payables (AP)", perm: "ap.manage", priority: true },
      { href: "/payments", label: "Payments (AP)", perm: "ap.pay", priority: true },
    ],
  },
  {
    title: "Accounts Receivable",
    items: [
      { href: "/ar-billing", label: "AR Billing", perm: "ar.manage" },
      { href: "/collections", label: "Collections", perm: "collections.manage" },
      { href: "/statements", label: "AR Statements", perm: "ar.manage" },
      { href: "/dunning", label: "Dunning", perm: "collections.manage" },
      { href: "/receivables", label: "Receivables (AR)", perm: "ar.manage" },
    ],
  },
  {
    title: "General Ledger",
    items: [
      { href: "/gl", label: "General Ledger", perm: "gl.batch.manage" },
      { href: "/periods", label: "Period Close", perm: "gl.period.manage" },
      { href: "/approvals", label: "Approvals", perm: "approval.config" },
    ],
  },
  {
    title: "System Admin",
    items: [
      { href: "/users", label: "Users & Roles", perm: "user.manage", priority: true },
      { href: "/tenants", label: "HOAs (Tenants)", perm: "tenant.create", priority: true },
      { href: "/gateway", label: "Payment Gateway", perm: "payment.manage", priority: true },
      { href: "/scheduler", label: "Scheduled Jobs", perm: "scheduler.manage", priority: true },
      { href: "/reports", label: "Reports", perm: "report.read", priority: true },
      { href: "/board", label: "Board Dashboard", perm: "report.read", priority: true },
      { href: "/migration", label: "Data Migration", perm: "data.migrate", priority: true },
      { href: "/go-live", label: "Go-Live & Compliance", perm: "compliance.manage", priority: true },
    ],
  },
  {
    title: "Reference",
    items: [
      { href: "/roles-and-flow", label: "Roles, Access & Flow", perm: null, priority: true },
      { href: "/portal/login", label: "Resident Portal ↗", perm: null, priority: true },
    ],
  },
];

/** Nav filtered to what a role may actually reach. */
export function navFor(roleCode: string): NavGroup[] {
  return NAV_GROUPS.map((g) => ({
    title: g.title,
    items: g.items.filter(
      (i) => !i.disabled && (i.perm === null || roleHas(roleCode, i.perm))
    ),
  })).filter((g) => g.items.length > 0);
}

/** Nav filtered by actual backend permissions, authoritative for live mode. */
export function navForPermissions(permissions: string[], isSuperadmin: boolean): NavGroup[] {
  const permSet = new Set(permissions);
  return NAV_GROUPS.map((g) => ({
    title: g.title,
    items: g.items.filter(
      (i) => !i.disabled && (i.perm === null || isSuperadmin || permSet.has(i.perm))
    ),
  })).filter((g) => g.items.length > 0);
}
