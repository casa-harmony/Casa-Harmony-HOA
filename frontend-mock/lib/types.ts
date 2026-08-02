export interface Membership {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  role_code: string;
  role_name: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user_id: string;
  email: string;
  full_name: string | null;
  is_superadmin: boolean;
  must_change_password?: boolean;
  memberships: Membership[];
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  status: string;
  functional_currency: string;
  num_units: number | null;
  timezone: string;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  created_at: string;
}

export interface Structure {
  id: string;
  structure_code: string;
  title: string;
  description: string | null;
  segment_separator: string;
  enabled: boolean;
  is_coa: boolean;
  created_at: string;
}

export type Qualifier =
  | "balancing"
  | "natural_account"
  | "cost_center"
  | "fund"
  | "intercompany"
  | "management"
  | "secondary_tracking"
  | "none";

export interface Segment {
  id: string;
  structure_id: string;
  segment_number: number;
  name: string;
  prompt: string;
  column_name: string;
  value_set_id: string | null;
  qualifier: Qualifier;
  displayed: boolean;
  enabled: boolean;
  required: boolean;
  default_value: string | null;
}

export interface StructureDetail extends Structure {
  segments: Segment[];
}

export interface ValueSet {
  id: string;
  code: string;
  name: string;
  description: string | null;
  validation_type: string;
  format_type: string;
  max_size: number;
  uppercase_only: boolean;
  zero_fill: boolean;
  numbers_only: boolean;
}

export interface ValueSetValue {
  id: string;
  value_set_id: string;
  value: string;
  description: string | null;
  enabled: boolean;
  summary_flag: boolean;
  allow_posting: boolean;
  parent_value: string | null;
  account_type: string | null;
  start_date: string | null;
  end_date: string | null;
}

export interface CodeCombination {
  id: string;
  structure_id: string;
  concatenated_segments: string;
  balancing_segment_value: string | null;
  natural_account_value: string | null;
  cost_center_value: string | null;
  fund_value: string | null;
  account_type: string | null;
  enabled: boolean;
  allow_posting: boolean;
  summary_flag: boolean;
}

export interface Role {
  id: string;
  tenant_id: string | null;
  code: string;
  name: string;
  description: string | null;
  is_system: boolean;
  permissions: string[];
}

export interface AppUser {
  id: string;
  email: string;
  full_name: string | null;
  is_superadmin: boolean;
  is_active: boolean;
  created_at: string;
}

// --- Financials (Prompts 2 & 3) ---
export interface Vendor {
  id: string;
  vendor_number: string;
  name: string;
  payment_terms: string;
  payment_term_id: string | null;
  vendor_type_id: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  is_1099: boolean;
  income_tax_type: string | null;
  state_reportable: boolean;
  tax_reporting_name: string | null;
}

export interface Bank {
  id: string;
  bank_name: string;
  routing_number: string;
  branch_name: string | null;
  city: string | null;
  state: string | null;
  status: string;
}

export interface PurchaseOrder {
  id: string;
  po_number: string;
  vendor_id: string;
  description: string | null;
  document_type: string;
  order_date: string;
  start_date: string | null;
  end_date: string | null;
  amount: string;
  amount_limit: string;
  billed_amount: string;
  status: string;
  approval_status: string;
}

export interface PoDist {
  id: string;
  distribution_num: number;
  code_combination_id: string;
  amount: string;
  fund_value: string;
  quantity_ordered: string;
  quantity_received: string;
  quantity_billed: string;
  amount_billed: string;
}

export interface PoLine {
  id: string;
  line_num: number;
  item_description: string;
  quantity: string;
  unit_price: string;
  line_amount: string;
  distributions: PoDist[];
}

export interface PoDetail extends PurchaseOrder {
  lines: PoLine[];
}

export interface ApInvoice {
  id: string;
  invoice_number: string;
  vendor_id: string;
  po_header_id: string | null;
  invoice_date: string;
  gl_date: string;
  amount: string;
  tax_amount: string;
  status: string;
  approval_status: string;
  match_status: string;
  on_hold: boolean;
  hold_reason: string | null;
  gl_je_header_id: string | null;
}

