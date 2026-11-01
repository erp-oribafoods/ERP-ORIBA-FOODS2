// Import quotidien du classeur du circuit (même format que la simulation validée) :
// listes (Grossistes, Agents-dépôts, Sous-agents, Clients) puis journaux 1-Appro, 2-Prises, 3-Dispatch, 4-Ventes, 5-Versements.
// Chaque ligne reçoit un identifiant stable : réimporter le même fichier (ou le fichier du lendemain, complété) n'ajoute que les nouveautés.
import { App, nm } from '../app.js';
import { esc, $, $$, fmtN, fmtD, toast, busy, icon, modal, exportRows, saveBlob } from './ui.js';
import { cleNom, trouverAgent } from './noms.js';
import { K, generateurCles } from './circuitRefs.js';
import { today } from '../../shared/logic.js';

const vide = (v) => v === '' || v === null || v === undefined;
const t = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const num = (v) => { if (vide(v)) return null; if (typeof v === 'number') return v; const n = Number(String(v).replace(/[\s  ]/g, '').replace(',', '.')); return Number.isNaN(n) ? NaN : n; };
function iso(v) {
  if (vide(v)) return null;
  if (v instanceof Date && !isNaN(v)) { const j = new Date(v.getTime() + 12 * 3600 * 1000); return new Date(Date.UTC(j.getFullYear(), j.getMonth(), j.getDate())).toISOString().slice(0, 10); }
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/); if (m) { let y = m[3]; if (y.length === 2) y = '20' + y; if (/^0?206$/.test(y)) y = '2026'; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
const FEUILLES = { grossistes: /^grossistes$/i, depots: /^agents?[\s-]*d[ée]p[oô]ts?$/i, sous: /^sous[\s-]*agents?$/i, clients: /^clients?/i, params: /^param/i,
  appro: /^1\s*[-–]?\s*appro/i, prise: /^2\s*[-–]?\s*prise/i, dispatch: /^3\s*[-–]?\s*dispatch/i, ventes: /^4\s*[-–]?\s*vente/i, versements: /^5\s*[-–]?\s*versement/i };
const feuille = (wb, re) => wb.SheetNames.find((n) => re.test(n.trim()));
export const estClasseurCircuit = (wb) => !!(feuille(wb, FEUILLES.depots) && (feuille(wb, FEUILLES.prise) || feuille(wb, FEUILLES.dispatch) || feuille(wb, FEUILLES.ventes)));

// Lit une feuille : ligne d'en-tête repérée (Code / Date), colonnes repérées par leur libellé
function lire(wb, re, cols) {
  const n = feuille(wb, re); if (!n) return [];
  const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: true });
  const h = rows.findIndex((r, i) => i < 12 && r.some((c) => ['code', 'date', 'produit'].includes(K(c))));
  if (h < 0) return [];
  const head = rows[h].map(K);
  const idx = Object.fromEntries(Object.entries(cols).map(([k, al]) => [k, head.findIndex((c) => al.some((a) => c === a || c.startsWith(a)))]));
  const out = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i]; const o = { _ligne: i + 1 };
    for (const k of Object.keys(cols)) o[k] = idx[k] >= 0 ? r[idx[k]] : '';
    if (Object.keys(cols).every((k) => vide(o[k]))) continue;
    if (/^total/i.test(t(r[0])) || /^total$/i.test(t(r[1]))) continue;
    out.push(o);
  }
  return out;
}
const C_LISTES = {
  grossistes: { code: ['code'], nom: ['nom'], localite: ['localite'], fournisseur: ['fournisseur'], telephone: ['telephone'], stock: ['stock_initial'], solde: ['solde'] },
  depots: { code: ['code'], nom: ['nom'], zone: ['zone', 'equipe'], grossiste: ['grossiste'], telephone: ['telephone'], stock: ['stock_initial'] },
  sous: { code: ['code'], nom: ['nom'], depot: ['agent_depot', 'agent'], localite: ['localite'], telephone: ['telephone'], stock: ['stock_initial'] },
  clients: { code: ['code'], nom: ['nom'], vendeur: ['vendeur'], localite: ['localite'], telephone: ['telephone'], plafond: ['plafond'] },
};
const C_JOURNAUX = {
  appro: { date: ['date'], grossiste: ['grossiste'], fournisseur: ['fournisseur'], produit: ['produit'], cartons: ['cartons'], prix: ['prix'], observation: ['observation'] },
  prise: { date: ['date'], agent: ['agent'], grossiste: ['grossiste'], produit: ['produit'], cartons: ['cartons'], prix: ['prix'], mode: ['mode'], observation: ['observation'] },
  dispatch: { date: ['date'], agent: ['agent'], sous: ['sous_agent'], produit: ['produit'], cartons: ['cartons'], observation: ['observation'] },
  ventes: { date: ['date'], vendeur: ['vendeur'], client: ['client'], produit: ['produit'], cartons: ['cartons'], prix: ['prix'], mode: ['mode'], echeance: ['echeance'], numero: ['n_vente', 'no_vente', 'numero'] },
  versements: { date: ['date'], par: ['verse_par'], objet: ['objet'], numero: ['n_vente', 'no_vente'], lieu: ['lieu'], grossiste: ['grossiste'], montant: ['montant'] },
};

