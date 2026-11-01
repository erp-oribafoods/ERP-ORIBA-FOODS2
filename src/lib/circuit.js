// Calculs du circuit de distribution : grossistes → agents-dépôts → sous-agents → clients.
// Mêmes règles que le classeur de simulation validé (stock initial, entrées, sorties, stock final ; caisse ; crédits).
import { venteTotals, creditInfo, num, round2, addDays } from '../../shared/logic.js';

const somme = (l, f) => round2(l.reduce((s, x) => s + num(f(x)), 0));

export function circuitCtx(D, I) {
  const mv = (D.circuit_mvts || []).filter((m) => m.statut !== 'annule');
  const vers = (D.versements || []).filter((v) => v.statut !== 'annule');
  const ventes = (D.ventes || []).filter((v) => v.statut === 'validee').map((v) => ({ v, ...venteTotals(v, I) }));
  const rembs = (D.remboursements || []).filter((r) => r.statut === 'valide');
  const dates = [...mv.map((m) => m.date)].sort();
  const depart = I.p.circuit_date_depart?.date || dates[0] || '0000-01-01';
  const depots = (D.agents || []).filter((a) => a.role_circuit === 'depot' && a.actif !== false);
  const sous = (D.agents || []).filter((a) => a.role_circuit === 'sous_agent' && a.actif !== false);
  const grossistes = (D.grossistes || []).filter((g) => g.actif !== false);
  const sousDe = new Map(depots.map((d) => [d.id, sous.filter((s) => s.depot_id === d.id)]));
  const reseau = (depotId) => new Set([depotId, ...(sousDe.get(depotId) || []).map((s) => s.id)]);
  const venteById = new Map(ventes.map((x) => [x.v.id, x]));
  return { D, I, mv, vers, ventes, rembs, depart, depots, sous, grossistes, sousDe, reseau, venteById };
}

const entre = (d, a, b) => d >= a && d < b;       // [a ; b[
const jourJ = (d, j) => d === j;

// Situation d'une journée pour un agent-dépôt ou un sous-agent
function situationVendeur(C, agent, date, { depot }) {
  const dep = C.depart;
  const avant = (d) => d >= dep && d < date;
  const venduPar = (f) => C.ventes.filter((x) => x.v.agent_id === agent.id && f(x.v.date));
  const entrees = (f) => (depot ? C.mv.filter((m) => m.type === 'prise' && m.agent_id === agent.id && f(m.date)) : C.mv.filter((m) => m.type === 'dispatch' && m.sous_agent_id === agent.id && f(m.date)));
  const dispatchs = (f) => (depot ? C.mv.filter((m) => m.type === 'dispatch' && m.agent_id === agent.id && f(m.date)) : []);
  const si = round2(num(agent.stock_initial) + somme(entrees(avant), (m) => m.cartons) - somme(dispatchs(avant), (m) => m.cartons) - somme(venduPar(avant), (x) => x.cartons));
  const recu = somme(entrees((d) => jourJ(d, date)), (m) => m.cartons);
  const disp = somme(dispatchs((d) => jourJ(d, date)), (m) => m.cartons);
  const vj = venduPar((d) => jourJ(d, date));
  const vc = somme(vj.filter((x) => x.v.mode === 'comptant'), (x) => x.cartons);
  const vk = somme(vj.filter((x) => x.v.mode === 'credit'), (x) => x.cartons);
  const sf = round2(si + recu - disp - vc - vk);
  const ids = depot ? C.reseau(agent.id) : new Set([agent.id]);
  const aVerser = somme(C.ventes.filter((x) => ids.has(x.v.agent_id) && x.v.mode === 'comptant' && x.v.date === date), (x) => x.montant);
  const vs = C.vers.filter((v) => v.objet === 'ventes_comptant' && ids.has(v.agent_id) && v.date === date);
  const verse = somme(vs, (v) => v.montant);
  const verseGrossiste = somme(vs.filter((v) => v.lieu === 'grossiste'), (v) => v.montant);
  const remb = somme(C.rembs.filter((r) => r.date === date && ids.has(C.venteById.get(r.vente_id)?.v.agent_id)), (r) => r.montant);
  const credits = C.ventes.filter((x) => ids.has(x.v.agent_id) && x.v.mode === 'credit').map((x) => creditInfo(x.v, C.I, date));
  const enCours = somme(credits, (c) => c.solde), enRetard = somme(credits.filter((c) => c.statut === 'En retard'), (c) => c.solde);
  return { id: agent.id, code: agent.code || '', nom: agent.nom, equipe_id: agent.equipe_id, depot_id: agent.depot_id || null, si, recu, disp, vc, vk, sf, aVerser, verse, verseGrossiste, ecart: round2(aVerser - verse), remb, enCours, enRetard };
}

