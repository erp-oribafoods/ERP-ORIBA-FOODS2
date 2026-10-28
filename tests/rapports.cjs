const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const CDN = process.env.CDN_DIR, OUT = process.env.OUT_DIR;
const map = { 'chart.umd.min.js': 'chart.js/dist/chart.umd.js', 'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js', 'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js': 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js' };
(async () => {
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>' + fs.readFileSync(path.join(__dirname, '../dist/demo.html'), 'utf8') + '</body></html>';
  const browser = await chromium.launch(); const errors = [];
  for (const user of ['dg', 'rh', 'daf', 'commercial']) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await ctx.route('**/*', (route) => { const u = route.request().url(); if (u.startsWith('http://erp.test/')) return route.fulfill({ contentType: 'text/html', body: html }); const f = Object.keys(map).find((k) => u.endsWith(k)); if (f) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(CDN, 'node_modules', map[f])) }); if (u.includes('fonts.g')) return route.fulfill({ contentType: 'text/css', body: '' }); return route.abort(); });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(user + ' PAGEERROR ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(user + ' ' + m.text()); });
    await page.goto('http://erp.test/'); await page.waitForSelector('#lf', { timeout: 120000 });
    await page.fill('[name=identifiant]', user); await page.fill('[name=password]', 'Demo2026'); await page.click('#lf button[type=submit]'); await page.waitForSelector('.layout');
    await page.waitForTimeout(600);
    if (user === 'dg') await page.screenshot({ path: path.join(OUT, 'dash-dg.png') });
    for (const [type, fmt] of [['hebdo', 'pdf'], ['mensuel', 'pdf'], ['hebdo', 'xlsx'], ['mensuel', 'xlsx']]) {
      await page.click('#rapports'); await page.waitForSelector('#rp-type');
      await page.click(`[data-t=${type}]`);
      if (type === 'mensuel') await page.fill('#rp-mois', '2026-09');
      if (user === 'dg' && fmt === 'pdf') await page.screenshot({ path: path.join(OUT, `modal-${type}.png`) });
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click(fmt === 'pdf' ? '#rp-pdf' : '#rp-xlsx')]);
      const f = path.join(OUT, `${user}-${type}.${fmt}`); await dl.saveAs(f);
      await page.waitForTimeout(400);
      const t = await page.textContent('#toasts').catch(() => '');
      console.log(user, type, fmt, fs.statSync(f).size, (t || '').trim().slice(-60));
      await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    }
    await ctx.close();
  }
  console.log(errors.length ? 'ERREURS:\n' + errors.join('\n') : 'Aucune erreur');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
