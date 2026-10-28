// Tableau de bord de direction et analyses cumulées.
import { App, nm, filterBar, describeFilters, pageHead } from '../app.js';
import { esc, $, $$, icon, fmtF, fmtN, fmtQ, fmtD, chart, palette, alpha, cssVar, Table, modal, pill, statutCreditPill } from '../lib/ui.js';
import { salesFacts, rembFacts, openCredits, creancesParMois, groupSum, monthsBetween, moisLabel, periodRange, isoWeek } from '../lib/facts.js';
import { plafondsClients, lots, alertes, today, niveauPlafond, round2 } from '../../shared/logic.js';
import { openVente } from './ventes.js';
import { LOGO } from '../assets/logo.js';
import { ouvrirRapports } from '../lib/rapports.js';

function kpi(id, label, value, sub = '', sev = '') {
  return `<button class="kpi ${sev}" data-kpi="${id}"><span class="kpi-l">${esc(label)}</span><span class="kpi-v">${value}</span>${sub ? `<span class="kpi-s">${sub}</span>` : ''}</button>`;
}

function factsTable(title, rows) {
  const t = new Table({
    title, rows, pageSize: 15, sort: { k: 'date', dir: -1 },
    cols: [
      { k: 'numero', l: 'N°', v: (r) => r.v.numero }, { k: 'date', l: 'Date', v: (r) => r.date, f: (r) => fmtD(r.date) },
      { k: 'mode', l: 'Mode', v: (r) => (r.mode === 'credit' ? 'Crédit' : 'Comptant') },
      { k: 'agent', l: 'Agent', v: (r) => nm.agent(r.agent_id) }, { k: 'client', l: 'Client', v: (r) => nm.client(r.client_id) },
      { k: 'produit', l: 'Produit', v: (r) => nm.produit(r.produit_id) },
      { k: 'cartons', l: 'Qté (ctn éq.)', num: 1, v: (r) => r.cartons, f: (r) => fmtQ(r.cartons) },
      { k: 'montant', l: 'Montant FCFA', num: 1, v: (r) => r.montant, f: (r) => fmtN(r.montant) },
    ],
    onRow: (r) => openVente(r.v.id),
    meta: () => `Filtres : ${describeFilters('ventes')}`,
  });
  modal({ title, wide: true, body: '<div class="dd"></div>', onMount: (m) => t.mount($('.dd', m)) });
}

function creditsTable(title, rows) {
  const t = new Table({
    title, rows, pageSize: 15, sort: { k: 'solde', dir: -1 },
    cols: [
      { k: 'numero', l: 'N°', v: (r) => r.v.numero }, { k: 'date', l: 'Date', v: (r) => r.v.date, f: (r) => fmtD(r.v.date) },
      { k: 'client', l: 'Client', v: (r) => nm.client(r.v.client_id) }, { k: 'agent', l: 'Agent', v: (r) => nm.agent(r.v.agent_id) },
      { k: 'echeance', l: 'Échéance', v: (r) => r.v.echeance, f: (r) => fmtD(r.v.echeance) },
      { k: 'solde', l: 'Solde FCFA', num: 1, v: (r) => r.ci.solde, f: (r) => fmtN(r.ci.solde) },
      { k: 'retard', l: 'Retard (j)', num: 1, v: (r) => r.ci.joursRetard },
      { k: 'statut', l: 'Statut', v: (r) => r.ci.statut, f: (r) => statutCreditPill(r.ci.statut) },
    ],
    onRow: (r) => openVente(r.v.id),
  });
  modal({ title, wide: true, body: '<div class="dd"></div>', onMount: (m) => t.mount($('.dd', m)) });
}

