// Vue terrain : zones et équipes, agents commerciaux, clients et grossistes.
import { App, nm, filterBar, describeFilters, pageHead } from '../app.js';
import { boutonImport, lierImport } from '../lib/importer.js';
import { refFormPublic } from './admin.js';
import { esc, $, $$, fmtF, fmtN, fmtQ, fmtD, Table, modal, pill, statutCreditPill, chart, palette, alpha, icon } from '../lib/ui.js';
import { salesFacts, openCredits, groupSum, monthsBetween, moisLabel, periodRange } from '../lib/facts.js';
import { plafondsClients, lots, depenseAllocations, documentsVehicule, today, num } from '../../shared/logic.js';
import { openVente } from './ventes.js';
import { openClient } from './creances.js';
import { openDepense, ficheVehicule } from './depenses.js';

const NONE = '__aucune';
// Rattachements
const agentZone = (a) => a.zone_id || App.I.equipes.get(a.equipe_id)?.zone_id || NONE;
const agentEquipe = (a) => a.equipe_id || NONE;
const clientZone = (c) => App.I.marches.get(c.marche_id)?.zone_id || NONE;
const clientEquipe = (c) => App.I.marches.get(c.marche_id)?.equipe_id || NONE;
const marcheZone = (m) => m.zone_id || App.I.equipes.get(m.equipe_id)?.zone_id || NONE;
const depZone = (d) => d.zone_id || App.I.equipes.get(d.equipe_id)?.zone_id || NONE;
const vehZone = (v) => App.I.equipes.get(v.equipe_id)?.zone_id || NONE;

function unites(axe) {
  const list = axe === 'zone' ? App.D.zones.filter((z) => z.actif !== false).map((z) => ({ id: z.id, nom: z.nom })) : App.D.equipes.filter((e) => e.actif !== false).map((e) => ({ id: e.id, nom: e.nom, zone: e.zone_id }));
  return [...list, { id: NONE, nom: axe === 'zone' ? 'Sans zone (équipes transverses)' : 'Sans équipe' }];
}

// Toutes les données d'une zone ou d'une équipe
function perimetre(axe, id) {
  const I = App.I, f = App.filters.ventes;
  const isZ = axe === 'zone';
  const inU = (z, e) => (isZ ? z === id : e === id);
  const agents = App.D.agents.filter((a) => inU(agentZone(a), agentEquipe(a)));
  const clients = App.D.clients.filter((c) => inU(clientZone(c), clientEquipe(c)));
  const marches = App.D.marches.filter((m) => inU(marcheZone(m), m.equipe_id || NONE));
  const facts = salesFacts(I, f).filter((x) => inU(x.zone_id || NONE, x.equipe_id || NONE));
  const credits = openCredits(I, { ...f, preset: 'tout' }).filter((x) => x.v.statut === 'validee' && (() => { const z = I.marches.get(x.v.marche_id)?.zone_id || I.agents.get(x.v.agent_id)?.zone_id || NONE; const e = I.agents.get(x.v.agent_id)?.equipe_id || I.marches.get(x.v.marche_id)?.equipe_id || NONE; return inU(z, e); })());
  const [du, au] = periodRange(f);
  const deps = (App.D.depenses || []).filter((d) => d.date >= du && d.date <= au && (isZ ? depZone(d) === id : depenseAllocations(d, I).some((a) => (a.equipe_id || NONE) === id)));
  const montantDep = (d) => (isZ ? num(d.montant) : depenseAllocations(d, I).filter((a) => (a.equipe_id || NONE) === id).reduce((s, a) => s + a.montant, 0));
  const vehicules = App.D.vehicules.filter((v) => inU(vehZone(v), v.equipe_id || NONE));
  const clientIds = new Set(clients.map((c) => c.id));
  const L = lots(I).filter((l) => clientIds.has(l.client_id));
  return { agents, clients, marches, facts, credits, deps, montantDep, vehicules, lots: L };
}

