// Espace « Essentiel » : tableau de bord des dépôts, détail d'un dépôt, saisie rapide, crédits à relancer.
// Peu de chiffres, ceux qui comptent : cartons reçus (Oriba Foods, Oriba Rice, grossistes), vendus, stock, argent à verser, crédits en retard.
import { App, nm, opts, pageHead } from '../app.js';
import { esc, $, $$, fmtF, fmtN, fmtQ, fmtD, Table, modal, field, readForm, showErr, busy, toast, icon, pill } from '../lib/ui.js';
import { contexte, situationDepots, creditsCircuit, lundi } from '../lib/circuit.js';
import { ouvrirImportCircuit, modeleCircuit } from '../lib/importCircuit.js';
import { formMouvement, formVersement } from './circuit.js';
import { today, addDays, num } from '../../shared/logic.js';

const P = () => (App.filters.essentiel = App.filters.essentiel || { per: 'jour', date: today(), depot: '' });
function bornes() {
  const p = P(), d = p.date;
  if (p.per === 'semaine') { const l = lundi(d), f = addDays(l, 6); return [l, f > today() ? today() : f]; }
  if (p.per === 'mois') { const l = `${d.slice(0, 7)}-01`; const [y, m] = d.split('-').map(Number); const f = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); return [l, f > today() ? today() : f]; }
  return [d, d];
}
const libPer = () => { const [du, au] = bornes(); return du === au ? `le ${fmtD(du)}` : `du ${fmtD(du)} au ${fmtD(au)}`; };
const ctn = (x) => `${fmtQ(x)} ctn`;
const kpi = (l, v, s = '', c = '') => `<div class="kpi static ${c}"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span>${s ? `<span class="kpi-s">${s}</span>` : ''}</div>`;
const S = (l, k) => l.reduce((s, x) => s + num(x[k]), 0);
const pct = (x) => (x === null || x === undefined ? '—' : `<div class="mini"><div class="bar ${x >= 100 ? 'ok' : x >= 60 ? '' : 'warn'}"><i style="width:${Math.min(100, x)}%"></i></div>${fmtN(x, 0)} %</div>`);
const nomDepot = (id) => nm.agent(id);