export function renderDashboard(root) {
  const u = App.user;
  const h = Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hour12: false, timeZone: 'Africa/Niamey' }).format(new Date()));
  const jour = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Africa/Niamey' }).format(new Date());
  const t = today();
  const duJour = salesFacts(App.I, { preset: 'jour' });
  const nbAl = alertes(App.I, t, u.permissions);
  const retards = openCredits(App.I, { preset: 'tout' }).filter((x) => x.v.statut === 'validee' && x.ci.statut === 'En retard').length;
  root.innerHTML = `<section class="hero"><div><h1>${h < 13 ? 'Bonjour' : 'Bonsoir'}, ${esc(u.prenom || u.nom)}</h1>
      <p>${esc(jour.charAt(0).toUpperCase() + jour.slice(1))} · ${esc(u.role_nom || '')} · montants en FCFA, quantités en cartons équivalents</p>
      <div class="hero-chips"><span class="chip">Ventes du jour <b>${fmtF(duJour.reduce((s, x) => s + x.montant, 0))}</b></span><span class="chip">Cartons du jour <b>${fmtQ(duJour.reduce((s, x) => s + x.cartons, 0))}</b></span>
      <span class="chip">Alertes <b>${nbAl.length}</b></span><span class="chip">Crédits en retard <b>${retards}</b></span></div>
      <div class="hero-act"><button class="btn sm" id="rp-h">${icon('file')} Rapport hebdomadaire</button><button class="btn sm" id="rp-m">${icon('file')} Rapport mensuel</button></div></div>
      <div class="hero-logo"><img src="${LOGO}" alt="Oriba Food"></div></section>
    <div id="flt"></div><div id="dash"></div>`;
  $('#rp-h', root).addEventListener('click', () => ouvrirRapports('hebdo'));
  $('#rp-m', root).addEventListener('click', () => ouvrirRapports('mensuel'));
  const draw = () => drawDash($('#dash', root));
  filterBar($('#flt', root), 'ventes', ['periode', 'zone_id', 'agent_id', 'marche_id', 'client_id', 'produit_id', 'unite', 'mode'], draw);
  draw();
}

