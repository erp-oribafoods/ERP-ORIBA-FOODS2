// Parcours d'interface du module « Administration technique » en démonstration (Playwright).
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
    // œil sur le mot de passe de connexion
    await page.fill('[name=password]', 'Demo2026');
    if (!(await page.$('.pw-eye'))) errors.push('Bouton œil absent');
    await page.click('.pw-eye'); if ((await page.getAttribute('[name=password]', 'type')) !== 'text') errors.push('Le mot de passe ne s’affiche pas');
    await page.screenshot({ path: `${OUT}/${vp.width}-login-oeil.png` });
    await page.click('.pw-eye'); if ((await page.getAttribute('[name=password]', 'type')) !== 'password') errors.push('Le mot de passe ne se masque pas');
    await page.fill('[name=identifiant]', 'admin'); await page.click('#lf button[type=submit]');
    await page.waitForSelector('.layout', { timeout: 30000 }); await page.waitForTimeout(800);
    const nav = await page.$$eval('.nav a[data-p]', (l) => l.map((a) => a.dataset.p));
    const interdits = nav.filter((p) => !['parametres', 'utilisateurs', 'roles', 'audit', 'mon-compte'].includes(p));
    if (interdits.length) errors.push(`[${vp.width}] menus visibles par l’administrateur : ${interdits.join(', ')}`);
    await page.screenshot({ path: `${OUT}/${vp.width}-admin-accueil.png`, fullPage: true });
    for (const p of nav) { await page.evaluate((x) => { location.hash = x; }, p); await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/${vp.width}-admin-${p}.png`, fullPage: vp.width > 500 }); }
    await page.click('#mdp'); await page.waitForTimeout(400);
    const n = (await page.$$('.modal .pw-eye')).length; if (n !== 3) errors.push('Œil dans la fenêtre mot de passe : ' + n);
    await page.screenshot({ path: `${OUT}/${vp.width}-admin-mdp.png` });
    await ctx.close();
  }
  await browser.close();
  console.log(errors.length ? 'ERREURS:\n' + [...new Set(errors)].join('\n') : 'Aucune erreur');
})();