export function situationDepots(C, date) {
  return C.depots.map((d) => {
    const s = situationVendeur(C, d, date, { depot: true });
    const ss = (C.sousDe.get(d.id) || []).map((x) => situationVendeur(C, x, date, { depot: false }));
    return { ...s, stockSous: somme(ss, (x) => x.sf), venduReseau: round2(s.vc + s.vk + somme(ss, (x) => x.vc + x.vk)), nbSous: ss.length, sousAgents: ss };
  });
}
export function situationSous(C, date) { return C.sous.map((s) => situationVendeur(C, s, date, { depot: false })); }

// Semaine du lundi w0 au dimanche (w0 + 6)
export const lundi = (d) => { const j = new Date(d + 'T00:00:00Z').getUTCDay(); return addDays(d, -((j + 6) % 7)); };
export function grossistesSemaine(C, w0) {
  const w1 = addDays(w0, 7), dep = C.depart;
  return C.grossistes.map((g) => {
    const ap = C.mv.filter((m) => m.type === 'appro' && m.grossiste_id === g.id), pr = C.mv.filter((m) => m.type === 'prise' && m.grossiste_id === g.id);
    const si = round2(num(g.stock_initial) + somme(ap.filter((m) => entre(m.date, dep, w0)), (m) => m.cartons) - somme(pr.filter((m) => entre(m.date, dep, w0)), (m) => m.cartons));
    const sem = (l) => l.filter((m) => entre(m.date, w0, w1));
    const usine = somme(sem(ap).filter((m) => m.fournisseur !== 'Oriba Rice'), (m) => m.cartons), rice = somme(sem(ap).filter((m) => m.fournisseur === 'Oriba Rice'), (m) => m.cartons);
    const pc = somme(sem(pr).filter((m) => m.mode !== 'credit'), (m) => m.cartons), pk = somme(sem(pr).filter((m) => m.mode === 'credit'), (m) => m.cartons);
    const valeur = round2(num(g.solde_initial) + somme(ap.filter((m) => m.date < w1), (m) => m.montant));
    const regl = C.vers.filter((v) => v.objet === 'reglement_grossiste' && v.grossiste_id === g.id);
    const regle = somme(regl.filter((v) => v.date < w1), (v) => v.montant);
    return { id: g.id, code: g.code || '', nom: g.nom, localite: g.localite || '', fournisseur: g.fournisseur || '', si, usine, rice, pc, pk, sf: round2(si + usine + rice - pc - pk), valeur, regle, solde: round2(valeur - regle),
      regleSemaine: somme(sem(regl), (v) => v.montant), recuAgents: somme(C.vers.filter((v) => v.lieu === 'grossiste' && v.lieu_grossiste_id === g.id && entre(v.date, w0, w1)), (v) => v.montant) };
  });
}

// Évolution jour par jour (tout le circuit)
export function serie(C, date, n = 7) {
  const out = [];
  for (let k = n - 1; k >= 0; k--) {
    const d = addDays(date, -k);
    const vj = C.ventes.filter((x) => x.v.date === d && x.v.date >= C.depart && C.reseauTous().has(x.v.agent_id));
    out.push({ date: d, pris: somme(C.mv.filter((m) => m.type === 'prise' && m.date === d), (m) => m.cartons), disp: somme(C.mv.filter((m) => m.type === 'dispatch' && m.date === d), (m) => m.cartons),
      vc: somme(vj.filter((x) => x.v.mode === 'comptant'), (x) => x.cartons), vk: somme(vj.filter((x) => x.v.mode === 'credit'), (x) => x.cartons), ca: somme(vj.filter((x) => x.v.mode === 'comptant'), (x) => x.montant),
      verse: somme(C.vers.filter((v) => v.objet === 'ventes_comptant' && v.date === d), (v) => v.montant) });
  }
  return out;
}

// Crédits clients du circuit (ventes à crédit des agents-dépôts et sous-agents)
export function creditsCircuit(C, date) {
  const ids = C.reseauTous();
  return C.ventes.filter((x) => x.v.mode === 'credit' && ids.has(x.v.agent_id) && x.v.date <= date).map((x) => ({ x, ci: creditInfo(x.v, C.I, date) }))
    .filter((c) => c.ci.solde > 0).map(({ x, ci }) => ({ id: x.v.id, numero: x.v.numero, date: x.v.date, echeance: x.v.echeance, client_id: x.v.client_id, agent_id: x.v.agent_id, montant: ci.montant, rembourse: ci.rembourse, solde: ci.solde, statut: ci.statut, joursRetard: ci.joursRetard,
      proche: ci.statut !== 'En retard' && x.v.echeance && x.v.echeance >= date && (Date.parse(x.v.echeance) - Date.parse(date)) / 86400000 <= 2 }));
}

export function contexte(D, I) {
  const C = circuitCtx(D, I);
  let tous = null;
  C.reseauTous = () => (tous ||= new Set([...C.depots, ...C.sous].map((a) => a.id)));
  return C;
}
