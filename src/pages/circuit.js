// Circuit de distribution : usine Oriba Foods / Oriba Rice → grossistes → dépôts → agents → clients.
// Tableau de bord du jour, situation des dépôts et agents, grossistes par semaine, mouvements de stock et versements.
import { App, nm, opts, pageHead } from '../app.js';
import { esc, $, $$, fmtF, fmtN, fmtQ, fmtD, Table, modal, confirmBox, field, readForm, showErr, busy, toast, icon, pill } from '../lib/ui.js';
import { contexte, situationDepots, situationSous, grossistesSemaine, serie, creditsCircuit, lundi } from '../lib/circuit.js';
import { ouvrirImportCircuit, modeleCircuit } from '../lib/importCircuit.js';
import { refFormPublic } from './admin.js';
import { today, addDays, num } from '../../shared/logic.js';
import { CIRCUIT_TYPES, OBJETS_VERSEMENT, LIEUX_VERSEMENT } from '../../shared/schema.js';

// Date par défaut : aujourd'hui, ou le dernier jour d'activité du circuit s'il n'y a rien aujourd'hui
const dernierJour = () => [...(App.D.circuit_mvts || []), ...(App.D.versements || [])].map((m) => m.date).filter((d) => d <= today()).sort().pop() || today();
const F = () => (App.filters.circuit = App.filters.circuit || { date: dernierJour(), type: '', du: '', au: '' });
const kpi = (l, v, s = '', c = '') => `<div class="kpi static ${c}"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span>${s ? `<span class="kpi-s">${s}</span>` : ''}</div>`;
const ctn = (x) => `${fmtQ(x)} ctn`;
const peutSaisir = () => App.can('circuit', 'creer');
const vide = () => !(App.D.agents || []).some((a) => a.role_circuit === 'depot');

function barreDate(root, onChange, label = 'Date du rapport') {
  const f = F();
  return `<div class="filters"><label class="ff"><span>${label}</span><input type="date" id="c-date" value="${f.date}" max="${today()}"></label>
    <button class="btn ghost sm" id="c-prec" type="button" style="align-self:end">‹ Jour précédent</button><button class="btn ghost sm" id="c-suiv" type="button" style="align-self:end">Jour suivant ›</button><button class="btn ghost sm" id="c-auj" type="button" style="align-self:end">Aujourd’hui</button></div>`;
}
function lierDate(root, draw) {
  const f = F();
  const set = (d) => { if (d > today()) d = today(); f.date = d; $('#c-date', root).value = d; draw(); };
  $('#c-date', root).addEventListener('change', (e) => set(e.target.value || today()));
  $('#c-prec', root).addEventListener('click', () => set(addDays(f.date, -1)));
  $('#c-suiv', root).addEventListener('click', () => set(addDays(f.date, 1)));
  $('#c-auj', root).addEventListener('click', () => set(today()));
}
const actions = () => (peutSaisir() ? `<button class="btn ghost" id="c-imp">${icon('upload')} Importer le classeur du jour</button><button class="btn ghost" id="c-mod">${icon('download')} Modèle Excel</button>` : '');
function lierActions(root) {
  $('#c-imp', root)?.addEventListener('click', () => ouvrirImportCircuit());
  $('#c-mod', root)?.addEventListener('click', () => modeleCircuit());
}
const aide = () => (vide() ? `<div class="note warn">Aucun dépôt n’est encore déclaré. Importez le classeur du circuit (onglets Grossistes, Dépôts, Agents des dépôts…) ou déclarez le rôle de chaque agent dans Référentiels > Agents commerciaux (« Rôle dans le circuit »).</div>` : '');

