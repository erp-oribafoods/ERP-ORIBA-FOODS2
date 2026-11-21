// Prévisions de vente mensuelles par agent, marché, zone et dépôt.
// Méthode (expliquée aussi dans l'écran) :
//  1. Historique mensuel des ventes validées de chaque entité (cartons et chiffre d'affaires).
//  2. Chaque mois est « désaisonnalisé » : divisé par son coefficient saisonnier (Ramadan, Korité, Tabaski, fêtes, hivernage…).
//  3. Niveau de base = moyenne pondérée des 3 derniers mois désaisonnalisés (poids 1-2-3, le plus récent pèse le plus).
//  4. Tendance = évolution entre les mois anciens et récents, plafonnée et amortie dans le temps.
//  5. Prévision du mois = niveau × tendance × coefficient saisonnier du mois : elle monte progressivement à l'approche
//     des pics et redescend après, au lieu de rester figée.
//  6. Mois en cours : la prévision est révisée chaque jour avec le rythme réellement observé (projection révisée).
//  Sans historique, l'objectif du mois sert de base (signalé).
import { num } from './logic.js';

// Dates estimées (calendrier lunaire : à ajuster d'un ou deux jours selon l'annonce officielle).
// Les périodes couvrent les jours où la demande monte (achats avant la fête).
export const EVENEMENTS = [
  ...[
    ['2026', '2026-02-18', '2026-03-19', '2026-03-13', '2026-03-20', '2026-05-13', '2026-05-27', '2026-08-20', '2026-08-25'],
    ['2027', '2027-02-08', '2027-03-09', '2027-03-03', '2027-03-10', '2027-05-03', '2027-05-17', '2027-08-09', '2027-08-14'],
    ['2028', '2028-01-28', '2028-02-26', '2028-02-20', '2028-02-27', '2028-04-21', '2028-05-05', '2028-07-28', '2028-08-02'],
  ].flatMap(([a, rd, rf, kd, kf, td, tf, md, mf]) => [
    { cle: 'ramadan', nom: `Ramadan ${a}`, du: rd, au: rf },
    { cle: 'korite', nom: `Préparatifs de la Korité ${a}`, du: kd, au: kf },
    { cle: 'tabaski', nom: `Préparatifs de la Tabaski ${a}`, du: td, au: tf },
    { cle: 'maouloud', nom: `Maouloud ${a}`, du: md, au: mf },
  ]),
  ...['2026', '2027', '2028'].flatMap((a) => [
    { cle: 'hivernage', nom: `Hivernage ${a}`, du: `${a}-07-01`, au: `${a}-09-15` },
    { cle: 'rentree', nom: `Rentrée scolaire ${a}`, du: `${a}-10-01`, au: `${a}-10-20` },
    { cle: 'fetes', nom: `Fêtes de fin d’année ${a}`, du: `${a}-12-15`, au: `${a}-12-31` },
  ]),
];
export const LIB_EVT = { ramadan: 'Ramadan', korite: 'Korité', tabaski: 'Tabaski', maouloud: 'Maouloud', hivernage: 'Hivernage', rentree: 'Rentrée scolaire', fetes: 'Fêtes de fin d’année' };
// Effet sur la demande, en % (paramétrable dans Administration > Paramètres)
export const COEF_DEFAUT = { ramadan: 25, korite: 20, tabaski: 35, maouloud: 10, hivernage: -10, rentree: 10, fetes: 20 };
export const effets = (p = {}) => Object.fromEntries(Object.entries(COEF_DEFAUT).map(([k, d]) => [k, p[`prev_effet_${k}`] === undefined || p[`prev_effet_${k}`] === null ? d : (k === 'hivernage' ? -Math.abs(num(p[`prev_effet_${k}`])) : num(p[`prev_effet_${k}`]))]));

