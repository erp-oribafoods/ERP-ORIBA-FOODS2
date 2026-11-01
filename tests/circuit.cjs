// Circuit de distribution : la plateforme doit donner les mêmes chiffres que le classeur de simulation validé,
// reconnaître toutes ses lignes au réimport et n'ajouter que les nouveautés.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const CDN = process.env.CDN_DIR, OUT = process.env.OUT_DIR, SIM = process.env.SIM;
const XLSX = require(path.join(CDN, 'node_modules/xlsx'));
const map = { 'chart.umd.min.js': 'chart.js/dist/chart.umd.js', 'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js', 'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js': 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js' };
let echecs = 0;
const verif = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) echecs++; };
const n = (s) => Number(String(s).replace(/[^\d,-]/g, '').replace(',', '.')) || 0;
(async () => {
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>' + fs.readFileSync(path.join(__dirname, '../dist/demo.html'), 'utf8') + '</body></html>';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }); const errs = [];
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith('http://erp.test/')) return r.fulfill({ contentType: 'text/html', body: html }); const f = Object.keys(map).find((k) => u.endsWith(k)); if (f) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(CDN, 'node_modules', map[f])) }); if (u.includes('fonts.g')) return r.fulfill({ contentType: 'text/css', body: '' }); return r.abort(); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  const t0 = Date.now();
  await p.goto('http://erp.test/'); await p.waitForSelector('#lf', { timeout: 180000 });
  console.log(`   Démo préparée en ${Math.round((Date.now() - t0) / 1000)} s`);
  await p.fill('[name=identifiant]', 'commercial'); await p.fill('[name=password]', 'Demo2026'); await p.click('#lf button[type=submit]'); await p.waitForSelector('.layout');
  const kpis = async () => Object.fromEntries(await p.$$eval('#k1 .kpi', (k) => k.map((x) => [x.querySelector('.kpi-l').textContent.trim(), x.querySelector('.kpi-v').textContent.trim()])));
  const aller = async (h) => { await p.evaluate((x) => { location.hash = x; }, h); await p.waitForTimeout(700); };
  const dater = async (d) => { await p.fill('#c-date', d); await p.dispatchEvent('#c-date', 'change'); await p.waitForTimeout(2000); };
  await aller('circuit'); await dater('2026-10-31');
  let k = await kpis();
  const attendu31 = { 'Stock chez les grossistes': 3500, 'Stock chez les dépôts': 86, 'Stock chez les agents': 87, 'Approvisionnement des dépôts': 315, 'Dispatché aux agents': 152, 'Vendu comptant': 284, 'Vendu à crédit': 10,
    'Ventes comptant à verser': 3692000, 'Versé': 3131000, 'Reste à verser': 561000, 'Remboursements de crédits reçus': 234000, 'Règlements des grossistes reçus': 0, 'Solde dû par les grossistes': 27925000 };
  for (const [l, v] of Object.entries(attendu31)) verif(n(k[l]) === v, `31/10 — ${l} : plateforme ${k[l]} / classeur ${v.toLocaleString('fr-FR')}`);
  await p.screenshot({ path: path.join(OUT, 'circuit-dashboard.png'), fullPage: true });
  await dater('2026-11-01'); k = await kpis();
  for (const [l, v] of Object.entries({ 'Crédits clients en cours': 442250, 'Dont en retard': 169000, 'Échéance dans 2 jours ou moins': 5 })) verif(n(k[l]) === v, `01/11 — ${l} : plateforme ${k[l]} / classeur ${v}`);
  verif(/4 client/.test(await p.textContent('#k1')), 'Clients à relancer : 4');
  // Agents-dépôts : une ligne comparée au classeur (A-NY1 et A-NY2 au 31/10)
  await aller('circuit-depots'); await dater('2026-10-31');
  const lig = await p.$$eval('#td tbody tr', (rs) => rs.map((r) => [...r.children].map((c) => c.textContent.trim())));
  const ny1 = lig.find((r) => r[0] === 'Niamey 1'), ny2 = lig.find((r) => r[0] === 'Niamey 2');
  verif(ny1 && [2, 3, 4, 5, 6, 7].map((i) => n(ny1[i])).join(',') === '7,15,14,6,0,2', `Niamey 1 (stock initial, pris, dispatché, vendu comptant, vendu crédit, stock final) : ${ny1?.slice(2, 8).join(' | ')}`);
  verif(ny2 && [2, 3, 4, 5, 6, 7].map((i) => n(ny2[i])).join(',') === '5,50,24,20,0,11', `Niamey 2 : ${ny2?.slice(2, 8).join(' | ')}`);
  await p.screenshot({ path: path.join(OUT, 'circuit-depots.png') });
  await p.click('#td tbody tr'); await p.waitForSelector('.modal #fs table'); await p.waitForTimeout(300);
  verif((await p.$$('.modal #fs tbody tr')).length >= 2, 'Fiche d’un agent-dépôt : ses sous-agents');
  await p.keyboard.press('Escape');
  // Grossistes, semaine du 26/10
  await aller('circuit-grossistes'); await dater('2026-10-31');
  const gk = await p.textContent('#gk');
  verif(/3[\s  ]?500 ctn/.test(gk) && /27[\s  ]?925[\s  ]?000/.test(gk), `Grossistes : stock final 3 500 ctn, solde dû 27 925 000 FCFA → ${gk.replace(/\s+/g, ' ').slice(0, 160)}`);
  // Réimport du classeur de simulation : tout est déjà présent
  const imp = async (f) => {
    await p.keyboard.press('Escape').catch(() => {}); await aller('circuit');
    await p.click('#c-imp'); await p.waitForSelector('.modal [data-f]', { state: 'attached' });
    await p.setInputFiles('.modal [data-f]', f); await p.waitForSelector('.modal [data-b] table', { timeout: 60000 }); await p.waitForTimeout(300);
    return p.$$eval('.modal [data-b] tbody tr', (rs) => rs.map((r) => [...r.children].map((c) => c.textContent.trim())));
  };
  let t = await imp(SIM);
  console.log('   ', t.map((r) => r.join(' / ')).join(' ; '));
  verif(t.every((r) => r[1] === '0' && r[3] === '0'), 'Classeur de simulation réimporté : 0 ligne à ajouter, 0 rejet');
  console.log('   note :', await p.$$eval('.modal [data-b] .note', (x) => x.map((y) => y.textContent).join(' | ')));
  verif(await p.$eval('.modal [data-go]', (x) => x.disabled), '« Tout est déjà à jour »');
  // Le lendemain : le classeur complété (1 dispatch, 1 vente, 1 versement en plus)
  const wb = XLSX.readFile(SIM, { cellDates: true });
  const ajoute = (nom, ligne) => { const ws = wb.Sheets[nom]; const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true }); aoa.push(ligne); wb.Sheets[nom] = XLSX.utils.aoa_to_sheet(aoa); };
  const d = new Date(Date.UTC(2026, 10, 1));
  ajoute('3-Dispatch', [d, 'A-NY2', 'S-NY2-1', 'Arôme DADI Poulet', 4, 'test']);
  ajoute('4-Ventes', [d, 'S-NY2-1', 'CL000', 'Arôme DADI Poulet', 3, 13000, 'Comptant', '', 'V9999']);
  ajoute('5-Versements', [d, 'A-NY2', 'Ventes comptant', '', 'Caisse Oriba', '', 39000]);
  const f2 = path.join(OUT, 'circuit_jour2.xlsx'); XLSX.writeFile(wb, f2);
  t = await imp(f2);
  const aj = Object.fromEntries(t.map((r) => [r[0], n(r[1])]));
  verif(aj['3-Dispatch'] === 1 && aj['4-Ventes'] === 1 && aj['5-Versements (versements)'] === 1 && aj['1-Appro grossistes'] === 0 && aj['2-Prises agents'] === 0, `Classeur du lendemain : seules les 3 nouvelles lignes sont proposées → ${JSON.stringify(aj)}`);
  await p.click('.modal [data-go]'); await p.waitForSelector('.modal [data-b] .note.ok', { timeout: 60000 });
  console.log('   ', (await p.textContent('.modal [data-b] .note.ok')).replace(/\s+/g, ' ').slice(0, 300));
  await p.keyboard.press('Escape'); await aller('circuit'); await dater('2026-11-01'); k = await kpis();
  verif(n(k['Dispatché aux agents']) === 4 && n(k['Vendu comptant']) === 3 && n(k['Ventes comptant à verser']) === 39000 && n(k['Versé']) === 39000, `01/11 après import : dispatché ${k['Dispatché aux agents']}, vendu ${k['Vendu comptant']}, à verser ${k['Ventes comptant à verser']}, versé ${k['Versé']}`);
  t = await imp(f2);
  verif(t.every((r) => r[1] === '0'), 'Même classeur réimporté une 2e fois : rien de nouveau');
  // Saisie à l'écran : un dispatch et un versement de remboursement
  await p.keyboard.press('Escape'); await aller('circuit-mouvements');
  await p.click('[data-n="dispatch"]'); await p.waitForSelector('.modal [name=agent_id]');
  await p.selectOption('.modal [name=agent_id]', { label: await p.$eval('.modal [name=agent_id] option:nth-child(2)', (o) => o.textContent) });
  await p.waitForTimeout(200);
  await p.selectOption('.modal [name=sous_agent_id]', { index: 1 }); await p.selectOption('.modal [name=produit_id]', { index: 1 }); await p.fill('.modal [name=cartons]', '2');
  await p.click('#ms'); await p.waitForTimeout(800);
  verif(!(await p.$('.modal [name=cartons]')), 'Saisie d’un dispatch à l’écran');
  await aller('circuit-versements'); await p.click('#v-new'); await p.waitForSelector('.modal [name=objet]');
  await p.selectOption('.modal [name=objet]', 'remboursement'); await p.waitForTimeout(200);
  const nbCredits = (await p.$$('.modal [name=vente_id] option')).length - 1;
  await p.selectOption('.modal [name=vente_id]', { index: 1 }); await p.fill('.modal [name=montant]', '1000'); await p.click('#vs'); await p.waitForTimeout(800);
  verif(nbCredits > 0 && !(await p.$('.modal [name=objet]')), `Remboursement d’un crédit depuis « Versements » (${nbCredits} crédits ouverts proposés)`);
  await p.screenshot({ path: path.join(OUT, 'circuit-versements.png') });
  // Modèle Excel du circuit
  await aller('circuit'); const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#c-mod')]);
  const fm = path.join(OUT, 'modele_circuit.xlsx'); await dl.saveAs(fm);
  const wm = XLSX.readFile(fm);
  verif(['Grossistes', 'Agents-dépôts', 'Sous-agents', 'Clients', '1-Appro grossistes', '2-Prises agents', '3-Dispatch', '4-Ventes', '5-Versements'].every((s) => wm.SheetNames.includes(s)), `Modèle : ${wm.SheetNames.join(', ')}`);
  t = await imp(fm);
  verif(t.every((r) => r[3] === '0'), `Modèle réimporté tel quel : aucun rejet (${t.map((r) => r[1]).join('/')} à ajouter = lignes d’exemple)`);
  // Plateforme vide (comme en production) : le classeur crée tout et donne les mêmes chiffres
  await p.keyboard.press('Escape').catch(() => {});
  await p.evaluate(() => window.__ERP_DEBUG__.call('purge.run', { cible: 'tout', confirmation: 'SUPPRIMER', motif: 'test plateforme vide' }));
  await p.evaluate(async () => { await window.__ERP_DEBUG__.call('param.save', { cle: 'circuit_date_depart', valeur: '', motif: 'test' }).catch(() => {}); });
  const vide0 = await p.evaluate(() => ({ g: window.__ERP_DEBUG__().grossistes.length, a: window.__ERP_DEBUG__().agents.length, v: window.__ERP_DEBUG__().ventes.length }));
  t = await imp(SIM);
  console.log('   plateforme vide', JSON.stringify(vide0), '→', t.map((r) => `${r[0]}:${r[1]}`).join(' ; '), '|', (await p.$$eval('.modal [data-b] .note', (x) => x.map((y) => y.textContent).join(' | '))).slice(0, 200));
  await p.click('.modal [data-go]'); await p.waitForSelector('.modal [data-b] .note.ok', { timeout: 120000 });
  console.log('   ', (await p.textContent('.modal [data-b] .note.ok')).replace(/\s+/g, ' ').slice(0, 400));
  await p.keyboard.press('Escape'); await aller('circuit'); await dater('2026-10-31'); k = await kpis();
  const ok31 = Object.entries(attendu31).filter(([l, v]) => n(k[l]) !== v);
  verif(!ok31.length, `Plateforme vide + import du classeur : mêmes chiffres qu’Excel au 31/10${ok31.length ? ' — écarts : ' + ok31.map(([l, v]) => `${l} ${k[l]} ≠ ${v}`).join(', ') : ''}`);
  t = await imp(SIM);
  verif(t.every((r) => r[1] === '0' && r[3] === '0'), 'Puis réimport : rien de nouveau');
  verif(!errs.length, errs.length ? 'Erreurs : ' + errs.slice(0, 3).join(' | ') : 'Aucune erreur dans la page');
  await b.close();
  console.log(echecs ? `${echecs} échec(s)` : 'Tous les contrôles sont réussis');
  process.exit(echecs ? 1 : 0);
})();