// Correspondance fichier → plateforme
function referentiels() {
  const D = App.D;
  const actifs = (l) => (l || []).filter((x) => x.actif !== false);
  const parCode = (l, c) => actifs(l).find((x) => x.code && K(x.code) === K(c));
  const parNom = (l, n) => { const r = actifs(l).filter((x) => cleNom(x.nom) === cleNom(n)); return r.length === 1 ? r[0] : null; };
  const equipe = (z) => { const k = cleNom(z).replace(/^axe /, '').replace(/^zone /, ''); return actifs(D.equipes).find((e) => cleNom(e.nom) === k || cleNom(e.code) === k) || null; };
  const produit = (p) => actifs(D.produits).find((x) => cleNom(x.nom) === cleNom(p) || (x.code && cleNom(x.code) === cleNom(p))) || null;
  return { D, parCode, parNom, equipe, produit };
}

export function analyseCircuit(wb) {
  const R = referentiels();
  const L = Object.fromEntries(Object.entries(C_LISTES).map(([k, c]) => [k, lire(wb, FEUILLES[k], c)]));
  const J = Object.fromEntries(Object.entries(C_JOURNAUX).map(([k, c]) => [k, lire(wb, FEUILLES[k], c)]));
  const ref = { creer: { grossistes: [], depots: [], sous: [], clients: [] }, maj: [], rejets: [] };
  // Grossistes
  const G = new Map();
  for (const g of L.grossistes) {
    if (!t(g.nom) && !t(g.code)) continue;
    const ex = R.parCode(R.D.grossistes, g.code) || R.parNom(R.D.grossistes, g.nom);
    const data = { code: t(g.code) || null, nom: t(g.nom), localite: t(g.localite) || null, fournisseur: t(g.fournisseur) || null, telephone: t(g.telephone) || null, stock_initial: num(g.stock) || 0, solde_initial: num(g.solde) || 0 };
    G.set(K(g.code || g.nom), ex ? { id: ex.id, ex } : { data });
    if (!ex) ref.creer.grossistes.push(data);
    else if (Number(ex.stock_initial || 0) !== data.stock_initial || Number(ex.solde_initial || 0) !== data.solde_initial) ref.maj.push({ table: 'grossistes', row: { id: ex.id, stock_initial: data.stock_initial, solde_initial: data.solde_initial }, lib: `${ex.nom} : stock et solde de départ` });
  }
  // Agents-dépôts
  const A = new Map();
  for (const a of L.depots) {
    if (!t(a.nom)) continue;
    const eq = R.equipe(a.zone);
    if (!eq) { ref.rejets.push({ feuille: 'Agents-dépôts', ligne: a._ligne, msg: `Zone « ${t(a.zone)} » inconnue : créez l’équipe/zone ou corrigez le nom` }); continue; }
    const ex = R.parCode(R.D.agents, a.code) || trouverAgent(a.nom, (R.D.agents || []).filter((x) => x.actif !== false), eq.id);
    const data = { code: t(a.code) || null, nom: t(a.nom), equipe_id: eq.id, zone_id: eq.zone_id, telephone: t(a.telephone) || null, role_circuit: 'depot', stock_initial: num(a.stock) || 0 };
    A.set(K(a.code || a.nom), ex ? { id: ex.id, ex, eq } : { data, eq });
    if (!ex) ref.creer.depots.push(data);
    else if (ex.role_circuit !== 'depot' || Number(ex.stock_initial || 0) !== data.stock_initial) ref.maj.push({ table: 'agents', row: { id: ex.id, role_circuit: 'depot', depot_id: null, stock_initial: data.stock_initial }, lib: `${ex.nom} : agent-dépôt de ${eq.nom}` });
  }
  // Sous-agents
  const S = new Map();
  for (const s of L.sous) {
    if (!t(s.nom)) continue;
    const dep = A.get(K(s.depot)) || (() => { const x = R.parCode(R.D.agents, s.depot) || R.parNom(R.D.agents, s.depot); return x && x.role_circuit === 'depot' ? { id: x.id, ex: x, eq: (R.D.equipes || []).find((e) => e.id === x.equipe_id) } : null; })();
    if (!dep) { ref.rejets.push({ feuille: 'Sous-agents', ligne: s._ligne, msg: `Agent-dépôt « ${t(s.depot)} » introuvable` }); continue; }
    const eqId = dep.ex?.equipe_id || dep.data?.equipe_id || dep.eq?.id;
    const ex = R.parCode(R.D.agents, s.code) || trouverAgent(s.nom, (R.D.agents || []).filter((x) => x.actif !== false), eqId);
    const data = { code: t(s.code) || null, nom: t(s.nom), equipe_id: eqId, zone_id: dep.eq?.zone_id || null, telephone: t(s.telephone) || null, role_circuit: 'sous_agent', stock_initial: num(s.stock) || 0, _depot: K(s.depot) };
    S.set(K(s.code || s.nom), ex ? { id: ex.id, ex } : { data });
    if (!ex) ref.creer.sous.push(data);
    else if (ex.role_circuit !== 'sous_agent' || (dep.id && ex.depot_id !== dep.id) || Number(ex.stock_initial || 0) !== data.stock_initial) ref.maj.push({ table: 'agents', row: { id: ex.id, role_circuit: 'sous_agent', stock_initial: data.stock_initial }, _depot: K(s.depot), lib: `${ex.nom} : sous-agent de ${dep.ex?.nom || dep.data?.nom}` });
  }
  // Clients
  const CL = new Map();
  for (const c of L.clients) {
    if (!t(c.nom)) continue;
    const ex = R.parCode(R.D.clients, c.code) || R.parNom(R.D.clients, c.nom);
    const data = { code: t(c.code) || null, nom: t(c.nom), telephone: t(c.telephone) || null, plafond_cartons: num(c.plafond) || null, type: /divers/i.test(c.nom) ? 'Détaillant' : 'Boutique' };
    CL.set(K(c.code || c.nom), ex ? { id: ex.id } : { data });
    if (!ex) ref.creer.clients.push(data);
  }
  // Paramètre : date des stocks initiaux
  let depart = null;
  const pn = feuille(wb, FEUILLES.params);
  if (pn) for (const r of window.XLSX.utils.sheet_to_json(wb.Sheets[pn], { header: 1, defval: '', raw: true })) if (/stocks? initia/i.test(t(r[0]))) depart = iso(r[1]);

  // Journaux
  const cle = generateurCles();
  const deja = { mvts: new Set((R.D.circuit_mvts || []).map((m) => m.ref_externe).filter(Boolean)), ventes: new Set((R.D.ventes || []).map((v) => v.ref_externe).filter(Boolean)), vers: new Set((R.D.versements || []).map((v) => v.ref_externe).filter(Boolean)),
    rembs: new Set((R.D.remboursements || []).filter((r) => r.statut === 'valide').map((r) => r.reference).filter(Boolean)) };
  const res = { appro: [], prise: [], dispatch: [], ventes: [], versements: [], remboursements: [] };
  const push = (k, r, msgs, ref2, data, apercu, set) => res[k].push({ ligne: r._ligne, statut: msgs.length ? 'rejet' : set.has(ref2) ? 'identique' : 'ok', msg: msgs.join(' ; '), ref: ref2, data, apercu });
  const prodOk = (r, msgs) => { const p = R.produit(r.produit); if (!p) msgs.push(`Produit « ${t(r.produit)} » inconnu`); return p; };
  const base = (r, msgs) => { const d = iso(r.date); if (!d) msgs.push('Date illisible'); else if (d > today()) msgs.push('Date dans le futur'); const q = num(r.cartons); if (!(q > 0)) msgs.push('Cartons manquants'); return { d, q }; };
  const connu = (map, code) => map.has(K(code));
  for (const r of J.appro) {
    const msgs = []; const { d, q } = base(r, msgs); const p = prodOk(r, msgs);
    if (!connu(G, r.grossiste) && !R.parCode(R.D.grossistes, r.grossiste)) msgs.push(`Grossiste « ${t(r.grossiste)} » absent de la liste`);
    const ref2 = cle(['A', d, K(r.grossiste), K(r.fournisseur), K(r.produit), q, num(r.prix) ?? '']);
    push('appro', r, msgs, ref2, { d, q, p, r }, `${fmtD(d)} · ${t(r.grossiste)} · ${t(r.fournisseur)} · ${fmtN(q)} ctn`, deja.mvts);
  }
  for (const r of J.prise) {
    const msgs = []; const { d, q } = base(r, msgs); const p = prodOk(r, msgs);
    if (!connu(A, r.agent) && !R.parCode(R.D.agents, r.agent)) msgs.push(`Agent-dépôt « ${t(r.agent)} » absent de la liste`);
    if (!connu(G, r.grossiste) && !R.parCode(R.D.grossistes, r.grossiste)) msgs.push(`Grossiste « ${t(r.grossiste)} » absent de la liste`);
    const ref2 = cle(['P', d, K(r.agent), K(r.grossiste), K(r.produit), q, num(r.prix) ?? '', K(r.mode)]);
    push('prise', r, msgs, ref2, { d, q, p, r }, `${fmtD(d)} · ${t(r.agent)} chez ${t(r.grossiste)} · ${fmtN(q)} ctn · ${t(r.mode)}`, deja.mvts);
  }
  for (const r of J.dispatch) {
    const msgs = []; const { d, q } = base(r, msgs); const p = prodOk(r, msgs);
    if (!connu(A, r.agent) && !R.parCode(R.D.agents, r.agent)) msgs.push(`Agent-dépôt « ${t(r.agent)} » absent de la liste`);
    if (!connu(S, r.sous) && !R.parCode(R.D.agents, r.sous)) msgs.push(`Sous-agent « ${t(r.sous)} » absent de la liste`);
    const ref2 = cle(['D', d, K(r.agent), K(r.sous), K(r.produit), q]);
    push('dispatch', r, msgs, ref2, { d, q, p, r }, `${fmtD(d)} · ${t(r.agent)} → ${t(r.sous)} · ${fmtN(q)} ctn`, deja.mvts);
  }
  const venteRef = new Map();
  for (const r of J.ventes) {
    const msgs = []; const { d, q } = base(r, msgs); const p = prodOk(r, msgs);
    const credit = /cr[ée]d/i.test(t(r.mode));
    if (!connu(A, r.vendeur) && !connu(S, r.vendeur) && !R.parCode(R.D.agents, r.vendeur)) msgs.push(`Vendeur « ${t(r.vendeur)} » absent des listes`);
    if (!(num(r.prix) >= 0) || vide(r.prix)) msgs.push('Prix manquant');
    if (credit && !t(r.client)) msgs.push('Client obligatoire pour un crédit');
    if (t(r.client) && !connu(CL, r.client) && !R.parCode(R.D.clients, r.client)) msgs.push(`Client « ${t(r.client)} » absent de la liste`);
    const ech = iso(r.echeance);
    if (credit && ech && d && ech < d) msgs.push('Échéance avant la date de vente');
    const ref2 = cle(['V', d, K(r.vendeur), K(r.client), K(r.produit), q, num(r.prix), credit ? 'K' : 'C']);
    if (t(r.numero)) venteRef.set(K(r.numero), ref2);
    push('ventes', r, msgs, ref2, { d, q, p, r, credit, ech }, `${fmtD(d)} · ${t(r.vendeur)} · ${t(r.client) || '—'} · ${fmtN(q)} ctn · ${credit ? 'crédit' : 'comptant'}`, deja.ventes);
  }
  for (const r of J.versements) {
    const msgs = []; const d = iso(r.date); if (!d) msgs.push('Date illisible'); else if (d > today()) msgs.push('Date dans le futur');
    const m = num(r.montant); if (!(m > 0)) msgs.push('Montant manquant');
    const ob = K(r.objet);
    const lieuG = /grossiste/i.test(t(r.lieu));
    if (ob.startsWith('rembours')) {
      const vref = venteRef.get(K(r.numero));
      if (!vref) msgs.push(`N° de vente « ${t(r.numero)} » introuvable dans l’onglet 4-Ventes`);
      const ref2 = cle(['R', d, K(r.par), vref || K(r.numero), m]);
      push('remboursements', r, msgs, ref2, { d, m, r, vref, lieuG }, `${fmtD(d)} · ${t(r.par)} · vente ${t(r.numero)} · ${fmtN(m)} FCFA`, deja.rembs);
    } else {
      const regl = ob.startsWith('reglement');
      if (regl ? !connu(G, r.par) && !R.parCode(R.D.grossistes, r.par) : !connu(A, r.par) && !connu(S, r.par) && !R.parCode(R.D.agents, r.par)) msgs.push(`« ${t(r.par)} » absent des listes`);
      if (lieuG && !regl && !connu(G, r.grossiste) && !R.parCode(R.D.grossistes, r.grossiste)) msgs.push('Grossiste du versement absent de la liste');
      const ref2 = cle(['S', d, K(r.par), regl ? 'G' : 'C', lieuG ? K(r.grossiste) : 'caisse', m]);
      push('versements', r, msgs, ref2, { d, m, r, regl, lieuG }, `${fmtD(d)} · ${t(r.par)} · ${regl ? 'règlement grossiste' : 'ventes comptant'} · ${fmtN(m)} FCFA${lieuG ? ' chez ' + t(r.grossiste) : ''}`, deja.vers);
    }
  }
  return { L, J, G, A, S, CL, ref, res, depart };
}

