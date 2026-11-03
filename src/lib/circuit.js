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
  // Sans date de départ ni mouvement, le stock part d'aujourd'hui (les ventes anciennes ne rendent pas le stock négatif)
  const depart = I.p.circuit_date_depart?.date || dates[0] || (D.agents || []).some((a) => num(a.stock_initial) > 0) && '0000-01-01' || new Date().toISOString().slice(0, 10);
  const depots = (D.agents || []).filter((a) => a.role_circuit === 'depot' && a.actif !== false);
  const sous = (D.agents || []).filter((a) => a.role_circuit === 'sous_agent' && a.actif !== false);
  const grossistes = (D.grossistes || []).filter((g) => g.actif !== false);
  const sousDe = new Map(depots.map((d) => [d.id, sous.filter((s) => s.depot_id === d.id)]));
  const reseau = (depotId) => new Set([depotId, ...(sousDe.get(depotId) || []).map((s) => s.id)]);
  const venteById = new Map(ventes.map((x) => [x.v.id, x]));
  const stockConnu = mv.length > 0 || (D.agents || []).some((a) => num(a.stock_initial) > 0);
  return { D, I, mv, vers, ventes, rembs, depart, depots, sous, grossistes, sousDe, reseau, venteById, stockConnu };
}

const entre = (d, a, b) => d >= a && d < b;       // [a ; b[

// Situation d'un dépôt ou d'un agent sur une période [date ; au] (un jour par défaut)
function situationVendeur(C, agent, date, { depot }, au = date) {
  const dep = C.depart;
  const avant = (d) => d >= dep && d < date;
  const jourJ = (d) => d >= date && d <= au;
  const venduPar = (f) => C.ventes.filter((x) => x.v.agent_id === agent.id && f(x.v.date));
  const entrees = (f) => (depot ? C.mv.filter((m) => m.type === 'prise' && m.agent_id === agent.id && f(m.date)) : C.mv.filter((m) => m.type === 'dispatch' && m.sous_agent_id === agent.id && f(m.date)));
  const dispatchs = (f) => (depot ? C.mv.filter((m) => m.type === 'dispatch' && m.agent_id === agent.id && f(m.date)) : []);
  // Transferts entre dépôts : reçus d'un autre dépôt / envoyés à un autre dépôt
  const trIn = (f) => (depot ? C.mv.filter((m) => m.type === 'transfert' && m.depot_dest_id === agent.id && f(m.date)) : []);
  const trOut = (f) => (depot ? C.mv.filter((m) => m.type === 'transfert' && m.agent_id === agent.id && f(m.date)) : []);
  const si = round2(num(agent.stock_initial) + somme(entrees(avant), (m) => m.cartons) + somme(trIn(avant), (m) => m.cartons) - somme(trOut(avant), (m) => m.cartons) - somme(dispatchs(avant), (m) => m.cartons) - somme(venduPar(avant), (x) => x.cartons));
  const ent = entrees(jourJ);
  const recuTransfert = somme(trIn(jourJ), (m) => m.cartons);
  const transfere = somme(trOut(jourJ), (m) => m.cartons);
  const recu = somme(ent, (m) => m.cartons);
  const recuFoods = somme(ent.filter((m) => m.type === 'prise' && !m.grossiste_id && m.fournisseur !== 'Oriba Rice'), (m) => m.cartons);
  const recuRice = somme(ent.filter((m) => m.type === 'prise' && !m.grossiste_id && m.fournisseur === 'Oriba Rice'), (m) => m.cartons);
  const recuGross = somme(ent.filter((m) => m.type === 'prise' && m.grossiste_id), (m) => m.cartons);
  const disp = somme(dispatchs(jourJ), (m) => m.cartons);
  const vj = venduPar(jourJ);
  const vc = somme(vj.filter((x) => x.v.mode === 'comptant'), (x) => x.cartons);
  const vk = somme(vj.filter((x) => x.v.mode === 'credit'), (x) => x.cartons);
  const sf = round2(si + recu + recuTransfert - transfere - disp - vc - vk);
  const ids = depot ? C.reseau(agent.id) : new Set([agent.id]);
  const vReseau = C.ventes.filter((x) => ids.has(x.v.agent_id) && jourJ(x.v.date));
  const aVerser = somme(vReseau.filter((x) => x.v.mode === 'comptant'), (x) => x.montant);
  const ca = somme(vReseau, (x) => x.montant);
  const vs = C.vers.filter((v) => v.objet === 'ventes_comptant' && ids.has(v.agent_id) && jourJ(v.date));
  const verse = somme(vs, (v) => v.montant);
  const verseGrossiste = somme(vs.filter((v) => v.lieu === 'grossiste'), (v) => v.montant);
  const remb = somme(C.rembs.filter((r) => jourJ(r.date) && ids.has(C.venteById.get(r.vente_id)?.v.agent_id)), (r) => r.montant);
  const credits = C.ventes.filter((x) => ids.has(x.v.agent_id) && x.v.mode === 'credit' && x.v.date <= au).map((x) => creditInfo(x.v, C.I, au));
  // Objectif du mois (cartons) et ventes du mois jusqu'à la fin de la période
  const mois = au.slice(0, 7);
  let objectif = somme((C.D.objectifs || []).filter((o) => o.actif !== false && o.axe === 'agent' && o.mois === mois && !o.produit_id && ids.has(o.cible_id)), (o) => o.objectif_cartons);
  // Sans objectifs par agent, le dépôt reprend l'objectif de son équipe
  if (!objectif && depot && agent.equipe_id) objectif = somme((C.D.objectifs || []).filter((o) => o.actif !== false && o.axe === 'equipe' && o.mois === mois && !o.produit_id && o.cible_id === agent.equipe_id), (o) => o.objectif_cartons);
  const venduMois = somme(C.ventes.filter((x) => ids.has(x.v.agent_id) && x.v.date >= `${mois}-01` && x.v.date <= au), (x) => x.cartons);
  const enCours = somme(credits, (c) => c.solde), enRetard = somme(credits.filter((c) => c.statut === 'En retard'), (c) => c.solde);
  return { id: agent.id, code: agent.code || '', nom: agent.nom, fonction: agent.fonction || '', equipe_id: agent.equipe_id, depot_id: agent.depot_id || null, prix: num(agent.prix_carton) || null, si, recu, recuFoods, recuRice, recuGross, recuTransfert, transfere, disp, vc, vk, sf, ca, aVerser, verse, verseGrossiste, ecart: round2(aVerser - verse), remb, enCours, enRetard, objectif, venduMois, taux: objectif > 0 ? (venduMois / objectif) * 100 : null };
}