const iso = (d) => d.toISOString().slice(0, 10);
export const joursDuMois = (m) => { const [y, mm] = m.split('-').map(Number); const n = new Date(Date.UTC(y, mm, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`); };
export const moisSuivant = (m, k = 1) => { const [y, mm] = m.split('-').map(Number); return iso(new Date(Date.UTC(y, mm - 1 + k, 1))).slice(0, 7); };
export const ecartMois = (a, b) => { const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number); return (yb - ya) * 12 + (mb - ma); };
export function listeMois(a, b) { const out = []; for (let m = a; m <= b; m = moisSuivant(m)) out.push(m); return out; }

// Poids d'un jour : 1 + somme des effets des périodes qui le couvrent
export function poidsJour(d, eff) {
  let p = 1;
  for (const e of EVENEMENTS) if (d >= e.du && d <= e.au) p += (eff[e.cle] || 0) / 100;
  return Math.max(0.2, p);
}
export function coefMois(m, eff) { const j = joursDuMois(m); return j.reduce((s, d) => s + poidsJour(d, eff), 0) / j.length; }
export const evenementsDuMois = (m) => { const d = `${m}-01`, f = joursDuMois(m).at(-1); return EVENEMENTS.filter((e) => e.au >= d && e.du <= f); };

// Prévision d'un mois à partir de l'historique strictement antérieur
// serie : Map mois -> valeur ; debut : premier mois de données du service ; base : objectif de repli
// dernier : dernier mois complet connu (les mois futurs ne comptent pas comme des mois à zéro)
export function prevoir(serie, mois, { debut, dernier, eff, croissanceMax = 10, base = null }) {
  const veille = moisSuivant(mois, -1), fin = dernier && dernier < veille ? dernier : veille;
  const hist = debut && debut <= fin ? listeMois(debut, fin).slice(-6) : [];
  const ds = hist.map((m) => num(serie.get(m)) / coefMois(m, eff));
  const total = ds.reduce((s, x) => s + x, 0);
  const c = coefMois(mois, eff);
  if (!hist.length || total <= 0) {
    if (base === null || base === undefined) return { valeur: 0, source: 'aucune', niveau: 0, tendance: 0, coef: c };
    return { valeur: num(base), source: 'objectif', niveau: num(base) / c, tendance: 0, coef: c };
  }
  const der = ds.slice(-3), w = der.map((_, i) => i + 1);
  const niveau = der.reduce((s, x, i) => s + x * w[i], 0) / w.reduce((s, x) => s + x, 0);
  let tendance = 0;
  if (ds.length >= 2) {
    const mi = Math.floor(ds.length / 2), a = ds.slice(0, mi), b = ds.slice(mi);
    const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length;
    const ecart = (a.length + b.length) / 2;
    if (ma > 0) tendance = (mb / ma - 1) / ecart;
    const cap = croissanceMax / 100;
    tendance = Math.max(-cap, Math.min(cap, tendance));
  }
  // Tendance amortie : l'effet s'atténue de 20 % par mois d'horizon
  const h = Math.max(1, ecartMois(fin, mois));
  let mult = 1; for (let k = 1; k <= h; k++) mult += tendance * Math.pow(0.8, k - 1);
  return { valeur: Math.max(0, niveau * mult * c), source: 'historique', niveau, tendance, coef: c, mois: hist.length };
}

// Répartition d'une prévision mensuelle jour par jour (pondérée par les pics), cumulée par semaine
export function repartition(mois, total, eff) {
  const j = joursDuMois(mois), p = j.map((d) => poidsJour(d, eff)), s = p.reduce((a, b) => a + b, 0) || 1;
  return j.map((d, i) => ({ date: d, prev: (total * p[i]) / s, poids: p[i] }));
}

// Projection révisée du mois en cours : ce qui est fait + reste à faire corrigé du rythme observé
export function reviser(prevision, realise, mois, aujourdhui, eff) {
  const jours = repartition(mois, prevision, eff);
  const attendu = jours.filter((x) => x.date <= aujourdhui).reduce((s, x) => s + x.prev, 0);
  const reste = prevision - attendu;
  const avancement = prevision > 0 ? attendu / prevision : 0; // part de la demande du mois déjà « passée »
  if (attendu <= 0) return { attendu, projection: prevision, avancement, rythme: null };
  const rythme = realise / attendu;
  const projection = realise + reste * ((1 - avancement) + avancement * rythme);
  return { attendu, projection: Math.max(realise, projection), avancement, rythme };
}

// Agrège les faits de vente par entité et par mois
export function series(faits, cle, mesure) {
  const out = new Map();
  for (const f of faits) {
    const k = cle(f); if (!k) continue;
    if (!out.has(k)) out.set(k, new Map());
    const m = out.get(k); m.set(f.mois, (m.get(f.mois) || 0) + num(f[mesure]));
  }
  return out;
}