const PAQUET = 300;
async function envoyer(type, fichier, rows) {
  const tot = { integrees: 0, deja: 0, refuses: [] };
  for (let i = 0; i < rows.length; i += PAQUET) {
    const out = await App.api.call('import.run', { type, mode: 'courant', fichier, rows: rows.slice(i, i + PAQUET), stats: { classeur_circuit: true } });
    tot.integrees += out.integrees.length; tot.deja += out.deja?.length || 0; tot.refuses.push(...out.refuses);
  }
  return tot;
}

// Enregistrement dans l'ordre : référentiels, mouvements, ventes, versements, remboursements
export async function appliquerCircuit(wb, fname, etape = () => {}) {
  let A = analyseCircuit(wb);
  const out = { refs: 0, refus: [] };
  const sauver = async (table, rows, lib) => {
    if (!rows.length) return;
    etape(lib);
    const r = await App.api.call('import.run', { type: table, mode: 'courant', fichier: `${fname} — ${lib}`, rows: rows.map((data, i) => ({ ligne: i + 1, data })) });
    out.refs += r.integrees.length; out.refus.push(...r.refuses.map((x) => `${lib} : ${x.erreur}`));
    await App.refresh();
  };
  if (A.depart && !App.I.p.circuit_date_depart?.date) await App.api.call('circuit.depart', { date: A.depart });
  await sauver('grossistes', A.ref.creer.grossistes, 'nouveaux grossistes');
  A = analyseCircuit(wb);
  await sauver('agents', A.ref.creer.depots, 'nouveaux agents-dépôts');
  A = analyseCircuit(wb);
  const depId = (k) => A.A.get(k)?.id;
  await sauver('agents', [...A.ref.creer.sous.map(({ _depot, ...d }) => ({ ...d, depot_id: depId(_depot) })).filter((d) => d.depot_id)], 'nouveaux sous-agents');
  await sauver('clients', A.ref.creer.clients, 'nouveaux clients');
  A = analyseCircuit(wb);
  if (A.ref.maj.length) {
    etape('mise à jour des rôles et stocks initiaux');
    for (const table of ['grossistes', 'agents']) {
      const lot = A.ref.maj.filter((m) => m.table === table).map((m) => ({ ...m.row, ...(m._depot ? { depot_id: depId(m._depot) } : {}) }));
      // les agents-dépôts d'abord, puis leurs sous-agents
      lot.sort((x, y) => (x.role_circuit === 'depot' ? 0 : 1) - (y.role_circuit === 'depot' ? 0 : 1));
      if (lot.length) { const r = await App.api.call('import.run', { type: table, mode: 'courant', fichier: `${fname} — mise à jour`, rows: lot.map((data, i) => ({ ligne: i + 1, data })) }); out.refs += r.integrees.length; out.refus.push(...r.refuses.map((x) => `Mise à jour : ${x.erreur}`)); }
    }
    await App.refresh();
  }
  A = analyseCircuit(wb);
  const g = (code) => A.G.get(K(code))?.id || App.D.grossistes.find((x) => K(x.code) === K(code))?.id;
  const ag = (code) => A.A.get(K(code))?.id || A.S.get(K(code))?.id || App.D.agents.find((x) => x.code && K(x.code) === K(code))?.id;
  const cl = (code) => (t(code) ? A.CL.get(K(code))?.id || App.D.clients.find((x) => x.code && K(x.code) === K(code))?.id || null : null);
  const nouv = (k) => A.res[k].filter((x) => x.statut === 'ok');
  const R = {};
  const mv = (k, f) => nouv(k).map((x) => ({ ligne: x.ligne, data: { ...f(x), date: x.data.d, produit_id: x.data.p.id, cartons: x.data.q, observation: t(x.data.r.observation) || null, ref_externe: x.ref } }));
  if (nouv('appro').length) { etape('approvisionnements des grossistes'); R.appro = await envoyer('circuit_appro', `${fname} — 1-Appro grossistes`, mv('appro', (x) => ({ grossiste_id: g(x.data.r.grossiste), fournisseur: t(x.data.r.fournisseur), prix: num(x.data.r.prix) }))); }
  if (nouv('prise').length) { etape('prises des agents-dépôts'); R.prise = await envoyer('circuit_prise', `${fname} — 2-Prises agents`, mv('prise', (x) => ({ agent_id: ag(x.data.r.agent), grossiste_id: g(x.data.r.grossiste), prix: num(x.data.r.prix), mode: t(x.data.r.mode) }))); }
  if (nouv('dispatch').length) { etape('dispatch aux sous-agents'); R.dispatch = await envoyer('circuit_dispatch', `${fname} — 3-Dispatch`, mv('dispatch', (x) => ({ agent_id: ag(x.data.r.agent), sous_agent_id: ag(x.data.r.sous) }))); }
  await App.refresh();
  for (const credit of [false, true]) {
    const rows = nouv('ventes').filter((x) => x.data.credit === credit).map((x) => ({ ligne: x.ligne, data: { date: x.data.d, agent_id: ag(x.data.r.vendeur), marche_id: null, client_id: cl(x.data.r.client), echeance: credit ? x.data.ech : null, ref_externe: x.ref, observation: null }, lignes: [{ produit_id: x.data.p.id, unite: 'carton', quantite: x.data.q, prix_unitaire: num(x.data.r.prix) }] }));
    if (rows.length) { etape(`ventes ${credit ? 'à crédit' : 'au comptant'}`); R[credit ? 'credit' : 'comptant'] = await envoyer(credit ? 'ventes_credit' : 'ventes_comptant', `${fname} — 4-Ventes`, rows); }
  }
  await App.refresh();
  if (nouv('versements').length) {
    etape('versements');
    R.versements = await envoyer('versements', `${fname} — 5-Versements`, nouv('versements').map((x) => ({ ligne: x.ligne, data: { date: x.data.d, montant: x.data.m, objet: x.data.regl ? 'reglement_grossiste' : 'ventes_comptant', ...(x.data.regl ? { grossiste_id: g(x.data.r.par) } : { agent_id: ag(x.data.r.par) }), lieu: x.data.lieuG ? 'grossiste' : 'caisse', lieu_grossiste_id: x.data.lieuG ? g(x.data.r.grossiste) : null, ref_externe: x.ref } })));
  }
  if (nouv('remboursements').length) {
    etape('remboursements de crédits');
    const parRef = new Map((App.D.ventes || []).filter((v) => v.ref_externe).map((v) => [v.ref_externe, v.id]));
    R.remb = await envoyer('remboursements', `${fname} — 5-Versements (remboursements)`, nouv('remboursements').map((x) => ({ ligne: x.ligne, data: { vente_id: parRef.get(x.data.vref), date: x.data.d, montant: x.data.m, mode: 'Espèces', reference: x.ref, commentaire: `Classeur du circuit — vente ${t(x.data.r.numero)}`, lieu: x.data.lieuG ? 'grossiste' : 'caisse', lieu_grossiste_id: x.data.lieuG ? g(x.data.r.grossiste) : null, verse_par: ag(x.data.r.par) || null } })));
  }
  for (const r of Object.values(R)) out.refus.push(...r.refuses.map((x) => `Ligne ${x.ligne} : ${x.erreur}`));
  await App.refresh(); App.rerender();
  return { ...out, R };
}

