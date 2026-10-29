const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const CDN = process.env.CDN_DIR, OUT = process.env.OUT_DIR;
const map = { 'chart.umd.min.js': 'chart.js/dist/chart.umd.js', 'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js', 'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js': 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js' };
(async () => {
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>' + fs.readFileSync(path.join(__dirname, '../dist/demo.html'), 'utf8') + '</body></html>';
  const b = await chromium.launch(); const errs = [];
  for (const user of ['dg', 'commercial']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith('http://erp.test/')) return r.fulfill({ contentType: 'text/html', body: html }); const f = Object.keys(map).find((k) => u.endsWith(k)); if (f) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(CDN, 'node_modules', map[f])) }); if (u.includes('fonts.g')) return r.fulfill({ contentType: 'text/css', body: '' }); return r.abort(); });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto('http://erp.test/'); await p.waitForSelector('#lf', { timeout: 120000 });
    await p.fill('[name=identifiant]', user); await p.fill('[name=password]', 'Demo2026'); await p.click('#lf button[type=submit]'); await p.waitForSelector('.layout');
    const vu = await p.$('a[data-p=suppression]');
    console.log(user, ': menu Suppression visible =', !!vu);
    if (!vu) { await ctx.close(); continue; }
    await p.click('a[data-p=suppression]'); await p.waitForTimeout(600);
    await p.selectOption('#pg-c', 'ventes_credit'); await p.click('#pg-calc'); await p.waitForTimeout(800);
    console.log('aperçu :', (await p.textContent('#pg-res')).replace(/\s+/g, ' ').slice(0, 200));
    await p.screenshot({ path: path.join(OUT, 'purge.png') });
    await p.click('#pg-go'); await p.waitForSelector('#pgf');
    await p.fill('[name=motif]', 'Essai'); await p.fill('[name=confirmation]', 'supprimer'); await p.click('#pg-ok'); await p.waitForTimeout(500);
    console.log('mauvaise confirmation :', (await p.textContent('#pgf .err')).trim());
    await p.fill('[name=confirmation]', 'SUPPRIMER'); await p.click('#pg-ok'); await p.waitForTimeout(1200);
    console.log('résultat :', (await p.textContent('#toasts')).replace(/\s+/g, ' ').slice(-90));
    await p.click('#pg-calc'); await p.waitForTimeout(700);
    console.log('après :', (await p.textContent('#pg-res')).trim());
    await ctx.close();
  }
  console.log(errs.length ? 'ERREURS:\n' + errs.join('\n') : 'Aucune erreur'); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
