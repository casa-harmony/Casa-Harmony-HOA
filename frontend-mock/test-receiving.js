const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', err => console.error('PAGE ERROR:', err));
  page.on('console', msg => console.log('CONSOLE:', msg.text()));
  await page.goto('http://localhost:3000/receiving', { waitUntil: 'networkidle' });
  await browser.close();
})();
