// Reprise des fichiers Excel « TB Mohamedine Tahoua » et « Suivi dépenses équipes commerciaux ».
// Les règles de l'application (core.js) sont appliquées en mémoire sur les identifiants réels de la base,
// puis les lignes créées sont exportées pour chargement dans Supabase.
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { handle, uid } from '../shared/core.js';
import { memoryAdapter } from '../shared/memory-adapter.js';
import { buildIndex, creditInfo, venteTotals } from '../shared/logic.js';
import { MODULES, DEFAULT_PARAMS } from '../shared/schema.js';

const [srcPath, refPath, outPath] = process.argv.slice(2);
const SRC = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
const REF = JSON.parse(fs.readFileSync(refPath, 'utf8'));
const now = new Date().toISOString();

// État de départ = référentiels réels
const S = {
  zones: REF.zones.map((z) => ({ ...z, actif: true })), equipes: REF.equipes.map((e) => ({ ...e, responsable: null, actif: true })),
  categories_depense: REF.categories.map((c) => ({ ...c, libelle: c.code, actif: true, justif_obligatoire: false, vehicule_obligatoire: false, description_obligatoire: false, sensible: c.code === 'SALA' })),
  vehicules: [{ id: REF.vehicule_zinder, immatriculation: 'Véhicule commercial Zinder', equipe_id: REF.equipes.find((e) => e.code === 'ZIN').id, actif: true }],
  parametres: Object.entries(DEFAULT_PARAMS).map(([cle, valeur]) => ({ cle, valeur })),
  marches: [], agents: [], clients: [], produits: [], ventes: [], vente_lignes: [], remboursements: [], relances: [], stock_mouvements: [], depenses: [],
  depense_repartitions: [], depense_validations: [], budgets: [], clotures: [], anomalies: [], imports: [], audit_log: [], compteurs: [], objectifs: [],
};
const ROLE = { id: uid(), nom: '__reprise', permissions: Object.fromEntries(MODULES.map((m) => [m.k, m.a])), actif: true };
const USER = { id: uid(), nom: 'Reprise de données', prenom: null, username: 'reprise.donnees', email: 'reprise.donnees@oriba.local', role_id: ROLE.id, perimetre_type: 'global', perimetre_ids: [], statut: 'actif', mot_de_passe_hash: await bcrypt.hash(uid(), 4), must_change_password: false, created_at: now };
S.roles = [ROLE]; S.utilisateurs = [USER];
const initial = new Set(Object.values(S).flat());
const db = memoryAdapter(S);
const ctx = { userId: USER.id, crypto: { hash: (p) => bcrypt.hash(p, 4), verify: () => false }, blobs: { put: async () => {}, get: async () => null } };
const call = (a, p) => handle(db, a, p, ctx);
const rapport = [];
const note = (type, msg) => rapport.push({ type, msg });

const eq = (code) => REF.equipes.find((e) => e.code === code);
const zone = (nom) => REF.zones.find((z) => z.nom === nom).id;
const TAH = eq('TAH');

// Référentiels
await call('ref.save', { table: 'equipes', row: { id: TAH.id, responsable: SRC.chef }, motif: 'Chef d’équipe Axe Tahoua (fichier TB Mohamedine)' });
await call('ref.save', { table: 'equipes', row: { id: eq('NY1').id, responsable: 'Sidi' }, motif: 'Responsable indiqué dans Suivi dépenses (sept.–oct. 2026)' });
await call('ref.save', { table: 'equipes', row: { id: eq('NY2').id, responsable: 'Ramatou' }, motif: 'Responsable indiqué dans Suivi dépenses (sept.–oct. 2026)' });

const P = {};
for (const p of SRC.produits) {
  const code = p.nom.includes('Poulet') ? 'DADI-POULET' : 'DADI-EPICE';
  P[p.nom] = (await call('ref.save', { table: 'produits', row: { code, nom: p.nom, gamme: 'DADI', packs_par_carton: 12, prix_ref: p.prix_carton } })).row.id;
}
const M = {};
for (const m of SRC.marches) {
  const nom = m.replace(/^Marché /, '');
  M[m] = (await call('ref.save', { table: 'marches', row: { nom, commune: nom === 'Tahoua Ville' ? 'Tahoua' : nom, zone_id: zone(nom === 'Agadez' ? 'Agadez' : 'Tahoua'), equipe_id: TAH.id } })).row.id;
}
const A = {};
for (const [i, a] of SRC.agents.entries()) A[a.nom] = (await call('ref.save', { table: 'agents', row: { code: `TAH-${String(i + 1).padStart(2, '0')}`, nom: a.nom, telephone: a.telephone, equipe_id: TAH.id, zone_id: zone('Tahoua') } })).row.id;
const marcheClient = {};
for (const k of SRC.credit) marcheClient[k.client] = marcheClient[k.client] || k.marche;
const C = {};
const vus = new Set();
for (const c of SRC.clients) {
  const m = c.nom.match(/^Client\s+([A-Z])\s*-\s*(.+)$/);
  let code = m ? `TAH-${m[1]}` : null;
  if (vus.has(code)) { code += '2'; note('Client', `Deux clients portent la lettre « E » dans le fichier (${c.nom}) : codes TAH-E et TAH-E2 attribués.`); }
  vus.add(code);
  const detail = /D[ée]taillant/i.test(c.nom);
  const nom = detail ? 'Détaillants divers (ventes au détail Tahoua)' : m[2].replace(/\s+/g, ' ').trim();
  C[c.nom] = (await call('ref.save', { table: 'clients', row: { code, nom, type: detail ? 'Détaillant' : null, marche_id: M[marcheClient[c.nom] || 'Marché Tahoua Ville'], telephone: c.telephone } })).row.id;
}

