// Parcours « Importer Excel » : télécharger le modèle pré-rempli, le modifier, le réimporter.
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const CDN = process.env.CDN_DIR, OUT = process.env.OUT_DIR;
const XLSX = require(path.join(CDN, 'node_modules/xlsx'));
const map = { 'chart.umd.min.js': 'chart.js/dist/chart.umd.js', 'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js', 'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js': 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js' };
(async () => {
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>' + fs.readFileSync(path.join(__dirname, '../dist/demo.html'), 'utf8') + '</body></html>';
  const browser = await chromium.launch(); const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  await ctx.route('**/*', (route) => { const u = route.request().url(); if (u.startsWith('http://erp.test/')) return route.fulfill({ contentType: 'text/html', body: html }); const f = Object.keys(map).find((k) => u.endsWith(k)); if (f) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(CDN, 'node_modules', map[f])) }); if (u.includes('fonts.g')) return route.fulfill({ contentType: 'text/css', body: '' }); return route.abort(); });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://erp.test/'); await page.waitForSelector('#lf', { timeout: 120000 });
  await page.fill('[name=identifiant]', 'commercial'); await page.fill('[name=password]', 'Demo2026'); await page.click('#lf button[type=submit]'); await page.waitForSelector('.layout');
  const cycle = async (hash, edit, label) => {
    await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(600);
    await page.click('[data-imp]'); await page.waitForSelector('.modal [data-tpl]');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.modal [data-tpl]')]);
    const f = path.join(OUT, label + '.xlsx'); await dl.saveAs(f);
    const wb = XLSX.readFile(f); const sh = wb.SheetNames.find((n) => !['Lisez-moi', 'Listes'].includes(n));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sh], { header: 1, defval: '' });
    edit(rows);
    wb.Sheets[sh] = XLSX.utils.aoa_to_sheet(rows); XLSX.writeFile(wb, f);
    await page.setInputFiles('.modal [data-file]', f); await page.waitForSelector('.modal [data-go]');
    const note = await page.textContent('.modal .note');
    await page.screenshot({ path: path.join(OUT, label + '-controle.png') });
    await page.click('.modal [data-go]'); await page.waitForTimeout(1200);
    const toast = await page.textContent('#toasts').catch(() => '');
    console.log(label, '|', note.replace(/\s+/g, ' ').trim(), '|', (toast || '').trim());
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  };
  await cycle('suivi-agents', (rows) => { rows[1][2] = 27; rows[1][12] = 9; rows[2][12] = 8.5; }, 'suivi');
  await cycle('objectifs', (rows) => { rows[1][4] = 123; }, 'objectifs');
  await cycle('referentiels', (rows) => { rows[1][4] = 13500; }, 'produits');
  console.log(errors.length ? 'ERREURS:\n' + errors.join('\n') : 'Aucune erreur');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