function resume(P) {
  const open = P.credits.filter((x) => x.ci.solde > 0);
  const late = open.filter((x) => x.ci.statut === 'En retard');
  return {
    ca: P.facts.reduce((s, x) => s + x.montant, 0), ctn: P.facts.reduce((s, x) => s + x.cartons, 0), nbv: new Set(P.facts.map((x) => x.v.id)).size,
    agents: P.agents.filter((a) => a.actif !== false).length, clients: P.clients.filter((c) => c.actif !== false).length,
    grossistes: P.clients.filter((c) => c.actif !== false && /grossiste/i.test(c.type || '')).length,
    creances: open.reduce((s, x) => s + x.ci.solde, 0), nbOpen: open.length, retard: late.reduce((s, x) => s + x.ci.solde, 0), nbLate: late.length,
    dep: P.deps.filter((d) => d.statut === 'validee').reduce((s, d) => s + P.montantDep(d), 0), stock: P.lots.reduce((s, l) => s + l.restant, 0),
  };
}

export function renderTerrain(root) {
  App.filters.terrain = App.filters.terrain || { axe: 'zone', id: null };
  const T = App.filters.terrain;
  const draw = () => (T.id ? drawDetail(root) : drawOverview(root));
  root.innerHTML = '<div id="th"></div><div id="flt"></div><div id="tbody"></div>';
  filterBar($('#flt', root), 'ventes', ['periode', 'produit_id', 'mode'], draw);
  draw();
}

function drawOverview(root) {
  const T = App.filters.terrain;
  $('#th', root).innerHTML = pageHead('Zones et équipes', 'Cliquez sur une zone ou une équipe pour voir ses agents, clients et grossistes, ventes, créances, dépenses et stock confié.',
    `<div class="seg" role="group"><button data-axe="zone" class="${T.axe === 'zone' ? 'on' : ''}">Par zone</button><button data-axe="equipe" class="${T.axe === 'equipe' ? 'on' : ''}">Par équipe</button></div>`);
  $$('[data-axe]', root).forEach((b) => b.addEventListener('click', () => { T.axe = b.dataset.axe; T.id = null; drawOverview(root); }));
  const rows = unites(T.axe).map((u) => ({ ...u, r: resume(perimetre(T.axe, u.id)) })).filter((u) => u.id !== NONE || u.r.ca || u.r.agents || u.r.dep);
  const maxCA = Math.max(1, ...rows.map((u) => u.r.ca));
  $('#tbody', root).innerHTML = `<section class="zgrid">${rows.map((u) => `<button class="zcard" data-id="${u.id}">
      <span class="zc-h"><b>${esc(u.nom)}</b>${u.r.nbLate ? pill(`${u.r.nbLate} en retard`, 'crit') : u.r.nbOpen ? pill(`${u.r.nbOpen} crédits ouverts`, 'info') : ''}</span>
      <span class="zc-ca">${fmtF(u.r.ca)}</span><span class="bar"><i style="width:${(u.r.ca / maxCA) * 100}%"></i></span>
      <span class="zc-grid">
        <span><small>Agents</small><b>${fmtN(u.r.agents)}</b></span><span><small>Clients</small><b>${fmtN(u.r.clients)}</b></span>
        <span><small>dont grossistes</small><b>${fmtN(u.r.grossistes)}</b></span><span><small>Ventes</small><b>${fmtN(u.r.nbv)}</b></span>
        <span><small>Créances</small><b>${fmtN(u.r.creances)}</b></span><span><small>En retard</small><b class="${u.r.retard ? 't-crit' : ''}">${fmtN(u.r.retard)}</b></span>
        <span><small>Dépenses validées</small><b>${fmtN(u.r.dep)}</b></span><span><small>Stock confié (ctn)</small><b>${fmtQ(u.r.stock)}</b></span>
      </span></button>`).join('')}</section>
    <article class="card"><header><h3>Comparatif</h3></header><div id="cmp"></div></article>`;
  $$('.zcard', root).forEach((b) => b.addEventListener('click', () => { T.id = b.dataset.id; window.scrollTo(0, 0); drawDetail(root); }));
  new Table({ title: T.axe === 'zone' ? 'Synthèse par zone' : 'Synthèse par équipe', rows: rows.map((u) => ({ id: u.id, nom: u.nom, ...u.r })), pageSize: 30, sort: { k: 'ca', dir: -1 },
    onRow: (r) => { T.id = r.id; drawDetail(root); }, meta: () => `Filtres : ${describeFilters('ventes')}`,
    foot: (c, rs) => (c.k === 'nom' ? '<b>Total</b>' : ['ca', 'nbv', 'agents', 'clients', 'grossistes', 'creances', 'retard', 'dep'].includes(c.k) ? `<b>${fmtN(rs.reduce((s, r) => s + r[c.k], 0))}</b>` : ''),
    cols: [{ k: 'nom', l: T.axe === 'zone' ? 'Zone' : 'Équipe' }, { k: 'ca', l: 'CA FCFA', num: 1, f: (r) => `<b>${fmtN(r.ca)}</b>` }, { k: 'ctn', l: 'Cartons', num: 1, f: (r) => fmtQ(r.ctn) }, { k: 'nbv', l: 'Ventes', num: 1 },
      { k: 'agents', l: 'Agents', num: 1 }, { k: 'clients', l: 'Clients', num: 1 }, { k: 'grossistes', l: 'Grossistes', num: 1 },
      { k: 'creances', l: 'Créances ouvertes', num: 1, f: (r) => fmtN(r.creances) }, { k: 'retard', l: 'Dont en retard', num: 1, f: (r) => (r.retard ? `<span class="t-crit">${fmtN(r.retard)}</span>` : '0') },
      { k: 'dep', l: 'Dépenses validées', num: 1, f: (r) => fmtN(r.dep) }] }).mount($('#cmp', root));
}

