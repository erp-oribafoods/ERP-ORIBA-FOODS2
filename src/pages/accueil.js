// Espace « Essentiel » : tableau de bord des dépôts, détail d'un dépôt, saisie rapide, crédits à relancer.
// Peu de chiffres, ceux qui comptent : cartons reçus (Oriba Food, Oriba Rice, grossistes), vendus, stock, argent à verser, crédits en retard.
import { App, nm, opts, pageHead } from '../app.js';
import { esc, $, $$, fmtF, fmtN, fmtQ, fmtD, Table, modal, field, readForm, showErr, busy, toast, icon, pill, comboField, comboLire, chart, palette } from '../lib/ui.js';
import { contexte, situationDepots, creditsCircuit, lundi, stockGrossistes, ventesParMarche } from '../lib/circuit.js';
import { ouvrirImportCircuit, modeleCircuit } from '../lib/importCircuit.js';
import { formMouvement, formVersement } from './circuit.js';
import { ouvrirMiseAJour, peutMettreAJour } from '../lib/majTB.js';
import { peutImporter, ouvrirImport } from '../lib/importer.js';
import { today, addDays, num, round2, estVerrouille } from '../../shared/logic.js';

const P = () => (App.filters.essentiel = App.filters.essentiel || { per: 'tout', date: today(), du: '', au: today(), depot: '' });
// Première vente enregistrée (vue « Tout »)
const premiereVente = () => (App.D.ventes || []).reduce((m, v) => (v.statut === 'validee' && v.date < m ? v.date : m), today());
function bornes() {
  const p = P(), d = p.date;
  if (p.per === 'semaine') { const l = lundi(d), f = addDays(l, 6); return [l, f > today() ? today() : f]; }
  if (p.per === 'annee') return [`${d.slice(0, 4)}-01-01`, `${d.slice(0, 4)}-12-31` > today() ? today() : `${d.slice(0, 4)}-12-31`];
  if (p.per === 'tout') return [premiereVente(), today()];
  if (p.per === 'periode') { const du = p.du || premiereVente(), au = p.au || today(); return du <= au ? [du, au] : [au, du]; }
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
  return `<div class="filters per-bar"><div class="seg" role="group">${[['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois'], ['annee', 'Année'], ['tout', 'Tout'], ['periode', 'Période']].map(([k, l]) => `<button data-per="${k}" class="${p.per === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <label class="ff per-date" ${['tout', 'periode'].includes(p.per) ? 'hidden' : ''}><span>Date</span><input type="date" id="e-date" value="${p.date}" max="${today()}"></label>
    <label class="ff per-du" ${p.per === 'periode' ? '' : 'hidden'}><span>Du</span><input type="date" id="e-du" value="${p.du || premiereVente()}" max="${today()}"></label>
    <label class="ff per-du" ${p.per === 'periode' ? '' : 'hidden'}><span>Au</span><input type="date" id="e-au" value="${p.au || today()}" max="${today()}"></label><span class="muted small per-lib"></span></div>`;
}
function lierBarre(root, draw) {
  const p = P();
  const vis = () => { $$('.per-date', root).forEach((x) => { x.hidden = ['tout', 'periode'].includes(p.per); }); $$('.per-du', root).forEach((x) => { x.hidden = p.per !== 'periode'; }); };
  $$('[data-per]', root).forEach((b) => b.addEventListener('click', () => { p.per = b.dataset.per; $$('[data-per]', root).forEach((x) => x.classList.toggle('on', x === b)); vis(); draw(); }));
  $('#e-date', root).addEventListener('change', (e) => { p.date = e.target.value || today(); draw(); });
  $('#e-du', root)?.addEventListener('change', (e) => { p.du = e.target.value; draw(); });
  $('#e-au', root)?.addEventListener('change', (e) => { p.au = e.target.value || today(); draw(); });
}
const aucunDepot = () => (App.D.agents || []).every((a) => a.role_circuit !== 'depot');
const noteVide = () => `<div class="note warn">Aucun dépôt n’est encore enregistré. Allez dans <a href="#saisie-rapide">Saisie et import</a> pour importer le classeur, ou déclarez les dépôts dans Référentiels.</div>`;

// ---------------------------------------------------------------- Tableau de bord (unique)
export function renderAccueil(root) {
  // Mot de bienvenue selon l'heure : Bonjour le matin, Bonsoir à partir de midi
  const u = App.user || {}, h = new Date().getHours();
  // DG et DAF : le titre seul ; les autres : le prénom seul
  const role = u.role_nom || '';
  const titre = /\bDG\b|direction g[ée]n[ée]rale/i.test(role) ? 'DG' : /\bDAF\b|administratif et financier/i.test(role) ? 'DAF' : '';
  const qui = titre || String(u.prenom || u.nom || '').trim().split(/\s+/)[0] || '';
  const jour = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  root.innerHTML = pageHead(`${h < 12 ? 'Bonjour' : 'Bonsoir'}${qui ? ` ${qui}` : ''} 👋`, `${u.role_nom ? `${u.role_nom} · ` : ''}${jour.charAt(0).toUpperCase() + jour.slice(1)}. Bienvenue sur l’ERP ORIBA : voici l’essentiel de l’activité.`,
    App.can('circuit', 'creer') ? `<a class="btn primary" href="#saisie-rapide">${icon('plus')} Saisir ou importer</a>` : '') + (aucunDepot() && App.can('circuit') ? noteVide() : '') + barre() +
    `<section class="kpis k3" id="ek"></section>
     <h3 class="sec-t">Contrôle des créances</h3><section class="kpis k3 kpis-ctrl" id="ek2"></section>
     <div class="grid2 acc-graph" id="eg">
       <article class="card"><header><h3>Évolution des ventes</h3><span class="muted small" id="eg-l"></span></header><div class="cv h260"><canvas id="g-ventes"></canvas></div></article>
       <article class="card"><header><h3>Objectif du mois par dépôt</h3><span class="muted small">cartons vendus / objectif</span></header><div class="cv h260"><canvas id="g-obj"></canvas></div></article>
     </div><p class="muted small" id="eg-vide" hidden>Les graphiques s’afficheront dès que des ventes seront enregistrées.</p>
     <article class="card"><header><h3>Les dépôts (chefs d’équipe)</h3><span class="muted small">Cliquez sur un dépôt pour voir ses agents</span></header><div id="et"></div></article>
     <article class="card"><header><h3>Ventes par marché</h3><span class="muted small">Ventes des agents et des dépôts, par marché</span></header><div id="em"></div></article>
     <div class="grid2 acc-bas"><article class="card" id="ec"></article><article class="card" id="ea"></article></div>`;
  const draw = () => {
    const [du, au] = bornes(), C = contexte(App.D, App.I);
    $('.per-lib', root).textContent = libPer();
    const dep = situationDepots(C, du, au);
    // Ventes de toute la force de vente sur la période (dépôts, agents, et agents hors dépôt)
    const vp = C.ventes.filter((x) => x.v.date >= du && x.v.date <= au);
    const vC = vp.filter((x) => x.v.mode === 'comptant'), vK = vp.filter((x) => x.v.mode === 'credit');
    const sm = (l, k) => l.reduce((s, x) => s + num(x[k]), 0);
    const mois = au.slice(0, 7);
    const objA = sm((App.D.objectifs || []).filter((o) => o.actif !== false && o.axe === 'agent' && o.mois === mois && !o.produit_id), 'objectif_cartons');
    const obj = objA || sm((App.D.objectifs || []).filter((o) => o.actif !== false && o.axe === 'equipe' && o.mois === mois && !o.produit_id), 'objectif_cartons');
    const venduMois = sm(C.ventes.filter((x) => x.v.date >= `${mois}-01` && x.v.date <= au), 'cartons');
    const cr = creditsCircuit(C, au, { tous: true }), retard = cr.filter((c) => c.statut === 'En retard');
    const reste = S(dep, 'reste');
    const enc = C.rembs.filter((r) => r.date >= du && r.date <= au);
    const resteF = S(dep, 'resteFood'), resteR = S(dep, 'resteRice');
    // Argent encaissé : versements des ventes au comptant + remboursements des crédits
    const versP = C.vers.filter((v) => v.objet === 'ventes_comptant' && v.date >= du && v.date <= au);
    const encaisse = sm(versP, 'montant') + sm(enc, 'montant');
    const stG = stockGrossistes(C, au), stD = S(dep, 'sf'), stA = S(dep, 'stockSous');
    const tot = sm(vp, 'montant');
    $('#ek', root).innerHTML = [
      // 1. Les ventes
      kpi('Ventes totales', fmtF(tot), `${ctn(sm(vp, 'cartons'))}${obj ? ` · objectif du mois atteint à ${fmtN((venduMois / obj) * 100, 0)} %` : ''}`),
      kpi('Ventes au comptant', fmtF(sm(vC, 'montant')), `${ctn(sm(vC, 'cartons'))} · ${vC.length} vente(s)`),
      kpi('Ventes à crédit', fmtF(sm(vK, 'montant')), `${ctn(sm(vK, 'cartons'))} · ${vK.length} vente(s)`),
      // 2. L'argent
      kpi('Montant encaissé', fmtF(encaisse), `versé sur ventes comptant ${fmtF(sm(versP, 'montant'))} · remboursements de crédits ${fmtF(sm(enc, 'montant'))}`, 'ok'),
      kpi('Reste à verser', fmtF(reste), `à Oriba Food ${fmtF(resteF)} · à Oriba Rice ${fmtF(resteR)}${S(dep, 'soldeDepart') ? ` · dont ${fmtF(S(dep, 'soldeDepart'))} dus au départ` : ''}`, reste > 0 ? 'crit' : 'ok'),
      kpi('Crédits clients en cours', fmtF(S(cr, 'solde')), `dont en retard ${fmtF(S(retard, 'solde'))} (${new Set(retard.map((c) => c.client_id)).size} client(s))`, retard.length ? 'crit' : 'ok'),
      // 3. Les stocks restants, à chaque niveau
      kpi('Stock chez les grossistes', ctn(stG), `${C.grossistes.length} grossiste(s) · approvisionnés par Oriba Food et Oriba Rice`, stG < 0 ? 'warn' : ''),
      C.stockConnu ? kpi('Stock chez les dépôts', ctn(stD), `chefs d’équipe · reçu sur la période ${fmtQ(S(dep, 'recuGross'))} des grossistes, ${fmtQ(S(dep, 'recuFoods') + S(dep, 'recuRice'))} d’Oriba`, stD < 0 ? 'warn' : '')
        : kpi('Stock chez les dépôts', 'Non renseigné', 'Saisissez le stock de départ ou les approvisionnements des dépôts'),
      kpi('Stock chez les agents', ctn(stA), `agents déployés sur les marchés · total réseau ${ctn(stG + stD + stA)}`, stA < 0 ? 'warn' : ''),
    ].join('');
    // Contrôle des créances (comme le TB des équipes) : plafond global, retards, clients débiteurs
    const plafond = num(App.I.p.plafond_creances_cartons), seuil = num(App.I.p.seuil_alerte_creance_jours) || 7;
    const qteCr = S(cr, 'cartonsRestants'), util = plafond > 0 ? (qteCr / plafond) * 100 : null;
    const nbRetard = retard.length, nbSeuil = retard.filter((c) => c.joursRetard > seuil).length;
    const debiteurs = new Set(cr.map((c) => c.client_id).filter(Boolean)).size;
    $('#ek2', root).innerHTML = [
      kpi('Quantité en créance', ctn(qteCr), `${cr.length} crédit(s) non soldé(s)`),
      kpi('Plafond des créances', plafond ? ctn(plafond) : 'Non défini', plafond ? `utilisé à ${fmtN(util, 1)} %` : 'À définir dans Paramètres > Créances', util >= 100 ? 'crit' : util >= 80 ? 'warn' : ''),
      kpi('Statut du plafond', util === null ? '—' : util >= 100 ? '🚨 Dépassé' : util >= 80 ? '⚠️ Proche' : '✅ Normal', util === null ? '' : `${fmtQ(Math.max(0, plafond - qteCr))} ctn de marge`, util >= 100 ? 'crit' : util >= 80 ? 'warn' : 'ok'),
      kpi('Créances en retard', fmtN(nbRetard), `${fmtF(S(retard, 'solde'))}`, nbRetard ? 'crit' : 'ok'),
      kpi(`Retard de plus de ${seuil} jours`, fmtN(nbSeuil), 'crédits à relancer en priorité', nbSeuil ? 'crit' : 'ok'),
      kpi('Clients débiteurs actifs', fmtN(debiteurs), 'clients avec un solde à rembourser'),
    ].join('');
    graphiques(root, C, dep, du, au);
    new Table({ title: `Dépôts — ${libPer()}`, rows: dep, sort: { k: 'nom', dir: 1 }, pageSize: 20, exportable: true, onRow: (r) => { P().depot = r.id; App.go('depots'); },
      foot: (c, rs) => (c.k === 'nom' ? '<b>Total</b>' : ['siTotal', 'recuFoods', 'recuRice', 'recuGross', 'recuTransfert', 'transfere', 'venduReseau', 'stockTotal', 'enCours', 'resteFood', 'resteRice'].includes(c.k) ? `<b>${fmtN(rs.reduce((s, r) => s + num(r[c.k]), 0))}</b>` : ''),
      cols: [{ k: 'nom', l: 'Dépôt', f: (r) => `<b>${esc(r.nom)}</b>${r.responsable ? `<br><small class="muted">${esc(r.responsable)}</small>` : ''}`, x: (r) => (r.responsable ? `${r.nom} · ${r.responsable}` : r.nom) }, { k: 'siTotal', l: 'Stock début', num: 1, f: (r) => fmtQ(r.siTotal) },
        { k: 'recuFoods', l: 'Reçu Oriba Food', num: 1, f: (r) => fmtQ(r.recuFoods) }, { k: 'recuRice', l: 'Reçu Oriba Rice', num: 1, f: (r) => fmtQ(r.recuRice) }, { k: 'recuGross', l: 'Reçu grossistes', num: 1, f: (r) => fmtQ(r.recuGross) },
        { k: 'recuTransfert', l: 'Reçu d’un dépôt', num: 1, f: (r) => fmtQ(r.recuTransfert) }, { k: 'transfere', l: 'Transféré à un dépôt', num: 1, f: (r) => (r.transfere ? `−${fmtQ(r.transfere)}` : fmtQ(0)) },
        { k: 'venduReseau', l: 'Vendu', num: 1, f: (r) => fmtQ(r.venduReseau) }, { k: 'stockTotal', l: 'Stock fin', num: 1, f: (r) => (r.stockTotal < 0 ? `<b class="t-crit">${fmtQ(r.stockTotal)}</b>` : `<b>${fmtQ(r.stockTotal)}</b>`) },
        { k: 'taux', l: 'Objectif du mois', num: 1, v: (r) => r.taux ?? -1, f: (r) => (r.objectif ? `${pct(r.taux)}<small class="muted">${fmtQ(r.venduMois)} / ${fmtQ(r.objectif)} ctn</small>` : '—'), x: (r) => (r.taux === null ? '' : Math.round(r.taux)) },
        { k: 'enCours', l: 'Crédits en cours (FCFA)', num: 1, f: (r) => (r.enRetard > 0 ? `<b class="t-crit">${fmtN(r.enCours)}</b>` : fmtN(r.enCours)) },
        { k: 'resteFood', l: 'À verser Oriba Food (FCFA)', num: 1, f: (r) => (r.resteFood > 0 ? `<b class="t-crit">${fmtN(r.resteFood)}</b>` : fmtN(r.resteFood)) },
        { k: 'resteRice', l: 'À verser Oriba Rice (FCFA)', num: 1, f: (r) => (r.resteRice > 0 ? `<b class="t-crit">${fmtN(r.resteRice)}</b>` : fmtN(r.resteRice)) }] }).mount($('#et', root));
    const vm = ventesParMarche(C, du, au), totM = vm.reduce((x, r) => x + r.total, 0) || 1;
    new Table({ title: `Ventes par marché — ${libPer()}`, rows: vm.map((r) => ({ ...r, nom: r.marche_id ? nm.marche(r.marche_id) : 'Marché non renseigné', zone: r.equipes.map((e) => nm.equipe(e)).join(', '), part: (r.total / totM) * 100 })),
      sort: { k: 'total', dir: -1 }, pageSize: 40, exportable: true, empty: 'Aucune vente sur la période.',
      foot: (c, rs) => (c.k === 'nom' ? '<b>Total</b>' : ['cartons', 'comptant', 'credit', 'total', 'nb'].includes(c.k) ? `<b>${fmtN(rs.reduce((x, r) => x + num(r[c.k]), 0))}</b>` : ''),
      cols: [{ k: 'nom', l: 'Marché', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'zone', l: 'Équipe' }, { k: 'vendeurs', l: 'Vendu par', v: (r) => r.vendeurs.join(', '), f: (r) => esc(r.vendeurs.join(', ')) },
        { k: 'nb', l: 'Ventes', num: 1, f: (r) => fmtN(r.nb) }, { k: 'cartons', l: 'Cartons', num: 1, f: (r) => fmtQ(r.cartons) }, { k: 'comptant', l: 'Comptant (FCFA)', num: 1, f: (r) => fmtN(r.comptant) },
        { k: 'credit', l: 'Crédit (FCFA)', num: 1, f: (r) => fmtN(r.credit) }, { k: 'total', l: 'Total (FCFA)', num: 1, f: (r) => `<b>${fmtN(r.total)}</b>` }, { k: 'part', l: 'Part', num: 1, f: (r) => `${fmtN(r.part, 0)} %` }] }).mount($('#em', root));
    // Crédits à relancer : les plus en retard d'abord
    const rang = (c) => (c.statut === 'En retard' ? 0 : c.proche ? 1 : 2);
    const top = [...cr].sort((a, b) => rang(a) - rang(b) || b.joursRetard - a.joursRetard || b.solde - a.solde).slice(0, 6);
    $('#ec', root).innerHTML = `<header><h3>Ventes à crédit à relancer</h3>${cr.length ? '<a class="small" href="#credits">Voir tous les crédits</a>' : ''}</header>${top.length ? `<ul class="alertes">${top.map((c) => `<li class="${c.statut === 'En retard' ? 'crit' : c.proche ? 'warn' : ''}"><b>${esc(nm.client(c.client_id) || 'Client non précisé')}</b> doit ${fmtF(c.solde)} — ${c.statut === 'En retard' ? `en retard de ${c.joursRetard} jour(s)` : `échéance le ${fmtD(c.echeance)}`}<small class="muted"> · vendeur : ${esc(nm.agent(c.agent_id))}</small></li>`).join('')}</ul>` : '<p class="muted">Aucun crédit en cours.</p>'}`;
    // À surveiller : dépôts
    const alertes = [
      ...dep.filter((d) => d.reste > 0).sort((a, b) => b.reste - a.reste).map((d) => [`${d.nom} : ${fmtF(d.reste)} pas encore versés${d.resteFood > 0 && d.resteRice > 0 ? ` (Oriba Food ${fmtF(d.resteFood)} · Oriba Rice ${fmtF(d.resteRice)})` : d.resteRice > 0 ? ' à Oriba Rice' : ' à Oriba Food'}`, 'crit']),
      ...dep.filter((d) => C.stockConnu && d.stockTotal < 0).map((d) => [`${d.nom} : stock négatif (${fmtQ(d.stockTotal)} ctn) — vérifier les saisies`, 'warn']),
      ...dep.filter((d) => d.objectif && d.taux !== null && d.taux < 50 && au.slice(8, 10) >= '15').map((d) => [`${d.nom} : ${fmtN(d.taux, 0)} % de l’objectif du mois seulement`, 'warn']),
    ].slice(0, 6);
    $('#ea', root).innerHTML = `<header><h3>À surveiller</h3></header>${alertes.length ? `<ul class="alertes">${alertes.map(([t, c]) => `<li class="${c}">${esc(t)}</li>`).join('')}</ul>` : '<p class="muted">Rien à signaler.</p>'}`;
  };
  lierBarre(root, draw);
  draw();
}

// Graphiques du tableau de bord : ventes jour par jour (comptant, crédit, encaissements) et objectif du mois par dépôt
function graphiques(root, C, dep, du, au) {
  const pal = palette();
  const debut = du === au ? addDays(au, -13) : du;           // en vue « Jour » : les 14 derniers jours
  const jours = []; for (let d = debut; d <= au; d = addDays(d, 1)) jours.push(d);
  // Longue période : un point par mois au lieu d'un par jour
  const parMois = jours.length > 62, cle = (d) => (parMois ? d.slice(0, 7) : d);
  if (parMois) { const m = [...new Set(jours.map(cle))]; jours.length = 0; jours.push(...m); }
  const parJour = (l, f) => { const m = new Map(); for (const x of l) m.set(cle(f(x).date), (m.get(cle(f(x).date)) || 0) + num(f(x).val)); return m; };
  const vC = parJour(C.ventes.filter((x) => x.v.mode === 'comptant' && x.v.date >= debut && x.v.date <= au), (x) => ({ date: x.v.date, val: x.montant }));
  const vK = parJour(C.ventes.filter((x) => x.v.mode === 'credit' && x.v.date >= debut && x.v.date <= au), (x) => ({ date: x.v.date, val: x.montant }));
  const enc = parJour(C.rembs.filter((r) => r.date >= debut && r.date <= au), (r) => ({ date: r.date, val: r.montant }));
  const mois = au.slice(0, 7);
  const dObj = dep.filter((d) => d.objectif > 0 || d.venduMois > 0).sort((a, b) => (b.objectif || 0) - (a.objectif || 0));
  const vide = !vC.size && !vK.size && !enc.size && !dObj.length;
  $('#eg', root).hidden = vide; $('#eg-vide', root).hidden = !vide;
  if (vide) return;
  $('#eg-l', root).textContent = `du ${fmtD(debut)} au ${fmtD(au)}`;
  chart($('#g-ventes', root), { type: 'bar', stacked: true, data: { labels: jours.map((d) => (parMois ? `${['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][+d.slice(5, 7) - 1]} ${d.slice(2, 4)}` : fmtD(d).slice(0, 5))), datasets: [
    { label: 'Ventes au comptant', data: jours.map((d) => vC.get(d) || 0), backgroundColor: pal[0], borderRadius: 3, stack: 'v' },
    { label: 'Ventes à crédit', data: jours.map((d) => vK.get(d) || 0), backgroundColor: pal[2], borderRadius: 3, stack: 'v' },
    { type: 'line', label: 'Encaissements sur crédits', data: jours.map((d) => enc.get(d) || 0), borderColor: pal[1], backgroundColor: pal[1], tension: 0.3, pointRadius: 2, borderWidth: 2, stack: 'e' }] } });
  const h = Math.min(420, Math.max(260, dObj.length * 30 + 60)) + 'px';
  $('#g-obj', root).parentElement.style.height = h; $('#g-ventes', root).parentElement.style.height = h;
  chart($('#g-obj', root), { type: 'bar', horizontal: true, money: false, data: { labels: dObj.map((d) => d.nom.replace(/^Dépôt /, '')), datasets: [
    { label: `Vendu (${mois.slice(5)}/${mois.slice(0, 4)})`, data: dObj.map((d) => d.venduMois), backgroundColor: pal[0], borderRadius: 3 },
    { label: 'Objectif du mois', data: dObj.map((d) => d.objectif), backgroundColor: pal[3] || '#c9c2dd', borderRadius: 3 }] },
    tip: (ctx) => `${ctx.dataset.label} : ${fmtQ(ctx.parsed.x)} ctn` });
}

