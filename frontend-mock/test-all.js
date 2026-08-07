/**
 * Crash sweep for the demo build.
 *
 *   node test-all.js            # against a running dev server on :3000
 *   BASE=http://localhost:3001 node test-all.js
 *
 * Signs in as the Super Administrator (sees every screen), visits each route
 * and reports the Next.js error overlay plus any console/page errors.
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:3000';

// Every route, including the ones currently hidden from the sidebar.
const routes = [
  '/dashboard', '/service-desk', '/residents', '/documents', '/notifications',
  '/vendors', '/payables', '/payments', '/purchasing', '/receiving',
  '/encumbrance', '/ap-setup',
  '/ar-billing', '/receivables', '/collections', '/statements', '/dunning',
  '/coa', '/value-sets', '/budgets', '/gl', '/periods', '/cash',
  '/fixed-assets', '/approvals',
  '/users', '/tenants', '/gateway', '/scheduler', '/reports', '/board',
  '/migration', '/go-live',
  '/roles-and-flow', '/portal/login', '/login',
];

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  // Session shape written by app/providers.tsx (LS_KEY / persona + tenant).
  await page.goto(`${BASE}/login`);
  await page.evaluate(() =>
    localStorage.setItem(
      'casa_demo_session_v1',
      JSON.stringify({ personaId: 'user-1', tenantId: 'tenant-1' })
    )
  );

  const failed = [];

  for (const route of routes) {
    const problems = [];
    const onConsole = (m) => m.type() === 'error' && problems.push(m.text());
    const onError = (e) => problems.push(`pageerror: ${e.message}`);
    page.on('console', onConsole);
    page.on('pageerror', onError);

    try {
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 20000 });
      const overlay =
        (await page.locator('text="This page couldn\'t load"').count()) > 0 ||
        (await page.locator('text="Application error"').count()) > 0 ||
        (await page.locator('text="Unhandled Runtime Error"').count()) > 0;
      if (overlay) problems.push('error overlay rendered');
    } catch (e) {
      problems.push(`navigation: ${e.message}`);
    }

    page.off('console', onConsole);
    page.off('pageerror', onError);

    if (problems.length) {
      failed.push({ route, problems });
      console.error(`FAIL ${route}\n      ${problems.join('\n      ')}`);
    } else {
      console.log(`ok   ${route}`);
    }
  }

  await browser.close();

  console.log('\n--- REPORT ---');
  if (failed.length) {
    failed.forEach((f) => console.log(`- ${f.route}: ${f.problems[0]}`));
    process.exit(1);
  }
  console.log(`All ${routes.length} routes loaded clean.`);
})();