function drawDetail(root) {
  const T = App.filters.terrain;
  const u = unites(T.axe).find((x) => x.id === T.id);
  if (!u) { T.id = null; return drawOverview(root); }
  const P = perimetre(T.axe, T.id);
  const R = resume(P);
  const zoneOf = u.zone ? ` · zone ${nm.zone(u.zone)}` : '';
  $('#th', root).innerHTML = `<button class="btn sm ghost back" id="back">← ${T.axe === 'zone' ? 'Toutes les zones' : 'Toutes les équipes'}</button>` +
    pageHead(u.nom, `${T.axe === 'zone' ? 'Zone' : 'Équipe'}${zoneOf} · ${fmtN(R.agents)} agents, ${fmtN(R.clients)} clients dont ${fmtN(R.grossistes)} grossistes, ${fmtN(P.marches.length)} marchés`);
  $('#back', root).addEventListener('click', () => { T.id = null; drawOverview(root); });
  const canDep = App.can('depenses');
  const tabs = [['agents', 'Agents commerciaux'], ['clients', 'Clients et grossistes'], ['ventes', 'Ventes'], ['creances', 'Créances'], ['marches', 'Marchés'], ...(canDep ? [['depenses', 'Dépenses et logistique']] : []), ['stock', 'Stock confié']];
  T.tab = tabs.some((t) => t[0] === T.tab) ? T.tab : 'agents';
  $('#tbody', root).innerHTML = `<section class="kpis">
      ${[['Chiffre d’affaires', fmtF(R.ca), `${fmtQ(R.ctn)} ctn · ${fmtN(R.nbv)} ventes`, ''], ['Créances ouvertes', fmtF(R.creances), `${fmtN(R.nbOpen)} crédits`, ''], ['Créances en retard', fmtF(R.retard), `${fmtN(R.nbLate)} crédits`, R.nbLate ? 'crit' : ''],
        ['Agents actifs', fmtN(R.agents), '', ''], ['Clients / grossistes', `${fmtN(R.clients)} / ${fmtN(R.grossistes)}`, '', ''], ...(canDep ? [['Dépenses validées', fmtF(R.dep), 'sur la période', '']] : []), ['Stock confié restant', `${fmtQ(R.stock)} ctn`, `${P.lots.length} lot(s)`, '']]
        .map(([l, v, s, c]) => `<div class="kpi static ${c}"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span>${s ? `<span class="kpi-s">${s}</span>` : ''}</div>`).join('')}</section>
    <section class="grid g2"><article class="card"><header><h3>Ventes par mois</h3></header><div class="cv h240"><canvas id="z-mois"></canvas></div></article>
      <article class="card"><header><h3>Ventes par marché</h3></header><div class="cv h240"><canvas id="z-marche"></canvas></div></article></section>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" class="${T.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <article class="card" id="ztab"></article>`;
  const pal = palette();
  const dates = P.facts.map((x) => x.date).sort();
  const mois = dates.length ? monthsBetween(dates[0], dates[dates.length - 1]) : [];
  const gc = groupSum(P.facts.filter((x) => x.mode === 'comptant'), 'mois'), gk = groupSum(P.facts.filter((x) => x.mode === 'credit'), 'mois');
  chart($('#z-mois', root), { type: 'bar', stacked: true, data: { labels: mois.map(moisLabel), datasets: [{ label: 'Comptant', data: mois.map((m) => gc.get(m) || 0), backgroundColor: pal[1] }, { label: 'Crédit', data: mois.map((m) => gk.get(m) || 0), backgroundColor: pal[2] }] } });
  const gm = [...groupSum(P.facts, 'marche_id')].sort((a, b) => b[1] - a[1]).slice(0, 12);
  chart($('#z-marche', root), { type: 'bar', horizontal: true, legend: false, data: { labels: gm.map(([k]) => nm.marche(k)), datasets: [{ label: 'CA', data: gm.map(([, v]) => v), backgroundColor: gm.map((_, i) => alpha(pal[0], 1 - i * 0.06)), borderRadius: 3 }] } });
  const drawTab = () => {
    const host = $('#ztab', root);
    const t = T.tab;
    const title = `${u.nom} — ${tabs.find((x) => x[0] === t)[1]}`;
    const meta = () => `${T.axe === 'zone' ? 'Zone' : 'Équipe'} : ${u.nom} · Filtres : ${describeFilters('ventes')}`;
    if (t === 'agents') new Table({ title, meta, rows: agentStats(P.agents, P.facts), sort: { k: 'ca', dir: -1 }, onRow: (r) => openAgent(r.id), cols: AGENT_COLS }).mount(host);
    if (t === 'clients') new Table({ title, meta, rows: clientStats(P.clients, P.facts), sort: { k: 'ca', dir: -1 }, onRow: (r) => openClient(r.id), cols: CLIENT_COLS }).mount(host);
    if (t === 'ventes') {
      const g = new Map(); for (const x of P.facts) { const o = g.get(x.v.id) || { id: x.v.id, v: x.v, montant: 0, ctn: 0 }; o.montant += x.montant; o.ctn += x.cartons; g.set(x.v.id, o); }
      new Table({ title, meta, rows: [...g.values()], sort: { k: 'date', dir: -1 }, onRow: (r) => openVente(r.id), foot: (c, rs) => (c.k === 'montant' ? `<b>${fmtN(rs.reduce((s, r) => s + r.montant, 0))}</b>` : ''),
        cols: [{ k: 'numero', l: 'N°', v: (r) => r.v.numero }, { k: 'date', l: 'Date', v: (r) => r.v.date, f: (r) => fmtD(r.v.date) }, { k: 'mode', l: 'Mode', v: (r) => (r.v.mode === 'credit' ? 'Crédit' : 'Comptant') },
          { k: 'agent', l: 'Agent', v: (r) => nm.agent(r.v.agent_id) }, { k: 'marche', l: 'Marché', v: (r) => nm.marche(r.v.marche_id) }, { k: 'client', l: 'Client', v: (r) => (r.v.client_id ? nm.client(r.v.client_id) : '—') },
          { k: 'ctn', l: 'Cartons', num: 1, f: (r) => fmtQ(r.ctn) }, { k: 'montant', l: 'Montant FCFA', num: 1, f: (r) => fmtN(r.montant) }] }).mount(host);
    }
    if (t === 'creances') new Table({ title, meta, rows: P.credits.filter((x) => x.ci.solde > 0).map((x) => ({ ...x, id: x.v.id })), sort: { k: 'retard', dir: -1 }, onRow: (r) => openVente(r.id),
      foot: (c, rs) => (c.k === 'solde' ? `<b>${fmtN(rs.reduce((s, r) => s + r.ci.solde, 0))}</b>` : ''),
      cols: [{ k: 'numero', l: 'N°', v: (r) => r.v.numero }, { k: 'date', l: 'Date', v: (r) => r.v.date, f: (r) => fmtD(r.v.date) }, { k: 'client', l: 'Client', v: (r) => nm.client(r.v.client_id) }, { k: 'agent', l: 'Agent', v: (r) => nm.agent(r.v.agent_id) },
        { k: 'montant', l: 'Montant', num: 1, v: (r) => r.ci.montant, f: (r) => fmtN(r.ci.montant) }, { k: 'solde', l: 'Solde', num: 1, v: (r) => r.ci.solde, f: (r) => `<b>${fmtN(r.ci.solde)}</b>` },
        { k: 'echeance', l: 'Échéance', v: (r) => r.v.echeance, f: (r) => fmtD(r.v.echeance) }, { k: 'retard', l: 'Retard (j)', num: 1, v: (r) => r.ci.joursRetard }, { k: 'statut', l: 'Statut', v: (r) => r.ci.statut, f: (r) => statutCreditPill(r.ci.statut) }] }).mount(host);
    if (t === 'marches') {
      const rows = P.marches.map((m) => { const fx = P.facts.filter((x) => x.marche_id === m.id); return { id: m.id, nom: m.nom, commune: m.commune, equipe: nm.equipe(m.equipe_id), clients: App.D.clients.filter((c) => c.marche_id === m.id).length, agents: new Set(fx.map((x) => x.agent_id)).size, ca: fx.reduce((s, x) => s + x.montant, 0), ctn: fx.reduce((s, x) => s + x.cartons, 0) }; });
      new Table({ title, meta, rows, sort: { k: 'ca', dir: -1 }, cols: [{ k: 'nom', l: 'Marché / village' }, { k: 'commune', l: 'Commune' }, { k: 'equipe', l: 'Équipe' }, { k: 'agents', l: 'Agents actifs', num: 1 }, { k: 'clients', l: 'Clients', num: 1 }, { k: 'ctn', l: 'Cartons', num: 1, f: (r) => fmtQ(r.ctn) }, { k: 'ca', l: 'CA FCFA', num: 1, f: (r) => fmtN(r.ca) }] }).mount(host);
    }
    if (t === 'depenses') {
      host.innerHTML = '<h4 class="sec">Véhicules</h4><div id="zv"></div><h4 class="sec">Dépenses par catégorie (validées)</h4><div id="zc"></div><h4 class="sec">Détail des dépenses</h4><div id="zd"></div>';
      new Table({ title: `${u.nom} — véhicules`, rows: P.vehicules.map((v) => ({ id: v.id, v, docs: documentsVehicule(v.id, App.I) })), exportable: false, pageSize: 10, onRow: (r) => ficheVehicule(r.id), empty: 'Aucun véhicule rattaché.', cols: VEH_COLS }).mount($('#zv', host));
      const byCat = new Map(); for (const d of P.deps.filter((x) => x.statut === 'validee')) byCat.set(d.categorie_id, (byCat.get(d.categorie_id) || 0) + P.montantDep(d));
      const tot = [...byCat.values()].reduce((s, v) => s + v, 0);
      new Table({ title: `${u.nom} — dépenses par catégorie`, rows: [...byCat].map(([k, v]) => ({ id: k, cat: nm.categorie(k), m: v })), pageSize: 20, sort: { k: 'm', dir: -1 },
        cols: [{ k: 'cat', l: 'Catégorie' }, { k: 'm', l: 'Montant FCFA', num: 1, f: (r) => fmtN(r.m) }, { k: 'p', l: 'Part', num: 1, v: (r) => (tot ? (r.m / tot) * 100 : 0), f: (r) => `${fmtN(tot ? (r.m / tot) * 100 : 0, 1)} %` }] }).mount($('#zc', host));
      new Table({ title: `${u.nom} — dépenses`, rows: P.deps, pageSize: 15, sort: { k: 'date', dir: -1 }, onRow: (r) => openDepense(r.id),
        cols: [{ k: 'numero', l: 'N°' }, { k: 'date', l: 'Date', f: (r) => fmtD(r.date) }, { k: 'cat', l: 'Catégorie', v: (r) => nm.categorie(r.categorie_id) }, { k: 'veh', l: 'Véhicule', v: (r) => (r.vehicule_id ? nm.vehicule(r.vehicule_id) : '') }, { k: 'montant', l: 'Montant', num: 1, v: (r) => P.montantDep(r), f: (r) => fmtN(P.montantDep(r)) }, { k: 'statut', l: 'Statut' }] }).mount($('#zd', host));
    }
    if (t === 'stock') new Table({ title, meta, rows: P.lots, sort: { k: 'date', dir: -1 }, empty: 'Aucun stock confié chez un client de ce périmètre.',
      cols: [{ k: 'numero', l: 'Lot', v: (r) => r.lot.numero }, { k: 'client', l: 'Dépositaire', v: (r) => nm.client(r.client_id) }, { k: 'produit', l: 'Produit', v: (r) => nm.produit(r.produit_id) }, { k: 'initial', l: 'Remis', num: 1, f: (r) => fmtQ(r.initial) }, { k: 'vendu', l: 'Vendu', num: 1, f: (r) => fmtQ(r.vendu) }, { k: 'restant', l: 'Restant', num: 1, f: (r) => `<b>${fmtQ(r.restant)}</b>` }] }).mount(host);
  };
  $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => { T.tab = b.dataset.tab; $$('[data-tab]', root).forEach((x) => x.classList.toggle('on', x === b)); drawTab(); }));
  drawTab();
}