// ---------------------------------------------------------------- Tableau de bord du circuit
export function renderCircuit(root) {
  root.innerHTML = pageHead('Tableau de bord du circuit', 'Grossistes → dépôts → agents → clients : stocks, ventes, caisse et crédits du jour choisi.', actions()) + aide() + barreDate(root) +
    `<section class="kpis" id="k1"></section><div class="grid g2"><article class="card"><header><h3>Les 7 derniers jours</h3></header><div id="s7"></div></article><article class="card"><header><h3>Par zone (dépôt) — jour choisi</h3></header><div id="pz"></div></article></div>
     <article class="card"><header><h3>Crédits à relancer</h3></header><div id="cr"></div></article>`;
  lierActions(root);
  const draw = () => {
    const d = F().date, C = contexte(App.D, App.I);
    const dep = situationDepots(C, d), ss = situationSous(C, d), gs = grossistesSemaine(C, lundi(d)), cr = creditsCircuit(C, d);
    const S = (l, k) => l.reduce((s, x) => s + num(x[k]), 0);
    const regJour = C.vers.filter((v) => v.objet === 'reglement_grossiste' && v.date === d).reduce((s, v) => s + num(v.montant), 0);
    const retard = cr.filter((c) => c.statut === 'En retard'), proches = cr.filter((c) => c.proche);
    const reste = S(dep, 'ecart');
    $('#k1', root).innerHTML = [
      kpi('Stock chez les grossistes', ctn(S(gs, 'sf')), 'fin de la semaine en cours'), kpi('Stock chez les dépôts', ctn(S(dep, 'sf')), 'fin de journée'), kpi('Stock chez les agents', ctn(S(ss, 'sf')), 'fin de journée'),
      kpi('Approvisionnement des dépôts', ctn(S(dep, 'recu')), 'Oriba Foods, Oriba Rice et grossistes'), kpi('Dispatché aux agents', ctn(S(dep, 'disp'))),
      kpi('Vendu comptant', ctn(S(dep, 'vc') + S(ss, 'vc')), 'agents + agents'), kpi('Vendu à crédit', ctn(S(dep, 'vk') + S(ss, 'vk')), 'agents + agents'),
      kpi('Ventes comptant à verser', fmtF(S(dep, 'aVerser'))), kpi('Versé', fmtF(S(dep, 'verse')), `dont ${fmtF(S(dep, 'verseGrossiste'))} chez les grossistes`), kpi('Reste à verser', fmtF(reste), '', reste > 0 ? 'crit' : 'ok'),
      kpi('Remboursements de crédits reçus', fmtF(S(dep, 'remb'))), kpi('Règlements des grossistes reçus', fmtF(regJour)),
      kpi('Crédits clients en cours', fmtF(S(cr, 'solde')), `${cr.length} crédit(s)`), kpi('Dont en retard', fmtF(S(retard, 'solde')), `${new Set(retard.map((c) => c.client_id)).size} client(s) à relancer`, retard.length ? 'crit' : ''),
      kpi('Échéance dans 2 jours ou moins', fmtN(proches.length), '', proches.length ? 'warn' : ''), kpi('Solde dû par les grossistes', fmtF(S(gs, 'solde')), `réglé cette semaine : ${fmtF(S(gs, 'regleSemaine'))}`),
    ].join('');
    const se = serie(C, d);
    new Table({ title: 'Circuit — 7 derniers jours', rows: se.map((r) => ({ ...r, id: r.date })), sort: { k: 'date', dir: 1 }, pageSize: 7, exportable: true,
      foot: (c, rs) => (c.k === 'date' ? '<b>Total</b>' : ['pris', 'disp', 'vc', 'vk'].includes(c.k) ? `<b>${fmtQ(rs.reduce((s, r) => s + r[c.k], 0))}</b>` : ['ca', 'verse'].includes(c.k) ? `<b>${fmtN(rs.reduce((s, r) => s + r[c.k], 0))}</b>` : ''),
      cols: [{ k: 'date', l: 'Date', f: (r) => fmtD(r.date) }, { k: 'pris', l: 'Pris (ctn)', num: 1, f: (r) => fmtQ(r.pris) }, { k: 'disp', l: 'Dispatché (ctn)', num: 1, f: (r) => fmtQ(r.disp) },
        { k: 'vc', l: 'Vendu comptant (ctn)', num: 1, f: (r) => fmtQ(r.vc) }, { k: 'vk', l: 'Vendu crédit (ctn)', num: 1, f: (r) => fmtQ(r.vk) }, { k: 'ca', l: 'Ventes comptant (FCFA)', num: 1, f: (r) => fmtN(r.ca) }, { k: 'verse', l: 'Versé (FCFA)', num: 1, f: (r) => fmtN(r.verse) }] }).mount($('#s7', root));
    new Table({ title: 'Circuit — par zone', rows: dep, sort: { k: 'zone', dir: 1 }, pageSize: 20, onRow: (r) => ficheDepot(r.id),
      cols: [{ k: 'zone', l: 'Zone', v: (r) => nm.equipe(r.equipe_id) }, { k: 'nom', l: 'Dépôt' }, { k: 'stock', l: 'Stock agent + agents (ctn)', num: 1, v: (r) => r.sf + r.stockSous, f: (r) => fmtQ(r.sf + r.stockSous) },
        { k: 'venduReseau', l: 'Vendu (ctn)', num: 1, f: (r) => fmtQ(r.venduReseau) }, { k: 'aVerser', l: 'À verser', num: 1, f: (r) => fmtN(r.aVerser) }, { k: 'verse', l: 'Versé', num: 1, f: (r) => fmtN(r.verse) },
        { k: 'ecart', l: 'Écart', num: 1, f: (r) => (r.ecart > 0 ? `<b class="t-crit">${fmtN(r.ecart)}</b>` : fmtN(r.ecart)) }] }).mount($('#pz', root));
    new Table({ title: 'Crédits à relancer', rows: cr.filter((c) => c.statut === 'En retard' || c.proche), sort: { k: 'joursRetard', dir: -1 }, pageSize: 10, empty: 'Aucun crédit en retard ni proche de l’échéance.',
      cols: [{ k: 'numero', l: 'Vente' }, { k: 'client', l: 'Client', v: (r) => nm.client(r.client_id) }, { k: 'vendeur', l: 'Vendeur', v: (r) => nm.agent(r.agent_id) }, { k: 'date', l: 'Vendu le', f: (r) => fmtD(r.date) },
        { k: 'echeance', l: 'Échéance', f: (r) => fmtD(r.echeance) }, { k: 'solde', l: 'Reste dû (FCFA)', num: 1, f: (r) => `<b>${fmtN(r.solde)}</b>` },
        { k: 'joursRetard', l: 'Statut', num: 1, f: (r) => (r.statut === 'En retard' ? pill(`En retard (${r.joursRetard} j)`, 'crit') : pill('Échéance proche', 'warn')) }] }).mount($('#cr', root));
  };
  lierDate(root, draw);
  draw();
}

