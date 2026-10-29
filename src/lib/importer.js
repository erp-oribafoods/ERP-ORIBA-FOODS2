// Import Excel commun à toutes les rubriques : modèle (pré-rempli quand c'est une mise à jour),
// lecture du fichier, contrôle ligne par ligne, puis envoi au serveur qui applique les règles de gestion.
import { App, nm } from '../app.js';
import { esc, $, fmtN, fmtD, Table, toast, busy, pill, exportRows, saveBlob, icon, modal } from './ui.js';
import { venteTotals, isDate, num, round2, lineCalc, today } from '../../shared/logic.js';
import { REFS, SUIVI_CHAMPS, AXES_OBJECTIF, MODES_PAIEMENT_DEP } from '../../shared/schema.js';
import { estTB, TYPES_TB, analyseTB, detecterEquipe, creerManquants, payloadPropre, modeleTB } from './importTB.js';

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const LABEL = { vehicules: 'immatriculation', categories_depense: 'libelle' };
const refCols = (table) => REFS[table].f.map((f) => f.k.replace(/_id$/, ''));
const refEx = { produits: ['P-001', 'Exemple produit', 'DADI', 12, 13000], agents: ['A01', 'Nom de l’agent', '', 'Niamey 1', 'Niamey', 'Katako', '01/04/2026'], marches: ['Nom du marché', 'Niamey', 'Niamey', 'Niamey 1'], clients: ['C001', 'Nom du client', 'Grossiste', 'Katako', '', '', 'non'], zones: ['Nom de la zone'], equipes: ['EQ1', 'Nom de l’équipe', 'Niamey', 'Responsable'], vehicules: ['AB-1234-RN', 'Toyota Hilux', 'Niamey 1', 'Nom du conducteur'], categories_depense: ['CODE', 'Libellé', 'Autre', 'non', 'non', 'non', 'non'] };

export const TYPES = {
  ...Object.fromEntries(Object.keys(REFS).map((k) => [k, { l: REFS[k].l, cols: refCols(k), ex: refEx[k] || [], perm: ['referentiels', 'modifier'], maj: true, onglet: k }])),
  ventes_comptant: { l: 'Ventes au comptant', cols: ['reference', 'date', 'agent', 'marche', 'client', 'produit', 'unite', 'quantite', 'prix_unitaire', 'observation'], ex: ['', '03/05/2026', 'Nom de l’agent', 'Katako', '', 'P-001', 'carton', 2, 13000, ''], perm: ['ventes', 'creer'], onglet: 'ventes_comptant', aide: 'Une ligne par produit vendu. Plusieurs lignes avec la même « reference » forment une seule vente.' },
  ventes_credit: { l: 'Ventes à crédit', cols: ['reference', 'date', 'agent', 'marche', 'client', 'produit', 'unite', 'quantite', 'prix_unitaire', 'echeance', 'observation'], ex: ['CR-001', '03/05/2026', 'Nom de l’agent', 'Katako', 'C001', 'P-001', 'carton', 10, 13000, '31/05/2026', ''], perm: ['ventes', 'creer'], onglet: 'ventes_credit', aide: 'Client obligatoire. Le plafond de créances est contrôlé comme pour une saisie à l’écran.' },
  remboursements: { l: 'Remboursements', cols: ['reference_vente', 'date', 'montant', 'mode', 'reference'], ex: ['VR-2026-00001', '20/05/2026', 50000, 'Espèces', 'Reçu 123'], perm: ['remboursements', 'creer'], onglet: 'remboursements', aide: '« reference_vente » : numéro ERP de la vente à crédit (VR-…) ou sa référence d’import.' },
  stock_remises: { l: 'Remises de stock confié', cols: ['date', 'depositaire', 'produit', 'quantite', 'valeur_unitaire', 'document'], ex: ['03/06/2026', 'C900', 'P-001', 500, 12500, 'BL-0141'], perm: ['stock', 'creer'], onglet: 'remises_stock' },
  depenses: { l: 'Dépenses (détail)', cols: ['date', 'equipe', 'categorie', 'vehicule', 'montant', 'mode_paiement', 'reference_piece', 'sans_piece', 'beneficiaire', 'description', 'validite_debut', 'validite_fin'], ex: ['05/11/2026', 'Niamey 1', 'Carburant', 'AB-1234-RN', 25000, 'Espèces', 'Ticket 0012', 'non', 'Station Total', '', '', ''], perm: ['depenses', 'creer'], onglet: 'depenses', aide: 'Les dépenses complètes sont soumises au circuit de validation ; celles qui demandent une photo du justificatif restent en brouillon pour qu’on y joigne la pièce.' },
  depenses_agregees: { l: 'Dépenses mensuelles agrégées', cols: ['mois', 'equipe', 'vehicule', 'categorie', 'montant', 'commentaire'], ex: ['2026-05', 'Zinder', '', 'Carburant', 250000, 'Total mai'], perm: ['depenses', 'creer'], onglet: 'depenses_mensuelles', aide: 'Un total par mois, équipe et catégorie (reprise des anciens tableaux).' },
  objectifs: { l: 'Objectifs commerciaux', cols: ['mois', 'axe', 'cible', 'produit', 'objectif_cartons', 'objectif_ca'], ex: ['2026-11', 'agent', 'Nom de l’agent', '', 300, ''], perm: ['objectifs', 'modifier'], maj: true, onglet: 'objectifs', aide: '« axe » : agent, zone, equipe, marche, produit ou global. Videz les deux objectifs d’une ligne pour retirer l’objectif.' },
  suivi_agents: { l: 'Fiches des agents terrain', cols: ['mois', 'agent', ...SUIVI_CHAMPS.map((c) => c[0]), 'commentaire'], ex: ['2026-11', 'Nom de l’agent', 26, 1, 0, 0, '', 200, 180, 30, 2, 3, 8, ''], perm: ['suivi', 'modifier'], maj: true, onglet: 'suivi_agents', aide: 'Une ligne par agent et par mois. La ligne remplace toute la fiche du mois : une case vide efface la valeur.' },
  budgets: { l: 'Budgets de dépenses', cols: ['mois', 'equipe', 'categorie', 'vehicule', 'montant', 'commentaire'], ex: ['2026-11', 'Niamey 1', '', '', 250000, ''], perm: ['budgets', 'modifier'], maj: true, onglet: 'budgets', aide: 'Laissez « categorie » vide pour un budget global de l’équipe.' },
};
export const peutImporter = (type) => { const t = TYPES[type]; return !!t && App.can(t.perm[0], t.perm[1]); };

