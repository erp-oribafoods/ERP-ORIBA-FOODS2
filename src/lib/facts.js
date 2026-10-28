// Préparation des faits filtrés (lignes de vente, remboursements) pour les tableaux de bord et analyses.
import { creditInfo, venteTotals, today, addDays, num, round2 } from '../../shared/logic.js';

export function periodRange(f) {
  const t = today();
  const y = t.slice(0, 4), m = t.slice(5, 7);
  const firstOfMonth = `${y}-${m}-01`;
  switch (f.preset) {
    case 'jour': return [t, t];
    case '7j': return [addDays(t, -6), t];
    case 'mois': return [firstOfMonth, t];
    case 'mois_prec': { const d = new Date(Date.UTC(+y, +m - 2, 1)); const s = d.toISOString().slice(0, 10); const e = addDays(firstOfMonth, -1); return [s, e]; }
    case 'trimestre': { const q = Math.floor((+m - 1) / 3) * 3 + 1; return [`${y}-${String(q).padStart(2, '0')}-01`, t]; }
    case 'annee': return [`${y}-01-01`, t];
    case 'perso': return [f.du || '0000-01-01', f.au || '9999-12-31'];
    default: return ['0000-01-01', '9999-12-31'];
  }
}

export const PRESETS = [['tout', 'Toute la période'], ['jour', "Aujourd'hui"], ['7j', '7 derniers jours'], ['mois', 'Ce mois'], ['mois_prec', 'Mois précédent'], ['trimestre', 'Ce trimestre'], ['annee', 'Cette année'], ['perso', 'Période personnalisée']];

export function venteCtx(v, I) {
  const m = I.marches.get(v.marche_id), a = I.agents.get(v.agent_id);
  return { zone_id: m?.zone_id || a?.zone_id || null, equipe_id: a?.equipe_id || m?.equipe_id || null };
}

export function venteMatches(v, f, I, { ignorePeriod = false } = {}) {
  if (v.statut !== 'validee') return false;
  if (!ignorePeriod) { const [du, au] = periodRange(f); if (v.date < du || v.date > au) return false; }
  if (f.agent_id && v.agent_id !== f.agent_id) return false;
  if (f.marche_id && v.marche_id !== f.marche_id) return false;
  if (f.client_id && v.client_id !== f.client_id) return false;
  if (f.mode && v.mode !== f.mode) return false;
  if (f.zone_id && venteCtx(v, I).zone_id !== f.zone_id) return false;
  if (f.equipe_id && venteCtx(v, I).equipe_id !== f.equipe_id) return false;
  return true;
}

// Une ligne de fait par ligne de vente
export function salesFacts(I, f, opts = {}) {
  const out = [];
  for (const v of I.D.ventes || []) {
    if (!venteMatches(v, f, I, opts)) continue;
    const c = venteCtx(v, I);
    for (const l of I.lignesByVente.get(v.id) || []) {
      if (f.produit_id && l.produit_id !== f.produit_id) continue;
      if (f.unite && l.unite !== f.unite) continue;
      out.push({ v, l, id: l.id, date: v.date, mois: v.date.slice(0, 7), mode: v.mode, agent_id: v.agent_id, marche_id: v.marche_id, client_id: v.client_id, produit_id: l.produit_id, zone_id: c.zone_id, equipe_id: c.equipe_id, montant: num(l.montant), cartons: num(l.cartons), quantite: num(l.quantite), unite: l.unite });
    }
  }
  return out;
}

// Remboursements enregistrés sur la période, imputés au prorata du produit si filtre produit
export function rembFacts(I, f) {
  const [du, au] = periodRange(f);
  const out = [];
  for (const r of I.D.remboursements || []) {
    if (r.statut !== 'valide' || r.date < du || r.date > au) continue;
    const v = I.ventes.get(r.vente_id);
    if (!v || !venteMatches(v, { ...f, mode: '' }, I, { ignorePeriod: true })) continue;
    let share = 1;
    if (f.produit_id || f.unite) {
      const t = venteTotals(v, I);
      const part = t.lignes.filter((l) => (!f.produit_id || l.produit_id === f.produit_id) && (!f.unite || l.unite === f.unite)).reduce((s, l) => s + num(l.montant), 0);
      share = t.montant > 0 ? part / t.montant : 0;
    }
    if (share > 0) out.push({ r, v, id: r.id, date: r.date, mois: r.date.slice(0, 7), montant: round2(num(r.montant) * share) });
  }
  return out;
}

// Créances ouvertes (non filtrées par la période : état à date)
export function openCredits(I, f, asOf = today()) {
  const out = [];
  for (const v of I.D.ventes || []) {
    if (v.mode !== 'credit' || !venteMatches(v, { ...f, mode: '' }, I, { ignorePeriod: true })) continue;
    const ci = creditInfo(v, I, asOf);
    if (f.produit_id && !ci.lignes.some((l) => l.produit_id === f.produit_id)) continue;
    out.push({ v, ci, id: v.id });
  }
  return out;
}

// Créances ouvertes à chaque fin de mois
export function creancesParMois(I, f, mois) {
  return mois.map((m) => {
    const [y, mm] = m.split('-').map(Number);
    const end = new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10);
    const asOf = end > today() ? today() : end;
    let s = 0;
    for (const v of I.D.ventes || []) {
      if (v.mode !== 'credit' || v.date > asOf || !venteMatches(v, { ...f, mode: '' }, I, { ignorePeriod: true })) continue;
      s += creditInfo(v, I, asOf).solde;
    }
    return s;
  });
}

export function groupSum(rows, key, val = 'montant') {
  const m = new Map();
  for (const r of rows) { const k = typeof key === 'function' ? key(r) : r[key]; m.set(k, (m.get(k) || 0) + (typeof val === 'function' ? val(r) : r[val])); }
  return m;
}

export function monthsBetween(a, b) {
  const out = [];
  let [y, m] = a.slice(0, 7).split('-').map(Number);
  const [yb, mb] = b.slice(0, 7).split('-').map(Number);
  while (y < yb || (y === yb && m <= mb)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } if (out.length > 60) break; }
  return out;
}

export const MOIS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
export const moisLabel = (m) => `${MOIS_FR[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
export function isoWeek(d) {
  const t = new Date(Date.parse(d + 'T00:00:00Z'));
  const day = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - day + 3);
  const fy = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const w = 1 + Math.round(((t - fy) / 86400000 - 3 + ((fy.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-S${String(w).padStart(2, '0')}`;
}