const VEH_COLS = [
  { k: 'immat', l: 'Véhicule', v: (r) => r.v.immatriculation }, { k: 'equipe', l: 'Équipe', v: (r) => nm.equipe(r.v.equipe_id) }, { k: 'cond', l: 'Conducteur', v: (r) => r.v.conducteur || '' },
  ...['ASSU', 'VIGN', 'VTEC'].map((code, i) => ({ k: code, l: ['Assurance', 'Vignette', 'Visite technique'][i], v: (r) => r.docs.find((d) => d.code === code)?.fin || '',
    f: (r) => { const d = r.docs.find((x) => x.code === code); return d.fin ? `${fmtD(d.fin)} ${d.etat === 'expire' ? pill('Expirée', 'crit') : d.etat === 'bientot' ? pill(`${d.jours} j`, 'warn') : ''}` : pill('Non renseignée', 'mute'); } })),
];

// ---------- Agents ----------
function agentStats(agents, facts) {
  return agents.map((a) => {
    const fx = facts.filter((x) => x.agent_id === a.id);
    const credits = (App.D.ventes || []).filter((v) => v.agent_id === a.id && v.mode === 'credit' && v.statut === 'validee');
    const oc = openCredits(App.I, { preset: 'tout', agent_id: a.id }).filter((x) => x.ci.solde > 0);
    return { id: a.id, nom: a.nom, code: a.code, telephone: a.telephone, equipe: nm.equipe(a.equipe_id), zone: nm.zone(a.zone_id || App.I.equipes.get(a.equipe_id)?.zone_id), actif: a.actif !== false,
      ca: fx.reduce((s, x) => s + x.montant, 0), ctn: fx.reduce((s, x) => s + x.cartons, 0), nb: new Set(fx.map((x) => x.v.id)).size, clients: new Set(fx.filter((x) => x.client_id).map((x) => x.client_id)).size,
      marches: [...new Set(fx.map((x) => nm.marche(x.marche_id)))].join(', '), creances: oc.reduce((s, x) => s + x.ci.solde, 0), retards: oc.filter((x) => x.ci.statut === 'En retard').length,
      derniere: fx.map((x) => x.date).sort().pop() || '', nbCredits: credits.length };
  });
}
const AGENT_COLS = [
  { k: 'nom', l: 'Agent' }, { k: 'equipe', l: 'Équipe' }, { k: 'zone', l: 'Zone' }, { k: 'marches', l: 'Marchés couverts', cls: 'wrap' },
  { k: 'nb', l: 'Ventes', num: 1 }, { k: 'ctn', l: 'Cartons', num: 1, f: (r) => fmtQ(r.ctn) }, { k: 'ca', l: 'CA FCFA', num: 1, f: (r) => `<b>${fmtN(r.ca)}</b>` },
  { k: 'clients', l: 'Clients servis', num: 1 }, { k: 'creances', l: 'Créances ouvertes', num: 1, f: (r) => fmtN(r.creances) },
  { k: 'retards', l: 'Retards', num: 1, f: (r) => (r.retards ? `<span class="t-crit">${r.retards}</span>` : '0') },
  { k: 'derniere', l: 'Dernière vente', f: (r) => fmtD(r.derniere) }, { k: 'actif', l: 'Statut', v: (r) => (r.actif ? 'Actif' : 'Inactif'), f: (r) => (r.actif ? pill('Actif', 'ok') : pill('Inactif', 'mute')) },
];