export function toISO(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) { const j = new Date(v.getTime() + 12 * 3600 * 1000); return new Date(Date.UTC(j.getFullYear(), j.getMonth(), j.getDate())).toISOString().slice(0, 10); } // arrondi au jour le plus proche (dates Excel décalées de quelques secondes)
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s;
}
export function toMonth(v) {
  if (v instanceof Date || typeof v === 'number') return toISO(v)?.slice(0, 7);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.\-](\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})-(\d{2})-\d{2}/); if (m) return `${m[1]}-${m[2]}`;
  const MO = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  const n = norm(s).split('_'); const i = MO.findIndex((x) => n[0]?.startsWith(x.slice(0, 4))); if (i >= 0 && /^\d{4}$/.test(n[1] || '')) return `${n[1]}-${String(i + 1).padStart(2, '0')}`;
  return s;
}
const toNum = (v) => { if (v === '' || v === null || v === undefined) return null; if (typeof v === 'number') return v; const n = Number(String(v).replace(/[\s  ]/g, '').replace(',', '.')); return isNaN(n) ? NaN : n; };
const oui = (v) => ['oui', 'o', 'yes', '1', 'x', 'vrai', 'true'].includes(norm(v));
const vide = (v) => v === '' || v === null || v === undefined;

function resolver(table, label = LABEL[table] || 'nom') {
  const m = new Map();
  for (const r of App.D[table] || []) {
    if (r.code) { m.set(norm(r.code), r.id); if (r[label]) m.set(norm(`${r[label]} (${r.code})`), r.id); }
    if (r[label]) { m.set(norm(r[label]), r.id); m.set(norm(String(r[label]).replace(/\s*\(d[eé]mo\)$/i, '')), r.id); }
    if (r.numero) m.set(norm(r.numero), r.id);
  }
  return (v) => (vide(v) ? null : m.get(norm(v)) ?? undefined);
}

