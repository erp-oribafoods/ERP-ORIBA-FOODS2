const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const CDN = process.env.CDN_DIR, OUT = process.env.OUT_DIR;
const map = { 'chart.umd.min.js': 'chart.js/dist/chart.umd.js', 'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js', 'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js': 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js' };
(async () => {
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>' + fs.readFileSync(path.join(__dirname, '../dist/demo.html'), 'utf8') + '</body></html>';
  const browser = await chromium.launch(); const errors = [];
  for (const [vw, user] of [[1440, 'commercial'], [390, 'daf'], [1440, 'rh'], [1440, 'admin']]) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: 900 } });
    await ctx.route('**/*', (route) => { const u = route.request().url(); if (u.startsWith('http://erp.test/')) return route.fulfill({ contentType: 'text/html', body: html }); const f = Object.keys(map).find((k) => u.endsWith(k)); if (f) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(CDN, 'node_modules', map[f])) }); if (u.includes('fonts.g')) return route.fulfill({ contentType: 'text/css', body: '' }); return route.abort(); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto('http://erp.test/'); await page.waitForSelector('#lf', { timeout: 120000 });
    await page.fill('[name=identifiant]', user); await page.fill('[name=password]', 'Demo2026'); await page.click('#lf button[type=submit]'); await page.waitForSelector('.layout');
    await page.evaluate(() => { location.hash = 'saisie'; }); await page.waitForTimeout(700);
    const n = await page.$$eval('.saisie-c', (x) => x.length);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) errors.push(`débordement ${user}`);
    await page.screenshot({ path: path.join(OUT, `saisie-${user}-${vw}.png`), fullPage: true });
    const btns = await page.$$('[data-s]');
    let opened = 0;
    for (let i = 0; i < btns.length; i++) {
      await page.evaluate(() => { location.hash = 'saisie'; }); await page.waitForTimeout(400);
      const b = (await page.$$('[data-s]'))[i]; const lib = (await b.textContent()).trim();
      await b.click(); await page.waitForTimeout(900);
      if (await page.$('.modal')) opened++; else errors.push(`${user} : « ${lib} » n’a pas ouvert de formulaire`);
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    }
    console.log(user, vw, ':', n, 'rubriques,', opened, '/', btns.length, 'formulaires ouverts');
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS:\n' + errors.join('\n') : 'Aucune erreur');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
