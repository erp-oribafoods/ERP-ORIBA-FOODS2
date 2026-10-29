// Parcours « Importer Excel » au format tableau de bord : modèle TB, saisie, import, réimport (aucun doublon), remboursements
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const CDN = process.env.CDN_DIR, OUT = process.env.OUT_DIR;
const XLSX = require(path.join(CDN, 'node_modules/xlsx'));
const map = { 'chart.umd.min.js': 'chart.js/dist/chart.umd.js', 'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js', 'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js': 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js' };
(async () => {
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>' + fs.readFileSync(path.join(__dirname, '../dist/demo.html'), 'utf8') + '</body></html>';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const errs = [];
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith('http://erp.test/')) return r.fulfill({ contentType: 'text/html', body: html }); const f = Object.keys(map).find((k) => u.endsWith(k)); if (f) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(CDN, 'node_modules', map[f])) }); if (u.includes('fonts.g')) return r.fulfill({ contentType: 'text/css', body: '' }); return r.abort(); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://erp.test/'); await p.waitForSelector('#lf', { timeout: 120000 });
  await p.fill('[name=identifiant]', 'commercial'); await p.fill('[name=password]', 'Demo2026'); await p.click('#lf button[type=submit]'); await p.waitForSelector('.layout');
  const ouvrir = async (hash) => { await p.evaluate((h) => { location.hash = h; }, hash); await p.waitForTimeout(600); await p.click('[data-imp]'); await p.waitForSelector('.modal [data-tpl]'); };
  // 1. modèle TB de l'équipe Niamey 1
  await ouvrir('ventes-comptant');
  const f = path.join(OUT, 'tb.xlsx');
  let [dl] = await Promise.all([p.waitForEvent('download'), p.click('.modal [data-tpl]')]); await dl.saveAs(f);
  const wb = XLSX.readFile(f);
  console.log('Feuilles du modèle :', wb.SheetNames.join(', '));
  const par = XLSX.utils.sheet_to_json(wb.Sheets['Paramètres'], { header: 1, defval: '' });
  const agents = par.slice(4).map((r) => r[3]).filter(Boolean), marches = par.slice(4).map((r) => r[6]).filter(Boolean), clients = par.slice(4).map((r) => r[8]).filter(Boolean), prod = par.slice(4).map((r) => r[11]).filter(Boolean);
  const d = new Date(); const j = (k) => { const x = new Date(d.getTime() - k * 86400000); return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`; };
  const jc = [['JOURNAL DES VENTES AU COMPTANT'], ['Date', "Nom de l'agent", 'Marché/Village', 'Client/Acheteur', 'Produit', 'Unité', 'Quantité', 'Prix unitaire (FCFA)', 'Montant (FCFA)', 'Observation'],
    [j(3), agents[0], marches[0], clients[0], prod[0], 'Carton', 10, 13000, 130000, 'test'], [j(2), 'Nouvel Agent Test', 'Marché Nouveau Test', 'Client Z - Nouveau Client Test', prod[0], 'Pack', 6, 1150, 6900, ''], ['TOTAUX', '', '', '', '', '', 16, '', 136900, '']];
  const jk = [['JOURNAL DES VENTES À CRÉDIT'], ['Date', 'Agent', 'Marché', 'Client/Débiteur', 'Produit', 'Unité', 'Quantité', 'Prix unitaire (FCFA)', 'Montant (FCFA)', 'Date promesse', 'Montant remboursé (FCFA)', 'Date remboursement'],
    [j(5), agents[0], marches[0], clients[0], prod[0], 'Carton', 20, 13000, 260000, j(1), 100000, j(1)]];
  wb.Sheets['Journal Comptant'] = XLSX.utils.aoa_to_sheet(jc); wb.Sheets['Journal Crédit'] = XLSX.utils.aoa_to_sheet(jk); XLSX.writeFile(wb, f);
  const charger = async () => { await p.setInputFiles('.modal [data-file]', f); await p.waitForTimeout(800); };
  const note = async (sel = '.modal [data-res] .note') => (await p.$$eval(sel, (n) => n.map((x) => x.textContent.replace(/\s+/g, ' ').trim()).join(' | '))).slice(0, 300);
  await charger();
  console.log('Équipe détectée :', await p.$eval('.modal [data-eq]', (s) => s.options[s.selectedIndex].text));
  console.log('Comptant (1er import) :', await note());
  await p.screenshot({ path: path.join(OUT, 'tb-controle.png') });
  await p.click('.modal [data-res] [data-go]'); await p.waitForTimeout(1500);
  console.log('Après import :', (await p.textContent('#toasts')).replace(/\s+/g, ' ').slice(-120));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await ouvrir('ventes-comptant'); await charger();
  console.log('Comptant (réimport du même fichier) :', await note());
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // 2. crédit puis remboursements enchaînés
  await ouvrir('ventes-credit'); await charger();
  console.log('Crédit :', await note());
  await p.click('.modal [data-res] [data-go]'); await p.waitForTimeout(1500);
  console.log('Remboursements proposés :', await note('.modal [data-res2] .note'));
  await p.screenshot({ path: path.join(OUT, 'tb-remb.png') });
  await p.click('.modal [data-res2] [data-go]'); await p.waitForTimeout(1500);
  console.log('Après remboursements :', (await p.textContent('#toasts')).replace(/\s+/g, ' ').slice(-90));
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // 3. le fichier indique ensuite 160 000 remboursés : seule la différence est proposée
  jk[2][10] = 160000; wb.Sheets['Journal Crédit'] = XLSX.utils.aoa_to_sheet(jk); XLSX.writeFile(wb, f);
  await ouvrir('remboursements'); await charger();
  console.log('Remboursements (cumul porté à 160 000) :', await note(), '|', await p.$$eval('.modal [data-res] tbody tr', (t) => t.map((r) => r.textContent.replace(/\s+/g, ' ')).join(' / ')));
  console.log(errs.length ? 'ERREURS:\n' + errs.join('\n') : 'Aucune erreur'); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