function drawDash(host) {
  const I = App.I, f = App.filters.ventes;
  const facts = salesFacts(I, f);
  const comptant = facts.filter((x) => x.mode === 'comptant'), credit = facts.filter((x) => x.mode === 'credit');
  const sum = (a, k = 'montant') => a.reduce((s, x) => s + x[k], 0);
  const rem = rembFacts(I, f);
  const oc = openCredits(I, f);
  const open = oc.filter((x) => x.ci.solde > 0), late = open.filter((x) => x.ci.statut === 'En retard');
  const plaf = plafondsClients(I).filter((p) => !f.client_id || p.client.id === f.client_id);
  const top = plaf[0];
  const L = lots(I).filter((l) => (!f.client_id || l.client_id === f.client_id) && (!f.produit_id || l.produit_id === f.produit_id));
  const stockRest = L.reduce((s, l) => s + l.restant, 0);
  const A = alertes(I, today(), App.user.permissions);
  const [du, au] = periodRange(f);
  const dates = facts.map((x) => x.date).sort();
  const m0 = du !== '0000-01-01' ? du : dates[0] || today();
  const m1 = au !== '9999-12-31' ? (au > today() ? today() : au) : today();
  const mois = monthsBetween(m0, m1);
  const pal = palette();

  host.innerHTML = `
  <section class="kpis">
    ${kpi('comptant', 'CA comptant', fmtF(sum(comptant)), `${fmtQ(sum(comptant, 'cartons'))} ctn`)}
    ${kpi('credit', 'Ventes à crédit', fmtF(sum(credit)), `${fmtQ(sum(credit, 'cartons'))} ctn`)}
    ${kpi('total', 'Ventes totales', fmtF(sum(facts)), `${fmtN(new Set(facts.map((x) => x.v.id)).size)} ventes`)}
    ${kpi('qte', 'Quantité vendue', `${fmtQ(sum(facts, 'cartons'))} ctn`, `dont ${fmtN(facts.filter((x) => x.unite === 'pack').reduce((s, x) => s + x.quantite, 0))} packs`)}
    ${kpi('remb', 'Encaissements sur crédits', fmtF(sum(rem)), `${fmtN(rem.length)} remboursements`)}
    ${kpi('open', 'Créances ouvertes', fmtF(open.reduce((s, x) => s + x.ci.solde, 0)), `${fmtN(open.length)} crédits · ${fmtQ(open.reduce((s, x) => s + x.ci.cartonsRestants, 0))} ctn éq.`)}
    ${kpi('late', 'Créances en retard', fmtF(late.reduce((s, x) => s + x.ci.solde, 0)), `${fmtN(late.length)} crédits en retard`, late.length ? 'crit' : '')}
    ${kpi('plafond', 'Utilisation du plafond', top ? `${fmtN(top.pct, 0)} %` : '0 %', top ? esc(top.client.nom) : 'Aucune créance', top ? top.sev : '')}
    ${kpi('stock', 'Stock confié restant', `${fmtQ(stockRest)} ctn`, `${fmtN(L.filter((l) => l.restant > 0).length)} lots actifs`)}
  </section>

  <section class="grid g-dash">
    <article class="card span2"><header><h3>Évolution du chiffre d’affaires</h3>
      <div class="seg" role="group"><button data-gran="mois" class="on">Par mois</button><button data-gran="jour">Par jour</button></div></header>
      <div class="cv h260"><canvas id="c-ca"></canvas></div></article>
    <article class="card"><header><h3>Alertes prioritaires</h3><span class="muted">${fmtN(A.length)}</span></header>
      <ul class="alerts">${A.slice().sort((a, b) => ({ crit: 0, warn: 1, info: 2 }[a.sev] - { crit: 0, warn: 1, info: 2 }[b.sev])).slice(0, 12).map((a) => `<li class="al ${a.sev}" data-page="${a.page}" data-id="${a.id}" tabindex="0"><b>${esc(a.type)}</b><span>${esc(a.msg)}</span></li>`).join('') || '<li class="muted">Aucune alerte.</li>'}</ul>
      ${A.length > 12 ? `<button class="btn sm ghost" data-go="creances">Voir les ${A.length} alertes</button>` : ''}</article>
    <article class="card"><header><h3>Comptant et crédit par mois</h3></header><div class="cv h240"><canvas id="c-mode"></canvas></div></article>
    <article class="card"><header><h3>Ventes par agent</h3></header><div class="cv h240 scroll-y"><canvas id="c-agent"></canvas></div></article>
    <article class="card"><header><h3>Répartition par produit</h3></header><div class="cv h240"><canvas id="c-prod"></canvas></div></article>
    <article class="card"><header><h3>Ventes par marché / village</h3></header><div class="cv h240"><canvas id="c-marche"></canvas></div></article>
    <article class="card"><header><h3>Remboursements et créances ouvertes</h3></header><div class="cv h240"><canvas id="c-remb"></canvas></div></article>
    <article class="card"><header><h3>Plafond de créances</h3><select id="g-client" aria-label="Client">${plaf.map((p) => `<option value="${p.client.id}">${esc(p.client.nom)}</option>`).join('') || '<option>—</option>'}</select></header>
      <div class="gauge"><div class="cv h180"><canvas id="c-gauge"></canvas></div><div class="g-txt" id="g-txt"></div></div></article>
    <article class="card"><header><h3>Créances par statut</h3></header><div class="cv h240"><canvas id="c-statut"></canvas></div></article>
    <article class="card span2"><header><h3>Stock confié par lot</h3></header><div class="cv h240"><canvas id="c-stock"></canvas></div></article>
    <article class="card span3"><header><h3>Classements</h3>
      <div class="seg" role="group"><button data-top="agent_id" class="on">Agents</button><button data-top="marche_id">Marchés</button><button data-top="produit_id">Produits</button><button data-top="client_id">Clients</button></div></header>
      <div id="tops"></div></article>
  </section>`;

  // KPI drill-down
  $$('[data-kpi]', host).forEach((b) => b.addEventListener('click', () => {
    const k = b.dataset.kpi;
    if (k === 'comptant') factsTable('CA comptant — détail', comptant);
    else if (k === 'credit') factsTable('Ventes à crédit — détail', credit);
    else if (k === 'total' || k === 'qte') factsTable('Ventes — détail', facts);
    else if (k === 'remb') {
      const t = new Table({ title: 'Encaissements sur crédits', rows: rem, pageSize: 15, sort: { k: 'date', dir: -1 }, cols: [
        { k: 'numero', l: 'N°', v: (r) => r.r.numero }, { k: 'date', l: 'Date', v: (r) => r.date, f: (r) => fmtD(r.date) }, { k: 'vente', l: 'Vente', v: (r) => r.v.numero },
        { k: 'client', l: 'Client', v: (r) => nm.client(r.v.client_id) }, { k: 'mode', l: 'Mode', v: (r) => r.r.mode || '' }, { k: 'montant', l: 'Montant FCFA', num: 1, v: (r) => r.montant, f: (r) => fmtN(r.montant) }], onRow: (r) => openVente(r.v.id) });
      modal({ title: 'Encaissements sur crédits', wide: true, body: '<div class="dd"></div>', onMount: (m) => t.mount($('.dd', m)) });
    } else if (k === 'open') creditsTable('Créances ouvertes', open);
    else if (k === 'late') creditsTable('Créances en retard', late);
    else if (k === 'plafond' || k === 'stock') App.go(k === 'plafond' ? 'creances' : 'stock');
  }));
  $$('.al[data-page]', host).forEach((li) => { const go = () => (li.dataset.page === 'credit' ? openVente(li.dataset.id) : App.go(li.dataset.page)); li.addEventListener('click', go); li.addEventListener('keydown', (e) => e.key === 'Enter' && go()); });
  $$('[data-go]', host).forEach((b) => b.addEventListener('click', () => App.go(b.dataset.go)));

  // CA évolution
  const drawCA = (gran) => {
    const key = gran === 'jour' ? 'date' : 'mois';
    let labels;
    if (gran === 'jour') { labels = [...new Set(facts.map((x) => x.date))].sort(); } else labels = mois;
    const gc = groupSum(comptant, key), gk = groupSum(credit, key);
    chart($('#c-ca', host), {
      type: 'line', data: {
        labels: labels.map((l) => (gran === 'jour' ? fmtD(l).slice(0, 5) : moisLabel(l))),
        datasets: [
          { label: 'Total', data: labels.map((l) => (gc.get(l) || 0) + (gk.get(l) || 0)), borderColor: pal[0], backgroundColor: alpha(pal[0], 0.12), fill: true, tension: 0.3, pointRadius: gran === 'jour' ? 0 : 3, borderWidth: 2.5 },
          { label: 'Comptant', data: labels.map((l) => gc.get(l) || 0), borderColor: pal[1], tension: 0.3, pointRadius: 0, borderWidth: 1.6 },
          { label: 'Crédit', data: labels.map((l) => gk.get(l) || 0), borderColor: pal[2], tension: 0.3, pointRadius: 0, borderWidth: 1.6, borderDash: [5, 4] },
        ],
      },
    });
  };
  drawCA('mois');
  $$('[data-gran]', host).forEach((b) => b.addEventListener('click', () => { $$('[data-gran]', host).forEach((x) => x.classList.toggle('on', x === b)); drawCA(b.dataset.gran); }));

  const gc = groupSum(comptant, 'mois'), gk = groupSum(credit, 'mois');
  chart($('#c-mode', host), { type: 'bar', data: { labels: mois.map(moisLabel), datasets: [
    { label: 'Comptant', data: mois.map((m) => gc.get(m) || 0), backgroundColor: pal[1], borderRadius: 3 },
    { label: 'Crédit', data: mois.map((m) => gk.get(m) || 0), backgroundColor: pal[2], borderRadius: 3 }] } });

  const ga = [...groupSum(facts, 'agent_id')].sort((a, b) => b[1] - a[1]).slice(0, 15);
  $('#c-agent', host).parentElement.style.height = Math.max(240, ga.length * 24 + 40) + 'px';
  chart($('#c-agent', host), { type: 'bar', horizontal: true, legend: false, data: { labels: ga.map(([k]) => nm.agent(k).replace(' (démo)', '')), datasets: [{ label: 'CA', data: ga.map(([, v]) => v), backgroundColor: pal[0], borderRadius: 3 }] },
    onClick: (e, els) => { if (els[0]) factsTable(`Ventes — ${nm.agent(ga[els[0].index][0])}`, facts.filter((x) => x.agent_id === ga[els[0].index][0])); } });

  const gp = [...groupSum(facts, 'produit_id')].sort((a, b) => b[1] - a[1]);
  const totP = gp.reduce((s, [, v]) => s + v, 0);
  chart($('#c-prod', host), { type: 'doughnut', cutout: '62%', legendPos: 'right', data: { labels: gp.map(([k]) => nm.produit(k)), datasets: [{ data: gp.map(([, v]) => v), backgroundColor: pal, borderWidth: 0 }] },
    tip: (c) => `${c.label} : ${fmtF(c.parsed)} (${totP ? fmtN((c.parsed / totP) * 100, 1) : 0} %)` });

  const gm = [...groupSum(facts, 'marche_id')].sort((a, b) => b[1] - a[1]).slice(0, 12);
  chart($('#c-marche', host), { type: 'bar', legend: false, data: { labels: gm.map(([k]) => nm.marche(k)), datasets: [{ label: 'CA', data: gm.map(([, v]) => v), backgroundColor: gm.map((_, i) => alpha(pal[3], 1 - i * 0.055)), borderRadius: 3 }] },
    onClick: (e, els) => { if (els[0]) factsTable(`Ventes — ${nm.marche(gm[els[0].index][0])}`, facts.filter((x) => x.marche_id === gm[els[0].index][0])); } });

  const gr = groupSum(rem, 'mois');
  const cpm = creancesParMois(I, f, mois);
  chart($('#c-remb', host), { type: 'bar', y2: false, data: { labels: mois.map(moisLabel), datasets: [
    { type: 'bar', label: 'Remboursements', data: mois.map((m) => gr.get(m) || 0), backgroundColor: pal[1], borderRadius: 3, order: 2 },
    { type: 'line', label: 'Créances ouvertes (fin de mois)', data: cpm, borderColor: pal[4], backgroundColor: pal[4], tension: 0.3, pointRadius: 3, order: 1 }] } });

  // Jauge plafond
  const drawGauge = (cid) => {
    const p = plaf.find((x) => x.client.id === cid) || plaf[0];
    const seuils = I.p.seuils_plafond || [75, 90, 100];
    const pct = p ? p.pct : 0;
    const shown = Math.min(pct, 120);
    const sevCol = { ok: cssVar('--ok'), warn: cssVar('--warn'), crit: cssVar('--crit') }[p ? p.sev : 'ok'];
    chart($('#c-gauge', host), { type: 'doughnut', rotation: -90, circumference: 180, cutout: '72%', legend: false,
      data: { labels: ['Utilisé', 'Disponible'], datasets: [{ data: [shown, Math.max(0, 120 - shown)], backgroundColor: [sevCol, cssVar('--line')], borderWidth: 0 }] },
      tip: (c) => (c.dataIndex === 0 ? `Utilisé : ${fmtN(pct, 1)} %` : `Marge : ${p ? fmtQ(p.marge) : 0} ctn`) });
    $('#g-txt', host).innerHTML = p ? `<b>${fmtN(pct, 0)} %</b><span>${fmtQ(p.encours)} / ${fmtQ(p.plafond)} ctn</span><span>Marge ${fmtQ(p.marge)} ctn · ${fmtF(p.fcfa)}</span>${pill(p.label, p.sev)}<small>Seuils : ${seuils.join(' % · ')} % (échelle 0–120 %)</small>` : '<span class="muted">Aucune créance ouverte.</span>';
  };
  drawGauge(plaf[0]?.client.id);
  $('#g-client', host).addEventListener('change', (e) => drawGauge(e.target.value));

  const st = ['En attente', 'Partiellement remboursé', 'En retard', 'Soldé'];
  const cnt = st.map((s) => oc.filter((x) => x.ci.statut === s).length);
  const amt = st.map((s) => oc.filter((x) => x.ci.statut === s).reduce((a, x) => a + (s === 'Soldé' ? x.ci.montant : x.ci.solde), 0));
  chart($('#c-statut', host), { type: 'doughnut', cutout: '58%', legendPos: 'right', data: { labels: st, datasets: [{ data: cnt, backgroundColor: [cssVar('--info'), cssVar('--warn'), cssVar('--crit'), cssVar('--ok')], borderWidth: 0 }] },
    tip: (c) => `${c.label} : ${c.parsed} crédit(s) · ${fmtF(amt[c.dataIndex])}${c.dataIndex === 3 ? ' vendus' : ' restants'}`,
    onClick: (e, els) => { if (els[0]) creditsTable(`Créances — ${st[els[0].index]}`, oc.filter((x) => x.ci.statut === st[els[0].index])); } });

  chart($('#c-stock', host), { type: 'bar', stacked: true, money: false, data: { labels: L.map((l) => `${l.lot.numero} · ${nm.produit(l.produit_id).replace(' (démo)', '')}`), datasets: [
    { label: 'Vendu', data: L.map((l) => l.vendu), backgroundColor: pal[1] },
    { label: 'Restant', data: L.map((l) => l.restant), backgroundColor: pal[0] },
    { label: 'Retours, pertes, ajustements', data: L.map((l) => l.retour + l.perte + l.ajustMoins - l.ajustPlus), backgroundColor: pal[5] }] },
    tip: (c) => `${c.dataset.label} : ${fmtQ(c.parsed.y)} ctn (lot initial ${fmtQ(L[c.dataIndex].initial)})` });

  const drawTop = (key) => {
    const name = { agent_id: nm.agent, marche_id: nm.marche, produit_id: nm.produit, client_id: nm.client }[key];
    const g = new Map();
    for (const x of facts) { const k = x[key] || '—'; const o = g.get(k) || { id: k, ca: 0, q: 0, c: 0, k: 0, n: new Set() }; o.ca += x.montant; o.q += x.cartons; if (x.mode === 'comptant') o.c += x.montant; else o.k += x.montant; o.n.add(x.v.id); g.set(k, o); }
    const rows = [...g.values()].map((o, i) => ({ ...o, nb: o.n.size, nom: name(o.id) }));
    new Table({ title: 'Classement', rows, pageSize: 10, sort: { k: 'ca', dir: -1 }, meta: () => `Filtres : ${describeFilters('ventes')}`, cols: [
      { k: 'nom', l: { agent_id: 'Agent', marche_id: 'Marché', produit_id: 'Produit', client_id: 'Client' }[key] },
      { k: 'nb', l: 'Ventes', num: 1 }, { k: 'q', l: 'Qté (ctn)', num: 1, f: (r) => fmtQ(r.q) },
      { k: 'c', l: 'Comptant', num: 1, f: (r) => fmtN(r.c) }, { k: 'k', l: 'Crédit', num: 1, f: (r) => fmtN(r.k) },
      { k: 'ca', l: 'CA total FCFA', num: 1, f: (r) => `<b>${fmtN(r.ca)}</b>` },
      { k: 'part', l: 'Part', num: 1, v: (r) => (sum(facts) ? round2((r.ca / sum(facts)) * 100) : 0), f: (r) => `${fmtN(sum(facts) ? (r.ca / sum(facts)) * 100 : 0, 1)} %` }],
      onRow: (r) => factsTable(`Ventes — ${r.nom}`, facts.filter((x) => (x[key] || '—') === r.id)) }).mount($('#tops', host));
  };
  drawTop('agent_id');
  $$('[data-top]', host).forEach((b) => b.addEventListener('click', () => { $$('[data-top]', host).forEach((x) => x.classList.toggle('on', x === b)); drawTop(b.dataset.top); }));
  void niveauPlafond;
}