// ---------------------------------------------------------------- Dépôts et agents
const COLS_STOCK = (dep) => [
  { k: 'si', l: 'Stock initial', num: 1, f: (r) => fmtQ(r.si) }, { k: 'recu', l: dep ? 'Approvisionné' : 'Reçu du dépôt', num: 1, f: (r) => fmtQ(r.recu) },
  ...(dep ? [{ k: 'disp', l: 'Dispatché aux agents', num: 1, f: (r) => fmtQ(r.disp) }] : []),
  { k: 'vc', l: 'Vendu comptant', num: 1, f: (r) => fmtQ(r.vc) }, { k: 'vk', l: 'Vendu crédit', num: 1, f: (r) => fmtQ(r.vk) },
  { k: 'sf', l: 'Stock final', num: 1, f: (r) => (r.sf < 0 ? `<b class="t-crit">${fmtQ(r.sf)}</b>` : `<b>${fmtQ(r.sf)}</b>`) },
];
const COLS_ARGENT = (dep) => [
  { k: 'aVerser', l: dep ? 'Ventes comptant du réseau (FCFA)' : 'Ventes comptant (FCFA)', num: 1, f: (r) => fmtN(r.aVerser) }, { k: 'verse', l: dep ? 'Versé (FCFA)' : 'Versé directement (FCFA)', num: 1, f: (r) => fmtN(r.verse) },
  ...(dep ? [{ k: 'verseGrossiste', l: 'dont chez le grossiste', num: 1, f: (r) => fmtN(r.verseGrossiste) }, { k: 'ecart', l: 'Reste à verser', num: 1, f: (r) => (r.ecart > 0 ? `<b class="t-crit">${fmtN(r.ecart)}</b>` : fmtN(r.ecart)) }, { k: 'remb', l: 'Remboursements reçus', num: 1, f: (r) => fmtN(r.remb) }] : []),
  { k: 'enCours', l: 'Crédits en cours', num: 1, f: (r) => fmtN(r.enCours) }, { k: 'enRetard', l: 'Dont en retard', num: 1, f: (r) => (r.enRetard > 0 ? `<b class="t-crit">${fmtN(r.enRetard)}</b>` : fmtN(r.enRetard)) },
];
const foot = (keys) => (c, rs) => (c.k === 'nom' ? '<b>Total</b>' : keys.includes(c.k) ? `<b>${fmtN(rs.reduce((s, r) => s + num(r[c.k]), 0), 2)}</b>` : '');
const KS = ['si', 'recu', 'disp', 'vc', 'vk', 'sf', 'stockSous', 'aVerser', 'verse', 'verseGrossiste', 'ecart', 'remb', 'enCours', 'enRetard'];

export function renderDepots(root) {
  root.innerHTML = pageHead('Dépôts et agents', 'Chaque dépôt s’approvisionne chez Oriba Foods, Oriba Rice ou un grossiste et remet les cartons à ses agents. Cliquez sur un dépôt pour voir ses agents.', actions()) + aide() + barreDate(root) +
    '<article class="card"><header><h3>Dépôts — jour choisi (cartons et FCFA)</h3></header><div id="td"></div></article><article class="card"><header><h3>Agents des dépôts — jour choisi</h3></header><div id="ts"></div></article>';
  lierActions(root);
  const draw = () => {
    const d = F().date, C = contexte(App.D, App.I);
    new Table({ title: `Dépôts au ${fmtD(d)}`, rows: situationDepots(C, d), sort: { k: 'zone', dir: 1 }, pageSize: 20, onRow: (r) => ficheDepot(r.id), foot: foot(KS), meta: () => `Date : ${fmtD(d)}`,
      cols: [{ k: 'zone', l: 'Zone', v: (r) => nm.equipe(r.equipe_id) }, { k: 'nom', l: 'Dépôt' }, ...COLS_STOCK(true), { k: 'stockSous', l: 'Stock chez ses agents', num: 1, f: (r) => fmtQ(r.stockSous) }, ...COLS_ARGENT(true)] }).mount($('#td', root));
    new Table({ title: `Agents des dépôts au ${fmtD(d)}`, rows: situationSous(C, d), sort: { k: 'depot', dir: 1 }, pageSize: 30, foot: foot(KS), meta: () => `Date : ${fmtD(d)}`,
      cols: [{ k: 'nom', l: 'Agent' }, { k: 'depot', l: 'Dépôt', v: (r) => nm.agent(r.depot_id) }, ...COLS_STOCK(false), ...COLS_ARGENT(false)] }).mount($('#ts', root));
  };
  lierDate(root, draw);
  draw();
}