export function openAgent(id) {
  const a = App.I.agents.get(id);
  const facts = salesFacts(App.I, { ...App.filters.ventes, agent_id: id });
  const st = agentStats([a], facts)[0];
  const ventes = [...new Map(facts.map((x) => [x.v.id, x.v])).values()];
  modal({ title: `Agent — ${a.nom}`, wide: true,
    body: `<dl class="dl"><dt>Code</dt><dd>${esc(a.code || '—')}</dd><dt>Équipe</dt><dd>${esc(st.equipe)}</dd><dt>Zone</dt><dd>${esc(st.zone)}</dd><dt>Téléphone</dt><dd>${esc(a.telephone || '—')}</dd><dt>Affecté le</dt><dd>${fmtD(a.date_affectation)}</dd><dt>Marchés couverts</dt><dd>${esc(st.marches || '—')}</dd></dl>
      <section class="kpis sm"><div class="kpi static"><span class="kpi-l">CA (période)</span><span class="kpi-v">${fmtF(st.ca)}</span><span class="kpi-s">${fmtQ(st.ctn)} ctn · ${st.nb} ventes</span></div>
      <div class="kpi static ${st.retards ? 'crit' : ''}"><span class="kpi-l">Créances ouvertes</span><span class="kpi-v">${fmtF(st.creances)}</span><span class="kpi-s">${st.retards} en retard</span></div>
      <div class="kpi static"><span class="kpi-l">Clients servis</span><span class="kpi-v">${fmtN(st.clients)}</span></div></section><div id="av"></div>`,
    onMount: (m) => new Table({ title: `Ventes ${a.nom}`, rows: ventes.map((v) => ({ ...v, mt: facts.filter((x) => x.v.id === v.id).reduce((s, x) => s + x.montant, 0) })), pageSize: 10, sort: { k: 'date', dir: -1 }, onRow: (r) => openVente(r.id),
      cols: [{ k: 'numero', l: 'N°' }, { k: 'date', l: 'Date', f: (r) => fmtD(r.date) }, { k: 'mode', l: 'Mode', v: (r) => (r.mode === 'credit' ? 'Crédit' : 'Comptant') }, { k: 'marche', l: 'Marché', v: (r) => nm.marche(r.marche_id) }, { k: 'client', l: 'Client', v: (r) => (r.client_id ? nm.client(r.client_id) : '—') }, { k: 'mt', l: 'Montant', num: 1, f: (r) => fmtN(r.mt) }] }).mount($('#av', m)) });
}