// Fenêtre d'import
export function ouvrirImportCircuit() {
  modal({ title: 'Import du classeur du circuit', wide: true,
    body: `<ol class="steps-imp"><li><b>Choisissez le classeur du jour</b> (même format que le modèle : onglets Grossistes, Agents-dépôts, Sous-agents, Clients, 1-Appro, 2-Prises, 3-Dispatch, 4-Ventes, 5-Versements).</li>
      <li><b>Vérifiez le bilan</b> : les lignes déjà enregistrées sont reconnues, seules les nouvelles sont proposées.</li><li><b>Enregistrez</b> : rien n’est jamais enregistré deux fois.</li></ol>
      <div class="filters"><label class="btn primary"><input type="file" accept=".xlsx,.xls" hidden data-f>${icon('upload')} Choisir le classeur</label><button class="btn ghost" type="button" data-mod>${icon('download')} Modèle Excel</button></div><div data-b></div>`,
    onMount: (m) => {
      let wb = null, fname = '';
      const zone = $('[data-b]', m);
      $('[data-mod]', m).addEventListener('click', () => modeleCircuit());
      const LIBS = [['appro', '1-Appro grossistes'], ['prise', '2-Prises agents'], ['dispatch', '3-Dispatch'], ['ventes', '4-Ventes'], ['versements', '5-Versements (versements)'], ['remboursements', '5-Versements (remboursements)']];
      const afficher = () => {
        const A = analyseCircuit(wb);
        const c = (k, s) => A.res[k].filter((x) => x.statut === s).length;
        const nCreer = Object.values(A.ref.creer).reduce((s, l) => s + l.length, 0);
        const total = LIBS.reduce((s, [k]) => s + c(k, 'ok'), 0) + nCreer + A.ref.maj.length;
        const rej = [...A.ref.rejets.map((x) => [x.feuille, x]), ...LIBS.flatMap(([k, l]) => A.res[k].filter((x) => x.statut === 'rejet').map((x) => [l, x]))];
        zone.innerHTML = `${total ? '' : '<div class="note ok">Tout est déjà à jour : aucune nouvelle ligne dans ce classeur.</div>'}
          <div class="tbl-wrap"><table class="tbl maj-t"><thead><tr><th>Onglet</th><th class="n">À ajouter</th><th class="n">Déjà présentes</th><th class="n">Rejetées</th></tr></thead><tbody>
          ${LIBS.map(([k, l]) => `<tr><td>${l}</td><td class="n">${fmtN(c(k, 'ok'))}</td><td class="n">${fmtN(c(k, 'identique'))}</td><td class="n">${c(k, 'rejet') ? `<b class="t-crit">${c(k, 'rejet')}</b>` : 0}</td></tr>`).join('')}</tbody></table></div>
          ${nCreer || A.ref.maj.length ? `<div class="note">À créer : ${[['grossistes', 'grossiste(s)'], ['depots', 'agent(s)-dépôt(s)'], ['sous', 'sous-agent(s)'], ['clients', 'client(s)']].filter(([k]) => A.ref.creer[k].length).map(([k, l]) => `${A.ref.creer[k].length} ${l}`).join(', ') || 'rien'}.${A.ref.maj.length ? ` À mettre à jour : ${A.ref.maj.length} (rôle, agent-dépôt ou stock de départ).` : ''}${A.depart && !App.I.p.circuit_date_depart?.date ? ` Date des stocks initiaux : ${fmtD(A.depart)}.` : ''}</div>` : ''}
          ${rej.length ? `<details class="card"><summary><b>${rej.length} ligne(s) rejetée(s)</b> — à corriger dans le classeur</summary><p>${rej.slice(0, 25).map(([f, x]) => `${esc(f)} ligne ${x.ligne} : ${esc(x.msg)}`).join('<br>')}${rej.length > 25 ? '<br>…' : ''}</p></details>` : ''}
          <div class="row-act"><button class="btn ghost" data-x>Exporter le contrôle</button><button class="btn primary" data-go ${total ? '' : 'disabled'}>${icon('check')} Enregistrer dans la plateforme</button></div><div data-p></div>`;
        $('[data-x]', zone).addEventListener('click', () => exportRows('xlsx', 'Contrôle classeur circuit', [{ k: 'f', l: 'Onglet' }, { k: 'ligne', l: 'Ligne' }, { k: 'apercu', l: 'Aperçu' }, { k: 's', l: 'Contrôle' }, { k: 'msg', l: 'Détail' }],
          LIBS.flatMap(([k, l]) => A.res[k].map((x) => ({ f: l, ligne: x.ligne, apercu: x.apercu, s: { ok: 'Nouvelle', identique: 'Déjà présente', rejet: 'Rejetée' }[x.statut], msg: x.msg }))), `Fichier : ${fname}`));
        $('[data-go]', zone).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
          const prog = $('[data-p]', zone);
          try {
            const r = await appliquerCircuit(wb, fname, (txt) => { prog.innerHTML = `<div class="note">${esc(txt)}…</div>`; });
            const f = (x) => (x ? `${fmtN(x.integrees)} ajoutée(s)${x.deja ? `, ${fmtN(x.deja)} déjà présente(s)` : ''}` : '0');
            zone.innerHTML = `<div class="note ok"><b>Import terminé.</b><ul><li>Référentiels créés ou mis à jour : ${r.refs}</li><li>Approvisionnements : ${f(r.R.appro)} · Prises : ${f(r.R.prise)} · Dispatch : ${f(r.R.dispatch)}</li><li>Ventes comptant : ${f(r.R.comptant)} · Ventes à crédit : ${f(r.R.credit)}</li><li>Versements : ${f(r.R.versements)} · Remboursements : ${f(r.R.remb)}</li></ul>
              ${r.refus.length ? `<span class="t-crit">${r.refus.length} ligne(s) refusée(s) :</span><br><span class="small">${r.refus.slice(0, 15).map(esc).join('<br>')}</span>` : ''}</div><p class="muted small">Demain, réimportez le classeur complété : seules les nouvelles lignes seront ajoutées.</p>`;
            toast('Classeur du circuit importé.');
          } catch (e) { toast(e.message, 'err'); prog.innerHTML = `<div class="note warn">${esc(e.message)} — relancez l’import : les lignes déjà enregistrées ne seront pas reprises.</div>`; }
        }));
      };
      $('[data-f]', m).addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        try {
          const w = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
          if (!estClasseurCircuit(w)) { toast('Ce fichier n’a pas le format du classeur du circuit (onglets Agents-dépôts, 2-Prises agents, 4-Ventes…).', 'warn'); return; }
          wb = w; fname = file.name; afficher();
        } catch (er) { toast('Lecture du fichier impossible : ' + er.message, 'err'); }
        e.target.value = '';
      });
    } });
}

