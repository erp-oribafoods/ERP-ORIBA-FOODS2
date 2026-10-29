// Mise à jour quotidienne : même fichier importé plusieurs fois, fichier enrichi, double envoi, ligne retirée du fichier
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const CDN = process.env.CDN_DIR, OUT = process.env.OUT_DIR;
const XLSX = require(path.join(CDN, 'node_modules/xlsx'));
const map = { 'chart.umd.min.js': 'chart.js/dist/chart.umd.js', 'xlsx.full.min.js': 'xlsx/dist/xlsx.full.min.js', 'jspdf.umd.min.js': 'jspdf/dist/jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js': 'jspdf-autotable/dist/jspdf.plugin.autotable.min.js' };
let echecs = 0;
const verif = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) echecs++; };
(async () => {
  const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body>' + fs.readFileSync(path.join(__dirname, '../dist/demo.html'), 'utf8') + '</body></html>';
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true }); const errs = [];
  await ctx.route('**/*', (r) => { const u = r.request().url(); if (u.startsWith('http://erp.test/')) return r.fulfill({ contentType: 'text/html', body: html }); const f = Object.keys(map).find((k) => u.endsWith(k)); if (f) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(CDN, 'node_modules', map[f])) }); if (u.includes('fonts.g')) return r.fulfill({ contentType: 'text/css', body: '' }); return r.abort(); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto('http://erp.test/'); await p.waitForSelector('#lf', { timeout: 120000 });
  await p.fill('[name=identifiant]', 'commercial'); await p.fill('[name=password]', 'Demo2026'); await p.click('#lf button[type=submit]'); await p.waitForSelector('.layout');
  await p.evaluate(() => { location.hash = 'saisie'; }); await p.waitForTimeout(800);
  const D = await p.evaluate(() => window.__ERP_DEBUG__?.());
  if (!D) throw new Error('Données de démo indisponibles (window.__ERP_DEBUG__)');
  const eq = D.equipes.find((e) => D.agents.filter((a) => a.equipe_id === e.id).length >= 2);
  const ag = D.agents.filter((a) => a.equipe_id === eq.id).slice(0, 2).map((a) => a.nom);
  const ma = D.marches.find((m) => m.equipe_id === eq.id || m.zone_id === eq.zone_id).nom;
  const pr = D.produits[0].nom;
  const d = new Date(); const j = (k) => { const x = new Date(d.getTime() - k * 86400000); return `${String(x.getDate()).padStart(2, '0')}/${String(x.getMonth() + 1).padStart(2, '0')}/${x.getFullYear()}`; };
  const fichier = (nom, comptant, credit) => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['PARAMÈTRES'], [], ['DIRECTION'], [`Chef d'équipe Axe ${eq.nom}`, eq.responsable || ag[0]]]), 'Paramètres');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['JOURNAL DES VENTES AU COMPTANT'], ['Date', "Nom de l'agent", 'Marché/Village', 'Client/Acheteur', 'Produit', 'Unité', 'Quantité', 'Prix unitaire (FCFA)', 'Montant (FCFA)', 'Observation'], ...comptant, ['TOTAUX']]), 'Journal Comptant');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['JOURNAL DES VENTES À CRÉDIT'], ['Date', 'Agent', 'Marché', 'Client/Débiteur', 'Produit', 'Unité', 'Quantité', 'Prix unitaire (FCFA)', 'Montant (FCFA)', 'Date promesse', 'Montant remboursé (FCFA)', 'Date remboursement'], ...credit, ['TOTAUX']]), 'Journal Crédit');
    const f = path.join(OUT, nom); XLSX.writeFile(wb, f); return f;
  };
  const C1 = [[j(4), ag[0], 'Marché ' + ma, 'Client E - Détaillant', pr, 'Carton', 5, 13000, 65000, ''],
    [j(4), ag[0], 'Marché ' + ma, 'Client E - Détaillant', pr, 'Carton', 5, 13000, 65000, 'même ligne deux fois'],
    [j(3), 'Agent Quotidien Test', 'Marché Village Quotidien', 'Client E - Détaillant', pr, 'Pack', 6, 1150, 6900, '']];
  const K1 = [[j(6), ag[1], 'Marché ' + ma, 'Client Q - Elh Quotidien', pr, 'Carton', 20, 13000, 260000, j(1), 50000, j(2)],
    [j(5), ag[1], 'Marché ' + ma, 'Client R - Elh Hebdo', pr, 'Carton', 10, 13000, 130000, j(1), '', '']];
  const compter = () => p.evaluate(() => { const D = window.__ERP_DEBUG__(); const v = D.ventes.filter((x) => String(x.ref_externe || '').startsWith('TB|') && x.statut === 'validee'); return { comptant: v.filter((x) => x.mode === 'comptant').length, credit: v.filter((x) => x.mode === 'credit').length, remb: D.remboursements.filter((r) => v.some((x) => x.id === r.vente_id) && r.statut === 'valide').reduce((s, r) => s + Number(r.montant), 0), agents: D.agents.filter((a) => a.nom === 'Agent Quotidien Test').length, clients: D.clients.filter((c) => c.nom === 'Elh Quotidien').length }; });
  const ouvrirMaj = async (f) => {
    await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(200);
    await p.evaluate(() => { location.hash = 'saisie'; }); await p.waitForTimeout(500);
    await p.click('#maj'); await p.waitForSelector('.modal [data-files]', { state: 'attached' });
    await p.setInputFiles('.modal [data-files]', f); await p.waitForSelector('.modal [data-bilan] table'); await p.waitForTimeout(300);
    return p.$$eval('.modal [data-bilan] tbody tr td.n', (t) => t.map((x) => Number(x.textContent.replace(/\D/g, '')) || 0));
  };
  const lancer = async () => { await p.click('.modal [data-go]'); await p.waitForSelector('.modal [data-bilan] .note.ok', { timeout: 60000 }); return (await p.textContent('.modal [data-bilan] .note.ok')).replace(/\s+/g, ' '); };

  // Jour 1
  const f1 = fichier('jour1.xlsx', C1, K1);
  let n = await ouvrirMaj(f1);
  verif(n[0] === 3 && n[1] === 2 && n[2] === 1, `Bilan jour 1 : 3 comptant (dont 2 lignes identiques), 2 crédits, 1 remboursement → ${n.slice(0, 3).join(' / ')}`);
  await p.screenshot({ path: path.join(OUT, 'maj-bilan.png') });
  console.log('  ', (await lancer()).slice(0, 260));
  let c = await compter();
  verif(c.comptant === 3 && c.credit === 2 && c.remb === 50000 && c.agents === 1 && c.clients === 1, `Après jour 1 : ${JSON.stringify(c)}`);

  // Même fichier, une deuxième fois
  n = await ouvrirMaj(f1);
  verif(n[0] === 0 && n[1] === 0 && n[2] === 0 && n[3] === 6, `Même fichier réimporté : rien de nouveau, 6 lignes reconnues → ${n.join(' / ')}`);
  verif(await p.$eval('.modal [data-go]', (b) => b.disabled), 'Bouton « Mettre à jour » désactivé quand tout est à jour');

  // Jour 2 : une vente en plus, remboursement porté à 120 000, l'autre crédit soldé
  const K2 = [[...K1[0].slice(0, 10), 120000, j(0)], [...K1[1].slice(0, 10), 130000, j(0)]];
  const f2 = fichier('jour2.xlsx', [...C1, [j(1), ag[1], 'Marché ' + ma, 'Client E - Détaillant', pr, 'Carton', 3, 13000, 39000, '']], K2);
  n = await ouvrirMaj(f2);
  verif(n[0] === 1 && n[1] === 0 && n[2] === 2, `Bilan jour 2 : 1 nouvelle vente, 2 remboursements à compléter → ${n.slice(0, 3).join(' / ')}`);
  console.log('  ', (await lancer()).slice(0, 260));
  c = await compter();
  verif(c.comptant === 4 && c.credit === 2 && c.remb === 250000, `Après jour 2 : ${JSON.stringify(c)} (remboursé attendu 120 000 + 130 000)`);

  // Double envoi au serveur (double clic, deux personnes en même temps) : rien en double
  const dbl = await p.evaluate(async () => {
    const D = window.__ERP_DEBUG__(); const v = D.ventes.find((x) => String(x.ref_externe || '').startsWith('TB|') && x.mode === 'comptant');
    const l = D.vente_lignes.find((x) => x.vente_id === v.id);
    const row = { ligne: 1, data: { date: v.date, agent_id: v.agent_id, marche_id: v.marche_id, client_id: v.client_id, ref_externe: v.ref_externe }, lignes: [{ produit_id: l.produit_id, unite: l.unite, quantite: l.quantite, prix_unitaire: l.prix_unitaire }] };
    const r = await window.__ERP_DEBUG__.call('import.run', { type: 'ventes_comptant', mode: 'courant', fichier: 'test double', rows: [row, row] });
    return { integrees: r.integrees.length, deja: r.deja.length };
  });
  verif(dbl.integrees === 0 && dbl.deja === 2, `Envoi en double d'une ligne déjà importée : refusé par le serveur → ${JSON.stringify(dbl)}`);
  const dblR = await p.evaluate(async () => {
    const D = window.__ERP_DEBUG__(); const v = D.ventes.find((x) => String(x.ref_externe || '').startsWith('TB|') && x.mode === 'credit');
    const row = { ligne: 1, data: { vente_id: v.id, date: v.date, cumul: 120000 } };
    const r = await window.__ERP_DEBUG__.call('import.run', { type: 'remboursements', mode: 'courant', fichier: 'test double', rows: [row, row] });
    return { integrees: r.integrees.length, deja: r.deja.length };
  });
  verif(dblR.integrees === 0 && dblR.deja === 2, `Remboursement cumulé envoyé deux fois : rien n'est ajouté → ${JSON.stringify(dblR)}`);

  // Jour 3 : une ligne retirée du fichier → signalée, pas supprimée
  const f3 = fichier('jour3.xlsx', [C1[0], C1[2]], K2);
  n = await ouvrirMaj(f3);
  verif(n[0] === 0 && n[5] === 2, `Lignes retirées du fichier signalées (2 : le doublon de ligne et la vente du jour 2) → absentes ${n[5]}`);
  await p.screenshot({ path: path.join(OUT, 'maj-absentes.png') });
  c = await compter();
  verif(c.comptant === 4, 'Rien n’est supprimé automatiquement');
  verif(!errs.length, errs.length ? 'Erreurs : ' + errs.slice(0, 3).join(' | ') : 'Aucune erreur dans la page');
  await b.close();
  console.log(echecs ? `${echecs} échec(s)` : 'Tous les contrôles sont réussis');
  process.exit(echecs ? 1 : 0);
})();