export function renderAgents(root) {
  root.innerHTML = pageHead('Agents commerciaux', 'Performance de chaque agent sur la période : ventes, clients servis, créances générées.',
    `${boutonImport('agents')}${App.can('referentiels', 'modifier') ? `<button class="btn primary" id="add">${icon('plus')} Nouvel agent</button>` : ''}`) + '<div id="flt"></div><div class="card" id="tb"></div>';
  lierImport(root); $('#add', root)?.addEventListener('click', () => refFormPublic('agents'));
  const draw = () => {
    const f = App.filters.ventes;
    const ag = App.D.agents.filter((a) => (!f.equipe_id || a.equipe_id === f.equipe_id) && (!f.zone_id || agentZone(a) === f.zone_id));
    new Table({ title: 'Agents commerciaux', rows: agentStats(ag, salesFacts(App.I, f)), sort: { k: 'ca', dir: -1 }, onRow: (r) => openAgent(r.id), meta: () => `Filtres : ${describeFilters('ventes')}`, cols: AGENT_COLS,
      foot: (c, rs) => (['ca', 'nb', 'creances'].includes(c.k) ? `<b>${fmtN(rs.reduce((s, r) => s + r[c.k], 0))}</b>` : c.k === 'nom' ? '<b>Total</b>' : '') }).mount($('#tb', root));
  };
  filterBar($('#flt', root), 'ventes', ['periode', 'zone_id', 'equipe_id', 'produit_id', 'mode'], draw);
  draw();
}