export interface GlLine {
  line_num: number;
  code_combination_id: string;
  entered_dr: string;
  entered_cr: string;
  fund_value: string;
  description: string | null;
}

export interface GlHeader {
  id: string;
  je_name: string;
  je_category: string;
  je_source: string;
  accounting_date: string;
  status: string;
  source_doc_type: string | null;
  source_doc_id: string | null;
  lines: GlLine[];
}

export interface GlBatch {
  id: string;
  batch_name: string;
  description: string | null;
  source: string;
  accounting_date: string;
  period_name: string;
  status: string;
  control_total_dr: string;
  control_total_cr: string;
  approved_by: string | null;
  posted_at: string | null;
}

export interface GlBatchDetail extends GlBatch {
  headers: GlHeader[];
}

export interface ApprovalRequest {
  id: string;
  document_type: string;
  document_id: string;
  amount: string;
  status: string;
  current_level: number;
  required_levels: number;
}

export interface Homeowner {
  id: string;
  account_number: string;
  first_name: string;
  last_name: string;
  email: string | null;
  property_unit: string | null;
  bank_account_masked: string | null;
  status: string;
}

export interface Receipt {
  id: string;
  homeowner_id: string;
  receipt_number: string;
  amount: string;
  receipt_date: string;
  payment_method: string;
  status: string;
}

export interface ServiceTicket {
  id: string;
  ticket_number: string;
  subject: string;
  description: string | null;
  category: string;
  priority: string;
  status: string;
  homeowner_id: string | null;
  vendor_id: string | null;
  estimated_cost: string | null;
  po_header_id: string | null;
  created_at: string;
}

export interface ApprovalRule {
  id?: string;
  level_num: number;
  min_amount: string;
  max_amount: string | null;
  approver_role_id: string;
}

export interface ApprovalHierarchy {
  id: string;
  name: string;
  document_type: string;
  enabled: boolean;
  rules: ApprovalRule[];
}

// --- Residents (portal logins) ---
export interface Resident {
  id: string;
  username: string;
  full_name: string;
  resident_type: string;
  email: string | null;
  is_active: boolean;
  unit_count: number;
}

export interface ResidentUnit {
  id: string;
  homeowner_id: string;
  unit_number: string;
  is_primary: boolean;
}

export interface PortalUnit {
  homeowner_id: string;
  unit_number: string;
  account_number: string;
  is_primary: boolean;
  balance: string;
}

export interface PortalInvoice {
  id: string;
  invoice_number: string;
  invoice_type: string;
  amount: string;
  amount_paid: string;
  balance: string;
  invoice_date: string;
  due_date: string | null;
  status: string;
}

// --- AP configuration ---
export interface PaymentTerm {
  id: string;
  name: string;
  description: string | null;
  due_days: number;
  discount_percent: string;
  discount_days: number;
  active: boolean;
}

export interface VendorType {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

export interface DistSetLine {
  line_num: number;
  code_combination_id: string;
  percent: string;
  fund_value: string;
  description: string | null;
}

export interface DistributionSet {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  lines: DistSetLine[];
}

// --- AP payments ---
export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  method_type: string;
  bank_account_id: string | null;
  active: boolean;
}

export interface Payable {
  invoice_id: string;
  invoice_number: string;
  vendor_id: string;
  vendor_name: string;
  due_date: string | null;
  gross_amount: string;
  amount_remaining: string;
}

