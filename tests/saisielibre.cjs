// Vente : « Vendu par » et « Client » se choisissent dans la liste OU se tapent à la main
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const CDN = process.env.CDN_DIR, OUT = process.env.OUT_DIR;
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
  const d0 = await D();
  const dep = d0.agents.find((a) => a.role_circuit === 'depot' && /Niamey 1/.test(a.nom));
  const ouvrir = async () => { await p.keyboard.press('Escape').catch(() => {}); await p.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 10000 }).catch(() => {}); await p.evaluate(() => { location.hash = 'saisie-rapide'; }); await p.waitForTimeout(500); await p.click('#s-vente'); await p.waitForSelector('.modal [name=vendeur]'); await p.waitForTimeout(500); };
  // 1. Nouvel agent et nouveau client tapés à la main, vente à crédit
  await ouvrir();
  verif(await p.$eval('.modal [name=vendeur]', (e) => e.tagName === 'INPUT' && !!e.list), 'Vendu par : zone de saisie avec liste de suggestions');
  await p.selectOption('.modal [name=mode]', 'credit');
  await p.fill('.modal [name=vendeur]', 'Hadiza Moussa'); await p.waitForTimeout(150);
  verif(await p.isVisible('.modal [name=depot_nouveau]') && /Nouvel agent/.test(await p.textContent('.modal [data-hint=vendeur]')), 'Nom inconnu : « Nouvel agent », choix du dépôt demandé');
  await p.selectOption('.modal [name=depot_nouveau]', dep.id); await p.waitForTimeout(100);
  await p.fill('.modal [name=client]', 'Boutique Mariama Yantala'); await p.waitForTimeout(150);
  verif(/Nouveau client/.test(await p.textContent('.modal [data-hint=client]')), 'Client inconnu : « Nouveau client »');
  verif(await p.inputValue('.modal [name=prix_unitaire]') === String(dep.prix_carton || ''), `Prix proposé selon le dépôt : ${await p.inputValue('.modal [name=prix_unitaire]')}`);
  await p.fill('.modal [name=quantite]', '3');
  await p.screenshot({ path: path.join(OUT, 'vente-libre.png') });
  await p.click('#vs'); await p.waitForSelector('.modal [name=vendeur]', { state: 'detached', timeout: 15000 }).catch(() => {}); await p.waitForTimeout(300);
  verif(!(await p.$('.modal [name=vendeur]')), 'Vente enregistrée');
  let d1 = await D();
  const ag = d1.agents.find((a) => a.nom === 'Hadiza Moussa'), cl = d1.clients.find((c) => c.nom === 'Boutique Mariama Yantala');
  const v = d1.ventes.find((x) => x.agent_id === ag?.id);
  verif(ag && ag.role_circuit === 'sous_agent' && ag.depot_id === dep.id, `Agent créé et rattaché à ${dep.nom}`);
  verif(cl && v && v.client_id === cl.id && v.mode === 'credit', `Client créé et vente à crédit ${v?.numero} enregistrée à son nom`);
  // 2. Nom existant tapé sans accent ni majuscule : pas de doublon
  await ouvrir();
  await p.fill('.modal [name=vendeur]', 'hadiza moussa'); await p.fill('.modal [name=client]', 'boutique mariama yantala'); await p.waitForTimeout(150);
  verif(await p.isHidden('.modal [name=depot_nouveau]') && !(await p.textContent('.modal [data-hint=client]')), 'Noms existants tapés en minuscules : reconnus');
  await p.fill('.modal [name=quantite]', '1'); console.log('   avant :', await p.inputValue('.modal [name=vendeur]'), '|', await p.inputValue('.modal [name=client]'), '|', await p.inputValue('.modal [name=prix_unitaire]')); await p.click('#vs'); await p.waitForTimeout(400); console.log('   err :', await p.$eval('.modal .err', (e) => e.hidden ? '' : e.textContent).catch(() => 'fermé')); await p.waitForSelector('.modal [name=vendeur]', { state: 'detached', timeout: 15000 }).catch(() => {}); await p.waitForTimeout(300);
  d1 = await D();
  console.log('  ', d1.agents.filter((a) => /hadiza/i.test(a.nom)).length, d1.clients.filter((c) => /mariama yantala/i.test(c.nom)).length, d1.ventes.filter((x) => x.agent_id === ag.id).map(x=>x.statut+x.mode)); verif(d1.agents.filter((a) => /hadiza moussa/i.test(a.nom)).length === 1 && d1.clients.filter((c) => /mariama yantala/i.test(c.nom)).length === 1 && d1.ventes.filter((x) => x.agent_id === ag.id).length === 2, 'Pas de doublon : 2 ventes pour le même agent et le même client');
  // 3. Choix dans la liste (libellé proposé)
  await ouvrir();
  const lib = await p.$eval('#dl-vendeur option', (o) => o.value);
  await p.fill('.modal [name=vendeur]', lib); await p.fill('.modal [name=quantite]', '1'); await p.click('#vs'); await p.waitForSelector('.modal [name=vendeur]', { state: 'detached', timeout: 15000 }).catch(() => {}); await p.waitForTimeout(300);
  verif(!(await p.$('.modal [name=vendeur]')) && (await D()).agents.length === d1.agents.length, `Choix dans la liste (« ${lib} ») : vente enregistrée sans création`);
  // 4. Vente à crédit sans client : refusée avec un message clair
  await ouvrir(); await p.selectOption('.modal [name=mode]', 'credit'); await p.fill('.modal [name=vendeur]', lib); await p.fill('.modal [name=quantite]', '1'); await p.click('#vs'); await p.waitForTimeout(500);
  verif(/indiquez le client/i.test(await p.textContent('.modal .err')), `Crédit sans client : « ${await p.textContent('.modal .err')} »`);
  // 5. Toutes les listes des formulaires : on tape le nom au lieu de dérouler
  await p.keyboard.press('Escape').catch(() => {}); await p.evaluate(() => { location.hash = 'saisie-rapide'; }); await p.waitForTimeout(500);
  await p.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 10000 }).catch(() => {}); await p.click('#s-appro'); await p.waitForSelector('.modal [name=source]'); await p.waitForTimeout(500);
  verif(await p.$('.modal .combo-in[data-for="f-agent_id"]'), 'Approvisionnement : la case « Dépôt » accepte la saisie');
  await p.fill('.modal .combo-in[data-for="f-agent_id"]', 'depot niamey 2'); await p.waitForTimeout(150);
  const n2 = d0.agents.find((a) => a.role_circuit === 'depot' && /Niamey 2/.test(a.nom));
  console.log('   dbg :', await p.evaluate(() => ({ n: document.querySelectorAll('.modal').length, txt: [...document.querySelectorAll('.combo-in[data-for="f-agent_id"]')].map((e) => e.value), sel: [...document.querySelectorAll('select[name=agent_id]')].map((e) => e.value + '/' + e.options.length), hint: document.querySelector('[data-hint-for="f-agent_id"]')?.textContent })));
  verif(await p.inputValue('.modal [name=agent_id]') === n2.id, '« depot niamey 2 » tapé à la main → Dépôt Niamey 2 reconnu');
  await p.selectOption('.modal [name=source]', 'grossiste'); await p.waitForTimeout(150);
  verif(await p.inputValue('.modal .combo-in[data-for="f-source"]') === 'Un grossiste', 'Choix à la flèche : le texte de la case suit');
  await p.fill('.modal .combo-in[data-for="f-grossiste_id"]', 'Grossiste Elh Garba Dolé'); await p.waitForTimeout(150);
  verif(/pas dans la liste/.test(await p.textContent('.modal [data-hint-for="f-grossiste_id"]')), 'Grossiste inconnu : proposition de l’ajouter');
  await p.screenshot({ path: path.join(OUT, 'liste-libre.png') });
  await p.click('.modal .combo-add'); await p.waitForTimeout(1200);
  const gNew = (await D()).grossistes.find((g) => g.nom === 'Grossiste Elh Garba Dolé');
  verif(gNew && await p.inputValue('.modal [name=grossiste_id]') === gNew.id, 'Grossiste ajouté à la liste et choisi dans le formulaire');
  await p.selectOption('.modal [name=produit_id]', { index: 1 }); await p.fill('.modal [name=cartons]', '12'); await p.click('#ms'); await p.waitForSelector('.modal [name=source]', { state: 'detached', timeout: 15000 }).catch(() => {});
  const mv = (await D()).circuit_mvts.find((m) => m.grossiste_id === gNew?.id);
  verif(mv && mv.agent_id === n2.id && mv.cartons === 12, `Approvisionnement enregistré : ${n2.nom} ← ${gNew?.nom}, 12 ctn`);
  // Liste qui dépend d'une autre (agents du dépôt) : saisie possible aussi
  await p.waitForFunction(() => !document.querySelector('.modal'), null, { timeout: 10000 }).catch(() => {}); await p.click('#s-remise'); await p.waitForSelector('.modal [name=sous_agent_id]'); await p.waitForTimeout(500);
  await p.fill('.modal .combo-in[data-for="f-agent_id"]', 'Dépôt Niamey 1'); await p.waitForTimeout(300);
  await p.fill('.modal .combo-in[data-for="f-sous_agent_id"]', 'hadiza moussa'); await p.waitForTimeout(150);
  verif(await p.inputValue('.modal [name=sous_agent_id]') === ag.id, 'Remise : agent du dépôt tapé à la main → reconnu');
  await p.selectOption('.modal [name=produit_id]', { index: 1 }); await p.fill('.modal [name=cartons]', '2'); await p.click('#ms'); await p.waitForSelector('.modal [name=sous_agent_id]', { state: 'detached', timeout: 15000 }).catch(() => {});
  const errR = await p.$eval('.modal .err', (e) => e.textContent).catch(() => ''); verif(!(await p.$('.modal [name=sous_agent_id]')), 'Remise enregistrée' + (errR ? ' — ' + errR : ''));
  verif(!errs.length, errs.length ? 'Erreurs : ' + errs.slice(0, 3).join(' | ') : 'Aucune erreur dans la page');
  await b.close(); console.log(echecs ? `${echecs} échec(s)` : 'Tous les contrôles sont réussis'); process.exit(echecs ? 1 : 0);
})();
