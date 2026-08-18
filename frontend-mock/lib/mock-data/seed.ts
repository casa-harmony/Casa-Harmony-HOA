/**
 * Demo dataset — three complete communities.
 *
 * Everything is cross-linked: a ticket points at a real vendor, which has real
 * invoices, which have real payments, which appear on the real bank statement.
 * Switching community in the header swaps the entire dataset.
 */

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  legal_name: string;
  status: string;
  num_units: number;
  city: string;
  state: string;
  timezone: string;
  founded: string;
  monthly_dues: number;
  kind: string;
}

export const TENANTS: Tenant[] = [
  {
    id: "tenant-1",
    name: "Sunnyvale Gardens",
    slug: "sunnyvale",
    legal_name: "Sunnyvale Gardens Homeowners Association, Inc.",
    status: "active",
    num_units: 148,
    city: "Sunnyvale",
    state: "CA",
    timezone: "America/Los_Angeles",
    founded: "2004",
    monthly_dues: 385,
    kind: "Condominium complex · 6 buildings",
  },
  {
    id: "tenant-2",
    name: "Oakridge Estates",
    slug: "oakridge",
    legal_name: "Oakridge Estates Community Association",
    status: "active",
    num_units: 92,
    city: "Plano",
    state: "TX",
    timezone: "America/Chicago",
    founded: "2011",
    monthly_dues: 240,
    kind: "Gated single-family · 92 lots",
  },
  {
    id: "tenant-3",
    name: "Pinecrest Towers",
    slug: "pinecrest",
    legal_name: "Pinecrest Towers Condominium Association",
    status: "active",
    num_units: 210,
    city: "Fort Lauderdale",
    state: "FL",
    timezone: "America/New_York",
    founded: "1998",
    monthly_dues: 615,
    kind: "High-rise · 22 floors",
  },
];

/* ------------------------------------------------------------- demo logins */

export interface Persona {
  id: string;
  email: string;
  full_name: string;
  role_code: string;
  tenant_ids: string[];
  is_superadmin: boolean;
  title: string;
  /** One-line explanation shown under the picker on the login screen. */
  pitch: string;
}

export const PERSONAS: Persona[] = [
  {
    id: "user-1",
    email: "avery.stone@casaharmony.ai",
    full_name: "Avery Stone",
    role_code: "SUPERADMIN",
    tenant_ids: ["tenant-1", "tenant-2", "tenant-3"],
    is_superadmin: true,
    title: "Platform Operations, Casa Harmony",
    pitch:
      "Sees every community on the platform and can create or suspend them. This is your own team, not the client's.",
  },
  {
    id: "user-2",
    email: "morgan.reyes@harborpm.com",
    full_name: "Morgan Reyes",
    role_code: "SYSADMIN",
    tenant_ids: ["tenant-1", "tenant-2", "tenant-3"],
    is_superadmin: false,
    title: "Regional Director, Harbor Property Management",
    pitch:
      "Oversees all three communities. Full operational and financial control, but cannot create or suspend a community.",
  },
  {
    id: "user-3",
    email: "jane.okafor@harborpm.com",
    full_name: "Jane Okafor",
    role_code: "HOA_ADMIN",
    tenant_ids: ["tenant-1", "tenant-2"],
    is_superadmin: false,
    title: "Property Manager, Sunnyvale Gardens",
    pitch:
      "The busiest role. Runs the service desk, approves spending, manages residents — for her communities only.",
  },
  {
    id: "user-4",
    email: "david.lin@harborpm.com",
    full_name: "David Lin",
    role_code: "ACCOUNTANT",
    tenant_ids: ["tenant-1", "tenant-3"],
    is_superadmin: false,
    title: "Controller, Harbor Property Management",
    pitch:
      "Prepares every financial document but cannot approve any of them. Watch the sidebar lose Service Desk and Users.",
  },
  {
    id: "user-5",
    email: "priya.raman@sunnyvalegardens.org",
    full_name: "Priya Raman",
    role_code: "BOARD_MEMBER",
    tenant_ids: ["tenant-1"],
    is_superadmin: false,
    title: "Board Treasurer, Sunnyvale Gardens",
    pitch:
      "An elected volunteer homeowner. Reads the finances and approves large spend. This role is proposed, not yet built on the server.",
  },
  {
    id: "user-6",
    email: "auditor@brightlineaudit.com",
    full_name: "Tom Fairbanks",
    role_code: "VIEWER",
    tenant_ids: ["tenant-1"],
    is_superadmin: false,
    title: "External Auditor, Brightline Audit LLP",
    pitch:
      "Read-only. As built today this role sees almost nothing — a gap worth discussing with the client.",
  },
];

/* ------------------------------------------------------------------ helpers */

function iso(daysAgo: number, hour = 9, min = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}

function dateOnly(daysAgo: number): string {
  return iso(daysAgo).slice(0, 10);
}

function pick<T>(arr: T[], i: number): T {
  return arr[i % arr.length];
}

/* ------------------------------------------------------------------ vendors */