// Modèle : même format que le classeur de simulation, listes pré-remplies, journaux vides avec une ligne d'exemple
export function modeleCircuit() {
  const X = window.XLSX; if (!X) return toast('Module Excel non chargé.', 'err');
  const D = App.D;
  const wb = X.utils.book_new();
  const add = (nom, titre, sous, head, rows, w) => { const ws = X.utils.aoa_to_sheet([[titre], [sous], [], head, ...rows]); ws['!cols'] = w.map((x) => ({ wch: x })); X.utils.book_append_sheet(wb, ws, nom); };
  const fd = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
  const depots = (D.agents || []).filter((a) => a.actif !== false && a.role_circuit === 'depot'), sous = (D.agents || []).filter((a) => a.actif !== false && a.role_circuit === 'sous_agent');
  const code = (a) => a?.code || a?.nom || '';
  const X1 = { G: (D.grossistes || []).find((g) => g.actif !== false), A: depots[0], S: sous[0], P: (D.produits || []).find((p) => p.actif !== false) };
  const j = fd(today());
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Classeur du circuit ORIBA FOODS — modèle'], [], ['1. Listes (Grossistes, Agents-dépôts, Sous-agents, Clients) : complétez-les au besoin ; un nouvel élément est créé à l’import.'], ['2. Journaux 1 à 5 : une ligne par mouvement ; gardez les lignes des jours précédents, la plateforme ne reprend que les nouvelles.'],
    ['3. Codes : utilisez les codes des listes (grossiste, agent-dépôt, sous-agent, client). Dates JJ/MM/AAAA. Mode : Comptant ou Crédit.'], ['4. 5-Versements : Objet = Ventes comptant, Remboursement crédit (avec le N° de vente de l’onglet 4-Ventes) ou Règlement grossiste ; Lieu = Caisse Oriba ou Chez le grossiste.'],
    ['5. Remplacez ou supprimez les lignes d’exemple marquées « exemple ».']]), 'Lisez-moi');
  add('Paramètres', 'Paramètres', 'Date des stocks initiaux du circuit.', ['Produit', 'Prix de référence (FCFA)'], [...(D.produits || []).filter((p) => p.actif !== false).map((p) => [p.nom, p.prix_ref || '']), [], ['Date des stocks initiaux', fd(App.I.p.circuit_date_depart?.date) || j]], [30, 22]);
  add('Grossistes', 'Grossistes', 'Une ligne par grossiste.', ['Code', 'Nom', 'Localité', 'Fournisseur habituel', 'Téléphone', 'Stock initial (cartons)', 'Solde dû au départ (FCFA)'], (D.grossistes || []).filter((g) => g.actif !== false).map((g) => [g.code || '', g.nom, g.localite || '', g.fournisseur || '', g.telephone || '', g.stock_initial || 0, g.solde_initial || 0]), [9, 28, 22, 20, 14, 14, 18]);
  add('Agents-dépôts', 'Agents commerciaux = dépôts', 'Un agent-dépôt par zone.', ['Code', 'Nom', 'Zone', 'Grossiste habituel', 'Téléphone', 'Stock initial (cartons)'], depots.map((a) => [code(a), a.nom, nm.equipe(a.equipe_id), '', a.telephone || '', a.stock_initial || 0]), [10, 26, 14, 16, 14, 14]);
  add('Sous-agents', 'Sous-agents', 'Commerciaux de terrain de chaque agent-dépôt.', ['Code', 'Nom', 'Agent-dépôt', 'Localité / marché', 'Téléphone', 'Stock initial (cartons)'], sous.map((a) => [code(a), a.nom, code((D.agents || []).find((x) => x.id === a.depot_id)), '', a.telephone || '', a.stock_initial || 0]), [11, 26, 12, 22, 14, 14]);
  add('Clients', 'Clients', 'Clients des agents et sous-agents.', ['Code', 'Nom', 'Vendeur rattaché', 'Localité', 'Téléphone', 'Plafond (cartons)'], (D.clients || []).filter((c) => c.actif !== false).map((c) => [c.code || '', c.nom, '', '', c.telephone || '', c.plafond_cartons || '']), [9, 28, 13, 20, 13, 11]);
  const ex = (l) => (X1.A ? [l] : []);
  add('1-Appro grossistes', 'Approvisionnement des grossistes', 'Cartons reçus par les grossistes.', ['Date', 'Grossiste (code)', 'Fournisseur', 'Produit', 'Cartons', 'Prix carton (FCFA)', 'Montant (FCFA)', 'Observation'], ex([j, code(X1.G), 'Usine Oriba Foods', X1.P?.nom || '', 100, '', '', 'exemple']), [12, 14, 20, 22, 10, 14, 16, 26]);
  add('2-Prises agents', 'Prises des agents-dépôts chez les grossistes', 'Déstockage chez les grossistes.', ['Date', 'Agent-dépôt (code)', 'Grossiste (code)', 'Produit', 'Cartons', 'Prix carton (FCFA)', 'Mode', 'Montant (FCFA)', 'Observation'], ex([j, code(X1.A), code(X1.G), X1.P?.nom || '', 20, '', 'Comptant', '', 'exemple']), [12, 14, 14, 22, 10, 14, 12, 16, 24]);
  add('3-Dispatch', 'Dispatch aux sous-agents', 'Cartons remis par l’agent-dépôt à ses sous-agents.', ['Date', 'Agent-dépôt (code)', 'Sous-agent (code)', 'Produit', 'Cartons', 'Observation'], ex([j, code(X1.A), code(X1.S), X1.P?.nom || '', 5, 'exemple']), [12, 14, 14, 22, 10, 26]);
  add('4-Ventes', 'Ventes aux clients', 'Une ligne par vente ; pour un crédit, client et échéance obligatoires.', ['Date', 'Vendeur (code)', 'Client (code)', 'Produit', 'Cartons', 'Prix carton (FCFA)', 'Mode', 'Échéance (crédit)', 'N° vente'], [], [12, 13, 12, 22, 9, 13, 11, 13, 10]);
  add('5-Versements', 'Versements et remboursements', 'Argent versé à la caisse Oriba ou chez le grossiste.', ['Date', 'Versé par (code)', 'Objet', 'N° vente (remboursement)', 'Lieu du versement', 'Grossiste (si versé chez lui)', 'Montant (FCFA)'], [], [12, 14, 20, 14, 18, 16, 15]);
  saveBlob(`Classeur_circuit_ORIBA_${today()}.xlsx`, new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
