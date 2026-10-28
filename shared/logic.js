// Règles de calcul partagées entre le serveur et le navigateur.
import { DEFAULT_PARAMS } from './schema.js';

export const TZ = 'Africa/Niamey';

export function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function nowISO() { return new Date().toISOString(); }
export function dayNum(d) { return Math.floor(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') / 86400000); }
export function daysBetween(a, b) { return dayNum(b) - dayNum(a); }
export function addDays(d, n) {
  const t = new Date(Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') + n * 86400000);
  return t.toISOString().slice(0, 10);
}
export function moisDe(d) { return String(d).slice(0, 7); }
export const round2 = (x) => Math.round((Number(x) + Number.EPSILON) * 100) / 100;
export const num = (x) => (x === null || x === undefined || x === '' ? 0 : Number(x));
export function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s)); }

export function params(D) {
  const p = { ...DEFAULT_PARAMS };
  for (const r of D.parametres || []) p[r.cle] = r.valeur;
  return p;
}

export function lineCalc(produit, unite, quantite, prix) {
  const q = num(quantite), pu = num(prix);
  const ppc = num(produit?.packs_par_carton) || 12;
  return { montant: round2(q * pu), cartons: unite === 'pack' ? Math.round((q / ppc) * 10000) / 10000 : q };
}

