// Parcours d'interface du module « Prévisions » en démonstration (Playwright).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const CDN = process.env.CDN_DIR, OUT = process.env.OUT_DIR, XLSX_FILE = process.env.MAYO_XLSX;
const map = { 'chart.umd.min.js': 'chart.js/dist/chart.umd.js', 'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js', 'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js': 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js' };
(async () => {
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fs.readFileSync(path.join(__dirname, '../dist/demo.html'), 'utf8') + '</body></html>';
  const browser = await chromium.launch(); const errors = [];
  for (const [vp, scheme] of [[{ width: 1440, height: 900 }, 'light'], [{ width: 390, height: 844 }, 'dark']]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme });
    await ctx.route('**/*', (route) => { const u = route.request().url();
      if (u.startsWith('http://erp.test/')) return route.fulfill({ contentType: 'text/html', body: html });
      const f = Object.keys(map).find((k) => u.endsWith(k)); if (f) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(CDN, 'node_modules', map[f])) });
      return route.abort(); });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${vp.width}] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${vp.width}] PAGEERROR ${e.message}`));
    await page.goto('http://erp.test/'); await page.waitForSelector('#lf', { timeout: 120000 });
    await page.fill('[name=identifiant]', 'commercial'); await page.fill('[name=password]', 'Demo2026'); await page.click('#lf button[type=submit]');
    await page.waitForSelector('.layout', { timeout: 30000 });
    if (!(await page.$('a[data-p="previsions"]'))) errors.push('Entrée de menu absente');
    for (const axe of ['agent', 'marche', 'zone', 'depot', 'pics']) {
      await page.evaluate(() => { location.hash = 'previsions'; }); await page.waitForTimeout(400);
      await page.click(`[data-axe="${axe}"]`); await page.waitForTimeout(700);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); if (ov) errors.push(`[${vp.width}] débordement ${axe}`);
      await page.screenshot({ path: `${OUT}/${vp.width}-${axe}.png`, fullPage: vp.width > 500 });
      if (axe === 'agent') {
        const n = await page.$$eval('#pv-t tbody tr', (t) => t.length); if (!n) errors.push('Tableau agents vide');
        await page.click('#pv-t tbody tr'); await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/${vp.width}-detail.png` });
        await page.click('[data-close]'); await page.waitForTimeout(300);
        // mois futur puis passé
        await page.fill('#pv-m', '2027-05'); await page.dispatchEvent('#pv-m', 'change'); await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/${vp.width}-agent-mai27.png`, fullPage: vp.width > 500 });
        const m = await page.evaluate(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); });
        await page.fill('#pv-m', m); await page.dispatchEvent('#pv-m', 'change'); await page.waitForTimeout(600);
        await page.screenshot({ path: `${OUT}/${vp.width}-agent-passe.png`, fullPage: vp.width > 500 });
        const now = await page.evaluate(() => new Date().toISOString().slice(0, 7));
        await page.fill('#pv-m', now); await page.dispatchEvent('#pv-m', 'change'); await page.waitForTimeout(400);
        if (vp.width > 500 && await page.$('#pv-obj')) {
          await page.click('#pv-obj'); await page.waitForTimeout(400);
          const ta = await page.$('.modal textarea'); if (ta) await ta.fill('Objectifs issus des prévisions');
          await page.click('.modal .btn.primary, .modal .btn.danger'); await page.waitForTimeout(900);
          const t = await page.textContent('#toasts').catch(() => ''); if (!/Objectifs enregistrés/.test(t || '')) errors.push('Reprise objectifs : ' + t);
        }
      }
    }
    await ctx.close();
  }
  await browser.close();
  console.log(errors.length ? 'ERREURS:\n' + [...new Set(errors)].join('\n') : 'Aucune erreur');
})();