// ---------------------------------------------------------------- Un dépôt et ses agents
export function renderDepotsEssentiel(root) {
  const p = P();
  const depots = (App.D.agents || []).filter((a) => a.role_circuit === 'depot' && a.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  if (!depots.some((d) => d.id === p.depot)) p.depot = depots[0]?.id || '';
  const can = App.can('circuit', 'creer');
  root.innerHTML = pageHead('Dépôts', 'Cliquez sur un dépôt pour voir ses agents. Chiffres de la période choisie.',
    can && p.depot ? `<button class="btn primary" id="d-appro">${icon('plus')} Approvisionner un dépôt</button><button class="btn" id="d-remise">${icon('plus')} Remettre à un agent</button><button class="btn" id="d-transf">${icon('truck')} Transférer entre dépôts</button>` : '') +
    (depots.length ? '' : noteVide()) +
    `<article class="card tb-sec bleu" id="jr-c"><header><h3>Journée des dépôts</h3><label class="ff"><span>Journée du</span><input type="date" id="jr-date" value="${p.jour || today()}" max="${today()}"></label></header>
      <p class="muted small">Pour chaque dépôt (chef d’équipe et ses agents) : cartons pris, remis, vendus, et argent à remettre à la caisse d’Oriba Food et d’Oriba Rice ce jour-là. Cliquez sur un dépôt pour voir le détail de ses opérations. « À remettre » : ventes au comptant du jour à verser à la caisse ; « Reste dû » : cumul non encore versé. Une opération devient définitive à la fin de sa journée de saisie.</p>
      <div id="jr"></div><h4 class="sec" id="jo-t"></h4><div id="jo"></div></article>` + barre() +
    '<section class="zgrid" id="dz"></section><article class="card" id="dt-c"><header><h3 id="dt-t">Agents du dépôt</h3></header><div id="dt"></div></article>';
  $('#d-appro', root)?.addEventListener('click', () => formMouvement('prise', p.depot));
  $('#d-remise', root)?.addEventListener('click', () => formMouvement('dispatch', p.depot));
  $('#d-transf', root)?.addEventListener('click', () => formMouvement('transfert', p.depot));
  const draw = () => {
    $('.per-lib', root).textContent = libPer();
    if (!p.depot) return;
    const [du, au] = bornes(), C = contexte(App.D, App.I);
    const tous = situationDepots(C, du, au);
    const d = tous.find((x) => x.id === p.depot); if (!d) return;
    // Une carte par dépôt : reçu, ventes, stock final, reste à verser, créances, clients
    const ventesDe = (x) => { const ids = C.reseau(x.id); return C.ventes.filter((v) => ids.has(v.v.agent_id)); };
    const cartes = tous.map((x) => {
      const vs = ventesDe(x), vp = vs.filter((v) => v.v.date >= du && v.v.date <= au);
      const clients = new Set(vs.map((v) => v.v.client_id).filter(Boolean)).size;
      const nbRetard = creditsCircuit(C, au).filter((c) => C.reseau(x.id).has(c.agent_id) && c.statut === 'En retard').length;
      return { ...x, ca: vp.reduce((s2, v) => s2 + num(v.montant), 0), clients, nbRetard };
    });
    cartes.sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }));
    const maxCA = Math.max(1, ...cartes.map((x) => x.ca));
    $('#dz', root).innerHTML = cartes.map((x, i) => `<button class="zcard ${x.id === p.depot ? 'on' : ''}" data-d="${x.id}" style="--zc: var(--c${(i % 8) + 1})">
      <span class="zc-h"><b>${esc(x.nom)}${x.responsable ? `<small class="muted"> · ${esc(x.responsable)}</small>` : ''}</b>${x.nbRetard ? pill(`${x.nbRetard} crédit(s) en retard`, 'crit') : ''}</span>
      <span class="zc-ca">${fmtF(x.ca)} <small class="muted">de ventes</small></span><span class="bar" title="Ventes de la période"><i style="width:${(x.ca / maxCA) * 100}%"></i></span>
      <span class="zc-grid">
        <span><small>Reçu par le dépôt</small><b>${fmtQ(x.recu + x.recuTransfert)} ctn</b></span><span><small>Ventes</small><b>${fmtQ(x.venduReseau)} ctn</b></span>
        <span><small>Stock final</small><b class="${C.stockConnu && x.stockTotal < 0 ? 't-crit' : ''}">${C.stockConnu ? `${fmtQ(x.stockTotal)} ctn` : '—'}</b></span><span><small>Reste dû Oriba Food</small><b class="${x.resteFood > 0 ? 't-crit' : ''}">${fmtF(x.resteFood)}</b></span><span><small>Reste dû Oriba Rice</small><b class="${x.resteRice > 0 ? 't-crit' : ''}">${fmtF(x.resteRice)}</b></span>
        <span><small>Créances</small><b class="${x.enRetard > 0 ? 't-crit' : ''}">${fmtF(x.enCours)}</b></span><span><small>Clients</small><b>${fmtN(x.clients)}</b></span>
      </span></button>`).join('');
    $$('#dz [data-d]', root).forEach((b) => b.addEventListener('click', () => { p.depot = b.dataset.d; draw(); $('#dt-c', root).scrollIntoView({ behavior: 'smooth', block: 'start' }); }));
    $('#dt-t', root).textContent = `Agents de ${d.nom} — ${libPer()}`;
    const lignes = [{ ...d, nom: d.responsable ? `${d.responsable} (chef d’équipe)` : `${d.nom} (vente directe)`, recu: d.recu + d.recuTransfert, si: d.si, sf: d.sf, fonction: 'Dépôt — chef d’équipe', _depot: true,
      objectif: d.objPropre, venduMois: d.venduMoisPropre, taux: d.objPropre > 0 ? (d.venduMoisPropre / d.objPropre) * 100 : null }, ...d.sousAgents];
    new Table({ title: `Agents — ${d.nom}`, rows: lignes, sort: { k: 'objectif', dir: -1 }, pageSize: 30,
      foot: (c, rs) => (c.k === 'nom' ? '<b>Total</b>' : ['si', 'vc', 'vk', 'sf', 'objectif', 'venduMois', 'enCours'].includes(c.k) ? `<b>${fmtN(rs.reduce((s, r) => s + num(r[c.k]), 0))}</b>` : ''),
      cols: [{ k: 'nom', l: 'Agent' }, { k: 'fonction', l: 'Fonction' }, { k: 'marche', l: 'Marché', v: (r) => (r.marche_id ? nm.marche(r.marche_id) : ''), f: (r) => (r.marche_id ? esc(nm.marche(r.marche_id)) : '<span class="muted">—</span>') }, { k: 'si', l: 'Stock début', num: 1, f: (r) => fmtQ(r.si) }, { k: 'recu', l: 'Reçu', num: 1, f: (r) => fmtQ(r.recu) + (r._depot ? ' <small class="muted">(fournisseurs et autres dépôts)</small>' : ' <small class="muted">(du dépôt)</small>') },
        { k: 'vc', l: 'Vendu comptant', num: 1, f: (r) => fmtQ(r.vc) }, { k: 'vk', l: 'Vendu crédit', num: 1, f: (r) => fmtQ(r.vk) }, { k: 'sf', l: 'Stock fin', num: 1, f: (r) => (r.sf < 0 ? `<b class="t-crit">${fmtQ(r.sf)}</b>` : `<b>${fmtQ(r.sf)}</b>`) },
        { k: 'objectif', l: 'Objectif du mois', num: 1, f: (r) => (r.objectif ? fmtQ(r.objectif) : '—') }, { k: 'venduMois', l: 'Vendu du mois', num: 1, f: (r) => fmtQ(r.venduMois) },
        { k: 'taux', l: 'Réalisé', num: 1, v: (r) => r.taux ?? -1, f: (r) => pct(r.taux) }, { k: 'enCours', l: 'Crédits en cours (FCFA)', num: 1, f: (r) => (r.enRetard > 0 ? `<b class="t-crit">${fmtN(r.enCours)}</b>` : fmtN(r.enCours)) }] }).mount($('#dt', root));
  };
  const drawJour = () => {
    const j = p.jour || today(), C = contexte(App.D, App.I);
    const tous = situationDepots(C, j, j);
    const ops = (d) => operationsDepot(C, d.id, j);
    const rows = tous.map((d) => ({ ...d, nbOps: ops(d).length, pris: round2(d.recu), versFood: d.verseFood, versRice: d.verseRice })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { numeric: true }));
    const S = (k) => (c, rs) => (c.k === 'nom' ? '<b>Total</b>' : k.includes(c.k) ? `<b>${fmtN(rs.reduce((x, r) => x + num(r[c.k]), 0))}</b>` : '');
    new Table({ title: `Journée des dépôts du ${fmtD(j)}`, rows, sort: { k: 'nom', dir: 1 }, pageSize: 40, onRow: (r) => { p.depot = r.id; drawOps(); draw(); },
      foot: S(['pris', 'disp', 'vcReseau', 'vkReseau', 'aVerserFood', 'aVerserRice', 'verse', 'resteFood', 'resteRice', 'nbOps']),
      cols: [{ k: 'nom', l: 'Dépôt', v: (r) => r.nom + (r.responsable ? ` · ${r.responsable}` : ''), f: (r) => `<b>${esc(r.nom)}</b>${r.responsable ? `<br><small class="muted">${esc(r.responsable)}</small>` : ''}` },
        { k: 'pris', l: 'Cartons pris', num: 1, x: (r) => r.pris, f: (r) => `${r.pris ? `<b>${fmtQ(r.pris)}</b>` : '0'}${[r.recuFoods && `Food ${fmtQ(r.recuFoods)}`, r.recuRice && `Rice ${fmtQ(r.recuRice)}`, r.recuGross && `grossiste ${fmtQ(r.recuGross)}`, r.recuTransfert && `+${fmtQ(r.recuTransfert)} d’un dépôt`, r.transfere && `−${fmtQ(r.transfere)} vers un dépôt`].filter(Boolean).map((t) => `<br><small class="muted">${t}</small>`).join('')}` },
        { k: 'disp', l: 'Remis agents', num: 1, f: (r) => fmtQ(r.disp) },
        { k: 'vcReseau', l: 'Vendus cpt', num: 1, f: (r) => fmtQ(r.vcReseau) }, { k: 'vkReseau', l: 'Vendus crédit', num: 1, f: (r) => fmtQ(r.vkReseau) },
        { k: 'aVerserFood', l: 'À remettre Food', num: 1, f: (r) => (r.aVerserFood ? `<b>${fmtN(r.aVerserFood)}</b>` : '0') },
        { k: 'aVerserRice', l: 'À remettre Rice', num: 1, f: (r) => (r.aVerserRice ? `<b>${fmtN(r.aVerserRice)}</b>` : '0') },
        { k: 'verse', l: 'Versé', num: 1, f: (r) => fmtN(r.verse) },
        { k: 'resteFood', l: 'Reste dû Food', num: 1, f: (r) => (r.resteFood > 0 ? `<b class="t-crit">${fmtN(r.resteFood)}</b>` : fmtN(r.resteFood)) },
        { k: 'resteRice', l: 'Reste dû Rice', num: 1, f: (r) => (r.resteRice > 0 ? `<b class="t-crit">${fmtN(r.resteRice)}</b>` : fmtN(r.resteRice)) },
        { k: 'nbOps', l: 'Opér.', num: 1, f: (r) => (r.nbOps ? `<b>${r.nbOps}</b>` : '<span class="muted">0</span>') }] }).mount($('#jr', root));
    drawOps();
  };
  const drawOps = () => {
    const j = p.jour || today(), C = contexte(App.D, App.I), d = (App.D.agents || []).find((a) => a.id === p.depot);
    if (!d) { $('#jo-t', root).textContent = ''; $('#jo', root).innerHTML = ''; return; }
    $('#jo-t', root).textContent = `Opérations du ${fmtD(j)} — ${d.nom}${d.responsable ? ` · ${d.responsable}` : ''}`;
    new Table({ title: `Opérations ${d.nom} ${j}`, rows: operationsDepot(C, d.id, j), sort: { k: 'ordre', dir: 1 }, pageSize: 50, empty: 'Aucune opération enregistrée ce jour pour ce dépôt.',
      cols: [{ k: 'ordre', l: 'Saisie', v: (r) => r.ordre, f: (r) => (r.heure ? esc(r.heure) : '—') }, { k: 'type', l: 'Opération', f: (r) => `<b>${esc(r.type)}</b>` }, { k: 'numero', l: 'N°' },
        { k: 'qui', l: 'Par' }, { k: 'detail', l: 'Détail' }, { k: 'cartons', l: 'Cartons', num: 1, f: (r) => (r.cartons ? fmtQ(r.cartons) : '') },
        { k: 'montant', l: 'Montant (FCFA)', num: 1, f: (r) => (r.montant ? fmtN(r.montant) : '') },
        { k: 'verrou', l: 'Statut', v: (r) => (r.verrou ? 'Définitive' : 'Modifiable aujourd’hui'), f: (r) => (r.verrou ? '🔒 Définitive' : '<span class="muted">Modifiable ce jour</span>') }] }).mount($('#jo', root));
  };
  $('#jr-date', root).addEventListener('change', (e) => { p.jour = e.target.value || today(); drawJour(); });
  lierBarre(root, draw);
  draw();
  drawJour();
}