export interface Notification {
  id: string;
  category: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

export interface ApPayment {
  id: string;
  payment_number: string;
  vendor_id: string;
  payment_method_id: string | null;
  payment_date: string;
  amount: string;
  reference: string | null;
  status: string;
  gl_je_header_id: string | null;
}

// --- Receiving (P13) ---
export interface RcvReceipt {
  id: string;
  receipt_number: string;
  po_header_id: string;
  received_date: string;
  packing_slip: string | null;
  notes: string | null;
  needs_inspection: boolean;
  status: string;
  inspected_at: string | null;
}

// --- Cash Management (P14) ---
export interface CeBankAccount {
  id: string;
  account_code: string;
  name: string;
  fund_value: string;
  bank_name: string | null;
  routing_number: string | null;
  gl_cash_combination_id: string | null;
  currency: string;
  active: boolean;
}

export interface CeStatementLine {
  id: string;
  line_num: number;
  line_date: string | null;
  description: string | null;
  reference: string | null;
  amount: string;
  reconciled: boolean;
  match_type: string | null;
  matched_payment_id: string | null;
  matched_receipt_id: string | null;
}

export interface CeStatement {
  id: string;
  ce_bank_account_id: string;
  statement_date: string;
  opening_balance: string;
  closing_balance: string;
  status: string;
  reconciled_at: string | null;
  lines?: CeStatementLine[];
}

export interface CashPosition {
  bank_account_id: string;
  account_code: string;
  name: string;
  fund_value: string;
  closing_balance: string;
  deposits: string;
  withdrawals: string;
  open_items: number;
  statement_date: string | null;
}

// --- Encumbrance (P15) ---
export interface EncumbranceSettings {
  id: string | null;
  enabled: boolean;
  encumbrance_combination_id: string | null;
  reserve_combination_id: string | null;
}

export interface PoEncumbrance {
  id: string;
  po_header_id: string;
  po_number: string;
  vendor_id: string;
  encumbered_amount: string;
  liquidated_amount: string;
  open_commitment: string;
  status: string;
}

export interface CommitmentRow {
  cost_center: string;
  fund_value: string;
  committed: string;
  billed: string;
  available: string;
}

// --- Accounting periods (P16) ---
export interface AccountingPeriod {
  id: string;
  period_name: string;
  period_year: number;
  period_num: number;
  start_date: string | null;
  end_date: string | null;
  status: string;
  closed_at: string | null;
}

// --- Budget depth (P17) ---
export interface BudgetVersion {
  id: string;
  name: string;
  fiscal_year: number;
  version_type: string;
  status: string;
  is_controlling: boolean;
  approved_at: string | null;
}

export interface BudgetLineV2 {
  id: string;
  code_combination_id: string;
  fund_value: string;
  cost_center_value: string | null;
  period_num: number;
  amount: string;
}

export interface BudgetVersionDetail extends BudgetVersion {
  lines: BudgetLineV2[];
}

export interface BvARow {
  code_combination_id: string;
  account: string;
  fund_value: string;
  cost_center: string;
  budget: string;
  actual: string;
  variance: string;
}

export interface BudgetControl {
  id: string | null;
  mode: string;
  controlling_version_id: string | null;
}

// --- Fixed Assets (P18) ---
export interface FaAsset {
  id: string;
  asset_number: string;
  name: string;
  category: string | null;
  fund_value: string;
  cost: string;
  salvage_value: string;
  in_service_date: string;
  life_months: number;
  method: string;
  accumulated_depreciation: string;
  net_book_value: string;
  status: string;
  disposal_date: string | null;
  disposal_proceeds: string;
}

export interface ReserveStudy {
  id: string;
  name: string;
  study_year: number;
  status: string;
}

export interface ReserveVsActualRow {
  component: string;
  category: string;
  fund_value: string;
  planned_year: number | null;
  planned_amount: string;
  actual: string;
  variance: string;
}

// --- AR billing & documents (P21) ---
export interface BillingPlanLine {
  id: string;
  department: string | null;
  income_combination_id: string;
  fund_value: string;
  amount: string;
}

export interface BillingPlan {
  id: string;
  name: string;
  plan_type: string;
  active: boolean;
  lines?: BillingPlanLine[];
}

export interface LateFeeRule {
  id: string | null;
  active: boolean;
  grace_days: number;
  fee_type: string;
  flat_amount: string;
  percent: string;
  fund_value: string;
  income_combination_id: string | null;
}

export interface DocumentAttachment {
  id: string;
  entity_type: string;
  entity_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  notes: string | null;
  homeowner_id: string | null;
  created_at: string;
}

// --- Resident portal (P22) ---
export interface PortalReceiptItem {
  receipt_number: string;
  amount: string;
  receipt_date: string;
  payment_method: string;
}

export interface PortalDashboard {
  total_balance: string;
  units: number;
  open_invoices: number;
  open_assessments: number;
  open_special: number;
  next_due_date: string | null;
  recent_payments: PortalReceiptItem[];
}

export interface PortalNotification {
  category: string;
  message: string;
  homeowner_id: string;
  unit_number: string;
  due_date: string | null;
  amount: string | null;
}

export interface PortalDocument {
  id: string;
  homeowner_id: string | null;
  entity_type: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
}

// --- Collections (P23) ---
export interface AgingRow {
  homeowner_id: string;
  account_number: string;
  name: string;
  buckets: Record<string, string>;
  total: string;
}

export interface DelinquencyCase {
  id: string;
  homeowner_id: string;
  stage: string;
  opened_date: string;
  balance_at_open: string;
  last_notice_date: string | null;
  notice_count: number;
  notes: string | null;
}

export interface PlanInstallment {
  id: string;
  seq: number;
  due_date: string;
  amount: string;
  amount_paid: string;
  status: string;
}

export interface CollectionPlan {
  id: string;
  plan_number: string;
  homeowner_id: string;
  total_amount: string;
  installments: number;
  frequency_days: number;
  start_date: string;
  status: string;
  schedule?: PlanInstallment[];
}

export interface Lien {
  id: string;
  lien_number: string;
  homeowner_id: string;
  amount: string;
  status: string;
  filed_date: string | null;
  released_date: string | null;
  reference: string | null;
}

// --- Board / exec reporting (P24) ---
export interface ExecDashboard {
  funds: { fund: string; cash: string; ar_open: string }[];
  cash_total: string;
  ar_open_total: string;
  delinquent_total: string;
  open_cases: number;
  active_plans: number;
  filed_liens: number;
  aging_by_fund: Record<string, Record<string, string>>;
}

export interface ForecastRow {
  period: string;
  fund: string;
  opening: string;
  inflow: string;
  outflow: string;
  ending: string;
}

// --- AR statements (P25) ---
export interface StatementRun {
  id: string;
  run_number: string;
  as_of_date: string;
  status: string;
  generated: number;
  sent: number;
  skipped: number;
  failed: number;
  created_at: string;
}

export interface StatementDelivery {
  id: string;
  homeowner_id: string;
  email: string | null;
  balance: string;
  status: string;
  error: string | null;
  sent_at: string | null;
}

// --- Scheduler (P26) ---
export interface SchedulerConfig {
  id: string | null;
  monthly_statements_enabled: boolean;
  board_packet_enabled: boolean;
  day_of_month: number;
  attach_statement_pdf: boolean;
  attach_board_pdf: boolean;
  dunning_enabled: boolean;
}

export interface JobRun {
  id: string;
  job_name: string;
  trigger: string;
  status: string;
  summary: string | null;
  started_at: string | null;
  finished_at: string | null;
}

// --- Payment gateway (P27) ---
export interface GatewayConfig {
  id: string | null;
  provider: string;
  publishable_key: string | null;
  secret_key_set: boolean;
  webhook_secret_set: boolean;
  active: boolean;
}

export interface GatewayTxn {
  id: string;
  txn_ref: string;
  provider: string;
  homeowner_id: string | null;
  invoice_id: string | null;
  amount: string;
  status: string;
  receipt_id: string | null;
  refund_of_id: string | null;
  confirmed_at: string | null;
  created_at: string;
}

// --- Dunning (P30) ---
export interface DunningRule {
  id: string;
  name: string;
  days_past_due: number;
  action: string;
  escalate_to_stage: string | null;
  attach_statement: boolean;
  message: string | null;
  active: boolean;
}

export interface DunningLog {
  id: string;
  homeowner_id: string;
  rule_id: string | null;
  days_past_due: number;
  action: string;
  status: string;
  balance: number;
  detail: string | null;
  sent_at: string | null;
  created_at: string;
}
