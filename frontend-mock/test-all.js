const { chromium } = require('playwright');

const routes = [
  '/dashboard', '/service-desk', '/residents', '/documents', '/notifications',
  '/coa', '/value-sets', '/vendors', '/ap-setup', '/cash', '/budgets', '/fixed-assets',
  '/purchasing', '/receiving', '/encumbrance', '/payables', '/payments',
  '/ar-billing', '/collections', '/statements', '/dunning', '/receivables',
  '/gl', '/periods', '/approvals', '/users', '/tenants', '/gateway',
  '/scheduler', '/reports', '/board', '/migration', '/go-live'
];

(async () => {
  console.log("Starting browser...");
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log("Setting mock auth...");
  await page.goto('http://localhost:3000/login');
  
  await page.evaluate(() => {
    localStorage.setItem('ch_erp_token', 'mock_jwt_token_123');
    localStorage.setItem('ch_erp_active_tenant', 'tenant-1');
  });

  await page.goto('http://localhost:3000/dashboard', { waitUntil: 'networkidle' });
  console.log("Logged in successfully.");

  const failedRoutes = [];
  
  for (const route of routes) {
    console.log(`Checking ${route}...`);
    try {
      await page.goto(`http://localhost:3000${route}`, { waitUntil: 'networkidle', timeout: 15000 });
      
      // Check for Next.js error overlay text or React error text
      const hasErrorText = await page.locator('text="This page couldn\'t load"').count() > 0;
      const hasRuntimeError = await page.locator('text="Application error: a client-side exception has occurred"').count() > 0;
      
      if (hasErrorText || hasRuntimeError) {
        console.error(`❌ Route ${route} CRASHED!`);
        failedRoutes.push(route);
      } else {
        console.log(`✅ Route ${route} is OK.`);
      }
    } catch (e) {
      console.error(`❌ Route ${route} FAILED TO LOAD: ${e.message}`);
      failedRoutes.push(route);
    }
  }

  await browser.close();
  
  if (failedRoutes.length > 0) {
    console.log("\\n--- REPORT ---");
    console.log("The following pages failed/crashed:");
    failedRoutes.forEach(r => console.log("- " + r));
  } else {
    console.log("\\n--- REPORT ---");
    console.log("✅ ALL PAGES LOADED SUCCESSFULLY!");
  }
})();
