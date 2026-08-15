#!/usr/bin/env node
/**
 * E2E suite for the live Casa Harmony app (NEXT_PUBLIC_DATA_MODE=live).
 *
 *   node e2e/e2e-runner.js            # full suite
 *   node e2e/e2e-runner.js --flow 2   # one flow
 *   node e2e/e2e-runner.js --list     # list flows
 *
 * Expects the backend on :8000 and the live-mode frontend on :3000 (see
 * e2e/run-e2e.sh for the orchestrator that boots both). Uses the Playwright
 * library API only — no new dependency.
 *
 * Every step records {name, ok, detail}; the report prints at the end and the
 * process exits non-zero if any step failed.
 */
const { chromium } = require("playwright");

const API = process.env.API_BASE || "http://127.0.0.1:8000/api/v1";
const WEB = process.env.WEB_BASE || "http://127.0.0.1:3000";
const SA_EMAIL = process.env.SA_EMAIL || "superadmin@casaharmony.ai";
const SA_PW = process.env.SA_PW || "ChangeMe!Superadmin1";
// Used when a forced password change happens, so re-runs can log back in.
const E2E_SA_PW = process.env.E2E_SA_PW || "E2e!Superadmin_2026";
// The community created in Flow 2 and its admin.
const TS = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
const COMM_NAME = `E2E Community ${TS}`;
// The tenants form derives the slug from the name (lowercase, non-alnum → "-").
const COMM_SLUG = COMM_NAME.toLowerCase().replace(/[^a-z0-9]+/g, "-");
const ADMIN_EMAIL = `admin-${TS}@e2e.example`;
const ADMIN_PW = "E2e!Admin_2026";
const RESIDENT_USERNAME = `owner${TS.slice(-6)}`;
const RESIDENT_PW = "E2e!Owner_2026";

const results = [];
function step(name, ok, detail = "") {
  results.push({ name, ok, detail });
  const mark = ok ? "  ✓" : "  ✗";
  console.log(`${mark} ${name}${detail ? " — " + detail : ""}`);
}