// ---------- Analyses cumulées ----------
const DIMS = {
  agent_id: ['Agent', (x) => x.agent_id, nm.agent], marche_id: ['Marché / village', (x) => x.marche_id, nm.marche],
  client_id: ['Client', (x) => x.client_id, nm.client], produit_id: ['Produit', (x) => x.produit_id, nm.produit],
  zone_id: ['Région / zone', (x) => x.zone_id, nm.zone], equipe_id: ['Équipe', (x) => x.equipe_id, nm.equipe],
  jour: ['Jour', (x) => x.date, fmtD], semaine: ['Semaine', (x) => isoWeek(x.date), (k) => k],
  mois: ['Mois', (x) => x.mois, moisLabel], trimestre: ['Trimestre', (x) => `${x.date.slice(0, 4)}-T${Math.floor((Number(x.date.slice(5, 7)) - 1) / 3) + 1}`, (k) => k],
};

export function renderAnalyses(root) {
  App.filters.analyse = App.filters.analyse || { dim: 'agent_id' };
  root.innerHTML = pageHead('Cumuls et analyses', 'Cumul des ventes au comptant et à crédit, remboursé et restant dû, par axe et par période.') +
    `<div id="flt"></div><div class="card"><header><h3>Regrouper par</h3><div class="seg wrap" role="group">${Object.entries(DIMS).map(([k, [l]]) => `<button data-dim="${k}" class="${App.filters.analyse.dim === k ? 'on' : ''}">${l}</button>`).join('')}</div></header>
    <div class="cv h260"><canvas id="c-an"></canvas></div><div id="tb"></div></div>`;
  const draw = () => {
    const dim = App.filters.analyse.dim;
    const [label, keyf, namef] = DIMS[dim];
    const facts = salesFacts(App.I, App.filters.ventes);
    const rem = rembFacts(App.I, { ...App.filters.ventes, preset: 'tout' });
    const g = new Map();
    const get = (k) => g.get(k) || g.set(k, { id: k, qc: 0, qk: 0, c: 0, k: 0, rb: 0, n: new Set() }).get(k);
    for (const x of facts) { const o = get(keyf(x) || '—'); if (x.mode === 'comptant') { o.c += x.montant; o.qc += x.cartons; } else { o.k += x.montant; o.qk += x.cartons; } o.n.add(x.v.id); }
    // Remboursé imputé aux ventes à crédit de la période, sur le même axe
    const creditIds = new Set(facts.filter((x) => x.mode === 'credit').map((x) => x.v.id));
    const shareByVente = new Map();
    for (const x of facts.filter((y) => y.mode === 'credit')) { const t = shareByVente.get(x.v.id) || []; t.push(x); shareByVente.set(x.v.id, t); }
    for (const r of rem) {
      if (!creditIds.has(r.v.id)) continue;
      const parts = shareByVente.get(r.v.id); const tot = parts.reduce((s, x) => s + x.montant, 0);
      for (const x of parts) get(keyf(x) || '—').rb += tot ? (r.montant * x.montant) / tot : 0;
    }
    const rows = [...g.values()].map((o) => ({ ...o, nom: o.id === '—' ? '—' : namef(o.id), nb: o.n.size, tot: o.c + o.k, q: o.qc + o.qk, du: Math.max(0, o.k - o.rb) }));
    const chrono = ['jour', 'semaine', 'mois', 'trimestre'].includes(dim);
    const sorted = rows.slice().sort((a, b) => (chrono ? String(a.id).localeCompare(String(b.id)) : b.tot - a.tot)).slice(0, chrono ? 400 : 20);
    const pal = palette();
    chart($('#c-an', root), { type: 'bar', stacked: true, data: { labels: sorted.map((r) => String(r.nom).replace(' (démo)', '')), datasets: [
      { label: 'Comptant', data: sorted.map((r) => r.c), backgroundColor: pal[1] }, { label: 'Crédit', data: sorted.map((r) => r.k), backgroundColor: pal[2] }] } });
    const totals = (c, rs) => (c.k === 'nom' ? '<b>Total</b>' : ['nb', 'qc', 'qk', 'q', 'c', 'k', 'tot', 'rb', 'du'].includes(c.k) ? `<b>${['qc', 'qk', 'q'].includes(c.k) ? fmtQ(rs.reduce((s, r) => s + r[c.k], 0)) : fmtN(rs.reduce((s, r) => s + r[c.k], 0))}</b>` : '');
    new Table({ title: `Cumul des ventes par ${label.toLowerCase()}`, rows, pageSize: 30, sort: { k: chrono ? 'id' : 'tot', dir: chrono ? 1 : -1 }, foot: totals,
      meta: () => `Regroupement : ${label} · Filtres : ${describeFilters('ventes')}`,
      cols: [
        { k: 'nom', l: label, v: (r) => r.nom }, { k: 'nb', l: 'Ventes', num: 1 },
        { k: 'qc', l: 'Qté comptant', num: 1, f: (r) => fmtQ(r.qc) }, { k: 'qk', l: 'Qté crédit', num: 1, f: (r) => fmtQ(r.qk) },
        { k: 'c', l: 'CA comptant', num: 1, f: (r) => fmtN(r.c) }, { k: 'k', l: 'Vendu à crédit', num: 1, f: (r) => fmtN(r.k) },
        { k: 'tot', l: 'Total ventes', num: 1, f: (r) => `<b>${fmtN(r.tot)}</b>` }, { k: 'rb', l: 'Remboursé', num: 1, f: (r) => fmtN(r.rb), v: (r) => round2(r.rb) },
        { k: 'du', l: 'Restant dû', num: 1, f: (r) => fmtN(r.du), v: (r) => round2(r.du) },
      ] }).mount($('#tb', root));
  };
  filterBar($('#flt', root), 'ventes', ['periode', 'zone_id', 'equipe_id', 'agent_id', 'marche_id', 'client_id', 'produit_id', 'unite', 'mode'], draw);
  $$('[data-dim]', root).forEach((b) => b.addEventListener('click', () => { App.filters.analyse.dim = b.dataset.dim; $$('[data-dim]', root).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  draw();
}