// Ventes au comptant
const norm = (s) => String(s || '').trim();
const rowsC = [];
for (const v of SRC.comptant) {
  if (!v.quantite || !v.prix) { note('Ligne vide', `Journal Comptant ligne ${v.ligne} (${v.date}, ${norm(v.agent)}) : quantité et prix vides, ligne non reprise.`); continue; }
  if (v.date_brute.includes('/')) note('Date corrigée', `Journal Comptant ligne ${v.ligne} : date « ${v.date_brute} » lue comme ${v.date}.`);
  rowsC.push({ ligne: v.ligne, data: { date: v.date, agent_id: A[norm(v.agent)], marche_id: M[norm(v.marche)], client_id: C[v.client], observation: v.observation || null, ref_externe: `TB-Tahoua-Comptant-L${v.ligne}` },
    lignes: [{ produit_id: P[v.produit], unite: /pack/i.test(v.unite) ? 'pack' : 'carton', quantite: v.quantite, prix_unitaire: v.prix }] });
}
const r1 = await call('import.run', { type: 'ventes_comptant', fichier: 'TB_Mohamedine_Tahoua_ORIBA_FOODS.xlsx — Journal Comptant', rows: rowsC });
r1.refuses.forEach((x) => note('Refus', `Comptant ligne ${x.ligne} : ${x.erreur}`));

// Ventes à crédit
const rowsK = [];
for (const k of SRC.credit) {
  let unite = /pack/i.test(k.unite) ? 'pack' : 'carton';
  if (unite === 'pack' && k.prix >= 5000) { unite = 'carton'; note('Unité corrigée', `Journal Crédit ligne ${k.ligne} (${k.client}, ${k.date}) : « ${k.quantite} Pack » à ${k.prix} FCFA = prix d’un carton ; repris comme ${k.quantite} cartons (montant ${k.montant} FCFA inchangé).`); }
  rowsK.push({ ligne: k.ligne, data: { date: k.date, agent_id: A[norm(k.agent)], marche_id: M[norm(k.marche)], client_id: C[k.client], echeance: k.promesse, observation: null, ref_externe: `TB-Tahoua-Credit-L${k.ligne}` },
    lignes: [{ produit_id: P[k.produit], unite, quantite: k.quantite, prix_unitaire: k.prix }] });
}
const r2 = await call('import.run', { type: 'ventes_credit', fichier: 'TB_Mohamedine_Tahoua_ORIBA_FOODS.xlsx — Journal Crédit', rows: rowsK });
r2.refuses.forEach((x) => note('Refus', `Crédit ligne ${x.ligne} : ${x.erreur}`));

// Remboursements (un encaissement cumulé par vente, tel que dans le fichier)
const ventesByRef = new Map(S.ventes.map((v) => [v.ref_externe, v]));
const rowsR = [];
for (const k of SRC.credit) {
  if (!k.rembourse) continue;
  const v = ventesByRef.get(`TB-Tahoua-Credit-L${k.ligne}`);
  let date = k.date_remb, com = 'Reprise fichier TB Mohamedine (montant remboursé cumulé)';
  if (!date) { date = k.promesse; com += ' — date de remboursement absente : date de promesse retenue'; note('Date manquante', `Journal Crédit ligne ${k.ligne} (${k.client}) : remboursement de ${k.rembourse} FCFA sans date ; date de promesse ${k.promesse} retenue.`); }
  rowsR.push({ ligne: k.ligne, data: { vente_id: v.id, date, montant: k.rembourse, mode: null, reference: null, commentaire: com } });
}
const r3 = await call('import.run', { type: 'remboursements', fichier: 'TB_Mohamedine_Tahoua_ORIBA_FOODS.xlsx — Journal Crédit (remboursements)', rows: rowsR });
r3.refuses.forEach((x) => note('Refus', `Remboursement ligne ${x.ligne} : ${x.erreur}`));