function ficheDepot(id) {
  const d = F().date, C = contexte(App.D, App.I);
  const r = situationDepots(C, d).find((x) => x.id === id); if (!r) return;
  modal({ title: `${r.nom} — ${nm.equipe(r.equipe_id)} — ${fmtD(d)}`, wide: true,
    body: `<section class="kpis sm">${[kpi('Stock initial', ctn(r.si)), kpi('Approvisionné', ctn(r.recu)), kpi('Dispatché', ctn(r.disp)), kpi('Vendu (agent)', ctn(r.vc + r.vk)), kpi('Stock final agent', ctn(r.sf)), kpi('Stock chez ses agents', ctn(r.stockSous)),
      kpi('À verser (réseau)', fmtF(r.aVerser)), kpi('Versé', fmtF(r.verse)), kpi('Reste à verser', fmtF(r.ecart), '', r.ecart > 0 ? 'crit' : 'ok'), kpi('Crédits en cours', fmtF(r.enCours), r.enRetard ? `dont ${fmtF(r.enRetard)} en retard` : '', r.enRetard ? 'crit' : '')].join('')}</section><h4 class="form-t">Ses agents</h4><div id="fs"></div>` });
  new Table({ title: `Agents des dépôts de ${r.nom}`, rows: r.sousAgents, sort: { k: 'nom', dir: 1 }, pageSize: 20, foot: foot(KS), empty: 'Aucun agent rattaché.', cols: [{ k: 'nom', l: 'Agent' }, ...COLS_STOCK(false), ...COLS_ARGENT(false)] }).mount($('#fs'));
}

// ---------------------------------------------------------------- Grossistes
export function renderGrossistes(root) {
  const can = App.can('referentiels', 'modifier');
  root.innerHTML = pageHead('Grossistes', 'Stock de chaque grossiste semaine par semaine (approvisionnements de l’usine ou d’Oriba Rice, cartons pris par les agents) et montant dû à Oriba.',
    `${actions()}${can ? `<button class="btn primary" id="g-new">${icon('plus')} Nouveau grossiste</button>` : ''}`) + barreDate(root, null, 'Semaine contenant le') + '<section class="kpis" id="gk"></section><article class="card" id="gt"></article>';
  lierActions(root);
  $('#g-new', root)?.addEventListener('click', () => refFormPublic('grossistes'));
  const draw = () => {
    const w0 = lundi(F().date), C = contexte(App.D, App.I), rows = grossistesSemaine(C, w0);
    const S = (k) => rows.reduce((s, x) => s + num(x[k]), 0);
    $('#gk', root).innerHTML = [kpi('Semaine', `${fmtD(w0)} → ${fmtD(addDays(w0, 6))}`), kpi('Stock final', ctn(S('sf'))), kpi('Reçu (usine / Oriba Rice)', `${fmtQ(S('usine'))} / ${fmtQ(S('rice'))} ctn`), kpi('Vendu aux agents', ctn(S('pc') + S('pk')), `dont ${fmtQ(S('pk'))} à crédit`), kpi('Solde dû à Oriba', fmtF(S('solde')), `réglé cette semaine : ${fmtF(S('regleSemaine'))}`, S('solde') > 0 ? 'warn' : '')].join('');
    new Table({ title: `Grossistes — semaine du ${fmtD(w0)}`, rows, sort: { k: 'nom', dir: 1 }, pageSize: 30, foot: foot(['si', 'usine', 'rice', 'pc', 'pk', 'sf', 'valeur', 'regle', 'solde', 'regleSemaine', 'recuAgents']), meta: () => `Semaine du ${fmtD(w0)} au ${fmtD(addDays(w0, 6))}`,
      empty: 'Aucun grossiste : ajoutez-les ou importez le classeur du circuit.',
      cols: [{ k: 'code', l: 'Code' }, { k: 'nom', l: 'Grossiste' }, { k: 'localite', l: 'Localité' }, { k: 'si', l: 'Stock initial semaine', num: 1, f: (r) => fmtQ(r.si) }, { k: 'usine', l: 'Reçu de l’usine', num: 1, f: (r) => fmtQ(r.usine) }, { k: 'rice', l: 'Reçu d’Oriba Rice', num: 1, f: (r) => fmtQ(r.rice) },
        { k: 'pc', l: 'Vendu aux agents comptant', num: 1, f: (r) => fmtQ(r.pc) }, { k: 'pk', l: 'Vendu aux agents à crédit', num: 1, f: (r) => fmtQ(r.pk) }, { k: 'sf', l: 'Stock final semaine', num: 1, f: (r) => (r.sf < 0 ? `<b class="t-crit">${fmtQ(r.sf)}</b>` : `<b>${fmtQ(r.sf)}</b>`) },
        { k: 'valeur', l: 'Valeur reçue cumulée (FCFA)', num: 1, f: (r) => fmtN(r.valeur) }, { k: 'regle', l: 'Réglé cumulé (FCFA)', num: 1, f: (r) => fmtN(r.regle) }, { k: 'solde', l: 'Solde dû à Oriba (FCFA)', num: 1, f: (r) => `<b>${fmtN(r.solde)}</b>` },
        { k: 'regleSemaine', l: 'Réglé cette semaine', num: 1, f: (r) => fmtN(r.regleSemaine) }, { k: 'recuAgents', l: 'Versements d’agents reçus', num: 1, f: (r) => fmtN(r.recuAgents) }] }).mount($('#gt', root));
  };
  lierDate(root, draw);
  draw();
}

