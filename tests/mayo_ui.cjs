// Parcours d'interface du module « Vente de mayonnaise » en démonstration (Playwright).
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
    if (!(await page.$('a[data-p="mayonnaise"]'))) errors.push('Entrée de menu absente');
    const go = async (tab) => { await page.evaluate(() => { location.hash = 'mayonnaise'; }); await page.waitForTimeout(400); await page.click(`[data-o="${tab}"]`); await page.waitForTimeout(500); };
    // Import du classeur
    await go('import');
    await page.setInputFiles('#mi-f', XLSX_FILE); await page.waitForSelector('#mi-ok', { timeout: 10000 });
    const lu = await page.textContent('#mi-r .lead'); if (!/76/.test(lu)) errors.push('Lecture classeur : ' + lu); const d = await page.textContent('#mi-t tbody'); if (!/0[2-9]\/11\/2026/.test(d) || /01\/11\/2026/.test(d)) errors.push('Dates lues : ' + d.slice(0, 200));
    await page.screenshot({ path: `${OUT}/${vp.width}-import.png`, fullPage: vp.width > 500 });
    await page.click('#mi-ok'); await page.waitForTimeout(1200);
    const t = await page.textContent('#toasts').catch(() => ''); if (!/76 visite/.test(t || '') && vp.width > 500) errors.push('Import : ' + t);
    // Fiche du jour
    await go('fiches'); await page.click('#mf-new'); await page.waitForSelector('#ff-vend');
    await page.fill('#ff-vend', 'Hamidou'); await page.selectOption('#ff-axe', { index: 2 });
    const set = async (p, c, v) => page.fill(`tr[data-p="${p}"] [data-c="${c}"]`, v);
    await set('oriba', 'stock_initial', '24'); await set('oriba', 'vendu_comptant', '10'); await set('oriba', 'vendu_credit', '4'); await set('oriba', 'client_credit', 'Boutique Koubia');
    await set('aida', 'stock_initial', '12'); await set('aida', 'vendu_comptant', '5'); await set('delice', 'stock_initial', '12'); await set('delice', 'vendu_comptant', '7');
    await page.fill('#ff-obs', 'Champion et Bistro présents dans presque toutes les boutiques'); await page.fill('#ff-rea', 'Les boutiquiers trouvent Aïda chère');
    const tot = (await page.textContent('#ff-tot')).replace(/\s/g, ' ');
    if (!/26 packs|Packs vendus : 26/.test(tot) || !/254/.test(tot.replace(/ /g, ''))) errors.push('Totaux fiche : ' + tot);
    await page.screenshot({ path: `${OUT}/${vp.width}-fiche.png` });
    await page.click('#ff-ok'); await page.waitForTimeout(1000);
    // Objectifs
    await go('objectifs'); await page.fill('[data-k="oriba"]', '600'); await page.fill('[data-k="aida"]', '300'); await page.fill('[data-k="delice"]', '400'); await page.fill('[data-k="visites"]', '250');
    await page.click('#mo-ok'); await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${vp.width}-objectifs.png`, fullPage: vp.width > 500 });
    // Visite
    await go('visites'); await page.click('#mv-new'); await page.waitForSelector('#fv-client');
    await page.fill('#fv-client', 'Client test'); await page.screenshot({ path: `${OUT}/${vp.width}-visite0.png` }); await page.click('#fv-prise [data-v="0"]'); await page.check('.mayo-marques input[value="CHAMPION"]'); await page.fill('#fv-motif', 'Prix élevé');
    await page.screenshot({ path: `${OUT}/${vp.width}-visite.png` });
    await page.click('#fv-ok'); await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${vp.width}-visites.png`, fullPage: vp.width > 500 });
    // Tableau de bord, par jour puis par semaine
    await go('tb'); await page.waitForTimeout(600);
    const ov = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1); if (ov) errors.push(`[${vp.width}] débordement horizontal`);
    await page.screenshot({ path: `${OUT}/${vp.width}-tb-jour.png`, fullPage: true });
    await page.click('[data-g="semaine"]'); await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/${vp.width}-tb-semaine.png`, fullPage: false });
    await ctx.close();
  }
  // Lecture seule pour le DG
  await browser.close();
  console.log(errors.length ? 'ERREURS:\n' + [...new Set(errors)].join('\n') : 'Aucune erreur');
})();