// Dépenses agrégées par mois, équipe et nature
const EQ = (n) => { const s = n.toLowerCase(); return s.startsWith('niamey 1') ? 'NY1' : s.startsWith('niamey 2') ? 'NY2' : s.includes('balleyara') ? 'BAL' : s.includes('dosso') ? 'DOS' : s.includes('zinder') ? 'ZIN' : s.includes('tahoua') ? 'TAH' : s.includes('konni') ? 'KON' : s.includes('maradi') ? 'MAR' : s.includes('mayonnaise') ? 'MAY' : s.includes('control') ? 'CTR' : null; };
const CAT = { carburant: 'CARB', vidange: 'VIDA', filtre: 'FILT', vignette: 'VIGN', patente: 'PATE', assurance: 'ASSU', réparation: 'REPA', 'caisse cachet annuel': 'CCAA', salaire: 'SALA', gadget: 'GADG' };
const catId = (code) => REF.categories.find((c) => c.code === code).id;
const rowsD = [];
for (const d of SRC.depenses) {
  const code = EQ(d.equipe);
  if (!code) { note('Équipe inconnue', `${d.feuille} ligne ${d.ligne} : « ${d.equipe} »`); continue; }
  const somme = Object.values(d.montants).reduce((s, x) => s + x, 0);
  if (d.total_fichier !== null && Math.abs(somme - d.total_fichier) > 1) note('Total incohérent', `${d.feuille} — ${d.equipe} : total du fichier ${d.total_fichier} FCFA, somme des colonnes ${somme} FCFA (écart ${somme - d.total_fichier}, ${d.montants.Patente ? 'la patente n’est pas comprise dans la formule du total' : 'à vérifier'}). Le détail par nature est repris.`);
  for (const [k, m] of Object.entries(d.montants)) {
    const c = CAT[k.toLowerCase()];
    if (!c) { note('Nature inconnue', `${d.feuille} : colonne « ${k} »`); continue; }
    rowsD.push({ ligne: `${d.feuille} L${d.ligne}`, data: { mois: d.mois, equipe_id: eq(code).id, categorie_id: catId(c), montant: m, description: `Reprise « Suivi dépenses équipes commerciaux » — ${d.feuille} — ${d.equipe}` } });
  }
}
const r4 = await call('import.run', { type: 'depenses_agregees', fichier: 'Suivi_depenses_equipes_commerciaux.xlsx', rows: rowsD });
r4.refuses.forEach((x) => note('Refus', `Dépense ${x.ligne} : ${x.erreur}`));

// Contrôle des totaux après reprise
const I = buildIndex(S);
const comptant = S.ventes.filter((v) => v.mode === 'comptant').reduce((s, v) => s + venteTotals(v, I).montant, 0);
const credits = S.ventes.filter((v) => v.mode === 'credit').map((v) => creditInfo(v, I, '2026-10-28'));
const ctrl = {
  ventes_comptant: S.ventes.filter((v) => v.mode === 'comptant').length, ca_comptant: comptant, cartons_comptant: S.ventes.filter((v) => v.mode === 'comptant').reduce((s, v) => s + venteTotals(v, I).cartons, 0),
  ventes_credit: credits.length, ca_credit: credits.reduce((s, c) => s + c.montant, 0), rembourse: credits.reduce((s, c) => s + c.rembourse, 0), solde: credits.reduce((s, c) => s + c.solde, 0),
  en_retard: credits.filter((c) => c.statut === 'En retard').length, cartons_dus: credits.reduce((s, c) => s + c.cartonsRestants, 0),
  depenses: S.depenses.length, depenses_total: S.depenses.reduce((s, d) => s + d.montant, 0),
  depenses_par_mois: Object.fromEntries(['2026-07', '2026-08', '2026-09', '2026-10'].map((m) => [m, S.depenses.filter((d) => d.mois === m).reduce((s, d) => s + d.montant, 0)])),
};

// Export des lignes créées ou modifiées
const out = { tables: {}, updates: [], controle: ctrl, rapport };
for (const [t, rows] of Object.entries(S)) {
  if (['roles', 'compteurs'].includes(t)) continue;
  const n = rows.filter((r) => !initial.has(r));
  if (t === 'utilisateurs') n.push({ ...USER, role_id: null, statut: 'desactive' });
  if (t === 'audit_log') n.forEach((r) => delete r.id);
  if (n.length) out.tables[t] = n;
}
out.tables.utilisateurs = [{ ...USER, role_id: null, statut: 'desactive' }];
for (const e of S.equipes) if (e.responsable) out.updates.push({ table: 'equipes', id: e.id, responsable: e.responsable });
out.compteurs = S.compteurs;
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(JSON.stringify(ctrl, null, 1));
console.log(Object.fromEntries(Object.entries(out.tables).map(([k, v]) => [k, v.length])));
console.log(rapport.length, 'remarques');