// ---------------------------------------------------------------- Mouvements de stock
const libType = { appro: 'Appro. grossiste', prise: 'Appro. dépôt', dispatch: 'Remise à un agent' };
export function renderMouvements(root) {
  const f = F();
  root.innerHTML = pageHead('Mouvements de stock du circuit', 'Approvisionnements des grossistes, prises des dépôts chez les grossistes et dispatch aux agents.',
    `${actions()}${peutSaisir() ? `<button class="btn primary" data-n="prise">${icon('plus')} Approvisionnement d’un dépôt</button><button class="btn" data-n="dispatch">${icon('plus')} Remise à un agent</button><button class="btn" data-n="appro">${icon('plus')} Approvisionnement d’un grossiste</button>` : ''}`) + aide() +
    `<div class="filters"><label class="ff"><span>Type</span><select id="m-type"><option value="">Tous</option>${Object.entries(libType).map(([k, l]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
     <label class="ff"><span>Du</span><input type="date" id="m-du" value="${f.du}"></label><label class="ff"><span>Au</span><input type="date" id="m-au" value="${f.au}"></label>
     <label class="chk" style="align-self:end"><input type="checkbox" id="m-ann" ${f.annules ? 'checked' : ''}> <span>Afficher les annulés</span></label></div><article class="card" id="mt"></article>`;
  lierActions(root);
  $$('[data-n]', root).forEach((b) => b.addEventListener('click', () => formMouvement(b.dataset.n)));
  const draw = () => {
    const rows = (App.D.circuit_mvts || []).filter((m) => (!f.type || m.type === f.type) && (!f.du || m.date >= f.du) && (!f.au || m.date <= f.au) && (f.annules || m.statut !== 'annule'));
    new Table({ title: 'Mouvements du circuit', rows, sort: { k: 'date', dir: -1 }, pageSize: 30, onRow: (r) => ficheMouvement(r),
      foot: (c, rs) => (c.k === 'cartons' ? `<b>${fmtQ(rs.reduce((s, r) => s + num(r.cartons), 0))}</b>` : c.k === 'montant' ? `<b>${fmtN(rs.reduce((s, r) => s + num(r.montant), 0))}</b>` : ''),
      cols: [{ k: 'numero', l: 'N°' }, { k: 'date', l: 'Date', f: (r) => fmtD(r.date) }, { k: 'type', l: 'Type', v: (r) => libType[r.type] }, { k: 'grossiste', l: 'Grossiste', v: (r) => (r.grossiste_id ? nm.grossiste(r.grossiste_id) : '') },
        { k: 'agent', l: 'Dépôt', v: (r) => (r.agent_id ? nm.agent(r.agent_id) : '') }, { k: 'sous', l: 'Agent', v: (r) => (r.sous_agent_id ? nm.agent(r.sous_agent_id) : '') }, { k: 'produit', l: 'Produit', v: (r) => nm.produit(r.produit_id) },
        { k: 'cartons', l: 'Cartons', num: 1, f: (r) => fmtQ(r.cartons) }, { k: 'prix', l: 'Prix', num: 1, f: (r) => (r.prix === null ? '—' : fmtN(r.prix)) }, { k: 'montant', l: 'Montant (FCFA)', num: 1, f: (r) => (r.montant === null ? '—' : fmtN(r.montant)) },
        { k: 'detail', l: 'Source / mode', v: (r) => (r.type === 'appro' ? r.fournisseur : r.type === 'prise' ? `${r.grossiste_id ? 'Grossiste' : r.fournisseur || ''} · ${r.mode === 'credit' ? 'Crédit' : 'Comptant'}` : '') },
        { k: 'statut', l: 'Statut', v: (r) => (r.statut === 'annule' ? 'Annulé' : 'Valide'), f: (r) => (r.statut === 'annule' ? pill('Annulé', 'mute') : pill('Valide', 'ok')) }] }).mount($('#mt', root));
  };
  const bind = (id, k, ev = 'change') => $(id, root).addEventListener(ev, (e) => { f[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; draw(); });
  bind('#m-type', 'type'); bind('#m-du', 'du'); bind('#m-au', 'au'); bind('#m-ann', 'annules');
  draw();
}

const optsAgents = (role, depot) => (App.D.agents || []).filter((a) => a.actif !== false && a.role_circuit === role && (!depot || a.depot_id === depot)).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((a) => ({ v: a.id, l: `${a.nom}${a.equipe_id ? ' — ' + nm.equipe(a.equipe_id) : ''}` }));
const optsGrossistes = () => (App.D.grossistes || []).filter((g) => g.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((g) => ({ v: g.id, l: `${g.nom}${g.localite ? ' — ' + g.localite : ''}` }));

export function formMouvement(type, depotId = '') {
  const T = { appro: 'Approvisionnement d’un grossiste', prise: 'Approvisionnement d’un dépôt', dispatch: 'Remise de cartons à un agent du dépôt' }[type];
  const prixDepot = (id) => (App.D.agents || []).find((a) => a.id === id)?.prix_carton ?? '';
  const dernierPrix = (t2) => [...(App.D.circuit_mvts || [])].filter((m) => m.type === t2 && m.prix !== null && m.statut !== 'annule').sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]?.prix ?? '';
  modal({ title: T,
    body: `<form class="form" id="mf"><div class="grid2">
      ${field({ k: 'date', l: 'Date', t: 'date', req: 1 }, today())}
      ${type !== 'appro' ? field({ k: 'agent_id', l: 'Dépôt', t: 'options', options: optsAgents('depot'), req: 1 }, depotId) : ''}
      ${type === 'prise' ? field({ k: 'source', l: 'Pris chez', t: 'options', options: [{ v: 'Oriba Foods', l: 'Oriba Foods' }, { v: 'Oriba Rice', l: 'Oriba Rice' }, { v: 'grossiste', l: 'Un grossiste' }], empty: false }) : ''}
      ${type !== 'dispatch' ? `<div data-gr ${type === 'prise' ? 'hidden' : ''}>${field({ k: 'grossiste_id', l: 'Grossiste', t: 'options', options: optsGrossistes(), req: 1 })}</div>` : ''}
      ${type === 'appro' ? field({ k: 'fournisseur', l: 'Fournisseur', t: 'options', options: [{ v: 'Oriba Foods', l: 'Oriba Foods' }, { v: 'Oriba Rice', l: 'Oriba Rice' }], empty: false }) : ''}
      ${type === 'dispatch' ? field({ k: 'sous_agent_id', l: 'Agent', t: 'options', options: [], req: 1 }) : ''}
      ${field({ k: 'produit_id', l: 'Produit', t: 'options', options: opts('produits'), req: 1 })}
      ${field({ k: 'cartons', l: 'Cartons', t: 'number', req: 1, min: 0 })}
      ${type !== 'dispatch' ? field({ k: 'prix', l: 'Prix du carton (FCFA)', t: 'number', min: 0 }, type === 'prise' && depotId ? prixDepot(depotId) || dernierPrix(type) : dernierPrix(type)) : ''}
      ${type === 'prise' ? field({ k: 'mode', l: 'Payé', t: 'options', options: [{ v: 'comptant', l: 'Comptant' }, { v: 'credit', l: 'À crédit' }], empty: false }) : ''}
      ${field({ k: 'observation', l: 'Observation', t: 'text', wide: 1 })}</div><p class="err" hidden></p></form>`,
    footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="ms">Enregistrer</button>',
    onMount: (m, close) => {
      const sa = $('[name=sous_agent_id]', m);
      const majSous = () => { if (!sa) return; const dep = $('[name=agent_id]', m).value; sa.innerHTML = '<option value="">—</option>' + optsAgents('sous_agent', dep).map((o) => `<option value="${o.v}">${esc(o.l)}</option>`).join(''); };
      $('[name=agent_id]', m)?.addEventListener('change', () => { majSous(); const p = prixDepot($('[name=agent_id]', m).value); if (type === 'prise' && p) $('[name=prix]', m).value = p; }); majSous();
      $('[name=source]', m)?.addEventListener('change', (e) => { $('[data-gr]', m).hidden = e.target.value !== 'grossiste'; });
      $('#ms', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const d = readForm($('#mf', m));
        if (type === 'prise') { if (d.source !== 'grossiste') { d.fournisseur = d.source; d.grossiste_id = null; } delete d.source; }
        try { await App.act('circuit.save', { ...d, type }, 'Mouvement enregistré.'); close(); } catch (e) { showErr(m, e.message); }
      }));
    } });
}