const VENDOR_TEMPLATES = [
  { name: "Acme Landscaping Co.", cat: "Landscaping", terms: "Net 30" },
  { name: "BluePeak Plumbing", cat: "Plumbing", terms: "Net 15" },
  { name: "Sterling Elevator Services", cat: "Elevator", terms: "Net 45" },
  { name: "Guardian Security Systems", cat: "Security", terms: "Net 30" },
  { name: "ClearView Window Cleaning", cat: "Janitorial", terms: "Net 30" },
  { name: "Metro Waste Solutions", cat: "Waste", terms: "Net 15" },
  { name: "Harbor Pool & Spa", cat: "Pool", terms: "Net 30" },
  { name: "Copperline Electric", cat: "Electrical", terms: "Net 30" },
  { name: "Redwood Roofing Partners", cat: "Roofing", terms: "Net 45" },
  { name: "Pinnacle HVAC Services", cat: "HVAC", terms: "Net 30" },
];

/* ------------------------------------------------------------------ people */

const FIRST = [
  "Sarah", "Michael", "Robert", "Linda", "James", "Patricia", "Daniel",
  "Elena", "Marcus", "Aisha", "Kevin", "Nora", "Victor", "Grace", "Omar",
  "Hannah", "Tyler", "Sofia", "Andre", "Maya",
];
const LAST = [
  "Jenkins", "Chen", "Williams", "Okonkwo", "Martinez", "Nguyen", "Foster",
  "Petrov", "Delgado", "Hassan", "Brooks", "Silva", "Kowalski", "Adeyemi",
  "Kim", "Rossi", "Fontaine", "Novak", "Barros", "Whitfield",
];

const TICKET_SUBJECTS: [string, string, string][] = [
  ["Water leaking from lobby ceiling", "MAINTENANCE", "HIGH"],
  ["Pool heater not working", "MAINTENANCE", "MEDIUM"],
  ["Noise complaint — late-night music", "COMPLAINT", "MEDIUM"],
  ["Request for replacement pool key fob", "REQUEST", "LOW"],
  ["Landscaping overgrown near building 3", "MAINTENANCE", "LOW"],
  ["Elevator stuck between floors 4 and 5", "MAINTENANCE", "HIGH"],
  ["Unauthorised vehicle in visitor parking", "VIOLATION", "MEDIUM"],
  ["Garage door sensor misaligned", "MAINTENANCE", "MEDIUM"],
  ["Request architectural approval for patio", "REQUEST", "LOW"],
  ["Dog waste not being cleaned up", "VIOLATION", "LOW"],
  ["Hallway light out on floor 7", "MAINTENANCE", "LOW"],
  ["Gym treadmill making grinding noise", "MAINTENANCE", "MEDIUM"],
];

const TICKET_STATUS = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

/* ============================================================ the generator */

export interface TenantData {
  vendors: any[];
  homeowners: any[];
  residents: any[];
  tickets: any[];
  ticketComments: Record<string, any[]>;
  purchaseOrders: any[];
  receipts: any[];
  payables: any[];
  apPayments: any[];
  documents: any[];
  notifications: any[];
  bankAccounts: any[];
  glBatches: any[];
  periods: any[];
  delinquency: any[];
  paymentPlans: any[];
  liens: any[];
  gatewayTxns: any[];
  schedulerRuns: any[];
  migrationBatches: any[];
  budgetVersions: any[];
  budgetLines: any[];
  fixedAssets: any[];
  approvalRequests: any[];
  approvalHierarchies: any[];
  aging: any;
  boardDashboard: any;
  cashForecast: any[];
  compliance: any;
}