export function analyse(type, raw) {
  const R = { agent: resolver('agents'), marche: resolver('marches'), client: resolver('clients'), produit: resolver('produits'), equipe: resolver('equipes'), zone: resolver('zones'), vehicule: resolver('vehicules'), categorie: resolver('categories_depense') };
  const out = [];
  const need = (row, k, res, label, msgs) => { const id = res(row[k]); if (!vide(row[k]) && id === undefined) msgs.push(`${label} inconnu : « ${row[k]} »`); return id ?? null; };
  const rows = raw.map((r, i) => { const o = { _ligne: i + 2 }; for (const [k, v] of Object.entries(r)) o[norm(k)] = v; return o; }).filter((r) => Object.keys(r).some((k) => k !== '_ligne' && !vide(r[k])));
  const push = (r, msgs, payload, apercu, extra = {}) => out.push({ ligne: r._ligne, statut: msgs.length ? 'rejet' : extra.statut || 'ok', msg: msgs.join(' ; ') || extra.msg || '', payload: { ligne: r._ligne, ...payload }, apercu });

  if (REFS[type]) {
    const label = LABEL[type] || 'nom';
    const find = resolver(type, label);
    for (const r of rows) {
      const msgs = []; const data = {};
      const existe = find(r.code) || find(r[label]);
      for (const f of REFS[type].f) {
        const c = f.k.replace(/_id$/, '');
        if (!(c in r) || (existe && vide(r[c]))) continue; // en mise à jour, une case vide ne change rien
        const v = r[c];
        if (f.t.startsWith('ref:')) { const tb = f.t.slice(4); const id = resolver(tb)(v); if (!vide(v) && id === undefined) msgs.push(`${f.l} inconnu(e) : « ${v} »`); data[f.k] = id ?? null; }
        else if (f.t === 'number') { const n = toNum(v); if (Number.isNaN(n)) msgs.push(`${f.l} : nombre attendu`); data[f.k] = n; }
        else if (f.t === 'bool') data[f.k] = oui(v);
        else if (f.t === 'date') { data[f.k] = toISO(v); if (data[f.k] && !isDate(data[f.k])) msgs.push(`${f.l} : date invalide`); }
        else if (f.t.startsWith('select:')) { const o = f.t.slice(7).split('|').find((x) => norm(x) === norm(v)); if (!vide(v) && !o) msgs.push(`${f.l} : valeur « ${v} » non prévue (${f.t.slice(7).split('|').join(', ')})`); data[f.k] = o || null; }
        else data[f.k] = vide(v) ? null : String(v).trim();
      }
      if (!existe && !data[label]) msgs.push(`${REFS[type].f.find((f) => f.k === label)?.l || 'Nom'} manquant`);
      if (type === 'produits' && !existe && data.packs_par_carton == null) data.packs_par_carton = 12;
      let statut = 'ok', msg = '';
      if (existe) {
        const avant = (App.D[type] || []).find((x) => x.id === existe);
        const diff = Object.keys(data).filter((k) => String(avant?.[k] ?? '') !== String(data[k] ?? ''));
        if (!diff.length) { statut = 'identique'; msg = 'Déjà à jour'; } else { statut = 'maj'; msg = `Mise à jour : ${diff.map((k) => REFS[type].f.find((f) => f.k === k)?.l || k).join(', ')}`; data.id = existe; for (const k of Object.keys(data)) if (k !== 'id' && !diff.includes(k)) delete data[k]; }
      }
      push(r, msgs, { data }, `${r.code || ''} ${r[label] || ''}`.trim(), { statut, msg });
    }
    return out;
  }
  if (type === 'ventes_comptant' || type === 'ventes_credit') {
    const groups = new Map();
    for (const r of rows) { const k = r.reference ? 'ref:' + r.reference : 'ligne:' + r._ligne; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const existing = new Set();
    for (const v of App.D.ventes || []) { if (v.statut !== 'validee') continue; for (const l of venteTotals(v, App.I).lignes) existing.add([v.date, v.agent_id, v.client_id || '', l.produit_id, num(l.quantite), round2(l.montant)].join('|')); }
    const seen = new Set();
    for (const [, g] of groups) {
      const h = g[0]; const msgs = [];
      const data = { date: toISO(h.date), agent_id: need(h, 'agent', R.agent, 'Agent', msgs), marche_id: need(h, 'marche', R.marche, 'Marché', msgs), client_id: need(h, 'client', R.client, 'Client', msgs), observation: h.observation ? String(h.observation) : 'Import Excel', ref_externe: h.reference ? String(h.reference) : null };
      if (!isDate(data.date)) msgs.push('Date manquante ou invalide');
      if (type === 'ventes_credit') { data.echeance = toISO(h.echeance); if (data.echeance && !isDate(data.echeance)) msgs.push('Échéance invalide'); if (!data.client_id) msgs.push('Client obligatoire pour un crédit'); }
      if (data.ref_externe && (App.D.ventes || []).some((v) => v.ref_externe === data.ref_externe && v.statut === 'validee')) msgs.push(`Référence ${data.ref_externe} déjà importée`);
      const lignes = []; let dup = false;
      for (const r of g) {
        const pid = need(r, 'produit', R.produit, 'Produit', msgs);
        if (!pid && !r.produit) msgs.push(`Ligne ${r._ligne} : produit manquant`);
        const u = norm(r.unite || 'carton').startsWith('pack') ? 'pack' : 'carton';
        const q = toNum(r.quantite), p = toNum(r.prix_unitaire);
        if (!(q > 0)) msgs.push(`Ligne ${r._ligne} : quantité vide ou négative`);
        if (p === null || Number.isNaN(p) || p < 0) msgs.push(`Ligne ${r._ligne} : prix unitaire invalide`);
        lignes.push({ produit_id: pid, unite: u, quantite: q, prix_unitaire: p });
        const mt = pid ? round2(lineCalc(App.I.produits.get(pid), u, q, p).montant) : 0;
        const key = [data.date, data.agent_id, data.client_id || '', pid, num(q), mt].join('|');
        if (existing.has(key) || seen.has(key)) dup = true;
        seen.add(key);
      }
      out.push({ ligne: g.map((r) => r._ligne).join(', '), statut: msgs.length ? 'rejet' : dup ? 'doublon' : 'ok', msg: msgs.join(' ; ') || (dup ? 'Doublon potentiel (date, agent, client, produit, quantité, montant)' : ''), payload: { ligne: g[0]._ligne, data, lignes }, apercu: `${fmtD(data.date)} · ${nm.agent(data.agent_id)} · ${lignes.length} ligne(s)` });
    }
    return out;
  }
  if (type === 'remboursements') {
    const byRef = new Map(); for (const v of App.D.ventes || []) { byRef.set(norm(v.numero), v); if (v.ref_externe) byRef.set(norm(v.ref_externe), v); }
    const deja = new Set((App.D.remboursements || []).filter((x) => x.statut !== 'annule').map((x) => [x.vente_id, x.date, round2(x.montant)].join('|')));
    for (const r of rows) {
      const msgs = []; const v = byRef.get(norm(r.reference_vente));
      if (!v) msgs.push(`Vente « ${r.reference_vente} » introuvable (n° ERP ou référence d’import)`);
      else if (v.mode !== 'credit') msgs.push('La vente référencée n’est pas à crédit');
      const d = toISO(r.date); if (!isDate(d)) msgs.push('Date invalide');
      const m = toNum(r.montant); if (!(m > 0)) msgs.push('Montant invalide');
      if (v && m > venteTotals(v, App.I).montant) msgs.push('Remboursement supérieur au montant de la vente');
      const dup = v && deja.has([v.id, d, round2(m)].join('|'));
      push(r, msgs, { data: { vente_id: v?.id, date: d, montant: m, mode: r.mode || null, reference: r.reference ? String(r.reference) : null, commentaire: 'Import Excel' } }, `${r.reference_vente} · ${fmtN(m)} FCFA`, dup ? { statut: 'doublon', msg: 'Même vente, même date, même montant déjà enregistrés' } : {});
    }
    return out;
  }
  if (type === 'stock_remises') {
    for (const r of rows) {
      const msgs = []; const data = { date: toISO(r.date), client_id: need(r, 'depositaire', R.client, 'Dépositaire', msgs), produit_id: need(r, 'produit', R.produit, 'Produit', msgs), quantite: toNum(r.quantite), valeur_unitaire: toNum(r.valeur_unitaire), document: r.document ? String(r.document) : null };
      if (!isDate(data.date)) msgs.push('Date invalide');
      if (!(data.quantite > 0)) msgs.push('Quantité invalide');
      push(r, msgs, { data }, `${nm.client(data.client_id)} · ${nm.produit(data.produit_id)} · ${data.quantite} ctn`);
    }
    return out;
  }
  if (type === 'depenses') {
    const ex = new Set((App.D.depenses || []).filter((d) => d.statut !== 'annulee').map((d) => [d.date, d.equipe_id, d.categorie_id, round2(d.montant)].join('|')));
    for (const r of rows) {
      const msgs = [];
      const data = { date: toISO(r.date), equipe_id: need(r, 'equipe', R.equipe, 'Équipe', msgs), categorie_id: need(r, 'categorie', R.categorie, 'Catégorie', msgs), vehicule_id: need(r, 'vehicule', R.vehicule, 'Véhicule', msgs), montant: toNum(r.montant),
        mode_paiement: vide(r.mode_paiement) ? null : MODES_PAIEMENT_DEP.find((x) => norm(x) === norm(r.mode_paiement)) || String(r.mode_paiement), reference_piece: vide(r.reference_piece) ? null : String(r.reference_piece), sans_piece: oui(r.sans_piece),
        beneficiaire: vide(r.beneficiaire) ? null : String(r.beneficiaire), description: vide(r.description) ? null : String(r.description), validite_debut: toISO(r.validite_debut), validite_fin: toISO(r.validite_fin) };
      if (!isDate(data.date)) msgs.push('Date invalide');
      if (!data.equipe_id) msgs.push('Équipe obligatoire');
      if (!data.categorie_id) msgs.push('Catégorie obligatoire');
      if (!(data.montant > 0)) msgs.push('Montant invalide');
      for (const k of ['validite_debut', 'validite_fin']) if (data[k] && !isDate(data[k])) msgs.push('Date de validité invalide');
      const dup = ex.has([data.date, data.equipe_id, data.categorie_id, round2(data.montant)].join('|'));
      push(r, msgs, { data }, `${fmtD(data.date)} · ${nm.equipe(data.equipe_id)} · ${nm.categorie(data.categorie_id)} · ${fmtN(data.montant)}`, dup ? { statut: 'doublon', msg: 'Même date, équipe, catégorie et montant déjà saisis' } : {});
    }
    return out;
  }
  if (type === 'depenses_agregees') {
    const ex = new Set((App.D.depenses || []).filter((d) => d.historique && d.statut !== 'annulee').map((d) => [d.mois, d.equipe_id, d.categorie_id, round2(d.montant)].join('|')));
    for (const r of rows) {
      const msgs = []; const data = { mois: toMonth(r.mois), equipe_id: need(r, 'equipe', R.equipe, 'Équipe', msgs), vehicule_id: need(r, 'vehicule', R.vehicule, 'Véhicule', msgs), categorie_id: need(r, 'categorie', R.categorie, 'Catégorie', msgs), montant: toNum(r.montant), description: r.commentaire ? String(r.commentaire) : null };
      if (!/^\d{4}-\d{2}$/.test(data.mois || '')) msgs.push('Mois invalide (AAAA-MM attendu)');
      if (!data.equipe_id) msgs.push('Équipe obligatoire');
      if (!data.categorie_id) msgs.push('Catégorie obligatoire');
      if (!(data.montant > 0)) msgs.push('Montant invalide');
      const dup = ex.has([data.mois, data.equipe_id, data.categorie_id, round2(data.montant)].join('|'));
      push(r, msgs, { data }, `${data.mois} · ${nm.equipe(data.equipe_id)} · ${nm.categorie(data.categorie_id)} · ${fmtN(data.montant)}`, dup ? { statut: 'doublon', msg: 'Montant déjà repris pour ce mois, cette équipe et cette catégorie' } : {});
    }
    return out;
  }
  if (type === 'objectifs') {
    const AX = { agent: 'agent', zone: 'zone', equipe: 'equipe', marche: 'marche', produit: 'produit', global: 'global' };
    for (const r of rows) {
      const msgs = [];
      const axe = AX[norm(r.axe)] || Object.keys(AXES_OBJECTIF).find((k) => norm(AXES_OBJECTIF[k]).startsWith(norm(r.axe))) || null;
      if (!axe) msgs.push(`Axe « ${r.axe} » inconnu (agent, zone, equipe, marche, produit ou global)`);
      const mois = toMonth(r.mois); if (!/^\d{4}-\d{2}$/.test(mois || '')) msgs.push('Mois invalide (AAAA-MM attendu)');
      const cible = axe && axe !== 'global' ? need(r, 'cible', R[axe], AXES_OBJECTIF[axe], msgs) : null;
      if (axe && axe !== 'global' && !cible && vide(r.cible)) msgs.push('Cible manquante');
      const produit = need(r, 'produit', R.produit, 'Produit', msgs);
      const oq = toNum(r.objectif_cartons), oca = toNum(r.objectif_ca);
      if (Number.isNaN(oq) || Number.isNaN(oca) || oq < 0 || oca < 0) msgs.push('Objectifs : nombres positifs attendus');
      const ex = (App.D.objectifs || []).find((o) => o.mois === mois && o.axe === axe && (o.cible_id || null) === cible && (o.produit_id || null) === produit);
      const same = ex && num(ex.objectif_cartons ?? -1) === (oq ?? -1) && num(ex.objectif_ca ?? -1) === (oca ?? -1);
      push(r, msgs, { data: { mois, axe, cible_id: cible, produit_id: produit, objectif_cartons: oq, objectif_ca: oca } }, `${mois} · ${axe ? AXES_OBJECTIF[axe] : '?'} · ${r.cible || 'global'} · ${oq ?? '—'} ctn · ${oca ? fmtN(oca) + ' FCFA' : '—'}`,
        same ? { statut: 'identique', msg: 'Déjà à jour' } : ex ? { statut: 'maj', msg: oq === null && oca === null ? 'Objectif retiré' : 'Mise à jour de l’objectif existant' } : oq === null && oca === null ? { statut: 'identique', msg: 'Ligne sans objectif' } : {});
    }
    return out;
  }
  if (type === 'suivi_agents') {
    for (const r of rows) {
      const msgs = [];
      const mois = toMonth(r.mois); if (!/^\d{4}-\d{2}$/.test(mois || '')) msgs.push('Mois invalide (AAAA-MM attendu)');
      const agent = need(r, 'agent', R.agent, 'Agent', msgs); if (!agent && vide(r.agent)) msgs.push('Agent manquant');
      const data = { mois, agent_id: agent, commentaire: vide(r.commentaire) ? null : String(r.commentaire) };
      for (const [k, l, ty] of SUIVI_CHAMPS) { const n = toNum(r[k]); if (Number.isNaN(n) || n < 0) msgs.push(`${l} : nombre positif attendu`); if (ty === 'note' && n > 10) msgs.push('Note sur 10'); data[k] = n; }
      const ex = (App.D.suivi_agents || []).find((x) => x.mois === mois && x.agent_id === agent);
      const cles = [...SUIVI_CHAMPS.map((c) => c[0]), 'commentaire'];
      const diff = ex ? cles.filter((k) => String(ex[k] ?? '') !== String(data[k] ?? '') && !(ex[k] != null && data[k] != null && Number(ex[k]) === Number(data[k]))) : [];
      const vide0 = cles.every((k) => data[k] === null);
      push(r, msgs, { data }, `${mois} · ${nm.agent(agent)}`, ex ? (diff.length ? { statut: 'maj', msg: `Modifié : ${diff.map((k) => SUIVI_CHAMPS.find((c) => c[0] === k)?.[1] || 'commentaire').join(', ')}` } : { statut: 'identique', msg: 'Déjà à jour' }) : vide0 ? { statut: 'identique', msg: 'Ligne vide' } : {});
    }
    return out;
  }
  if (type === 'budgets') {
    for (const r of rows) {
      const msgs = [];
      const mois = toMonth(r.mois); if (!/^\d{4}-\d{2}$/.test(mois || '')) msgs.push('Mois invalide (AAAA-MM attendu)');
      const data = { mois, equipe_id: need(r, 'equipe', R.equipe, 'Équipe', msgs), categorie_id: need(r, 'categorie', R.categorie, 'Catégorie', msgs), vehicule_id: need(r, 'vehicule', R.vehicule, 'Véhicule', msgs), montant: toNum(r.montant), commentaire: vide(r.commentaire) ? null : String(r.commentaire) };
      if (!(data.montant >= 0) || data.montant === null) msgs.push('Montant invalide');
      const ex = (App.D.budgets || []).find((x) => x.actif !== false && x.mois === mois && (x.equipe_id || null) === data.equipe_id && (x.categorie_id || null) === data.categorie_id && (x.vehicule_id || null) === data.vehicule_id);
      push(r, msgs, { data }, `${mois} · ${data.equipe_id ? nm.equipe(data.equipe_id) : 'Toutes équipes'}${data.categorie_id ? ' · ' + nm.categorie(data.categorie_id) : ''} · ${fmtN(data.montant)}`,
        ex ? (round2(ex.montant) === round2(data.montant) ? { statut: 'identique', msg: 'Déjà à jour' } : { statut: 'maj', msg: `Budget existant : ${fmtN(ex.montant)} → ${fmtN(data.montant)}` }) : {});
    }
    return out;
  }
  return out;
}

// Lignes pré-remplies pour les rubriques qui se mettent à jour (référentiels, objectifs, fiches, budgets)
function lignesActuelles(type, ctx = {}) {
  const fmtDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');
  if (REFS[type]) {
    return (App.D[type] || []).filter((r) => r.actif !== false).map((r) => REFS[type].f.map((f) => {
      const v = r[f.k];
      if (f.t.startsWith('ref:')) { const tb = f.t.slice(4); const x = (App.D[tb] || []).find((y) => y.id === v); return x ? x[LABEL[tb] || 'nom'] : ''; }
      if (f.t === 'bool') return v ? 'oui' : 'non';
      if (f.t === 'date') return fmtDate(v);
      return v ?? '';
    }));
  }
  const mois = ctx.mois || today().slice(0, 7);
  if (type === 'suivi_agents') {
    return (App.D.agents || []).filter((a) => a.actif !== false && (!ctx.equipe_id || a.equipe_id === ctx.equipe_id)).sort((a, b) => nm.equipe(a.equipe_id).localeCompare(nm.equipe(b.equipe_id), 'fr') || a.nom.localeCompare(b.nom, 'fr')).map((a) => {
      const f = (App.D.suivi_agents || []).find((x) => x.mois === mois && x.agent_id === a.id) || {};
      return [mois, a.code || a.nom, ...SUIVI_CHAMPS.map(([k]) => f[k] ?? ''), f.commentaire || ''];
    });
  }
  if (type === 'objectifs') {
    const axe = ctx.axe && ctx.axe !== 'global' ? ctx.axe : 'agent';
    const T = { agent: 'agents', zone: 'zones', equipe: 'equipes', marche: 'marches', produit: 'produits' }[axe];
    return (App.D[T] || []).filter((x) => x.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map((c) => {
      const o = (App.D.objectifs || []).find((x) => x.mois === mois && x.axe === axe && x.cible_id === c.id && !x.produit_id) || {};
      return [mois, axe, c.code || c.nom, '', o.objectif_cartons ?? '', o.objectif_ca ?? ''];
    });
  }
  if (type === 'budgets') {
    const bs = (App.D.budgets || []).filter((b) => b.actif !== false && b.mois === mois);
    const rows = bs.map((b) => [mois, b.equipe_id ? nm.equipe(b.equipe_id) : '', b.categorie_id ? nm.categorie(b.categorie_id) : '', b.vehicule_id ? nm.vehicule(b.vehicule_id) : '', b.montant, b.commentaire || '']);
    for (const e of (App.D.equipes || []).filter((x) => x.actif !== false)) if (!bs.some((b) => b.equipe_id === e.id && !b.categorie_id && !b.vehicule_id)) rows.push([mois, e.nom, '', '', '', '']);
    return rows;
  }
  return null;
}

export function telechargerModele(type, ctx = {}) {
  const t = TYPES[type];
  if (!window.XLSX) return toast('Module Excel non chargé.', 'err');
  const X = window.XLSX;
  const actuelles = t.maj ? lignesActuelles(type, ctx) : null;
  const data = [t.cols, ...(actuelles && actuelles.length ? actuelles : [t.ex])];
  const ws = X.utils.aoa_to_sheet(data);
  ws['!cols'] = t.cols.map((c) => ({ wch: Math.max(14, c.length + 2) }));
  const wb = X.utils.book_new();
  const lisez = [['Comment remplir ce fichier'], [''], [`Rubrique : ${t.l}`], ['1. Remplissez l’onglet « ' + t.onglet + ' » : une ligne par enregistrement, sans modifier la première ligne (titres des colonnes).'],
    ['2. Dates au format JJ/MM/AAAA ; mois au format AAAA-MM (ex. 2026-11) ; montants sans espace ni « FCFA ».'],
    ['3. Agents, marchés, clients, produits, équipes, catégories et véhicules : écrivez le nom exact ou le code (voir l’onglet « Listes »).'],
    [actuelles && actuelles.length ? '4. Le fichier contient déjà les données actuelles : modifiez les cases utiles, ajoutez des lignes, puis importez-le pour mettre la plateforme à jour.' : '4. La ligne d’exemple est à remplacer par vos données.'],
    ['5. Dans la plateforme : bouton « Importer Excel » de la rubrique, choisissez le fichier, vérifiez le contrôle, puis confirmez.'], ...(t.aide ? [[''], [t.aide]] : [])];
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(lisez), 'Lisez-moi');
  X.utils.book_append_sheet(wb, ws, t.onglet.slice(0, 31));
  const L = [['agents', 'nom'], ['marches', 'nom'], ['clients', 'nom'], ['produits', 'nom'], ['equipes', 'nom'], ['zones', 'nom'], ['categories_depense', 'libelle'], ['vehicules', 'immatriculation']];
  const cols = L.map(([tb, lb]) => (App.D[tb] || []).filter((x) => x.actif !== false).map((x) => (x.code ? `${x[lb]} (${x.code})` : x[lb])));
  const max = Math.max(0, ...cols.map((c) => c.length));
  const listes = [['Agents', 'Marchés', 'Clients', 'Produits', 'Équipes', 'Zones', 'Catégories de dépenses', 'Véhicules']];
  for (let i = 0; i < max; i++) listes.push(cols.map((c) => c[i] || ''));
  const wl = X.utils.aoa_to_sheet(listes); wl['!cols'] = listes[0].map(() => ({ wch: 26 }));
  X.utils.book_append_sheet(wb, wl, 'Listes');
  saveBlob(`ORIBA_${t.onglet}_${ctx.mois || today()}.xlsx`, new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

export async function lireFichier(type, file) {
  if (!window.XLSX) throw new Error('Module Excel non chargé.');
  const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const ong = norm(TYPES[type].onglet);
  const nomOnglet = wb.SheetNames.find((n) => norm(n) === ong) || wb.SheetNames.find((n) => !['lisez_moi', 'listes'].includes(norm(n))) || wb.SheetNames[0];
  const raw = window.XLSX.utils.sheet_to_json(wb.Sheets[nomOnglet], { defval: '', raw: true });
  return { nomOnglet, multi: wb.SheetNames.length > 1, res: analyse(type, raw) };
}

const LIB = { ok: ['Nouvelle', 'ok'], maj: ['Mise à jour', 'info'], identique: ['Inchangée', 'mute'], doublon: ['Doublon potentiel', 'warn'], rejet: ['Rejetée', 'crit'] };

// Affiche le contrôle et envoie au serveur ; mode « courant » (rubriques) ou « historique » (reprise)
export function rapportControle(host, type, fname, res, { mode = 'courant', onDone, preparer } = {}) {
  const c = Object.fromEntries(Object.keys(LIB).map((k) => [k, res.filter((r) => r.statut === k).length]));
  const RANG = { rejet: 0, doublon: 1, maj: 2, ok: 3, identique: 4 };
  res.sort((a, b) => RANG[a.statut] - RANG[b.statut]);
  res.forEach((r, i) => { r.id = String(i); });
  const pretes = c.ok + c.maj;
  const tbl = new Table({ title: `Contrôle de ${fname}`, rows: res, pageSize: 15, select: (r) => r.statut === 'doublon',
    cols: [{ k: 'ligne', l: 'Ligne(s)' }, { k: 'apercu', l: 'Aperçu', cls: 'wrap' }, { k: 'statut', l: 'Contrôle', v: (r) => LIB[r.statut][0], f: (r) => pill(LIB[r.statut][0], LIB[r.statut][1]) }, { k: 'msg', l: 'Détail', cls: 'wrap' }] });
  host.innerHTML = `<div class="note"><b>${esc(fname)}</b> : ${c.ok} nouvelle(s), ${c.maj} mise(s) à jour, ${c.identique} inchangée(s), ${c.doublon} doublon(s) potentiel(s) à arbitrer (cochez ceux à intégrer quand même), ${c.rejet} rejetée(s).</div><div class="imp-t"></div>
    <div class="row-act"><button class="btn ghost" data-rep>Exporter le contrôle</button><button class="btn primary" data-go ${pretes ? '' : 'disabled'}>Importer ${pretes} ligne(s)</button></div>`;
  const go = $('[data-go]', host);
  tbl.onSel = (s) => { go.disabled = !(pretes + s.size); go.textContent = `Importer ${pretes + s.size} ligne(s)`; };
  tbl.mount($('.imp-t', host)); tbl.onSel(tbl.sel);
  $('[data-rep]', host).addEventListener('click', () => exportRows('xlsx', 'Contrôle import', [{ k: 'ligne', l: 'Ligne' }, { k: 'apercu', l: 'Aperçu' }, { k: 'statut', l: 'Contrôle', v: (r) => LIB[r.statut][0] }, { k: 'msg', l: 'Détail' }], res, `Fichier : ${fname}`));
  go.addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    const chosen = res.filter((r) => r.statut === 'ok' || r.statut === 'maj' || (r.statut === 'doublon' && tbl.sel.has(r.id)));
    try {
      const rows = (preparer ? await preparer(chosen) : chosen.map((r) => r.payload)).map(payloadPropre);
      const out = await App.act('import.run', { type, mode, fichier: fname, rows, stats: { nouvelles: c.ok, mises_a_jour: c.maj, inchangees: c.identique, doublons: c.doublon, doublons_retenus: tbl.sel.size, rejets_controle: c.rejet }, rapport: res.filter((r) => !['ok', 'maj'].includes(r.statut)).map((r) => ({ ligne: r.ligne, statut: r.statut, msg: r.msg })) }, null);
      const b = out.brouillons?.length || 0;
      toast(`${out.integrees.length} ligne(s) intégrée(s)${out.deja?.length ? `, ${out.deja.length} déjà présente(s) ignorée(s)` : ''}${out.refuses.length ? `, ${out.refuses.length} refusée(s)` : ''}${b ? `, dont ${b} dépense(s) en brouillon (pièce à joindre)` : ''}.`, out.refuses.length ? 'warn' : 'ok');
      const notes = [];
      if (out.refuses.length) notes.push(`<div class="note warn"><b>Lignes refusées par les règles de gestion :</b><br>${out.refuses.slice(0, 30).map((r) => `Ligne ${r.ligne} : ${esc(r.erreur)}`).join('<br>')}</div>`);
      if (b) notes.push(`<div class="note"><b>Dépenses gardées en brouillon :</b><br>${out.brouillons.slice(0, 30).map((r) => `Ligne ${r.ligne} : ${esc(r.motif)}`).join('<br>')}</div>`);
      host.innerHTML = notes.join('') || '<div class="note">Import terminé.</div>';
      onDone?.(out);
    } catch (er) { toast(er.message, 'err'); }
  }));
}