function barre() {
  const p = P();
  return `<div class="filters per-bar"><div class="seg" role="group">${[['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois']].map(([k, l]) => `<button data-per="${k}" class="${p.per === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <label class="ff"><span>Date</span><input type="date" id="e-date" value="${p.date}" max="${today()}"></label><span class="muted small per-lib"></span></div>`;
}
function lierBarre(root, draw) {
  const p = P();
  $$('[data-per]', root).forEach((b) => b.addEventListener('click', () => { p.per = b.dataset.per; $$('[data-per]', root).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  $('#e-date', root).addEventListener('change', (e) => { p.date = e.target.value || today(); draw(); });
}
const aucunDepot = () => (App.D.agents || []).every((a) => a.role_circuit !== 'depot');
const noteVide = () => `<div class="note warn">Aucun dépôt n’est encore enregistré. Allez dans <a href="#saisie-rapide">Saisie et import</a> pour importer le classeur, ou déclarez les dépôts dans Référentiels.</div>`;

// ---------------------------------------------------------------- Tableau de bord
export function renderAccueil(root) {
  root.innerHTML = pageHead('Tableau de bord', 'Situation des dépôts : cartons reçus, vendus, stock, argent à verser et crédits en retard.',
    App.can('circuit', 'creer') ? `<a class="btn primary" href="#saisie-rapide">${icon('plus')} Saisir ou importer</a>` : '') + (aucunDepot() ? noteVide() : '') + barre() +
    '<section class="kpis k4" id="ek"></section><article class="card"><header><h3>Les dépôts</h3><span class="muted small">Cliquez sur un dépôt pour voir ses agents</span></header><div id="et"></div></article><article class="card" id="ea"></article>';
  const draw = () => {
    const [du, au] = bornes(), C = contexte(App.D, App.I);
    $('.per-lib', root).textContent = libPer();
    const dep = situationDepots(C, du, au), cr = creditsCircuit(C, au), retard = cr.filter((c) => c.statut === 'En retard');
    const reste = S(dep, 'ecart');
    $('#ek', root).innerHTML = [
      kpi('Cartons reçus par les dépôts', ctn(S(dep, 'recu')), `Oriba Foods ${fmtQ(S(dep, 'recuFoods'))} · Oriba Rice ${fmtQ(S(dep, 'recuRice'))} · grossistes ${fmtQ(S(dep, 'recuGross'))}`),
      kpi('Cartons vendus', ctn(S(dep, 'venduReseau')), `comptant ${fmtQ(S(dep, 'vcReseau'))} · crédit ${fmtQ(S(dep, 'vkReseau'))}`),
      kpi('Argent à verser', fmtF(S(dep, 'aVerser')), `versé ${fmtF(S(dep, 'verse'))} · reste ${fmtF(reste)}`, reste > 0 ? 'crit' : 'ok'),
      kpi('Crédits en retard', fmtF(S(retard, 'solde')), `${new Set(retard.map((c) => c.client_id)).size} client(s) à relancer`, retard.length ? 'crit' : 'ok'),
    ].join('');
    new Table({ title: `Dépôts — ${libPer()}`, rows: dep, sort: { k: 'nom', dir: 1 }, pageSize: 20, exportable: true, onRow: (r) => { P().depot = r.id; App.go('depots'); },
      foot: (c, rs) => (c.k === 'nom' ? '<b>Total</b>' : ['siTotal', 'recuFoods', 'recuRice', 'recuGross', 'venduReseau', 'stockTotal', 'ecart'].includes(c.k) ? `<b>${fmtN(rs.reduce((s, r) => s + num(r[c.k]), 0))}</b>` : ''),
      cols: [{ k: 'nom', l: 'Dépôt', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'siTotal', l: 'Stock début', num: 1, f: (r) => fmtQ(r.siTotal) },
        { k: 'recuFoods', l: 'Reçu Oriba Foods', num: 1, f: (r) => fmtQ(r.recuFoods) }, { k: 'recuRice', l: 'Reçu Oriba Rice', num: 1, f: (r) => fmtQ(r.recuRice) }, { k: 'recuGross', l: 'Reçu grossistes', num: 1, f: (r) => fmtQ(r.recuGross) },
        { k: 'venduReseau', l: 'Vendu', num: 1, f: (r) => fmtQ(r.venduReseau) }, { k: 'stockTotal', l: 'Stock fin', num: 1, f: (r) => (r.stockTotal < 0 ? `<b class="t-crit">${fmtQ(r.stockTotal)}</b>` : `<b>${fmtQ(r.stockTotal)}</b>`) },
        { k: 'taux', l: 'Objectif du mois', num: 1, v: (r) => r.taux ?? -1, f: (r) => (r.objectif ? `${pct(r.taux)}<small class="muted">${fmtQ(r.venduMois)} / ${fmtQ(r.objectif)} ctn</small>` : '—'), x: (r) => (r.taux === null ? '' : Math.round(r.taux)) },
        { k: 'ecart', l: 'Reste à verser (FCFA)', num: 1, f: (r) => (r.ecart > 0 ? `<b class="t-crit">${fmtN(r.ecart)}</b>` : fmtN(r.ecart)) }] }).mount($('#et', root));
    // À surveiller : 5 points au plus
    const alertes = [
      ...dep.filter((d) => d.ecart > 0).sort((a, b) => b.ecart - a.ecart).map((d) => [`${d.nom} : ${fmtF(d.ecart)} pas encore versés`, 'crit']),
      ...dep.filter((d) => d.stockTotal < 0).map((d) => [`${d.nom} : stock négatif (${fmtQ(d.stockTotal)} ctn) — vérifier les saisies`, 'warn']),
      ...retard.sort((a, b) => b.solde - a.solde).slice(0, 3).map((c) => [`${nm.client(c.client_id)} doit ${fmtF(c.solde)} depuis le ${fmtD(c.echeance)} (vendeur : ${nm.agent(c.agent_id)})`, 'crit']),
    ].slice(0, 5);
    $('#ea', root).innerHTML = `<header><h3>À surveiller</h3>${retard.length ? '<a class="small" href="#credits">Voir tous les crédits</a>' : ''}</header>${alertes.length ? `<ul class="alertes">${alertes.map(([t, c]) => `<li class="${c}">${esc(t)}</li>`).join('')}</ul>` : '<p class="muted">Rien à signaler.</p>'}`;
  };
  lierBarre(root, draw);
  draw();
}

// ---------------------------------------------------------------- Un dépôt et ses agents
export function renderDepotsEssentiel(root) {
  const p = P();
  const depots = (App.D.agents || []).filter((a) => a.role_circuit === 'depot' && a.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  if (!depots.some((d) => d.id === p.depot)) p.depot = depots[0]?.id || '';
  const can = App.can('circuit', 'creer');
  root.innerHTML = pageHead('Dépôts', 'Pour chaque dépôt : ses cartons, ses agents, leurs ventes et leurs objectifs.',
    can && p.depot ? `<button class="btn primary" id="d-appro">${icon('plus')} Approvisionner ce dépôt</button><button class="btn" id="d-remise">${icon('plus')} Remettre à un agent</button>` : '') +
    (depots.length ? `<div class="chips depot-chips">${depots.map((d) => `<button class="chip ${d.id === p.depot ? 'on' : ''}" data-d="${d.id}">${esc(d.nom)}</button>`).join('')}</div>` : noteVide()) + barre() +
    '<section class="kpis k4" id="dk"></section><article class="card"><header><h3 id="dt-t">Agents du dépôt</h3></header><div id="dt"></div></article>';
  $$('[data-d]', root).forEach((b) => b.addEventListener('click', () => { p.depot = b.dataset.d; renderDepotsEssentiel(root); }));
  $('#d-appro', root)?.addEventListener('click', () => formMouvement('prise', p.depot));
  $('#d-remise', root)?.addEventListener('click', () => formMouvement('dispatch', p.depot));
  const draw = () => {
    $('.per-lib', root).textContent = libPer();
    if (!p.depot) return;
    const [du, au] = bornes(), C = contexte(App.D, App.I);
    const d = situationDepots(C, du, au).find((x) => x.id === p.depot); if (!d) return;
    $('#dk', root).innerHTML = [
      kpi('Reçu par le dépôt', ctn(d.recu), `Oriba Foods ${fmtQ(d.recuFoods)} · Oriba Rice ${fmtQ(d.recuRice)} · grossistes ${fmtQ(d.recuGross)}`),
      kpi('Vendu', ctn(d.venduReseau), `comptant ${fmtQ(d.vcReseau)} · crédit ${fmtQ(d.vkReseau)}`),
      kpi('Stock fin', ctn(d.stockTotal), `au dépôt ${fmtQ(d.sf)} · chez les agents ${fmtQ(d.stockSous)}`, d.stockTotal < 0 ? 'crit' : ''),
      kpi('Reste à verser', fmtF(d.ecart), `à verser ${fmtF(d.aVerser)} · versé ${fmtF(d.verse)}${d.prix ? ` · prix ${fmtN(d.prix)} FCFA/ctn` : ''}`, d.ecart > 0 ? 'crit' : 'ok'),
    ].join('');
    $('#dt-t', root).textContent = `Agents de ${d.nom} — ${libPer()}`;
    const lignes = [{ ...d, nom: `${d.nom} (vente directe)`, recu: d.recu, si: d.si, sf: d.sf, fonction: 'Dépôt', _depot: true }, ...d.sousAgents];
    new Table({ title: `Agents — ${d.nom}`, rows: lignes, sort: { k: 'objectif', dir: -1 }, pageSize: 30,
      foot: (c, rs) => (c.k === 'nom' ? '<b>Total</b>' : ['si', 'vc', 'vk', 'sf', 'objectif', 'venduMois', 'enCours'].includes(c.k) ? `<b>${fmtN(rs.reduce((s, r) => s + num(r[c.k]), 0))}</b>` : ''),
      cols: [{ k: 'nom', l: 'Agent' }, { k: 'fonction', l: 'Fonction' }, { k: 'si', l: 'Stock début', num: 1, f: (r) => fmtQ(r.si) }, { k: 'recu', l: 'Reçu', num: 1, f: (r) => fmtQ(r.recu) + (r._depot ? ' <small class="muted">(fournisseurs)</small>' : ' <small class="muted">(du dépôt)</small>') },
        { k: 'vc', l: 'Vendu comptant', num: 1, f: (r) => fmtQ(r.vc) }, { k: 'vk', l: 'Vendu crédit', num: 1, f: (r) => fmtQ(r.vk) }, { k: 'sf', l: 'Stock fin', num: 1, f: (r) => (r.sf < 0 ? `<b class="t-crit">${fmtQ(r.sf)}</b>` : `<b>${fmtQ(r.sf)}</b>`) },
        { k: 'objectif', l: 'Objectif du mois', num: 1, f: (r) => (r._depot ? '' : r.objectif ? fmtQ(r.objectif) : '—') }, { k: 'venduMois', l: 'Vendu du mois', num: 1, f: (r) => (r._depot ? '' : fmtQ(r.venduMois)) },
        { k: 'taux', l: 'Réalisé', num: 1, v: (r) => r.taux ?? -1, f: (r) => (r._depot ? '' : pct(r.taux)) }, { k: 'enCours', l: 'Crédits en cours (FCFA)', num: 1, f: (r) => (r.enRetard > 0 ? `<b class="t-crit">${fmtN(r.enCours)}</b>` : fmtN(r.enCours)) }] }).mount($('#dt', root));
  };
  lierBarre(root, draw);
  draw();
}

// ---------------------------------------------------------------- Saisie rapide et import
export function renderSaisieRapide(root) {
  const can = App.can('circuit', 'creer');
  const tuile = (id, ic, t, s) => `<button class="card tuile" id="${id}" ${can ? '' : 'disabled'}><span class="tuile-ic">${icon(ic)}</span><b>${t}</b><span class="muted small">${s}</span></button>`;
  root.innerHTML = pageHead('Saisie et import', can ? 'Une opération à la fois, ou tout le classeur du jour d’un coup.' : 'Consultation seule : la saisie est réservée au Responsable Commercial.') +
    `<section class="tuiles">${tuile('s-imp', 'upload', 'Importer le classeur du jour', 'Toutes les opérations de la journée ; seules les nouvelles lignes sont ajoutées')}
      ${tuile('s-appro', 'warehouse', 'Approvisionnement d’un dépôt', 'Cartons reçus d’Oriba Foods, d’Oriba Rice ou d’un grossiste')}
      ${tuile('s-remise', 'users', 'Remise à un agent', 'Cartons donnés par le dépôt à un de ses agents')}
      ${tuile('s-vente', 'cash', 'Vente', 'Au comptant ou à crédit, par un agent ou par le dépôt')}
      ${tuile('s-vers', 'wallet', 'Versement ou remboursement', 'Argent versé à la caisse Oriba ou chez le grossiste')}
      ${tuile('s-mod', 'download', 'Modèle Excel du classeur', 'À remplir chaque jour, avec les listes déjà à jour')}</section>
     <p class="muted small">Les autres saisies (dépenses, objectifs, référentiels…) restent disponibles dans « Tous les modules », en bas du menu.</p>`;
  if (!can) return;
  $('#s-imp', root).addEventListener('click', () => ouvrirImportCircuit());
  $('#s-appro', root).addEventListener('click', () => formMouvement('prise'));
  $('#s-remise', root).addEventListener('click', () => formMouvement('dispatch'));
  $('#s-vente', root).addEventListener('click', () => formVente());
  $('#s-vers', root).addEventListener('click', () => formVersement());
  $('#s-mod', root).addEventListener('click', () => modeleCircuit());
}

// Vente simplifiée : un vendeur (dépôt ou agent), un produit, des cartons
export function formVente() {
  const vendeurs = (App.D.agents || []).filter((a) => a.actif !== false && a.role_circuit).sort((a, b) => (nm.agent(a.depot_id || a.id) + a.nom).localeCompare(nm.agent(b.depot_id || b.id) + b.nom, 'fr'))
    .map((a) => ({ v: a.id, l: a.role_circuit === 'depot' ? `${a.nom} (vente directe du dépôt)` : `${a.nom} — ${nm.agent(a.depot_id)}` }));
  const prixDe = (id) => { const a = (App.D.agents || []).find((x) => x.id === id); const d = a?.role_circuit === 'depot' ? a : (App.D.agents || []).find((x) => x.id === a?.depot_id); return d?.prix_carton ?? ''; };
  const prods = opts('produits');
  modal({ title: 'Nouvelle vente',
    body: `<form class="form" id="vf"><div class="grid2">
      ${field({ k: 'date', l: 'Date', t: 'date', req: 1 }, today())}
      ${field({ k: 'mode', l: 'Paiement', t: 'options', options: [{ v: 'comptant', l: 'Comptant' }, { v: 'credit', l: 'À crédit' }], empty: false })}
      ${field({ k: 'agent_id', l: 'Vendu par', t: 'options', options: vendeurs, req: 1 })}
      ${field({ k: 'client_id', l: 'Client (obligatoire à crédit)', t: 'options', options: opts('clients') })}
      ${field({ k: 'produit_id', l: 'Produit', t: 'options', options: prods, req: 1 }, prods.find((o) => /dadi/i.test(o.l))?.v || prods[0]?.v)}
      ${field({ k: 'quantite', l: 'Cartons', t: 'number', req: 1, min: 0 })}
      ${field({ k: 'prix_unitaire', l: 'Prix du carton (FCFA)', t: 'number', req: 1, min: 0 })}
      <div data-ech hidden>${field({ k: 'echeance', l: 'Date de remboursement promise', t: 'date' }, addDays(today(), 7))}</div></div><p class="err" hidden></p></form>`,
    footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="vs">Enregistrer la vente</button>',
    onMount: (m, close) => {
      const v = (n) => $(`[name=${n}]`, m);
      v('agent_id').addEventListener('change', () => { const p = prixDe(v('agent_id').value); if (p) v('prix_unitaire').value = p; });
      v('mode').addEventListener('change', () => { $('[data-ech]', m).hidden = v('mode').value !== 'credit'; });
      $('#vs', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const d = readForm($('#vf', m));
        try {
          await App.act('vente.create', { vente: { date: d.date, mode: d.mode, agent_id: d.agent_id, client_id: d.client_id, echeance: d.mode === 'credit' ? d.echeance : null }, lignes: [{ produit_id: d.produit_id, unite: 'carton', quantite: d.quantite, prix_unitaire: d.prix_unitaire }] }, 'Vente enregistrée.');
          close();
        } catch (e) { showErr(m, e.message); }
      }));
    } });
}

// ---------------------------------------------------------------- Crédits à relancer
export function renderCreditsEssentiel(root) {
  const can = App.can('remboursements', 'creer');
  root.innerHTML = pageHead('Crédits à relancer', 'Clients qui doivent encore de l’argent : d’abord ceux en retard, puis ceux dont l’échéance approche.',
    can ? `<button class="btn primary" id="c-remb">${icon('plus')} Enregistrer un remboursement</button>` : '') + '<section class="kpis k4" id="ck"></section><article class="card" id="ct"></article>';
  $('#c-remb', root)?.addEventListener('click', () => formVersement());
  const C = contexte(App.D, App.I), cr = creditsCircuit(C, today());
  const retard = cr.filter((c) => c.statut === 'En retard'), proches = cr.filter((c) => c.proche);
  $('#ck', root).innerHTML = [kpi('Total dû par les clients', fmtF(S(cr, 'solde')), `${cr.length} crédit(s)`), kpi('En retard', fmtF(S(retard, 'solde')), `${new Set(retard.map((c) => c.client_id)).size} client(s)`, retard.length ? 'crit' : 'ok'),
    kpi('Échéance dans 2 jours ou moins', fmtN(proches.length), '', proches.length ? 'warn' : ''), kpi('Plus gros retard', retard.length ? `${Math.max(...retard.map((c) => c.joursRetard))} jours` : '—', '', retard.length ? 'crit' : '')].join('');
  const rang = (c) => (c.statut === 'En retard' ? 0 : c.proche ? 1 : 2);
  new Table({ title: 'Crédits clients', rows: cr.sort((a, b) => rang(a) - rang(b) || b.joursRetard - a.joursRetard), pageSize: 30, empty: 'Aucun crédit en cours.',
    cols: [{ k: 'client', l: 'Client', v: (r) => nm.client(r.client_id), f: (r) => `<b>${esc(nm.client(r.client_id))}</b>` }, { k: 'vendeur', l: 'Agent', v: (r) => nm.agent(r.agent_id) },
      { k: 'depot', l: 'Dépôt', v: (r) => { const a = App.I.agents.get(r.agent_id); return a?.role_circuit === 'depot' ? a.nom : nm.agent(a?.depot_id); } },
      { k: 'date', l: 'Vendu le', f: (r) => fmtD(r.date) }, { k: 'echeance', l: 'À rembourser le', f: (r) => fmtD(r.echeance) }, { k: 'solde', l: 'Reste dû (FCFA)', num: 1, f: (r) => `<b>${fmtN(r.solde)}</b>` },
      { k: 'statut', l: 'Situation', v: (r) => rang(r), f: (r) => (r.statut === 'En retard' ? pill(`En retard de ${r.joursRetard} j`, 'crit') : r.proche ? pill('Échéance proche', 'warn') : pill('En cours', 'info')) }] }).mount($('#ct', root));
}