// Part des cartons du dépôt venant d'Oriba Rice (le reste : Oriba Food), d'après ses approvisionnements
function partRice(C, depotId, au) {
  const fourn = (m) => (m.grossiste_id ? C.grossistes.find((g) => g.id === m.grossiste_id)?.fournisseur : m.fournisseur);
  let food = 0, rice = 0;
  for (const m of C.mv) if (m.type === 'prise' && m.agent_id === depotId && m.date <= au) { const f = fourn(m); if (f === 'Oriba Rice') rice += num(m.cartons); else if (f) food += num(m.cartons); }
  return food + rice > 0 ? rice / (food + rice) : 0;
}
export function situationDepots(C, date, au = date) {
  return C.depots.map((d) => {
    const s = situationVendeur(C, d, date, { depot: true }, au);
    // Argent à verser : à Oriba Food ou à Oriba Rice
    const pr = partRice(C, d.id, au), ids = C.reseau(d.id);
    const vs = C.vers.filter((v) => v.objet === 'ventes_comptant' && ids.has(v.agent_id) && v.date >= date && v.date <= au);
    const verseRice = round2(somme(vs.filter((v) => v.beneficiaire === 'Oriba Rice'), (v) => v.montant) + somme(vs.filter((v) => !v.beneficiaire), (v) => v.montant) * pr);
    const aVerserRice = round2(s.aVerser * pr);
    const split = { partRice: pr, aVerserRice, aVerserFood: round2(s.aVerser - aVerserRice), verseRice, verseFood: round2(s.verse - verseRice) };
    // Reste à verser = solde : reste à encaisser au départ + ventes comptant depuis le départ − versements depuis le départ
    const dep0 = C.depart, cum = (x) => x >= dep0 && x <= au;
    const vCum = somme(C.ventes.filter((x) => x.v.mode === 'comptant' && ids.has(x.v.agent_id) && cum(x.v.date)), (x) => x.montant);
    const vsCum = C.vers.filter((v) => v.objet === 'ventes_comptant' && ids.has(v.agent_id) && cum(v.date));
    const verseCumRice = round2(somme(vsCum.filter((v) => v.beneficiaire === 'Oriba Rice'), (v) => v.montant) + somme(vsCum.filter((v) => !v.beneficiaire), (v) => v.montant) * pr);
    const verseCum = somme(vsCum, (v) => v.montant);
    split.soldeDepart = round2(num(d.solde_initial_food) + num(d.solde_initial_rice));
    split.resteRice = round2(num(d.solde_initial_rice) + vCum * pr - verseCumRice);
    split.resteFood = round2(num(d.solde_initial_food) + vCum * (1 - pr) - (verseCum - verseCumRice));
    split.reste = round2(split.resteFood + split.resteRice);
    const ss = (C.sousDe.get(d.id) || []).map((x) => situationVendeur(C, x, date, { depot: false }, au));
    const vcR = round2(s.vc + somme(ss, (x) => x.vc)), vkR = round2(s.vk + somme(ss, (x) => x.vk));
    return { ...s, ...split, stockSous: somme(ss, (x) => x.sf), stockTotal: round2(s.sf + somme(ss, (x) => x.sf)), siTotal: round2(s.si + somme(ss, (x) => x.si)), vcReseau: vcR, vkReseau: vkR, venduReseau: round2(vcR + vkR), nbSous: ss.length, sousAgents: ss };
  });
}
export function situationSous(C, date, au = date) { return C.sous.map((s) => situationVendeur(C, s, date, { depot: false }, au)); }

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
    out.push({ date: d, transferts: somme(C.mv.filter((m) => m.type === 'transfert' && m.date === d), (m) => m.cartons), pris: somme(C.mv.filter((m) => m.type === 'prise' && m.date === d), (m) => m.cartons), disp: somme(C.mv.filter((m) => m.type === 'dispatch' && m.date === d), (m) => m.cartons),
      vc: somme(vj.filter((x) => x.v.mode === 'comptant'), (x) => x.cartons), vk: somme(vj.filter((x) => x.v.mode === 'credit'), (x) => x.cartons), ca: somme(vj.filter((x) => x.v.mode === 'comptant'), (x) => x.montant),
      verse: somme(C.vers.filter((v) => v.objet === 'ventes_comptant' && v.date === d), (v) => v.montant) });
  }
  return out;
}

// Crédits clients du circuit (ventes à crédit des agents-dépôts et sous-agents)
export function creditsCircuit(C, date, { tous = false } = {}) {
  const ids = C.reseauTous();
  return C.ventes.filter((x) => x.v.mode === 'credit' && (tous || ids.has(x.v.agent_id)) && x.v.date <= date).map((x) => ({ x, ci: creditInfo(x.v, C.I, date) }))
    .filter((c) => c.ci.solde > 0).map(({ x, ci }) => ({ id: x.v.id, numero: x.v.numero, date: x.v.date, echeance: x.v.echeance, client_id: x.v.client_id, agent_id: x.v.agent_id, montant: ci.montant, rembourse: ci.rembourse, solde: ci.solde, statut: ci.statut, joursRetard: ci.joursRetard,
      proche: ci.statut !== 'En retard' && x.v.echeance && x.v.echeance >= date && (Date.parse(x.v.echeance) - Date.parse(date)) / 86400000 <= 2 }));
}

export function contexte(D, I) {
  const C = circuitCtx(D, I);
  let tous = null;
  C.reseauTous = () => (tous ||= new Set([...C.depots, ...C.sous].map((a) => a.id)));
  return C;
}