// ---------- Clients et grossistes ----------
function clientStats(clients, facts) {
  const P = new Map(plafondsClients(App.I).map((p) => [p.client.id, p]));
  return clients.map((c) => {
    const fx = facts.filter((x) => x.client_id === c.id);
    const p = P.get(c.id);
    return { id: c.id, nom: c.nom, code: c.code, type: c.type || '', marche: nm.marche(c.marche_id), zone: nm.zone(App.I.marches.get(c.marche_id)?.zone_id), depositaire: c.depositaire,
      ca: fx.reduce((s, x) => s + x.montant, 0), ctn: fx.reduce((s, x) => s + x.cartons, 0), nb: new Set(fx.map((x) => x.v.id)).size,
      creance: p?.fcfa || 0, pct: p?.pct || 0, sev: p?.sev || 'ok', label: p?.label || 'Aucune créance', derniere: fx.map((x) => x.date).sort().pop() || '' };
  });
}
const CLIENT_COLS = [
  { k: 'nom', l: 'Client' }, { k: 'type', l: 'Type', f: (r) => esc(r.type) + (r.depositaire ? ' ' + pill('Dépositaire', 'info') : '') }, { k: 'marche', l: 'Marché' }, { k: 'zone', l: 'Zone' },
  { k: 'nb', l: 'Achats', num: 1 }, { k: 'ctn', l: 'Cartons', num: 1, f: (r) => fmtQ(r.ctn) }, { k: 'ca', l: 'CA FCFA', num: 1, f: (r) => `<b>${fmtN(r.ca)}</b>` },
  { k: 'creance', l: 'Créance en cours', num: 1, f: (r) => fmtN(r.creance) }, { k: 'pct', l: 'Plafond utilisé', num: 1, f: (r) => (r.pct ? `<div class="mini"><div class="bar ${r.sev}"><i style="width:${Math.min(100, r.pct)}%"></i></div>${fmtN(r.pct, 0)} %</div>` : '—') },
  { k: 'derniere', l: 'Dernier achat', f: (r) => fmtD(r.derniere) },
];

