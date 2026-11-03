// Classeur fusionné (saisie journalière + suivi des équipes) : l'import reprend la situation de départ des dépôts
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const CDN = process.env.CDN_DIR, OUT = process.env.OUT_DIR, F = process.env.FUSION;
const map = { 'chart.umd.min.js': 'chart.js/dist/chart.umd.js', 'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js', 'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js': 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js' };
let echecs = 0; const verif = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) echecs++; };
(async () => {
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>' + fs.readFileSync(path.join(__dirname, '../dist/demo.html'), 'utf8') + '</body></html>';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } }); const errs = [];
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith('http://erp.test/')) return r.fulfill({ contentType: 'text/html', body: html }); const f = Object.keys(map).find((k) => u.endsWith(k)); if (f) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(CDN, 'node_modules', map[f])) }); if (u.includes('fonts.g')) return r.fulfill({ contentType: 'text/css', body: '' }); return r.abort(); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://erp.test/'); await p.waitForSelector('#lf', { timeout: 120000 });
  await p.fill('[name=identifiant]', 'commercial'); await p.fill('[name=password]', 'Demo2026'); await p.click('#lf button[type=submit]'); await p.waitForSelector('.layout');
  const D = () => p.evaluate(() => window.__ERP_DEBUG__());
  const imp = async () => {
    await p.keyboard.press('Escape').catch(() => {}); await p.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 10000 }).catch(() => {});
    await p.evaluate(() => { location.hash = 'saisie-rapide'; }); await p.waitForTimeout(600);
    await p.click('#f-circ'); await p.waitForSelector('.modal [data-f]', { state: 'attached' });
    await p.setInputFiles('.modal [data-f]', F); await p.waitForSelector('.modal [data-b] table', { timeout: 60000 }); await p.waitForTimeout(400);
    return { note: (await p.textContent('.modal [data-b]')).replace(/\s+/g, ' '), rej: await p.$eval('.modal [data-b] details p', (x) => x.textContent).catch(() => '') };
  };
  let r = await imp();
  verif(!r.rej, `Aucune ligne refusée${r.rej ? ' — ' + r.rej.slice(0, 300) : ''}`);
  await p.click('.modal [data-go]'); await p.waitForSelector('.modal .note.ok', { timeout: 120000 });
  const d = await D();
  const dep = (n) => d.agents.find((a) => a.nom === n);
  verif(Number(dep('Dépôt Niamey 1')?.solde_initial_food) === 11321500 && Number(dep('Dépôt Tahoua')?.solde_initial_rice) === 6344000 && Number(dep('Dépôt Mayonnaise')?.solde_initial_rice) === 1336147, 'Reste à encaisser au départ repris (Niamey 1 11 321 500 Food, Tahoua 6 344 000 Rice, Mayonnaise 1 336 147 Rice)');
  verif(Number(dep('Dépôt Tillabéri')?.stock_initial) === 419 && Number(dep('Dépôt Dosso')?.stock_initial) === 300, 'Stock de départ repris (Tillabéri 419, Dosso 300 cartons)');
  const tot = d.agents.reduce((s, a) => s + Number(a.solde_initial_food || 0) + Number(a.solde_initial_rice || 0), 0);
  verif(tot === 49035747, `Total du reste à encaisser au départ : ${tot}`);
  r = await imp();
  verif(/aucune nouvelle ligne|à jour/i.test(r.note), 'Réimport du même fichier : tout est déjà à jour');
  verif(!errs.length, errs.length ? 'Erreurs : ' + errs.slice(0, 3).join(' | ') : 'Aucune erreur dans la page');
  await b.close(); console.log(echecs ? `${echecs} échec(s)` : 'Tous les contrôles sont réussis'); process.exit(echecs ? 1 : 0);
})();