export function buildTenantData(t: Tenant, seed: number): TenantData {
  const n = (x: number) => Math.round(x * (0.8 + (seed % 5) * 0.12));
  const units = t.num_units;

  /* vendors ------------------------------------------------------------- */
  const vendorCount = 6 + (seed % 4);
  const vendors = VENDOR_TEMPLATES.slice(0, vendorCount).map((v, i) => ({
    id: `${t.slug}-vend-${i + 1}`,
    vendor_number: `V${1000 + i + seed * 10}`,
    name: v.name,
    category: v.cat,
    status: i === vendorCount - 1 ? "INACTIVE" : "ACTIVE",
    payment_terms: v.terms,
    email: `ap@${v.name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 14)}.com`,
    phone: `(${400 + seed}) 555-0${100 + i}`,
    ytd_spend: 4200 + i * 3100 + seed * 900,
    open_pos: i % 3 === 0 ? 2 : i % 3 === 1 ? 1 : 0,
    onboarded: dateOnly(400 - i * 30),
    w9_on_file: i % 4 !== 3,
    insurance_expires: dateOnly(-1 * (60 + i * 40)),
  }));

  /* homeowners (units) --------------------------------------------------- */
  const hoCount = Math.min(14, Math.round(units / 10));
  const homeowners = Array.from({ length: hoCount }, (_, i) => {
    const first = pick(FIRST, i + seed);
    const last = pick(LAST, i * 3 + seed);
    const balance =
      i % 5 === 0 ? 0 : i % 4 === 0 ? t.monthly_dues * (1 + (i % 3)) : 0;
    return {
      id: `${t.slug}-ho-${i + 1}`,
      account_number: `HO-${101 + i * 3}`,
      first_name: first,
      last_name: last,
      property_unit: `${101 + i * 3}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@email.com`,
      balance,
      monthly_dues: t.monthly_dues,
      status: balance > 0 ? "DELINQUENT" : "CURRENT",
      move_in: dateOnly(300 + i * 45),
    };
  });

  /* residents (portal logins) ------------------------------------------- */
  const residents = homeowners.slice(0, hoCount - 2).map((h, i) => ({
    id: `${t.slug}-res-${i + 1}`,
    username: `${h.first_name.toLowerCase()}${h.property_unit}`,
    full_name: `${h.first_name} ${h.last_name}`,
    resident_type: i % 4 === 1 ? "RENTER" : "OWNER",
    email: h.email,
    phone: `(${400 + seed}) 555-1${String(100 + i).slice(-3)}`,
    is_active: i !== hoCount - 3,
    mfa_channel: i % 3 === 0 ? "SMS" : "EMAIL",
    unit_count: i === 2 ? 2 : 1,
    last_login: i % 3 === 0 ? iso(i + 1, 14) : null,
    homeowner_id: h.id,
  }));

  /* tickets -------------------------------------------------------------- */
  const ticketCount = 8 + (seed % 5);
  const tickets = Array.from({ length: ticketCount }, (_, i) => {
    const [subject, category, priority] = pick(TICKET_SUBJECTS, i + seed);
    const status = pick(TICKET_STATUS, i + seed);
    const needsVendor = category === "MAINTENANCE";
    const ho = pick(homeowners, i + seed);
    return {
      id: `${t.slug}-tk-${i + 1}`,
      ticket_number: `SRV-${1040 + i + seed * 7}`,
      subject,
      description:
        "Reported via the resident portal. Photographs attached. Access arranged with the on-site manager.",
      category,
      priority,
      status,
      homeowner_id: ho.id,
      reported_by: `${ho.first_name} ${ho.last_name}`,
      unit: ho.property_unit,
      assigned_to: i % 3 === 0 ? "Jane Okafor" : i % 3 === 1 ? "Morgan Reyes" : null,
      vendor_id: needsVendor ? pick(vendors, i).id : null,
      estimated_cost: needsVendor ? 180 + i * 145 : null,
      po_header_id: needsVendor && i % 3 === 0 ? `${t.slug}-po-${(i % 4) + 1}` : null,
      created_at: iso(i * 2 + 1, 8 + (i % 8)),
      updated_at: iso(i, 11),
      sla_due: iso(-(3 - (i % 4)), 17),
    };
  });

  /* ticket comment threads ---------------------------------------------- */
  const ticketComments: Record<string, any[]> = {};
  tickets.forEach((tk, i) => {
    const thread: any[] = [
      {
        id: `${tk.id}-c1`,
        author: tk.reported_by,
        role: "Resident",
        at: tk.created_at,
        body: "Reported through the portal. Happy to give access any weekday morning.",
      },
    ];
    if (tk.status !== "OPEN") {
      thread.push({
        id: `${tk.id}-c2`,
        author: tk.assigned_to ?? "Jane Okafor",
        role: "Property Manager",
        at: iso(Math.max(0, i * 2 - 1), 10),
        body: "Inspected on site. Raising a work order with our contractor.",
      });
    }
    if (tk.status === "RESOLVED" || tk.status === "CLOSED") {
      thread.push({
        id: `${tk.id}-c3`,
        author: tk.assigned_to ?? "Jane Okafor",
        role: "Property Manager",
        at: iso(Math.max(0, i * 2 - 2), 16),
        body: "Work completed and inspected. Closing this ticket.",
      });
    }
    ticketComments[tk.id] = thread;
  });

  /* purchase orders ------------------------------------------------------ */
  const purchaseOrders = Array.from({ length: 6 }, (_, i) => {
    const v = pick(vendors, i);
    const amount = 850 + i * 1450 + seed * 200;
    const status = pick(["APPROVED", "PENDING", "APPROVED", "DRAFT", "CLOSED", "PENDING"], i);
    return {
      id: `${t.slug}-po-${i + 1}`,
      po_number: `PO-${2400 + i + seed * 11}`,
      vendor_id: v.id,
      vendor_name: v.name,
      description: `${v.category} — ${pick(["quarterly service", "emergency call-out", "annual contract", "repair works"], i)}`,
      document_type: i % 4 === 2 ? "CONTRACT" : "STANDARD",
      order_date: dateOnly(i * 6 + 3),
      amount,
      amount_limit: amount,
      amount_billed: status === "CLOSED" ? amount : status === "APPROVED" ? amount * 0.4 : 0,
      status,
      fund: i % 3 === 2 ? "Reserve" : "Operating",
      account: i % 3 === 2 ? "20-300-6000" : "10-200-5000",
      approvals_required: amount > 5000 ? 2 : 1,
      approvals_done: status === "APPROVED" || status === "CLOSED" ? (amount > 5000 ? 2 : 1) : 0,
    };
  });

  /* receipts ------------------------------------------------------------- */
  const receipts = purchaseOrders
    .filter((p) => p.status === "APPROVED" || p.status === "CLOSED")
    .map((p, i) => ({
      id: `${t.slug}-rcv-${i + 1}`,
      receipt_number: `RCV-${800 + i + seed * 5}`,
      po_header_id: p.id,
      po_number: p.po_number,
      vendor_name: p.vendor_name,
      received_date: dateOnly(i * 4 + 2),
      status: pick(["ACCEPTED", "PENDING_INSPECTION", "ACCEPTED"], i),
      received_by: "Jane Okafor",
      amount: p.amount * 0.5,
    }));

  /* payables ------------------------------------------------------------- */
  const payables = Array.from({ length: 9 }, (_, i) => {
    const v = pick(vendors, i);
    const po = i % 2 === 0 ? pick(purchaseOrders, i) : null;
    const amount = 420 + i * 780 + seed * 120;
    const status = pick(
      ["PAID", "APPROVED", "DRAFT", "PAID", "PENDING", "APPROVED", "DRAFT", "PAID", "PENDING"],
      i
    );
    const match = po
      ? pick(["MATCHED", "MATCHED", "MATCH_EXCEPTION"], i)
      : "NOT_MATCHED";
    return {
      id: `${t.slug}-inv-${i + 1}`,
      invoice_number: `${v.name.split(" ")[0].toUpperCase().slice(0, 4)}-${3300 + i + seed}`,
      vendor_id: v.id,
      vendor_name: v.name,
      po_header_id: po?.id ?? null,
      po_number: po?.po_number ?? null,
      invoice_date: dateOnly(i * 3 + 2),
      gl_date: dateOnly(i * 3 + 2),
      due_date: dateOnly(-(28 - i * 3)),
      amount,
      tax_amount: Math.round(amount * 0.0725 * 100) / 100,
      status,
      match_status: match,
      on_hold: match === "MATCH_EXCEPTION",
      hold_reason: match === "MATCH_EXCEPTION" ? "Invoice exceeds PO by more than tolerance" : null,
      fund: i % 3 === 2 ? "Reserve" : "Operating",
      account: i % 3 === 2 ? "20-300-6000" : "10-200-5000",
      description: `${v.category} services`,
    };
  });

  /* AP payments ---------------------------------------------------------- */
  const apPayments = payables
    .filter((p) => p.status === "PAID")
    .map((p, i) => ({
      id: `${t.slug}-pay-${i + 1}`,
      payment_number: `PMT-${5500 + i + seed * 3}`,
      vendor_id: p.vendor_id,
      vendor_name: p.vendor_name,
      invoice_id: p.id,
      invoice_number: p.invoice_number,
      amount: p.amount + p.tax_amount,
      payment_date: dateOnly(i * 5 + 1),
      method: pick(["ACH", "CHECK", "ACH"], i),
      reference: pick([`ACH-${9000 + i}`, `CHK-${4400 + i}`, `ACH-${9100 + i}`], i),
      status: pick(["COMPLETED", "COMPLETED", "PENDING"], i),
      bank_account: "Operating — Wells Fargo ••4471",
      cleared: i % 3 !== 2,
    }));

  /* documents ------------------------------------------------------------ */
  const documents = [
    { name: `${t.founded} Declaration of CC&Rs.pdf`, type: "HOA_RULES", size: 2_140_000, mime: "application/pdf" },
    { name: "FY2026 Approved Budget.xlsx", type: "BUDGET", size: 486_000, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    { name: "Reserve Study 2025 — Full Report.pdf", type: "RESERVE_STUDY", size: 5_820_000, mime: "application/pdf" },
    { name: "Board Meeting Minutes — March.docx", type: "BOARD_MEETING", size: 318_000, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    { name: "Certificate of Insurance 2026.pdf", type: "INSURANCE", size: 742_000, mime: "application/pdf" },
    { name: `${vendors[0].name} — Annual Contract.pdf`, type: "CONTRACT", size: 1_180_000, mime: "application/pdf" },
    { name: "Lobby ceiling leak — photo 1.jpg", type: "TICKET", size: 2_940_000, mime: "image/jpeg" },
    { name: "Pool permit renewal.pdf", type: "COMPLIANCE", size: 402_000, mime: "application/pdf" },
    { name: "Architectural Guidelines v3.pdf", type: "HOA_RULES", size: 1_620_000, mime: "application/pdf" },
  ].map((d, i) => ({
    id: `${t.slug}-doc-${i + 1}`,
    filename: d.name,
    entity_type: d.type,
    entity_id: `${t.slug}-ent-${i}`,
    content_type: d.mime,
    size_bytes: d.size,
    uploaded_by: pick(["Jane Okafor", "David Lin", "Morgan Reyes"], i),
    created_at: iso(i * 9 + 2, 10 + (i % 6)),
    visibility: i === 0 || i === 8 ? "RESIDENTS" : i === 3 ? "BOARD" : "STAFF",
    notes: null,
  }));

  /* notifications -------------------------------------------------------- */
  const notifications = [
    { cat: "INFO", msg: `New service ticket ${tickets[0]?.ticket_number} assigned to you`, ent: "ServiceTicket", read: false, d: 0 },
    { cat: "BUDGET_OVERRUN", msg: "Maintenance expense has reached 92% of the monthly budget", ent: "Budget", read: false, d: 1 },
    { cat: "HOLD", msg: `Invoice ${payables[2]?.invoice_number} placed on hold — price discrepancy`, ent: "ApInvoice", read: false, d: 2 },
    { cat: "APPROVAL", msg: `Purchase order ${purchaseOrders[1]?.po_number} is awaiting your approval`, ent: "PoHeader", read: false, d: 2 },
    { cat: "INFO", msg: "Monthly statements run completed — 148 delivered, 0 failed", ent: "Scheduler", read: true, d: 4 },
    { cat: "COLLECTIONS", msg: "Unit 118 has moved to the payment-plan stage", ent: "DelinquencyCase", read: true, d: 6 },
    { cat: "INFO", msg: "Board packet for March has been published", ent: "BoardPacket", read: true, d: 9 },
    { cat: "INFO", msg: "Bank statement imported — 34 lines, 32 auto-matched", ent: "BankStatement", read: true, d: 12 },
  ].map((x, i) => ({
    id: `${t.slug}-notif-${i + 1}`,
    category: x.cat,
    message: x.msg,
    entity_type: x.ent,
    entity_id: null,
    is_read: x.read,
    created_at: iso(x.d, 8 + (i % 9)),
    recipient_role_code: x.cat === "APPROVAL" ? "BOARD_MEMBER" : null,
  }));

  /* bank accounts -------------------------------------------------------- */
  const opCash = 84_000 + seed * 27_000;
  const resCash = 310_000 + seed * 95_000;
  const bankAccounts = [
    {
      id: `${t.slug}-bank-1`,
      name: "Operating Account",
      bank: "Wells Fargo",
      masked: "••••4471",
      fund: "Operating",
      balance: opCash,
      last_reconciled: dateOnly(31),
      unreconciled_items: 3,
    },
    {
      id: `${t.slug}-bank-2`,
      name: "Reserve Account",
      bank: "First Republic",
      masked: "••••8823",
      fund: "Reserve",
      balance: resCash,
      last_reconciled: dateOnly(31),
      unreconciled_items: 0,
    },
  ];

  /* GL batches ----------------------------------------------------------- */
  const glBatches = Array.from({ length: 6 }, (_, i) => ({
    id: `${t.slug}-batch-${i + 1}`,
    batch_name: `${pick(["AR", "AP", "PO", "Manual", "AR", "AP"], i)} — ${pick(["Assessments", "Vendor invoices", "Encumbrance", "Adjustment", "Late fees", "Payments"], i)}`,
    source: pick(["AR", "AP", "PO", "Manual", "AR", "AP"], i),
    period_name: pick(["JUL-2026", "JUL-2026", "JUN-2026", "JUN-2026", "JUN-2026", "MAY-2026"], i),
    status: i < 2 ? "DRAFT" : i < 3 ? "PENDING" : "POSTED",
    total_debit: 12_400 + i * 5_600,
    total_credit: 12_400 + i * 5_600,
    lines: 6 + i * 3,
    created_at: iso(i * 5 + 1),
  }));

  /* periods -------------------------------------------------------------- */
  const periods = [
    { name: "JUL-2026", status: "OPEN", num: 7 },
    { name: "JUN-2026", status: "CLOSED", num: 6 },
    { name: "MAY-2026", status: "CLOSED", num: 5 },
    { name: "APR-2026", status: "CLOSED", num: 4 },
    { name: "MAR-2026", status: "CLOSED", num: 3 },
    { name: "FEB-2026", status: "CLOSED", num: 2 },
  ].map((p, i) => ({
    id: `${t.slug}-per-${i + 1}`,
    period_name: p.name,
    period_year: 2026,
    period_num: p.num,
    status: p.status,
    closed_at: p.status === "CLOSED" ? iso(i * 30 + 5) : null,
    closed_by: p.status === "CLOSED" ? "David Lin" : null,
  }));

  /* collections ---------------------------------------------------------- */
  const delinquent = homeowners.filter((h) => h.balance > 0);
  const delinquency = delinquent.map((h, i) => ({
    id: `${t.slug}-case-${i + 1}`,
    homeowner_id: h.id,
    unit: h.property_unit,
    name: `${h.first_name} ${h.last_name}`,
    stage: pick(["NOTICE", "PAYMENT_PLAN", "LIEN", "NOTICE"], i),
    balance: h.balance,
    days_past_due: 32 + i * 29,
    opened_date: dateOnly(40 + i * 20),
    notice_count: 1 + (i % 3),
    last_notice: dateOnly(8 + i * 3),
  }));

  const paymentPlans = delinquency
    .filter((d) => d.stage === "PAYMENT_PLAN")
    .map((d, i) => ({
      id: `${t.slug}-plan-${i + 1}`,
      plan_number: `PP-${300 + i + seed}`,
      homeowner_id: d.homeowner_id,
      unit: d.unit,
      name: d.name,
      status: "ACTIVE",
      total: d.balance,
      remaining: Math.round(d.balance * 0.6),
      instalments: 6,
      paid_instalments: 2,
      next_due: dateOnly(-12),
    }));

  const liens = delinquency
    .filter((d) => d.stage === "LIEN")
    .map((d, i) => ({
      id: `${t.slug}-lien-${i + 1}`,
      lien_number: `LN-${90 + i + seed}`,
      homeowner_id: d.homeowner_id,
      unit: d.unit,
      name: d.name,
      status: "FILED",
      amount: d.balance,
      filed_date: dateOnly(22),
      recorded_county: `${t.city} County`,
    }));

  /* gateway -------------------------------------------------------------- */
  const gatewayTxns = Array.from({ length: 8 }, (_, i) => {
    const h = pick(homeowners, i);
    return {
      id: `${t.slug}-gw-${i + 1}`,
      reference: `ch_${Math.abs(seed * 7919 + i * 104729).toString(36).slice(0, 14)}`,
      homeowner_id: h.id,
      unit: h.property_unit,
      payer: `${h.first_name} ${h.last_name}`,
      amount: t.monthly_dues,
      method: pick(["CARD", "ACH", "CARD", "ACH"], i),
      card_last4: pick(["4242", "1881", "0005", "8431"], i),
      status: pick(["SUCCESS", "SUCCESS", "SUCCESS", "FAILED", "SUCCESS", "REFUNDED", "SUCCESS", "SUCCESS"], i),
      fee: Math.round(t.monthly_dues * 0.029 * 100) / 100 + 0.3,
      created_at: iso(i * 2, 11 + (i % 7)),
    };
  });

  /* scheduler ------------------------------------------------------------ */
  const schedulerRuns = [
    { job: "MONTHLY_STATEMENTS", status: "SUCCESS", summary: `${units} statements generated, ${units - 2} delivered`, d: 3 },
    { job: "BOARD_PACKET", status: "SUCCESS", summary: "Board packet published and 5 members notified", d: 3 },
    { job: "DUNNING_RUN", status: "SUCCESS", summary: `${delinquency.length} accounts processed, ${delinquency.length} notices sent`, d: 5 },
    { job: "LATE_FEES", status: "SUCCESS", summary: `${delinquent.length} late fees applied`, d: 6 },
    { job: "MONTHLY_STATEMENTS", status: "SUCCESS", summary: `${units} statements generated`, d: 33 },
    { job: "DUNNING_RUN", status: "FAILED", summary: "Mail provider timed out after 3 retries", d: 35 },
  ].map((r, i) => ({
    id: `${t.slug}-run-${i + 1}`,
    job_name: r.job,
    status: r.status,
    trigger: i % 3 === 0 ? "SCHEDULED" : "SCHEDULED",
    summary: r.summary,
    started_at: iso(r.d, 2, 15),
    duration_ms: 1400 + i * 820,
  }));

  /* migration ------------------------------------------------------------ */
  /* Field names here mirror the server's MigrationBatch exactly (batch_number,
   * entity_type, total_rows, created/updated/skipped/errors, COMMITTED). The
   * two transports feed the same screen, so a mock that invents its own shape
   * produces a screen that works in the demo and crashes against the real API
   * — which is precisely what happened before this was aligned. */
  const migrationBatches = [
    { entity: "HOMEOWNER", file: "homeowners.csv", rows: units, ok: units, fail: 0, d: 120 },
    { entity: "AR_OPENING", file: "ar_balances.csv", rows: 46, ok: 46, fail: 0, d: 120 },
    { entity: "VENDOR", file: "vendors.csv", rows: vendors.length, ok: vendors.length, fail: 0, d: 118 },
    { entity: "AP_OPEN_INVOICE", file: "open_ap.csv", rows: 2840, ok: 2836, fail: 4, d: 115 },
    { entity: "PO_OPEN", file: "open_pos.csv", rows: 38, ok: 38, fail: 0, d: 110 },
  ].map((m, i) => ({
    id: `${t.slug}-mig-${i + 1}`,
    batch_number: `MIG-${String(i + 1).padStart(5, "0")}`,
    entity_type: m.entity,
    source_filename: m.file,
    status: "COMMITTED",
    mode: "ADD",
    total_rows: m.rows,
    created: m.ok,
    updated: 0,
    skipped: 0,
    errors: m.fail,
    created_at: iso(m.d, 9),
  }));

  /* budgets -------------------------------------------------------------- */
  const budgetVersions = [
    { id: `${t.slug}-bv-1`, name: "FY2026 Operating", fiscal_year: 2026, version_type: "ORIGINAL", status: "APPROVED", is_controlling: true },
    { id: `${t.slug}-bv-2`, name: "FY2027 Operating", fiscal_year: 2027, version_type: "DRAFT", status: "DRAFT", is_controlling: false },
  ];

  const BUDGET_CATEGORIES = [
    ["10-200-5000", "Maintenance & Repairs", "Operating"],
    ["10-300-5100", "Landscaping", "Operating"],
    ["10-100-5200", "Insurance", "Operating"],
    ["10-100-5300", "Management Fees", "Operating"],
    ["10-400-5400", "Utilities", "Operating"],
    ["10-500-5500", "Pool & Amenities", "Operating"],
    ["20-300-6000", "Reserve — Roofing", "Reserve"],
    ["20-300-6100", "Reserve — Paving", "Reserve"],
  ];

  const budgetLines = BUDGET_CATEGORIES.map((c, i) => {
    const budget = (18_000 + i * 7_400) * (1 + seed * 0.15);
    const actual = budget * (0.72 + ((i * 13 + seed * 7) % 45) / 100);
    return {
      id: `${t.slug}-bl-${i + 1}`,
      account: c[0],
      name: c[1],
      fund: c[2],
      budget: Math.round(budget),
      actual: Math.round(actual),
      variance: Math.round(budget - actual),
      pct: Math.round((actual / budget) * 100),
    };
  });

  /* fixed assets --------------------------------------------------------- */
  const fixedAssets = [
    ["Roof — Building A", "Roofing", 240_000, 2012, 25],
    ["Elevator — Tower 1", "Elevator", 180_000, 2015, 20],
    ["Pool resurfacing", "Amenities", 62_000, 2019, 10],
    ["Asphalt car park", "Paving", 145_000, 2016, 18],
    ["HVAC — Clubhouse", "HVAC", 48_000, 2020, 15],
    ["Perimeter fencing", "Grounds", 36_000, 2018, 20],
  ].map((a, i) => {
    const cost = a[2] as number;
    const life = a[4] as number;
    const age = 2026 - (a[3] as number);
    return {
      id: `${t.slug}-fa-${i + 1}`,
      name: a[0] as string,
      category: a[1] as string,
      cost,
      in_service: `${a[3]}-06-01`,
      useful_life: life,
      accumulated: Math.round(Math.min(cost, (cost / life) * age)),
      nbv: Math.round(Math.max(0, cost - (cost / life) * age)),
      remaining_life: Math.max(0, life - age),
      reserve_funded: Math.round(cost * 0.62),
      status: "ACTIVE",
    };
  });

  /* approvals ------------------------------------------------------------ */
  const approvalHierarchies = [
    {
      id: `${t.slug}-ah-1`,
      name: "Purchase Order Approvals",
      document_type: "PO",
      enabled: true,
      rules: [
        { level_num: 1, min_amount: 0, max_amount: 5000, role: "HOA_ADMIN" },
        { level_num: 2, min_amount: 5000, max_amount: 25000, role: "BOARD_MEMBER" },
        { level_num: 3, min_amount: 25000, max_amount: null, role: "BOARD_MEMBER" },
      ],
    },
    {
      id: `${t.slug}-ah-2`,
      name: "Vendor Invoice Approvals",
      document_type: "AP_INVOICE",
      enabled: true,
      rules: [
        { level_num: 1, min_amount: 0, max_amount: 10000, role: "HOA_ADMIN" },
        { level_num: 2, min_amount: 10000, max_amount: null, role: "BOARD_MEMBER" },
      ],
    },
  ];

  const approvalRequests = purchaseOrders
    .filter((p) => p.status === "PENDING")
    .map((p, i) => ({
      id: `${t.slug}-appr-${i + 1}`,
      document_type: "PO",
      document_id: p.id,
      document_number: p.po_number,
      description: p.description,
      vendor_name: p.vendor_name,
      amount: p.amount,
      status: "PENDING",
      current_level: 1,
      required_levels: p.approvals_required,
      submitted_by: "David Lin",
      submitted_at: iso(i + 1, 14),
    }))
    .concat(
      payables
        .filter((p) => p.status === "PENDING")
        .map((p, i) => ({
          id: `${t.slug}-appr-inv-${i + 1}`,
          document_type: "AP_INVOICE",
          document_id: p.id,
          document_number: p.invoice_number,
          description: p.description,
          vendor_name: p.vendor_name,
          amount: p.amount,
          status: "PENDING",
          current_level: 1,
          required_levels: 1,
          submitted_by: "David Lin",
          submitted_at: iso(i + 2, 10),
        })) as any
    );

  /* aging ---------------------------------------------------------------- */
  const arOpen = delinquent.reduce((s, h) => s + h.balance, 0) + t.monthly_dues * 12;
  const aging = {
    as_of: dateOnly(0),
    grand_total: arOpen,
    totals: {
      Current: Math.round(arOpen * 0.68),
      "1-30": Math.round(arOpen * 0.16),
      "31-60": Math.round(arOpen * 0.08),
      "61-90": Math.round(arOpen * 0.05),
      "90+": Math.round(arOpen * 0.03),
    },
  };

  /* board ---------------------------------------------------------------- */
  const boardDashboard = {
    funds: [
      { fund: "Operating", cash: opCash, ar_open: Math.round(arOpen * 0.9) },
      { fund: "Reserve", cash: resCash, ar_open: 0 },
    ],
    cash_total: opCash + resCash,
    ar_open_total: arOpen,
    delinquent_total: delinquent.reduce((s, h) => s + h.balance, 0),
    open_cases: delinquency.length,
    active_plans: paymentPlans.length,
    filed_liens: liens.length,
    reserve_funded_pct: 62 + (seed % 3) * 7,
    units: t.num_units,
    occupancy_pct: 94 + (seed % 4),
  };

  const cashForecast = ["Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m, i) => {
    const opening = opCash + i * 4200;
    const inflow = t.monthly_dues * t.num_units * 0.97;
    const outflow = inflow * (0.86 + ((i * 7 + seed) % 14) / 100);
    return {
      period: `${m} 2026`,
      fund: "Operating",
      opening: Math.round(opening),
      inflow: Math.round(inflow),
      outflow: Math.round(outflow),
      ending: Math.round(opening + inflow - outflow),
    };
  });

  /* compliance ----------------------------------------------------------- */
  const holds = payables.filter((p) => p.on_hold).length;
  const pendingPos = purchaseOrders.filter((p) => p.status === "PENDING").length;
  const compliance = {
    health: {
      gl_posted_batches: glBatches.filter((b) => b.status === "POSTED").length,
      gl_unbalanced_batches: 0,
      open_periods: periods.filter((p) => p.status === "OPEN").length,
      closed_periods: periods.filter((p) => p.status === "CLOSED").length,
      budget_control_mode: "Advisory",
      ap_open_holds: holds,
      unreconciled_statements: bankAccounts.reduce((s, b) => s + b.unreconciled_items, 0),
      active_assets: fixedAssets.length,
      coa_structures: 1,
      vendors: vendors.length,
      audit_events: 980 + seed * 210,
    },
    items: [
      { code: "chk-1", title: "General Ledger balances", category: "FINANCE", status: "PASS", detail: "All posted batches balance. No unbalanced journals.", manual: false },
      { code: "chk-2", title: "Chart of Accounts configured", category: "SETUP", status: "PASS", detail: "1 structure, 3 segments, all value sets populated.", manual: false },
      { code: "chk-3", title: "Approval hierarchies defined", category: "SECURITY", status: "PASS", detail: "PO and AP invoice hierarchies are enabled.", manual: false },
      { code: "chk-4", title: "Open AP holds", category: "PAYABLES", status: holds > 0 ? "WARN" : "PASS", detail: holds > 0 ? `${holds} invoice(s) on hold awaiting review.` : "No invoices on hold.", manual: true },
      { code: "chk-5", title: "Purchase orders awaiting approval", category: "PROCUREMENT", status: pendingPos > 2 ? "FAIL" : pendingPos > 0 ? "WARN" : "PASS", detail: `${pendingPos} purchase order(s) pending approval.`, manual: true },
      { code: "chk-6", title: "Bank reconciliation current", category: "CASH", status: bankAccounts[0].unreconciled_items > 0 ? "WARN" : "PASS", detail: `${bankAccounts[0].unreconciled_items} unreconciled item(s) on the operating account.`, manual: true },
      { code: "chk-7", title: "Reserve study on file", category: "COMPLIANCE", status: "PASS", detail: "2025 reserve study uploaded and linked.", manual: true },
      { code: "chk-8", title: "Resident portal accounts issued", category: "SETUP", status: "WARN", detail: `${residents.length} of ${t.num_units} units have an active portal login.`, manual: true },
      { code: "chk-9", title: "Data migration verified", category: "PLATFORM", status: "PASS", detail: "All migration batches completed; 4 GL rows quarantined and reviewed.", manual: true },
      { code: "chk-10", title: "Insurance certificates current", category: "COMPLIANCE", status: "PASS", detail: "Certificate of insurance valid through 2026.", manual: true },
    ],
    go_live_ready: false,
  };

  return {
    vendors, homeowners, residents, tickets, ticketComments,
    purchaseOrders, receipts, payables, apPayments, documents, notifications,
    bankAccounts, glBatches, periods, delinquency, paymentPlans, liens,
    gatewayTxns, schedulerRuns, migrationBatches, budgetVersions, budgetLines,
    fixedAssets, approvalRequests, approvalHierarchies, aging, boardDashboard,
    cashForecast, compliance,
  };
}

/** All three datasets, built once. */
export const DATA: Record<string, TenantData> = TENANTS.reduce(
  (acc, t, i) => {
    acc[t.id] = buildTenantData(t, i + 1);
    return acc;
  },
  {} as Record<string, TenantData>
);