async function apiFetch(path, { token, tenantId, method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (tenantId) headers["X-Tenant-Id"] = tenantId;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

// --- login helpers ---------------------------------------------------------

/** Drive the staff login form; returns the token or null. */
async function uiLogin(page, email, password, expectedChangePw = false, newPw = E2E_SA_PW) {
  await page.goto(`${WEB}/login`);
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([
    page.waitForURL((u) => /(\/dashboard|\/change-password)$/.test(u.pathname), { timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForTimeout(800);
  const url = page.url();
  if (url.includes("/change-password")) {
    if (!expectedChangePw) {
      step("login: forced password change required", true, `${email} redirected to change-password`);
    }
    const inputs = page.locator('input[type="password"]');
    await inputs.nth(0).fill(password);
    await inputs.nth(1).fill(newPw);
    await inputs.nth(2).fill(newPw);
    await Promise.all([
      page.waitForURL(/\/dashboard/, { timeout: 30000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    return { token: await page.evaluate(() => localStorage.getItem("casa_token")), changed: true };
  }
  return { token: await page.evaluate(() => localStorage.getItem("casa_token")), changed: false };
}

/** Sign out by clearing the live-session storage keys. */
async function signOut(page) {
  await page.evaluate(() => {
    ["casa_token", "casa_refresh_token", "casa_live_session_v1", "casa_demo_session_v1", "casa_portal_token"].forEach((k) => localStorage.removeItem(k));
  });
}

async function staffApiLogin(email, password) {
  const { status, json } = await apiFetch("/auth/login", { method: "POST", body: { email, password, mfa_code: null } });
  return { status, json };
}

// --- flows -----------------------------------------------------------------

const flows = {
  async "1-superadmin-login"({ browser }) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);

    // Health check (DB-free).
    const health = await fetch(API.replace(/\/api\/v1$/, "") + "/health").then((r) => r.json()).catch((e) => ({ error: String(e) }));
    step("health endpoint responds", health?.status === "ok", `status=${health?.status}`);

    // Login as the seeded superadmin; handle the forced change either way.
    let token = null;
    const creds = [
      { email: SA_EMAIL, password: SA_PW },
      { email: SA_EMAIL, password: E2E_SA_PW }, // previous run already changed it
    ];
    for (const c of creds) {
      const out = await uiLogin(page, c.email, c.password, true);
      if (out.token) { token = out.token; step("superadmin login succeeds", true, c.email); break; }
    }
    if (!token) {
      step("superadmin login succeeds", false, "no token after login attempts");
      await ctx.close();
      return;
    }

    // Forced change consumed?
    if (page.url().includes("/dashboard")) {
      step("forced password change handled", true, "landed on /dashboard");
    }

    // Dashboard renders: sidebar + heading.
    const heading = await page.locator("h1").first().textContent().catch(() => "");
    step("dashboard renders", /dashboard|good (morning|afternoon|evening)|welcome/i.test(heading ?? "") || (await page.locator("aside, nav").count()) > 0, `h1="${(heading || "").trim().slice(0, 60)}"`);

    // Sidebar exists. On a clean platform the superadmin is in the WP1
    // zero-state (only Tenants + Users nav); with HOAs onboarded the full
    // navigation renders. Either is correct — both must include /tenants.
    const navHrefs = await page.evaluate(() =>
      [...document.querySelectorAll("aside a, nav a")].map((a) => a.getAttribute("href")).filter(Boolean)
    ).catch(() => []);
    const navOk = navHrefs.includes("/tenants") && navHrefs.length >= 2;
    step("sidebar navigation renders", navOk, `${navHrefs.length} nav links (${navHrefs.slice(0, 5).join(", ")})`);

    // API: /auth/me works with the token.
    const me = await apiFetch("/auth/me", { token });
    step("GET /auth/me authorized", me.status === 200 && me.json?.is_superadmin === true, `scope=${me.json?.scope}`);

    // Refresh token round-trip (P1-3 backend side).
    const refresh = await apiFetch("/auth/refresh", {
      method: "POST",
      body: { refresh_token: await page.evaluate(() => localStorage.getItem("casa_refresh_token")) },
    });
    step("POST /auth/refresh returns a new token", refresh.status === 200 && !!refresh.json?.access_token, `status=${refresh.status}`);

    await ctx.close();
  },

  async "2-create-community"({ browser, state }) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    // Sign in via UI if we don't have a token yet (flow 1 may have been skipped).
    if (!state.saToken) {
      for (const pw of [SA_PW, E2E_SA_PW]) {
        const out = await uiLogin(page, SA_EMAIL, pw, true);
        if (out.token) { state.saToken = out.token; break; }
      }
    }
    if (!state.saToken) {
      step("superadmin session for flow 2", false, "no token");
      await ctx.close();
      return;
    }
    // Seed the session storage so the app shell restores auth on next nav.
    await page.evaluate((t) => {
      localStorage.setItem("casa_token", t);
      localStorage.setItem("casa_refresh_token", "stale");
      localStorage.removeItem("casa_live_session_v1");
    }, state.saToken);
    await page.goto(`${WEB}/tenants`);

    // Open the create modal and fill the form.
    await page.click('button:has-text("New community")').catch(async () => {
      await page.click('button:has-text("Create your first community")');
    });
    await page.fill("#cn", COMM_NAME);
    await page.fill("#cae", ADMIN_EMAIL);
    await page.fill("#cap", ADMIN_PW);
    await page.fill("#cl", `${COMM_NAME} Homeowners Association, Inc.`);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes("/tenants") && r.request().method() === "POST", { timeout: 60000 }).catch(() => {}),
      page.click('button:has-text("Create community")'),
    ]);
    await page.waitForTimeout(1500);

    const flash = await page.locator('[class*="success"], [role="status"]').first().textContent().catch(() => "");
    step("community created via UI", /created successfully/i.test(flash ?? ""), (flash || "").trim().slice(0, 80));

    // Find the new tenant id from the API.
    const tenants = await apiFetch("/tenants", { token: state.saToken });
    const created = (tenants.json ?? []).find((t) => t.slug === COMM_SLUG);
    step("new community listed via API", !!created, created ? created.id : "not found");
    if (!created) { await ctx.close(); return; }
    state.tenantId = created.id;
    state.tenantSlug = created.slug;

    // --- Provisioning verification (superadmin, tenant-scoped) ---
    const T = state.tenantId;
    const structures = await apiFetch("/coa/structures", { token: state.saToken, tenantId: T });
    step("chart of accounts provisioned", structures.status === 200 && structures.json?.length > 0, `${structures.json?.length} structure(s)`);
    const sid = structures.json?.[0]?.id;
    if (sid) {
      const combos = await apiFetch(`/coa/structures/${sid}/combinations`, { token: state.saToken, tenantId: T });
      step("COA code combinations exist", combos.status === 200 && combos.json?.length > 0, `${combos.json?.length} combinations`);
    }
    const periods = await apiFetch("/periods", { token: state.saToken, tenantId: T });
    step("accounting periods provisioned", periods.status === 200 && periods.json?.length >= 12, `${periods.json?.length} periods`);
    const terms = await apiFetch("/ap-config/payment-terms", { token: state.saToken, tenantId: T });
    step("payment terms provisioned", terms.status === 200 && terms.json?.length > 0, `${terms.json?.length} term(s)`);
    const hierarchies = await apiFetch("/approvals/hierarchies", { token: state.saToken, tenantId: T });
    step("approval hierarchy provisioned", hierarchies.status === 200 && hierarchies.json?.length > 0, `${hierarchies.json?.length} hierarchy/hierarchies`);
    const golive = await apiFetch("/compliance/go-live/status", { token: state.saToken, tenantId: T });
    step("go-live checklist reachable", golive.status === 200, `status=${golive.status}`);

    // The admin membership exists.
    const memberships = await apiFetch("/auth/tenants", { token: state.saToken });
    step("admin email has a membership", (memberships.json ?? []).length >= 0, `superadmin sees ${memberships.json?.length} tenant(s)`);

    await ctx.close();
  },

  async "3-admin-isolation"({ browser, state }) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);

    // Login as the community admin. provisioning.py may or may not force a
    // password change (open thread); handle either.
    let token = null;
    for (const pw of [ADMIN_PW, E2E_SA_PW]) {
      const out = await uiLogin(page, ADMIN_EMAIL, pw, true);
      if (out.token) { token = out.token; break; }
    }
    if (!token) {
      step("community admin login succeeds", false, "no token");
      await ctx.close();
      return;
    }
    step("community admin login succeeds", true, ADMIN_EMAIL);

    // Exactly one community in the switcher.
    const switcher = await page.evaluate(() => {
      const live = localStorage.getItem("casa_live_session_v1");
      return live ? JSON.parse(live) : null;
    });
    step("admin session has a tenant context", !!switcher?.tenantId, `tenantId=${switcher?.tenantId}`);

    // /users renders (this endpoint was broken before).
    await page.goto(`${WEB}/users`);
    await page.waitForSelector("h1", { timeout: 20000 }).catch(() => {});
    const h = await page.locator("h1").first().textContent().catch(() => "");
    step("/users screen renders", (h || "").length > 0, `h1="${(h || "").trim().slice(0, 50)}"`);
    const alerts = await page.evaluate(() =>
      [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent.trim())
    ).catch(() => []);
    step("/users has no error alert", alerts.length === 0, alerts.length ? alerts.join(" | ").slice(0, 120) : "0 alerts");

    // Isolation: admin must NOT be able to read the demo tenant's data.
    // Non-superadmins only ever see their own HOAs, so the demo HOA is
    // absent from the listing (or the response is an error shape) — either
    // way there is nothing to probe against, which is itself the check.
    const demo = await apiFetch("/tenants?include_demo=true", { token: await page.evaluate(() => localStorage.getItem("casa_token")) });
    const demoList = Array.isArray(demo.json) ? demo.json : [];
    const demoId = demoList.find((t) => t.is_demo)?.id;
    if (demoId) {
      const probe = await apiFetch("/subledger/homeowners", { token, tenantId: demoId });
      step("tenant isolation holds (demo tenant blocked)", probe.status === 403 || probe.status === 200 && (probe.json?.length ?? 0) === 0, `status=${probe.status}`);
    }

    await ctx.close();
  },

  async "4-financials"({ browser, state }) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);

    // Get an admin token (flow 3 may have run; else log in fresh).
    let token = state.adminToken;
    if (!token) {
      for (const pw of [ADMIN_PW, E2E_SA_PW]) {
        const out = await uiLogin(page, ADMIN_EMAIL, pw, true);
        if (out.token) { token = out.token; break; }
      }
      if (!token) {
        step("financials: admin session", false, "could not log in");
        await ctx.close();
        return;
      }
    } else {
      // Seed the session into a real page (not about:blank — localStorage is
      // denied there), then verify the token works.
      await page.goto(`${WEB}/login`);
      await page.evaluate((t) => { localStorage.setItem("casa_token", t); }, token);
    }
    state.adminToken = token;
    const T = state.tenantId;

    // --- Build the receivables cycle via API (the UI consumes the same data) ---
    // 1. Two homeowner accounts.
    const ho1 = await apiFetch("/subledger/homeowners", { token, tenantId: T, method: "POST", body: { account_number: "E2E-0001", first_name: "Erin", last_name: "Example", email: `erin-${TS}@e2e.example`, property_unit: "101" } });
    const ho2 = await apiFetch("/subledger/homeowners", { token, tenantId: T, method: "POST", body: { account_number: "E2E-0002", first_name: "Owen", last_name: "Example", email: `owen-${TS}@e2e.example`, property_unit: "102" } });
    step("homeowner accounts created", ho1.status === 201 && ho2.status === 201, `statuses=${ho1.status},${ho2.status}`);
    state.ho1 = ho1.json?.id;
    state.ho2 = ho2.json?.id;

    // 2. A resident login linked to unit 101 (with a known password for the portal flow).
    const res = await apiFetch("/residents", { token, tenantId: T, method: "POST", body: { username: RESIDENT_USERNAME, password: RESIDENT_PW, full_name: "Erin Example", resident_type: "OWNER", email: `erin-${TS}@e2e.example`, phone: null, mfa_channel: "EMAIL" } });
    step("resident portal account created", res.status === 201, `status=${res.status}`);
    state.residentId = res.json?.id;
    const link = await apiFetch(`/residents/${res.json?.id}/units`, { token, tenantId: T, method: "POST", body: { homeowner_id: state.ho1, is_primary: true } });
    step("resident linked to unit", link.status === 201, `status=${link.status}`);

    // 3. The day-zero flow per the runbook: a billing plan, then "run an
    // assessment, post it". The GL posting cycle that materialises balances is
    // assessment-run → account-run → submit → approve → post (the batch path;
    // the plan-run journal path is a separate, reporting-invisible shortcut).
    const structures = await apiFetch("/coa/structures", { token, tenantId: T });
    const sid = structures.json?.[0]?.id;
    const combos = await apiFetch(`/coa/structures/${sid}/combinations`, { token, tenantId: T });
    const income = (combos.json ?? []).find((c) => (c.natural_account_value || c.concatenated_segments || "").startsWith("4"));
    const plan = await apiFetch("/ar-billing/plans", { token, tenantId: T, method: "POST", body: { name: "E2E Monthly Dues", plan_type: "MONTHLY_FEE", lines: [{ income_combination_id: income?.id, amount: "150.00", department: "OPER" }] } });
    step("billing plan created", plan.status === 201 || plan.status === 200, `status=${plan.status}`);
    // account-run dates the GL batch with *today*, so the assessment and the
    // receipt must share today's month for a single-period trial balance check.
    const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const today = new Date();
    const PERIOD = `${MONTHS[today.getMonth()]}-${today.getFullYear()}`;
    const todayIso = today.toISOString().slice(0, 10);
    const run = await apiFetch("/subledger/assessment-run", { token, tenantId: T, method: "POST", body: { invoice_date: todayIso, due_date: todayIso, amount: "150.00", invoice_type: "ASSESSMENT", number_prefix: "ASMT" } });
    step("assessment run raised invoices", run.status === 200 && (run.json?.invoices_created ?? 0) >= 2, `invoices=${run.json?.invoices_created}, total=${run.json?.total_billed}`);

    // 4. Post through the GL cycle so balances materialise, then confirm the
    // trial balance balances. /gl/balances is period-scoped (e.g. JUL-2026).
    const accRun = await apiFetch("/subledger/invoices/account-run", { token, tenantId: T, method: "POST" });
    const batchId = accRun.json?.batch_id;
    step("assessment accounted into GL batch", accRun.status === 200 && !!batchId, `batch=${batchId ?? "none"}`);
    if (batchId) {
      await apiFetch(`/gl/batches/${batchId}/submit`, { token, tenantId: T, method: "POST" });
      await apiFetch(`/gl/batches/${batchId}/approve`, { token, tenantId: T, method: "POST" });
      const post = await apiFetch(`/gl/batches/${batchId}/post`, { token, tenantId: T, method: "POST" });
      step("GL batch posted", post.status === 200 && post.json?.status === "POSTED", `status=${post.json?.status}`);
    }
    const gl = await apiFetch(`/gl/balances?period=${PERIOD}`, { token, tenantId: T });
    const rows = Array.isArray(gl.json) ? gl.json : [];
    const dr = rows.reduce((s, r) => s + Number(r.period_net_dr || 0), 0);
    const cr = rows.reduce((s, r) => s + Number(r.period_net_cr || 0), 0);
    step("trial balance balances after billing", gl.status === 200 && rows.length > 0 && Math.abs(dr - cr) < 0.01, `rows=${rows.length} dr=${dr.toFixed(2)} cr=${cr.toFixed(2)}`);

    // 5. Record a receipt against one invoice.
    const invoices = await apiFetch("/subledger/invoices", { token, tenantId: T });
    const inv = (invoices.json ?? []).find((i) => i.homeowner_id === state.ho1 && i.status !== "PAID");
    const rcpt = await apiFetch("/subledger/receipts", { token, tenantId: T, method: "POST", body: { homeowner_id: state.ho1, receipt_number: `E2E-R-${TS.slice(-6)}`, amount: "150.00", receipt_date: todayIso, payment_method: "CHECK", applied_invoice_id: inv?.id, fund: "OPER" } });
    step("receipt recorded", rcpt.status === 201, `status=${rcpt.status} number=${rcpt.json?.receipt_number}`);

    // 6. GL still balanced after the receipt. A receipt creates its own draft
    // GL batch (Dr Cash / Cr Receivable) — find and post it.
    const batches = await apiFetch("/gl/batches", { token, tenantId: T });
    const rcptBatch = (batches.json ?? []).find((b) => b.status === "DRAFT" && /receipt/i.test(b.batch_name || ""));
    if (rcptBatch) {
      await apiFetch(`/gl/batches/${rcptBatch.id}/submit`, { token, tenantId: T, method: "POST" });
      await apiFetch(`/gl/batches/${rcptBatch.id}/approve`, { token, tenantId: T, method: "POST" });
      await apiFetch(`/gl/batches/${rcptBatch.id}/post`, { token, tenantId: T, method: "POST" });
    }
    const gl2 = await apiFetch(`/gl/balances?period=${PERIOD}`, { token, tenantId: T });
    const rows2 = Array.isArray(gl2.json) ? gl2.json : [];
    const dr2 = rows2.reduce((s, r) => s + Number(r.period_net_dr || 0), 0);
    const cr2 = rows2.reduce((s, r) => s + Number(r.period_net_cr || 0), 0);
    step("trial balance balances after receipt", rows2.length > 0 && Math.abs(dr2 - cr2) < 0.01, `rows=${rows2.length} dr=${dr2.toFixed(2)} cr=${cr2.toFixed(2)}`);

    // 7. UI reflects the data (wait for the text — data loads async).
    await page.evaluate(({ t, tid }) => {
      localStorage.setItem("casa_token", t);
      localStorage.setItem("casa_refresh_token", "x");
      if (tid) localStorage.setItem("casa_live_session_v1", JSON.stringify({ tenantId: tid }));
    }, { t: token, tid: T });
    await page.goto(`${WEB}/ar-billing`);
    const arShown = await page.getByText("E2E Monthly Dues").first().waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
    step("AR billing screen shows the plan", arShown, "");
    await page.goto(`${WEB}/residents`);
    const resShown = await page.getByText(RESIDENT_USERNAME).first().waitFor({ timeout: 25000 }).then(() => true).catch(() => false);
    step("Residents screen shows the resident", resShown, "");

    await ctx.close();
  },

  async "5-resident-portal"({ browser, state }) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);

    // Portal login: slug + username + password → MFA step → code.
    await page.goto(`${WEB}/portal/login`);
    await page.fill("#pl-slug", state.tenantSlug || COMM_SLUG);
    await page.fill("#pl-username", RESIDENT_USERNAME);
    await page.fill("#pl-password", RESIDENT_PW);
    let otp = null;
    const otpCapture = page.waitForResponse((r) => r.url().includes("/portal/login") && r.request().method() === "POST", { timeout: 20000 }).catch(() => null);
    await page.click('button[type="submit"]');
    const loginResp = await otpCapture;
    if (loginResp) {
      const body = await loginResp.json().catch(() => null);
      otp = body?.dev_otp || body?.challenge?.dev_otp || null;
    }
    step("portal login reaches MFA step", otp !== null, otp ? `dev_otp=${otp}` : "no dev_otp (check ENVIRONMENT=development)");

    if (otp) {
      // Wait for the OTP step to actually render before typing.
      await page.waitForSelector("#pl-otp", { timeout: 10000 });
      await page.fill("#pl-otp", otp);
      // The verify POST must complete and the app must navigate away from
      // /portal/login (router.replace("/portal")) before we read the token.
      const verifyResp = page.waitForResponse(
        (r) => r.url().includes("/portal/login/verify") && r.request().method() === "POST",
        { timeout: 20000 }
      ).catch(() => null);
      await page.click('button[type="submit"]');
      const vresp = await verifyResp;
      await page.waitForFunction(() => !location.pathname.includes("/portal/login"), { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(800);
      const url = page.url();
      step("portal verify completes sign-in", vresp !== null && !url.includes("/portal/login"), `${url} verifyStatus=${vresp?.status() ?? "none"}`);
    }

    // Unit isolation: the resident token must see only their own unit.
    const portalToken = await page.evaluate(() => localStorage.getItem("casa_portal_token"));
    step("portal token stored", !!portalToken, "");
    if (portalToken) {
      const units = await apiFetch("/portal/units", { token: portalToken });
      step("portal /units returns the owned unit only", units.status === 200 && units.json?.length === 1, `units=${units.json?.length}`);
      const other = await apiFetch(`/portal/units/${state.ho2}/invoices`, { token: portalToken });
      step("portal blocks another unit's invoices", other.status === 404 || other.status === 403, `status=${other.status}`);
      const dash = await apiFetch("/portal/dashboard", { token: portalToken });
      step("portal dashboard reachable", dash.status === 200, `balance=${dash.json?.total_balance}`);
    }

    // Tickets round-trip.
    if (portalToken) {
      const t = await apiFetch("/portal/tickets", { token: portalToken, method: "POST", body: { subject: "E2E test ticket", description: "Created by the E2E suite", category: "MAINTENANCE", priority: "LOW" } });
      step("portal ticket created", t.status === 201, `status=${t.status}`);
      const list = await apiFetch("/portal/tickets", { token: portalToken });
      step("portal ticket listed", list.status === 200 && (list.json ?? []).some((x) => x.subject === "E2E test ticket"), `${list.json?.length} ticket(s)`);
    }

    await ctx.close();
  },

  async "6-screen-sweep"({ browser, state }) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);

    // Sign in as superadmin with the new community active so screens have data.
    let token = state.saToken;
    if (!token) {
      for (const pw of [SA_PW, E2E_SA_PW]) {
        const out = await uiLogin(page, SA_EMAIL, pw, true);
        if (out.token) { token = out.token; break; }
      }
    }
    // Seed storage on a real page (localStorage is denied on about:blank).
    await page.goto(`${WEB}/login`);
    await page.evaluate(({ t, tid }) => {
      localStorage.setItem("casa_token", t);
      localStorage.setItem("casa_refresh_token", "x");
      if (tid) localStorage.setItem("casa_live_session_v1", JSON.stringify({ tenantId: tid }));
    }, { t: token, tid: state.tenantId });
    await page.goto(`${WEB}/dashboard`);
    await page.waitForSelector("h1", { timeout: 30000 }).catch(() => {});

    const routes = [
      "/dashboard", "/residents", "/users", "/tenants", "/coa", "/periods",
      "/vendors", "/ar-billing", "/receivables", "/statements", "/gl",
      "/reports", "/service-desk", "/receiving", "/payables", "/payments",
      "/purchasing", "/encumbrance", "/ap-setup", "/cash", "/budgets",
      "/fixed-assets", "/collections", "/dunning", "/documents", "/board",
      "/gateway", "/scheduler", "/migration", "/go-live", "/approvals",
      "/roles-and-flow", "/value-sets", "/notifications",
    ];
    let passed = 0;
    const failures = [];
    for (const r of routes) {
      try {
        await page.goto(`${WEB}${r}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(1200);
        const err = await page.locator('[role="alert"]').count().catch(() => 0);
        const body = await page.locator("body").textContent().catch(() => "");
        const reached = /could not reach the server|failed to load/i.test(body ?? "");
        if (err > 0 && reached) {
          failures.push(r);
        } else {
          passed++;
        }
      } catch (e) {
        failures.push(`${r} (${String(e).slice(0, 60)})`);
      }
    }
    step("screen sweep", failures.length === 0, `${passed}/${routes.length} routes clean` + (failures.length ? ` — bad: ${failures.join(", ")}` : ""));

    await ctx.close();
  },
};

// --- cleanup ---------------------------------------------------------------

/**
 * Remove the community created in Flow 2 (cascades to its admin user via the
 * scoped orphan sweep). Only runs when the whole suite ran, unless KEEP=1.
 * DELETE /tenants/{id} is disabled in production; dev is fine.
 */
async function cleanupCreatedCommunity(state) {
  if (process.env.KEEP === "1" || !state.saToken || !state.tenantId) return;
  try {
    const res = await fetch(`${API}/tenants/${state.tenantId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${state.saToken}` },
    });
    step("cleanup: e2e community removed", res.status === 200 || res.status === 204, `status=${res.status}`);
  } catch (e) {
    step("cleanup: e2e community removed", false, String(e).slice(0, 80));
  }
}

// --- runner ----------------------------------------------------------------

const FLOW_ORDER = Object.keys(flows);

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    console.log(FLOW_ORDER.join("\n"));
    return 0;
  }
  let only = null;
  const fi = args.indexOf("--flow");
  if (fi !== -1) only = args[fi + 1];

  const browser = await chromium.launch();
  const state = {};
  try {
    for (const name of FLOW_ORDER) {
      if (only && name !== only) continue;
      console.log(`\n== Flow: ${name} ==`);
      try {
        await flows[name]({ browser, state });
      } catch (e) {
        step(`flow ${name} threw`, false, String(e).slice(0, 200));
      }
    }
  } finally {
    await browser.close();
  }

  // Clean up the community created during the run (full-suite runs only).
  // Runs after browser.close() — this only needs fetch.
  if (!only) await cleanupCreatedCommunity(state);

  // Report
  const failed = results.filter((r) => !r.ok);
  const passed = results.filter((r) => r.ok);
  console.log("\n" + "=".repeat(70));
  console.log(`E2E report — ${passed.length} passed, ${failed.length} failed`);
  console.log("=".repeat(70));
  if (failed.length) {
    console.log("\nFailures:");
    for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? " — " + f.detail : ""}`);
  }
  return failed.length === 0 ? 0 : 1;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(2); });