// Fenêtre « Importer Excel » d'une rubrique
export function ouvrirImport(type, ctx = {}) {
  const t = TYPES[type];
  const tbPossible = TYPES_TB.includes(type);
  modal({ title: `Importer depuis Excel — ${t.l}`, wide: true,
    body: `<ol class="steps-imp"><li><b>${tbPossible ? 'Utilisez votre tableau de bord habituel (TB … ORIBA FOODS)' : 'Téléchargez le modèle'}</b>${tbPossible ? ' : feuilles « Journal Comptant », « Journal Crédit » et « Stock », telles quelles' : t.maj ? ' (il contient déjà les données actuelles, à compléter ou corriger)' : ''}.</li><li><b>Choisissez le fichier</b> : la plateforme contrôle chaque ligne et reconnaît celles qu’elle connaît déjà.</li><li><b>Confirmez</b> : seules les nouvelles lignes sont enregistrées.</li></ol>
      <div class="filters"><label class="btn primary"><input type="file" accept=".xlsx,.xls,.csv" hidden data-file>${icon('upload')} Choisir le fichier Excel</label>
      <button class="btn ghost" type="button" data-tpl>${icon('download')} ${tbPossible ? 'Modèle vierge au format tableau de bord' : 'Télécharger le modèle'}</button></div>
      <div data-opt hidden></div>
      <p class="muted small">${tbPossible ? 'Les fichiers « TB … ORIBA FOODS » sont lus directement. Un fichier au format simple (une feuille, colonnes <code>' + t.cols.join(' · ') + '</code>) reste accepté.' : `Colonnes : <code>${t.cols.join(' · ')}</code>`}${t.aide && !tbPossible ? `<br>${esc(t.aide)}` : ''}</p><div data-res></div><div data-res2></div>`,
    onMount: (m, close) => {
      let wb = null, fname = '';
      const opt = { equipe_id: ctx.equipe_id || '', creer: true, depositaire_id: '' };
      const fermer = () => setTimeout(() => { if (!document.body.contains(m) || $('[data-fermer]', m)) return; const b = document.createElement('button'); b.className = 'btn'; b.dataset.fermer = '1'; b.textContent = 'Fermer'; b.addEventListener('click', close); m.querySelector('.modal-b')?.append(b) || $('[data-res]', m).append(b); }, 0);
      $('[data-tpl]', m).addEventListener('click', () => (tbPossible ? saveBlob(`TB_ORIBA_FOODS_modele${opt.equipe_id ? '_' + (App.D.equipes.find((e) => e.id === opt.equipe_id)?.code || '') : ''}.xlsx`, modeleTB(opt.equipe_id)) : telechargerModele(type, ctx)));
      const analyserTB = () => {
        const { res, nomOnglet, manquants } = analyseTB(type, wb, opt);
        $('[data-res2]', m).innerHTML = '';
        if (!nomOnglet) { $('[data-res]', m).innerHTML = `<div class="note warn">La feuille attendue (${type === 'stock_remises' ? '« Stock »' : type === 'ventes_comptant' ? '« Journal Comptant »' : '« Journal Crédit »'}) est absente du fichier.</div>`; return; }
        if (!res.length) { $('[data-res]', m).innerHTML = `<div class="note">Aucune ligne à traiter dans la feuille « ${esc(nomOnglet)} »${type === 'remboursements' ? ' (aucun montant remboursé)' : ''}.</div>`; return; }
        const nb = manquants ? manquants.agents.length + manquants.marches.length + manquants.clients.length : 0;
        rapportControle($('[data-res]', m), type, `${fname} — ${nomOnglet}`, res, { mode: 'courant',
          preparer: nb ? async (chosen) => {
            await creerManquants(manquants);
            const lignes = new Set(chosen.map((r) => r.payload.ligne));
            return analyseTB(type, wb, opt).res.filter((r) => lignes.has(r.payload.ligne) && r.statut !== 'rejet' && r.statut !== 'identique').map((r) => r.payload);
          } : null,
          onDone: () => {
            if (type === 'ventes_credit') {
              const r2 = analyseTB('remboursements', wb, opt).res;
              if (r2.some((r) => r.statut === 'ok')) { $('[data-res2]', m).innerHTML = '<h4 class="form-t">Remboursements contenus dans le même fichier</h4><div></div>'; rapportControle($('[data-res2]', m).lastChild, 'remboursements', `${fname} — remboursements`, r2, { mode: 'courant', onDone: fermer }); return; }
            }
            fermer();
          } });
        if (nb) $('[data-res]', m).insertAdjacentHTML('afterbegin', `<div class="note">${nb} élément(s) nouveau(x) seront créés dans les référentiels de l’équipe à la confirmation : ${esc([...manquants.agents.map((x) => 'agent ' + x), ...manquants.marches.map((x) => 'marché ' + x), ...manquants.clients.map((x) => 'client ' + x)].slice(0, 12).join(', '))}${nb > 12 ? '…' : ''}.</div>`);
      };
      const options = () => {
        const o = $('[data-opt]', m); o.hidden = false;
        const deps = (App.D.clients || []).filter((c) => c.actif !== false && c.depositaire);
        o.innerHTML = `<div class="filters"><label class="ff"><span>Équipe du fichier</span><select data-eq><option value="">— choisir —</option>${(App.D.equipes || []).filter((e) => e.actif !== false).map((e) => `<option value="${e.id}" ${e.id === opt.equipe_id ? 'selected' : ''}>${esc(e.nom)}</option>`).join('')}</select></label>
          ${type === 'stock_remises' ? `<label class="ff"><span>Dépositaire (gros client)</span><select data-dep><option value="">— choisir —</option>${deps.map((c) => `<option value="${c.id}" ${c.id === opt.depositaire_id ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}</select></label>` : ''}
          ${type.startsWith('ventes') ? `<label class="chk" style="align-self:end"><input type="checkbox" data-creer ${opt.creer ? 'checked' : ''}> <span>Créer automatiquement les agents, marchés et clients absents</span></label>` : ''}</div>
          ${type === 'stock_remises' && !deps.length ? '<p class="note warn">Aucun client n’est déclaré « gros client dépositaire » : ouvrez Référentiels > Clients et cochez la case pour le gros client concerné.</p>' : ''}`;
        $('[data-eq]', o).addEventListener('change', (e) => { opt.equipe_id = e.target.value; analyserTB(); });
        $('[data-dep]', o)?.addEventListener('change', (e) => { opt.depositaire_id = e.target.value; analyserTB(); });
        $('[data-creer]', o)?.addEventListener('change', (e) => { opt.creer = e.target.checked; analyserTB(); });
      };
      $('[data-file]', m).addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;
        try {
          if (!window.XLSX) throw new Error('Module Excel non chargé.');
          const w = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
          fname = file.name;
          if (tbPossible && estTB(w)) {
            wb = w; opt.equipe_id = opt.equipe_id || detecterEquipe(w);
            options(); analyserTB();
            if (!opt.equipe_id) toast('Choisissez l’équipe correspondant à ce fichier.', 'warn');
          } else {
            $('[data-opt]', m).hidden = true;
            const { nomOnglet, multi, res } = await lireFichier(type, file);
            if (multi) toast(`Onglet lu : « ${nomOnglet} »`);
            if (!res.length) { $('[data-res]', m).innerHTML = '<div class="note warn">Aucune ligne de données trouvée dans le fichier.</div>'; return; }
            rapportControle($('[data-res]', m), type, file.name, res, { mode: 'courant', onDone: fermer });
          }
        } catch (er) { toast('Lecture du fichier impossible : ' + er.message, 'err'); }
        e.target.value = '';
      });
    } });
}

// Boutons « Importer Excel » à placer dans l'en-tête d'une rubrique
export function boutonImport(type, id = 'imp') {
  return peutImporter(type) ? `<button class="btn ghost" id="${id}" data-imp="${type}">${icon('upload')} Importer Excel</button>` : '';
}
export function lierImport(root, ctxFn = () => ({})) {
  root.querySelectorAll('[data-imp]').forEach((b) => b.addEventListener('click', () => ouvrirImport(b.dataset.imp, ctxFn(b.dataset.imp))));
}