function ficheMouvement(r) {
  modal({ title: `${libType[r.type]} ${r.numero}`,
    body: `<dl class="dl">${[['Date', fmtD(r.date)], ['Grossiste', r.grossiste_id ? nm.grossiste(r.grossiste_id) : '—'], ['Fournisseur', r.fournisseur || '—'], ['Dépôt', r.agent_id ? nm.agent(r.agent_id) : '—'], ['Agent', r.sous_agent_id ? nm.agent(r.sous_agent_id) : '—'],
      ['Produit', nm.produit(r.produit_id)], ['Cartons', fmtQ(r.cartons)], ['Prix', r.prix === null ? '—' : fmtF(r.prix)], ['Montant', r.montant === null ? '—' : fmtF(r.montant)], ['Mode', r.type === 'prise' ? (r.mode === 'credit' ? 'Crédit' : 'Comptant') : '—'],
      ['Observation', r.observation || '—'], ['Statut', r.statut === 'annule' ? `Annulé — ${r.motif || ''}` : 'Valide'], ['Saisi le', fmtD(r.created_at)]].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`,
    footer: `${App.can('circuit', 'annuler') && r.statut !== 'annule' ? '<button class="btn danger" id="ma">Annuler ce mouvement</button>' : ''}<span class="grow"></span><button class="btn ghost" data-close>Fermer</button>`,
    onMount: (m, close) => $('#ma', m.parentElement)?.addEventListener('click', async () => {
      const motif = await confirmBox({ title: 'Annuler le mouvement', message: 'Le mouvement reste visible, marqué « annulé », et ne compte plus dans les stocks.', okLabel: 'Annuler le mouvement', danger: true, motif: true });
      if (!motif) return;
      try { await App.act('circuit.cancel', { id: r.id, motif }, 'Mouvement annulé.'); close(); } catch (e) { toast(e.message, 'err'); }
    }) });
}

