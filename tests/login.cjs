const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
(async () => {
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fs.readFileSync(path.join(__dirname, '../dist/demo.html'), 'utf8') + '</body></html>';
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  await p.route('**/*', (r) => r.request().url().startsWith('http://erp.test/') ? r.fulfill({ contentType: 'text/html', body: html }) : r.abort());
  await p.goto('http://erp.test/'); await p.waitForSelector('#lf', { timeout: 120000 }); await p.waitForTimeout(500);
  await p.screenshot({ path: process.env.OUT_DIR + '/login.png' });
  await p.fill('[name=identifiant]', 'dg'); await p.fill('[name=password]', 'Demo2026'); await p.click('#lf button[type=submit]'); await p.waitForSelector('.layout'); await p.waitForTimeout(1500);
  console.log(await p.$$eval('.kpi-v', (e) => e.slice(0, 4).map((x) => x.textContent)));
  await b.close();
})();