// Toutes les opérations d'un dépôt (lui-même et ses agents) pour une journée, dans l'ordre de saisie
function operationsDepot(C, depotId, j) {
  const ids = C.reseau(depotId), out = [];
  const h = (iso) => { try { return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Niamey', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); } catch { return ''; } };
  const add = (row, o) => out.push({ id: row.id, ordre: row.created_at || '', heure: row.created_at ? h(row.created_at) : '', numero: row.numero || '', verrou: estVerrouille(row), ...o });
  const src = (m) => (m.grossiste_id ? `grossiste ${nm.grossiste(m.grossiste_id)}` : m.fournisseur || 'Oriba Food');
  for (const m of C.mv) {
    if (m.date !== j) continue;
    if (m.type === 'prise' && m.agent_id === depotId) add(m, { type: 'Cartons pris', qui: nm.agent(depotId), detail: `${nm.produit(m.produit_id)} · chez ${src(m)}${m.mode === 'credit' ? ' · à crédit' : ''}`, cartons: num(m.cartons), montant: num(m.montant) });
    else if (m.type === 'dispatch' && m.agent_id === depotId) add(m, { type: 'Remise à un agent', qui: nm.agent(m.sous_agent_id), detail: nm.produit(m.produit_id), cartons: num(m.cartons), montant: 0 });
    else if (m.type === 'transfert' && m.agent_id === depotId) add(m, { type: 'Transfert envoyé', qui: nm.agent(depotId), detail: `vers ${nm.agent(m.depot_dest_id)} · ${nm.produit(m.produit_id)}`, cartons: num(m.cartons), montant: 0 });
    else if (m.type === 'transfert' && m.depot_dest_id === depotId) add(m, { type: 'Transfert reçu', qui: nm.agent(m.agent_id), detail: `de ${nm.agent(m.agent_id)} · ${nm.produit(m.produit_id)}`, cartons: num(m.cartons), montant: 0 });
  }
  for (const x of C.ventes) if (x.v.date === j && ids.has(x.v.agent_id)) add(x.v, { type: x.v.mode === 'credit' ? 'Vente à crédit' : 'Vente au comptant', qui: nm.agent(x.v.agent_id), detail: `${nm.client(x.v.client_id)}${x.v.marche_id ? ` · ${nm.marche(x.v.marche_id)}` : ''}${x.v.mode === 'credit' && x.v.echeance ? ` · échéance ${fmtD(x.v.echeance)}` : ''}`, cartons: num(x.cartons), montant: num(x.montant) });
  for (const v of C.vers) if (v.date === j && v.objet === 'ventes_comptant' && ids.has(v.agent_id)) add(v, { type: 'Versement', qui: nm.agent(v.agent_id), detail: `${v.lieu === 'grossiste' ? `chez ${nm.grossiste(v.lieu_grossiste_id)}` : 'caisse'}${v.beneficiaire ? ` · pour ${v.beneficiaire}` : ''}`, cartons: 0, montant: num(v.montant) });
  for (const r of C.rembs) { const x = C.venteById.get(r.vente_id); if (r.date === j && x && ids.has(x.v.agent_id)) add(r, { type: 'Remboursement de crédit', qui: nm.agent(x.v.agent_id), detail: `${nm.client(x.v.client_id)} · vente ${x.v.numero || ''}`, cartons: 0, montant: num(r.montant) }); }
  return out;
}

// ---------------------------------------------------------------- Saisie rapide et import
export function renderSaisieRapide(root) {
  const can = App.can('circuit', 'creer');
  const tuile = (id, ic, t, sub, ok = can) => `<button class="card tuile" id="${id}" ${ok ? '' : 'disabled'}><span class="tuile-ic">${icon(ic)}</span><b>${t}</b><span class="muted small">${sub}</span></button>`;
  const fichier = (id, t, sub, ok) => (ok ? `<article class="card fichier"><h3>${t}</h3><p class="muted small">${sub}</p><div class="row-act"><button class="btn primary" id="${id}">${icon('upload')} Importer</button>${id === 'f-circ' ? `<button class="btn ghost" id="f-circ-mod">${icon('download')} Modèle</button>` : ''}</div></article>` : '');
  root.innerHTML = pageHead('Saisie et import', can ? 'Tout se saisit ici : une opération à la fois, ou les fichiers Excel du jour.' : 'Consultation seule : la saisie est réservée au Responsable Commercial.') +
    `<h2 class="sec-t">Saisir une opération</h2>
     <section class="tuiles">${tuile('s-vente', 'cash', 'Vente', 'Au comptant ou à crédit')}
      ${tuile('s-vers', 'wallet', 'Versement ou remboursement', 'Argent versé à la caisse ou chez le grossiste ; crédit remboursé')}
      ${tuile('s-appro', 'warehouse', 'Approvisionnement d’un dépôt', 'Cartons reçus d’Oriba Food, d’Oriba Rice ou d’un grossiste')}
      ${tuile('s-remise', 'users', 'Remise à un agent', 'Cartons donnés par le dépôt à un de ses agents')}
      ${tuile('s-transf', 'truck', 'Transfert entre dépôts', 'Cartons envoyés d’un dépôt à un autre')}</section>
     <h2 class="sec-t">Importer les fichiers Excel</h2>
     <section class="fichiers">${fichier('f-circ', 'Classeur du jour (dépôts)', 'Approvisionnements, remises, transferts, ventes, versements, dépenses, objectifs et budgets. Seules les nouvelles lignes sont ajoutées.', can)}
     ${fichier('f-tb', 'Fichiers « TB » des équipes', 'Ventes, crédits et remboursements des fichiers TB de chaque zone. Seules les nouvelles lignes sont ajoutées.', peutMettreAJour())}
     ${fichier('f-obj', 'Objectifs des agents', 'Fichier « Liste des agents et objectif de vente » (Agent, Équipe, Fonction, Objectif).', peutImporter('objectifs'))}</section>
     <p class="muted small">Imports plus rares (historiques, référentiels, dépenses, budgets…) : <a href="#saisie">Imports avancés</a>, dans « Autres modules ».</p>`;
  if (can) {
    $('#s-appro', root).addEventListener('click', () => formMouvement('prise'));
    $('#s-remise', root).addEventListener('click', () => formMouvement('dispatch'));
    $('#s-transf', root).addEventListener('click', () => formMouvement('transfert'));
    $('#s-vente', root).addEventListener('click', () => formVente());
    $('#s-vers', root).addEventListener('click', () => formVersement());
  }
  $('#f-circ', root)?.addEventListener('click', () => ouvrirImportCircuit());
  $('#f-circ-mod', root)?.addEventListener('click', () => modeleCircuit());
  $('#f-tb', root)?.addEventListener('click', () => ouvrirMiseAJour());
  $('#f-obj', root)?.addEventListener('click', () => ouvrirImport('objectifs', { mois: today().slice(0, 7) }));
}

// Vente simplifiée : un vendeur (dépôt ou agent), un produit, des cartons
export function formVente() {
  const agents = () => (App.D.agents || []).filter((a) => a.actif !== false);
  const vendeurs = () => agents().filter((a) => a.role_circuit).sort((a, b) => (nm.agent(a.depot_id || a.id) + a.nom).localeCompare(nm.agent(b.depot_id || b.id) + b.nom, 'fr'))
    .map((a) => ({ v: a.id, l: a.role_circuit === 'depot' ? `${a.nom} (vente directe du dépôt)` : `${a.nom} — ${nm.agent(a.depot_id)}`, noms: [a.nom, a.code] }));
  const clients = () => (App.D.clients || []).filter((c) => c.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((c) => ({ v: c.id, l: c.code ? `${c.nom} (${c.code})` : c.nom, noms: [c.nom, c.code] }));
  const depots = agents().filter((a) => a.role_circuit === 'depot').sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((a) => ({ v: a.id, l: a.nom }));
  const prixDe = (id) => { const a = agents().find((x) => x.id === id); const d = a?.role_circuit === 'depot' ? a : agents().find((x) => x.id === a?.depot_id); return d?.prix_carton ?? ''; };
  const prods = opts('produits');
  modal({ title: 'Nouvelle vente',
    body: `<form class="form" id="vf"><div class="grid2">
      ${field({ k: 'date', l: 'Date', t: 'date', req: 1 }, today())}
      ${field({ k: 'mode', l: 'Paiement', t: 'options', options: [{ v: 'comptant', l: 'Comptant' }, { v: 'credit', l: 'À crédit' }], empty: false })}
      ${comboField({ k: 'vendeur', l: 'Vendu par', req: 1, options: vendeurs(), placeholder: 'Choisir ou écrire le nom de l’agent' })}
      ${comboField({ k: 'client', l: 'Client (obligatoire à crédit)', options: clients(), placeholder: 'Choisir ou écrire le nom du client' })}
      <div data-newdep hidden class="span2">${field({ k: 'depot_nouveau', l: 'Dépôt de ce nouvel agent', t: 'options', options: depots, req: 1 })}</div>
      ${field({ k: 'produit_id', l: 'Produit', t: 'options', options: prods, req: 1 }, prods.find((o) => /dadi/i.test(o.l))?.v || prods[0]?.v)}
      ${field({ k: 'quantite', l: 'Cartons', t: 'number', req: 1, min: 0 })}
      ${field({ k: 'prix_unitaire', l: 'Prix du carton (FCFA)', t: 'number', req: 1, min: 0 })}
      <div data-ech hidden>${field({ k: 'echeance', l: 'Date de remboursement promise', t: 'date' }, addDays(today(), 7))}</div></div><p class="err" hidden></p></form>`,
    footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="vs">Enregistrer la vente</button>',
    onMount: (m, close) => {
      const v = (n) => $(`[name=${n}]`, m);
      const hint = (k, t) => { $(`[data-hint=${k}]`, m).textContent = t; };
      const majVendeur = () => {
        const r = comboLire(v('vendeur').value, vendeurs());
        $('[data-newdep]', m).hidden = !(r.texte && !r.id);
        hint('vendeur', r.texte && !r.id ? `Nouvel agent « ${r.texte} » : il sera ajouté à la liste, rattaché au dépôt choisi ci-dessous.` : '');
        const p = prixDe(r.id || v('depot_nouveau').value); if (p) v('prix_unitaire').value = p;
      };
      const majClient = () => { const r = comboLire(v('client').value, clients()); hint('client', r.texte && !r.id ? `Nouveau client « ${r.texte} » : il sera ajouté à la liste.` : ''); };
      v('vendeur').addEventListener('input', majVendeur); v('vendeur').addEventListener('change', majVendeur);
      v('depot_nouveau').addEventListener('change', majVendeur);
      v('client').addEventListener('input', majClient); v('client').addEventListener('change', majClient);
      v('mode').addEventListener('change', () => { $('[data-ech]', m).hidden = v('mode').value !== 'credit'; });
      $('#vs', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const d = readForm($('#vf', m));
        const ve = comboLire(d.vendeur, vendeurs()), cl = comboLire(d.client, clients());
        try {
          if (!ve.texte) throw new Error('Indiquez qui a vendu : choisissez dans la liste ou écrivez le nom.');
          if (d.mode === 'credit' && !cl.texte) throw new Error('Pour une vente à crédit, indiquez le client.');
          if (!ve.id && !d.depot_nouveau) throw new Error(`Choisissez le dépôt auquel rattacher le nouvel agent « ${ve.texte} ».`);
          if (!(Number(d.quantite) > 0)) throw new Error('Indiquez le nombre de cartons.');
          let agentId = ve.id, clientId = cl.id;
          // Nouveaux noms tapés à la main : ajoutés aux listes avant la vente
          if (!agentId) {
            const dep = agents().find((a) => a.id === d.depot_nouveau);
            agentId = (await App.api.call('ref.save', { table: 'agents', row: { nom: ve.texte, fonction: 'Agent commercial', role_circuit: 'sous_agent', depot_id: dep.id, equipe_id: dep.equipe_id || null, zone_id: dep.zone_id || null }, motif: 'Créé depuis la saisie d’une vente' })).row.id;
          }
          if (cl.texte && !clientId) clientId = (await App.api.call('ref.save', { table: 'clients', row: { nom: cl.texte, type: 'Boutique' }, motif: 'Créé depuis la saisie d’une vente' })).row.id;
          await App.act('vente.create', { vente: { date: d.date, mode: d.mode, agent_id: agentId, client_id: clientId, echeance: d.mode === 'credit' ? d.echeance : null }, lignes: [{ produit_id: d.produit_id, unite: 'carton', quantite: d.quantite, prix_unitaire: d.prix_unitaire }] },
            `Vente enregistrée.${!ve.id ? ` Agent « ${ve.texte} » ajouté.` : ''}${cl.texte && !cl.id ? ` Client « ${cl.texte} » ajouté.` : ''}`);
          close();
        } catch (e) { await App.refresh().catch(() => {}); showErr(m, e.message); }
      }));
    } });
}

// ---------------------------------------------------------------- Crédits à relancer
export function renderCreditsEssentiel(root) {
  const can = App.can('remboursements', 'creer');
  root.innerHTML = pageHead('Crédits à relancer', 'Clients qui doivent encore de l’argent : d’abord ceux en retard, puis ceux dont l’échéance approche.',
    can ? `<button class="btn primary" id="c-remb">${icon('plus')} Enregistrer un remboursement</button>` : '') + '<section class="kpis k4" id="ck"></section><article class="card" id="ct"></article>';
  $('#c-remb', root)?.addEventListener('click', () => formVersement());
  const C = contexte(App.D, App.I), cr = creditsCircuit(C, today(), { tous: true });
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