// ---------------------------------------------------------------- Versements et caisse
export function renderVersements(root) {
  const f = F();
  root.innerHTML = pageHead('Versements et caisse', 'Versements des ventes comptant (à la caisse Oriba ou chez le grossiste), remboursements de crédits clients et règlements des grossistes.',
    `${actions()}${peutSaisir() ? `<button class="btn primary" id="v-new">${icon('plus')} Nouveau versement</button>` : ''}`) + aide() + barreDate(root) + '<section class="kpis" id="vk"></section><article class="card"><header><h3>Versements</h3></header><div id="vt"></div></article><article class="card"><header><h3>Remboursements de crédits des clients du circuit</h3></header><div id="rt"></div></article>';
  lierActions(root);
  $('#v-new', root)?.addEventListener('click', () => formVersement());
  const draw = () => {
    const d = f.date, C = contexte(App.D, App.I), dep = situationDepots(C, d);
    const S = (l, k) => l.reduce((s, x) => s + num(x[k]), 0);
    $('#vk', root).innerHTML = [kpi('Ventes comptant à verser', fmtF(S(dep, 'aVerser')), fmtD(d)), kpi('Versé', fmtF(S(dep, 'verse')), `dont ${fmtF(S(dep, 'verseGrossiste'))} chez les grossistes`), kpi('Reste à verser', fmtF(S(dep, 'ecart')), '', S(dep, 'ecart') > 0 ? 'crit' : 'ok'),
      kpi('Remboursements reçus', fmtF(S(dep, 'remb'))), kpi('Règlements des grossistes', fmtF(C.vers.filter((v) => v.objet === 'reglement_grossiste' && v.date === d).reduce((s, v) => s + num(v.montant), 0)))].join('');
    const vs = (App.D.versements || []).filter((v) => f.annules || v.statut !== 'annule');
    new Table({ title: 'Versements', rows: vs, sort: { k: 'date', dir: -1 }, pageSize: 25, onRow: (r) => ficheVersement(r),
      foot: (c, rs) => (c.k === 'montant' ? `<b>${fmtN(rs.reduce((s, r) => s + num(r.montant), 0))}</b>` : ''),
      cols: [{ k: 'numero', l: 'N°' }, { k: 'date', l: 'Date', f: (r) => fmtD(r.date) }, { k: 'objet', l: 'Objet', v: (r) => OBJETS_VERSEMENT[r.objet] }, { k: 'par', l: 'Versé par', v: (r) => (r.agent_id ? nm.agent(r.agent_id) : nm.grossiste(r.grossiste_id)) },
        { k: 'lieu', l: 'Lieu', v: (r) => (r.lieu === 'grossiste' ? `Chez ${nm.grossiste(r.lieu_grossiste_id)}` : 'Caisse Oriba') }, { k: 'montant', l: 'Montant (FCFA)', num: 1, f: (r) => `<b>${fmtN(r.montant)}</b>` }, { k: 'reference', l: 'Référence' },
        { k: 'statut', l: 'Statut', v: (r) => (r.statut === 'annule' ? 'Annulé' : 'Valide'), f: (r) => (r.statut === 'annule' ? pill('Annulé', 'mute') : pill('Valide', 'ok')) }] }).mount($('#vt', root));
    const ids = C.reseauTous(), vmap = new Map((App.D.ventes || []).map((v) => [v.id, v]));
    const rb = (App.D.remboursements || []).filter((r) => r.statut === 'valide' && ids.has(vmap.get(r.vente_id)?.agent_id));
    new Table({ title: 'Remboursements de crédits', rows: rb, sort: { k: 'date', dir: -1 }, pageSize: 15, empty: 'Aucun remboursement.',
      cols: [{ k: 'numero', l: 'N°' }, { k: 'date', l: 'Date', f: (r) => fmtD(r.date) }, { k: 'vente', l: 'Vente', v: (r) => vmap.get(r.vente_id)?.numero || '' }, { k: 'client', l: 'Client', v: (r) => nm.client(vmap.get(r.vente_id)?.client_id) },
        { k: 'vendeur', l: 'Vendeur', v: (r) => nm.agent(vmap.get(r.vente_id)?.agent_id) }, { k: 'lieu', l: 'Lieu', v: (r) => (r.lieu === 'grossiste' ? `Chez ${nm.grossiste(r.lieu_grossiste_id)}` : 'Caisse Oriba') }, { k: 'montant', l: 'Montant (FCFA)', num: 1, f: (r) => fmtN(r.montant) }] }).mount($('#rt', root));
  };
  lierDate(root, draw);
  draw();
}