// Index des données pour des calculs rapides
export function buildIndex(D) {
  const by = (arr) => { const m = new Map(); for (const r of arr || []) m.set(r.id, r); return m; };
  const group = (arr, key) => { const m = new Map(); for (const r of arr || []) { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  return {
    D,
    p: params(D),
    ventes: by(D.ventes), clients: by(D.clients), produits: by(D.produits), agents: by(D.agents),
    marches: by(D.marches), zones: by(D.zones), equipes: by(D.equipes), vehicules: by(D.vehicules),
    categories: by(D.categories_depense), users: by(D.utilisateurs), roles: by(D.roles),
    lignesByVente: group((D.vente_lignes || []).filter((l) => !l.annulee), 'vente_id'),
    rembByVente: group((D.remboursements || []).filter((r) => r.statut === 'valide'), 'vente_id'),
    relancesByVente: group(D.relances, 'vente_id'),
    stockByLot: group((D.stock_mouvements || []).filter((m) => m.statut === 'valide' && m.type !== 'remise'), 'lot_id'),
    repByDep: group((D.depense_repartitions || []).filter((r) => r.actif !== false), 'depense_id'),
    valByDep: group(D.depense_validations, 'depense_id'),
  };
}

export function venteTotals(v, I) {
  const lignes = I.lignesByVente.get(v.id) || [];
  let montant = 0, cartons = 0;
  for (const l of lignes) { montant += num(l.montant); cartons += num(l.cartons); }
  return { montant: round2(montant), cartons, lignes };
}

// Statuts calculés : priorité Soldé > En retard > Partiellement remboursé > En attente
export function creditInfo(v, I, asOf = today()) {
  const { montant, cartons, lignes } = venteTotals(v, I);
  const rembs = (I.rembByVente.get(v.id) || []).filter((r) => String(r.date) <= asOf);
  const rembourse = round2(rembs.reduce((s, r) => s + num(r.montant), 0));
  const solde = round2(montant - rembourse);
  const tol = num(I.p.tolerance_solde_fcfa);
  let statut;
  let joursRetard = 0;
  if (v.statut === 'annulee') statut = 'Annulée';
  else if (solde <= tol) statut = 'Soldé';
  else if (v.echeance && asOf > String(v.echeance)) { statut = 'En retard'; joursRetard = daysBetween(v.echeance, asOf); }
  else if (rembourse > 0) statut = 'Partiellement remboursé';
  else statut = 'En attente';
  const soldeOuvert = statut === 'Soldé' || statut === 'Annulée' ? 0 : solde;
  const cartonsRestants = montant > 0 ? (cartons * soldeOuvert) / montant : 0;
  const age = daysBetween(v.date, asOf);
  return { montant, cartons, lignes, rembourse, solde: soldeOuvert, soldeBrut: solde, cartonsRestants, statut, joursRetard, age, remboursements: rembs };
}

export function plafondClient(client, I) {
  const ind = client && client.plafond_cartons !== null && client.plafond_cartons !== undefined && client.plafond_cartons !== '' ? num(client.plafond_cartons) : null;
  return ind ?? num(I.p.plafond_cartons_client);
}

export function encoursClient(clientId, I, excludeVenteId = null) {
  let c = 0, f = 0;
  for (const v of I.D.ventes || []) {
    if (v.client_id !== clientId || v.mode !== 'credit' || v.statut !== 'validee' || v.id === excludeVenteId) continue;
    const ci = creditInfo(v, I);
    c += ci.cartonsRestants; f += ci.solde;
  }
  return { cartons: Math.round(c * 1000) / 1000, fcfa: round2(f) };
}

export function niveauPlafond(pct, seuils) {
  const [s1, s2, s3] = (seuils || [75, 90, 100]).map(Number);
  if (pct > s3) return { niv: 'depasse', label: 'Plafond dépassé', sev: 'crit' };
  if (pct >= s3) return { niv: 'atteint', label: 'Plafond atteint', sev: 'crit' };
  if (pct >= s2) return { niv: 's2', label: `Seuil ${s2} % franchi`, sev: 'crit' };
  if (pct >= s1) return { niv: 's1', label: `Seuil ${s1} % franchi`, sev: 'warn' };
  return { niv: 'ok', label: 'Sous les seuils', sev: 'ok' };
}

export function plafondsClients(I) {
  const out = [];
  const seuils = I.p.seuils_plafond;
  for (const c of I.D.clients || []) {
    const e = encoursClient(c.id, I);
    if (e.cartons <= 0 && e.fcfa <= 0) continue;
    const plafond = plafondClient(c, I);
    const pct = plafond > 0 ? (e.cartons / plafond) * 100 : 0;
    out.push({ client: c, encours: e.cartons, fcfa: e.fcfa, plafond, pct, marge: plafond - e.cartons, ...niveauPlafond(pct, seuils) });
  }
  return out.sort((a, b) => b.pct - a.pct);
}

// Stock confié : un lot = une remise ; solde propre à chaque lot
export function lots(I, asOf = today()) {
  const out = [];
  const dormant = num(I.p.jours_stock_dormant) || 30;
  for (const r of I.D.stock_mouvements || []) {
    if (r.type !== 'remise' || r.statut !== 'valide') continue;
    const mv = (I.stockByLot.get(r.id) || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const t = { vente: 0, retour: 0, perte: 0, ajustement_plus: 0, ajustement_moins: 0 };
    let dernierInv = null, derniereVente = null;
    let theo = num(r.quantite);
    for (const m of mv) {
      if (m.type === 'inventaire') {
        dernierInv = { date: m.date, physique: num(m.quantite), theorique: theo, ecart: round2(num(m.quantite) - theo), id: m.id };
        continue;
      }
      t[m.type] += num(m.quantite);
      if (m.type === 'vente') { derniereVente = m.date; theo -= num(m.quantite); }
      else if (m.type === 'ajustement_plus') theo += num(m.quantite);
      else theo -= num(m.quantite);
    }
    const restant = Math.round(theo * 1000) / 1000;
    const ref = derniereVente || r.date;
    const isDormant = restant > 0 && daysBetween(ref, asOf) > dormant;
    out.push({
      lot: r, id: r.id, client_id: r.client_id, produit_id: r.produit_id, date: r.date,
      initial: num(r.quantite), vendu: t.vente, retour: t.retour, perte: t.perte,
      ajustPlus: t.ajustement_plus, ajustMoins: t.ajustement_moins, ajuste: t.ajustement_plus - t.ajustement_moins - t.perte - t.retour,
      restant, valeurUnitaire: num(r.valeur_unitaire), valeurRestante: round2(restant * num(r.valeur_unitaire)),
      valeurInitiale: round2(num(r.quantite) * num(r.valeur_unitaire)),
      dernierInv, derniereVente, dormant: isDormant, negatif: restant < 0,
      ecartInventaire: dernierInv && Math.abs(dernierInv.ecart) > 0.0001,
      mouvements: mv,
    });
  }
  return out;
}

export function depenseAllocations(dep, I) {
  if (dep.partagee) {
    const reps = I.repByDep.get(dep.id) || [];
    if (reps.length) return reps.map((r) => ({ equipe_id: r.equipe_id, montant: num(r.montant) }));
  }
  return [{ equipe_id: dep.equipe_id, montant: num(dep.montant) }];
}

export function doublonKeyDepense(d) {
  return [d.date, round2(d.montant), d.categorie_id, d.equipe_id || '', (d.reference_piece || '').trim().toLowerCase(), (d.beneficiaire || '').trim().toLowerCase()].join('|');
}
export function doublonsDepenses(deps) {
  const m = new Map();
  for (const d of deps) {
    if (d.statut === 'annulee' || d.statut === 'rejetee' || d.historique) continue;
    const k = doublonKeyDepense(d);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(d.id);
  }
  const s = new Set();
  for (const ids of m.values()) if (ids.length > 1) ids.forEach((i) => s.add(i));
  return s;
}

export function moisClos(D, mois) {
  return (D.clotures || []).some((c) => c.mois === mois && c.statut === 'cloture');
}

// Centre d'alertes
export function alertes(I, asOf = today(), perms = null) {
  const can = (m) => !perms || (perms[m] || []).includes('lire');
  const p = I.p;
  const A = [];
  const nom = (map, id, k = 'nom') => map.get(id)?.[k] || '—';
  if (can('creances') || can('ventes') || can('dashboard')) {
    for (const r of plafondsClients(I)) {
      if (r.niv === 'ok') continue;
      A.push({
        sev: r.sev, type: 'Plafond de créances', page: 'creances', id: r.client.id,
        msg: `${r.client.nom} : ${r.label} — ${fmtQ(r.encours)} ctn / ${fmtQ(r.plafond)} (${r.pct.toFixed(0)} %), marge ${fmtQ(r.marge)} ctn`,
      });
    }
    const jAlerte = num(p.jours_alerte_echeance), jAnc = num(p.jours_creance_ancienne);
    for (const v of I.D.ventes || []) {
      if (v.mode !== 'credit' || v.statut !== 'validee') continue;
      const ci = creditInfo(v, I, asOf);
      if (ci.statut === 'Soldé') continue;
      const cl = nom(I.clients, v.client_id);
      if (ci.statut === 'En retard') A.push({ sev: 'crit', type: 'Échéance dépassée', page: 'credit', id: v.id, msg: `${v.numero} — ${cl} : ${fmtF(ci.solde)} dus, ${ci.joursRetard} j de retard` });
      else if (v.echeance && daysBetween(asOf, v.echeance) <= jAlerte) A.push({ sev: 'warn', type: 'Échéance proche', page: 'credit', id: v.id, msg: `${v.numero} — ${cl} : ${fmtF(ci.solde)} à encaisser le ${fmtD(v.echeance)}` });
      if (ci.age > jAnc) A.push({ sev: 'warn', type: 'Créance ancienne', page: 'credit', id: v.id, msg: `${v.numero} — ${cl} : ouverte depuis ${ci.age} jours` });
      const rel = (I.relancesByVente.get(v.id) || []).filter((r) => r.promesse_date).sort((a, b) => String(b.promesse_date).localeCompare(String(a.promesse_date)))[0];
      if (rel && String(rel.promesse_date) < asOf) {
        const paye = (I.rembByVente.get(v.id) || []).some((r) => String(r.date) >= String(rel.date));
        if (!paye) A.push({ sev: 'crit', type: 'Promesse manquée', page: 'credit', id: v.id, msg: `${v.numero} — ${cl} : promesse du ${fmtD(rel.promesse_date)} non tenue` });
      }
    }
  }
  if (can('stock') || can('dashboard')) {
    for (const l of lots(I, asOf)) {
      const lib = `${nom(I.clients, l.client_id)} · ${nom(I.produits, l.produit_id)} (lot ${l.lot.numero})`;
      if (l.negatif) A.push({ sev: 'crit', type: 'Stock négatif', page: 'stock', id: l.id, msg: `${lib} : stock théorique ${fmtQ(l.restant)} ctn` });
      if (l.ecartInventaire) A.push({ sev: 'warn', type: 'Écart d’inventaire', page: 'stock', id: l.id, msg: `${lib} : écart ${fmtQ(l.dernierInv.ecart)} ctn au ${fmtD(l.dernierInv.date)}` });
      if (l.dormant) A.push({ sev: 'info', type: 'Stock dormant', page: 'stock', id: l.id, msg: `${lib} : ${fmtQ(l.restant)} ctn sans vente depuis ${daysBetween(l.derniereVente || l.date, asOf)} j` });
    }
  }
  return A;
}

// Formats
export function fmtF(x) { return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(num(x))) + ' FCFA'; }
export function fmtN(x, d = 0) { return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(num(x)); }
export function fmtQ(x) { return fmtN(x, 2); }
export function fmtD(d) { if (!d) return '—'; const s = String(d).slice(0, 10).split('-'); return s.length === 3 ? `${s[2]}/${s[1]}/${s[0]}` : String(d); }