export function renderClients(root) {
  root.innerHTML = pageHead('Clients et grossistes', 'Chiffre d’affaires, créances et utilisation du plafond de chaque client. Cliquez sur un client pour ouvrir sa fiche et son historique.',
    `${boutonImport('clients')}${App.can('referentiels', 'modifier') ? `<button class="btn primary" id="add">${icon('plus')} Nouveau client</button>` : ''}`) +
    '<div id="flt"></div><section class="kpis" id="k"></section><div class="card" id="tb"></div>';
  lierImport(root); $('#add', root)?.addEventListener('click', () => refFormPublic('clients'));
  const draw = () => {
    const f = App.filters.ventes;
    const cl = App.D.clients.filter((c) => (!f.zone_id || clientZone(c) === f.zone_id) && (!f.type_client || c.type === f.type_client) && (!f.marche_id || c.marche_id === f.marche_id));
    const rows = clientStats(cl, salesFacts(App.I, f));
    $('#k', root).innerHTML = [['Clients', fmtN(rows.length)], ['dont grossistes', fmtN(rows.filter((r) => /grossiste/i.test(r.type)).length)], ['CA de la période', fmtF(rows.reduce((s, r) => s + r.ca, 0))], ['Créances en cours', fmtF(rows.reduce((s, r) => s + r.creance, 0))], ['Clients au-delà de 75 % du plafond', fmtN(rows.filter((r) => r.pct >= 75).length)]]
      .map(([l, v]) => `<div class="kpi static"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span></div>`).join('');
    new Table({ title: 'Clients et grossistes', rows, sort: { k: 'ca', dir: -1 }, onRow: (r) => openClient(r.id), meta: () => `Filtres : ${describeFilters('ventes')}`, cols: CLIENT_COLS }).mount($('#tb', root));
  };
  filterBar($('#flt', root), 'ventes', ['periode', 'zone_id', 'marche_id', 'type_client'], draw,
    { type_client: { l: 'Type de client', o: () => ['Grossiste', 'Demi-grossiste', 'Détaillant', 'Boutique', 'Supermarché', 'Autre'].map((x) => ({ v: x, l: x })) } });
  draw();
  void today;
}