export function formVersement() {
  const C = contexte(App.D, App.I);
  const tous = [...C.depots, ...C.sous].sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((a) => ({ v: a.id, l: `${a.nom}${a.role_circuit === 'depot' ? ' (dépôt' + (a.equipe_id ? ', ' + nm.equipe(a.equipe_id) : '') + ')' : ' (agent de ' + nm.agent(a.depot_id) + ')'}` }));
  modal({ title: 'Nouveau versement',
    body: `<form class="form" id="vf"><div class="grid2">
      ${field({ k: 'objet', l: 'Objet', t: 'options', options: [{ v: 'ventes_comptant', l: 'Ventes comptant' }, { v: 'remboursement', l: 'Remboursement d’un crédit client' }, { v: 'reglement_grossiste', l: 'Règlement d’un grossiste à Oriba' }], empty: false })}
      ${field({ k: 'date', l: 'Date', t: 'date', req: 1 }, today())}
      <div data-a>${field({ k: 'agent_id', l: 'Versé par (dépôt ou agent)', t: 'options', options: tous, req: 1 })}</div>
      <div data-g hidden>${field({ k: 'grossiste_id', l: 'Grossiste', t: 'options', options: optsGrossistes(), req: 1 })}</div>
      <div data-r hidden>${field({ k: 'vente_id', l: 'Crédit remboursé', t: 'options', options: [], req: 1 })}</div>
      <div data-l>${field({ k: 'lieu', l: 'Lieu du versement', t: 'options', options: Object.entries(LIEUX_VERSEMENT).map(([v, l]) => ({ v, l })), empty: false })}</div>
      <div data-lg hidden>${field({ k: 'lieu_grossiste_id', l: 'Chez quel grossiste', t: 'options', options: optsGrossistes() })}</div>
      ${field({ k: 'montant', l: 'Montant (FCFA)', t: 'number', req: 1, min: 0 })}
      ${field({ k: 'reference', l: 'Référence (reçu, bordereau…)', t: 'text' })}</div><p class="muted small" data-info></p><p class="err" hidden></p></form>`,
    footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="vs">Enregistrer</button>',
    onMount: (m, close) => {
      const v = (n) => $(`[name=${n}]`, m);
      const credits = () => { const a = v('agent_id').value; const ids = a ? new Set([a]) : C.reseauTous(); return creditsCircuit(C, today()).filter((c) => ids.has(c.agent_id)); };
      const maj = () => {
        const o = v('objet').value;
        $('[data-a]', m).hidden = o === 'reglement_grossiste'; $('[data-g]', m).hidden = o !== 'reglement_grossiste'; $('[data-r]', m).hidden = o !== 'remboursement';
        $('[data-l]', m).hidden = o === 'reglement_grossiste'; $('[data-lg]', m).hidden = o === 'reglement_grossiste' || v('lieu').value !== 'grossiste';
        if (o === 'remboursement') { const cr = credits(); v('vente_id').innerHTML = '<option value="">—</option>' + cr.map((c) => `<option value="${c.id}">${esc(`${c.numero} · ${nm.client(c.client_id)} · reste ${fmtN(c.solde)} FCFA${c.statut === 'En retard' ? ' (en retard)' : ''}`)}</option>`).join(''); }
        $('[data-info]', m).textContent = o === 'ventes_comptant' ? 'Argent des ventes comptant remis par l’dépôt (pour lui et ses agents) ou par un agent.' : o === 'remboursement' ? 'Le remboursement est enregistré sur la vente à crédit choisie : son solde et son statut se mettent à jour.' : 'Paiement fait par le grossiste à Oriba sur les cartons reçus.';
      };
      ['objet', 'lieu', 'agent_id'].forEach((n) => v(n).addEventListener('change', maj)); maj();
      $('#vs', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const d = readForm($('#vf', m));
        try {
          if (d.objet === 'remboursement') {
            if (!d.vente_id) throw new Error('Choisissez le crédit remboursé.');
            await App.act('remb.create', { vente_id: d.vente_id, date: d.date, montant: d.montant, reference: d.reference, lieu: d.lieu, lieu_grossiste_id: d.lieu === 'grossiste' ? d.lieu_grossiste_id : null, verse_par: d.agent_id || null, mode: 'Espèces' }, 'Remboursement enregistré.');
          } else await App.act('versement.save', { ...d, lieu_grossiste_id: d.lieu === 'grossiste' ? d.lieu_grossiste_id : null }, 'Versement enregistré.');
          close();
        } catch (e) { showErr(m, e.message); }
      }));
    } });
}

function ficheVersement(r) {
  modal({ title: `Versement ${r.numero}`,
    body: `<dl class="dl">${[['Date', fmtD(r.date)], ['Objet', OBJETS_VERSEMENT[r.objet]], ['Versé par', r.agent_id ? nm.agent(r.agent_id) : nm.grossiste(r.grossiste_id)], ['Lieu', r.lieu === 'grossiste' ? `Chez ${nm.grossiste(r.lieu_grossiste_id)}` : 'Caisse Oriba'],
      ['Montant', fmtF(r.montant)], ['Référence', r.reference || '—'], ['Statut', r.statut === 'annule' ? `Annulé — ${r.motif || ''}` : 'Valide']].map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`,
    footer: `${App.can('circuit', 'annuler') && r.statut !== 'annule' ? '<button class="btn danger" id="va">Annuler ce versement</button>' : ''}<span class="grow"></span><button class="btn ghost" data-close>Fermer</button>`,
    onMount: (m, close) => $('#va', m.parentElement)?.addEventListener('click', async () => {
      const motif = await confirmBox({ title: 'Annuler le versement', message: 'Le versement reste visible, marqué « annulé », et ne compte plus dans la caisse.', okLabel: 'Annuler le versement', danger: true, motif: true });
      if (!motif) return;
      try { await App.act('versement.cancel', { id: r.id, motif }, 'Versement annulé.'); close(); } catch (e) { toast(e.message, 'err'); }
    }) });
}
