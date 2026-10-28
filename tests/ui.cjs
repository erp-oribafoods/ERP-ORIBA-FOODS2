// Parcours d'interface en mode démonstration (Playwright) : chaque profil, chaque écran, erreurs console.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const CDN = process.env.CDN_DIR;
const OUT = process.env.OUT_DIR;
const map = {
  'chart.umd.min.js': 'chart.js/dist/chart.umd.js', 'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js',
  'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js': 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js',
};
(async () => {
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + fs.readFileSync(path.join(__dirname, '../dist/demo.html'), 'utf8') + '</body></html>';
  const browser = await chromium.launch();
  const errors = [];
  const run = async (viewport, scheme, shots) => {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme });
    await ctx.route('**/*', (route) => {
      const u = route.request().url();
      if (u.startsWith('http://erp.test/')) return route.fulfill({ contentType: 'text/html', body: html });
      const f = Object.keys(map).find((k) => u.endsWith(k));
      if (f) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(CDN, 'node_modules', map[f])) });
      if (u.includes('fonts.g')) return route.fulfill({ contentType: 'text/css', body: '' });
      return route.abort();
    });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${viewport.width}] ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`[${viewport.width}] PAGEERROR ${e.message}`));
    await page.goto('http://erp.test/');
    await page.waitForSelector('#lf', { timeout: 120000 });
    const login = async (u) => {
      await page.evaluate(() => { sessionStorage.clear(); });
      await page.goto('http://erp.test/?r=' + Math.random());
      await page.waitForSelector('#lf', { timeout: 60000 });
      await page.fill('[name=identifiant]', u); await page.fill('[name=password]', 'Demo2026');
      await page.click('#lf button[type=submit]');
      await page.waitForSelector('.layout', { timeout: 30000 });
    };
    for (const [user, pages] of Object.entries(shots)) {
      await login(user);
      for (const p of pages) {
        await page.evaluate((x) => { location.hash = x; }, p);
        await page.waitForTimeout(700);
        const ov = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
        if (ov) errors.push(`[${viewport.width}] débordement horizontal sur ${p} (${user})`);
        await page.screenshot({ path: `${OUT}/${viewport.width}-${scheme}-${user}-${p}.png`, fullPage: viewport.width > 500 });
      }
    }
    // Ouvrir une vente à crédit et le formulaire de vente
    await login('commercial');
    await page.evaluate(() => { location.hash = 'ventes-credit'; });
    await page.waitForTimeout(500);
    await page.click('#tb tbody tr.click');
    await page.waitForSelector('.modal');
    await page.screenshot({ path: `${OUT}/${viewport.width}-${scheme}-detail-credit.png` });
    await page.keyboard.press('Escape');
    await page.click('#new');
    await page.waitForSelector('#vf');
    await page.selectOption('[name=agent_id]', { index: 1 }); await page.selectOption('[name=marche_id]', { index: 1 }); await page.selectOption('[name=client_id]', { index: 1 });
    await page.selectOption('tr[data-i="0"] [data-k=produit_id]', { index: 1 });
    await page.fill('tr[data-i="0"] [data-k=quantite]', '2'); await page.fill('tr[data-i="0"] [data-k=prix_unitaire]', '13000');
    await page.waitForTimeout(200);
    const tot = await page.textContent('#tot');
    if (!/26\s?000/.test(tot.replace(/ | /g, ' '))) errors.push('Total formulaire inattendu : ' + tot);
    await page.screenshot({ path: `${OUT}/${viewport.width}-${scheme}-form-vente.png` });
    await page.locator('#save').last().click();
    await page.waitForTimeout(800);
    const toast = await page.textContent('#toasts').catch(() => '');
    if (!/enregistrée/.test(toast || '')) errors.push('Pas de confirmation de vente : ' + toast);
    // Dépense : formulaire
    await page.evaluate(() => { location.hash = 'depenses'; });
    await page.waitForTimeout(500);
    await page.click('#new'); await page.waitForSelector('#df');
    await page.screenshot({ path: `${OUT}/${viewport.width}-${scheme}-form-depense.png` });
    await ctx.close();
  };
  const all = ['pilotage-depenses', 'suivi-agents', 'reprise', 'objectifs', 'terrain', 'agents', 'clients', 'logistique', 'tableau-de-bord', 'analyses', 'ventes-comptant', 'ventes-credit', 'remboursements', 'creances', 'stock', 'depenses', 'pilotage-depenses', 'budgets', 'cloture', 'referentiels', 'parametres', 'audit', 'mon-compte'];
  await run({ width: 1440, height: 900 }, 'light', { dg: all, admin: ['utilisateurs', 'roles', 'reprise', 'referentiels'], cdg: ['depenses'], superviseur: ['tableau-de-bord', 'depenses', 'suivi-agents'], rh: ['suivi-agents', 'objectifs'] });
  await run({ width: 390, height: 844 }, 'dark', { dg: ['suivi-agents', 'terrain', 'logistique', 'tableau-de-bord', 'ventes-credit', 'creances', 'pilotage-depenses'] });
  await browser.close();
  console.log(errors.length ? 'ERREURS:\n' + [...new Set(errors)].join('\n') : 'Aucune erreur');
})().catch((e) => { console.error(e); process.exit(1); });
