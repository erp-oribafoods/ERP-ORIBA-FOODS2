// Reprise des tableaux de bord régionaux (Konni, Niamey 1 – Sidi, Niamey 2 – Ramatou, Balleyara).
// Même méthode que pour Tahoua : les règles de l'application (core.js) sont appliquées en mémoire,
// à partir des identifiants réels de la base, puis les lignes créées sont exportées pour chargement.
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { handle, uid } from '../shared/core.js';
import { memoryAdapter } from '../shared/memory-adapter.js';
import { buildIndex, creditInfo, venteTotals } from '../shared/logic.js';
import { MODULES, DEFAULT_PARAMS } from '../shared/schema.js';

const [srcPath, refPath, outPath] = process.argv.slice(2);
const SRC = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
const REF = JSON.parse(fs.readFileSync(refPath, 'utf8'));
const AUJ = '2026-10-28';
const now = new Date().toISOString();

const S = {
  zones: REF.zones.map((z) => ({ ...z, actif: true })), equipes: REF.equipes.map((e) => ({ ...e, actif: true })),
  marches: REF.marches.map((m) => ({ ...m, actif: true })), agents: REF.agents.map((a) => ({ ...a, actif: true })),
  produits: REF.produits.map((p) => ({ ...p, gamme: 'DADI', actif: true })), clients: [],
  categories_depense: [], vehicules: [], parametres: Object.entries(DEFAULT_PARAMS).map(([cle, valeur]) => ({ cle, valeur })),
  ventes: [], vente_lignes: [], remboursements: [], relances: [], stock_mouvements: [], depenses: [], depense_repartitions: [], depense_validations: [],
  budgets: [], clotures: [], anomalies: [], imports: [], audit_log: [], objectifs: [], suivi_agents: [], demandes: [],
  compteurs: REF.compteurs.map((c) => ({ ...c })),
};
const ROLE = { id: uid(), nom: '__reprise', permissions: Object.fromEntries(MODULES.map((m) => [m.k, m.a])), actif: true };
const USER = { id: REF.reprise_user, nom: 'Reprise de données', prenom: null, username: 'reprise.donnees', email: 'reprise.donnees@oriba.local', role_id: ROLE.id, perimetre_type: 'global', perimetre_ids: [], statut: 'actif', mot_de_passe_hash: await bcrypt.hash(uid(), 4), must_change_password: false, created_at: now };
S.roles = [ROLE]; S.utilisateurs = [USER];
const initial = new Set(Object.values(S).flat());
const db = memoryAdapter(S);
const ctx = { userId: USER.id, crypto: { hash: (p) => bcrypt.hash(p, 4), verify: () => false }, blobs: { put: async () => {}, get: async () => null } };
const call = (a, p) => handle(db, a, p, ctx);
const rapport = [];
const note = (region, type, msg) => rapport.push({ region, type, msg });
const t = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const k = (s) => t(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const eq = (code) => S.equipes.find((e) => e.code === code);
const zone = (nom) => S.zones.find((z) => z.nom === nom).id;
const PROD = Object.fromEntries(S.produits.map((p) => [k(p.nom), p.id]));

// Réglages propres à chaque fichier
const REG = {
  konni: { lib: 'Konni', fichier: 'TB_Abdoul_Magid_Konni_ORIBA_FOODS.xlsx', eq: 'KON', zone: 'Tahoua', prefix: 'KON', detail: 'Détaillants divers (Konni)' },
  sidi: { lib: 'Niamey 1', fichier: 'TB_SIDI_ORIBA_FOODS.xlsx', eq: 'NY1', zone: 'Niamey', prefix: 'NY1', detail: 'Détaillants divers (Niamey 1)' },
  ramatou: { lib: 'Niamey 2', fichier: 'TB_Ramatou_ORIBA_FOODS.xlsx', eq: 'NY2', zone: 'Niamey', prefix: 'NY2', detail: 'Détaillants divers (Niamey 2)' },
  balleyara: { lib: 'Balleyara', fichier: 'TB_Zouera_Balleyara_ORIBA_FOODS.xlsx', eq: 'BAL', zone: 'Tillabéri', prefix: 'BAL', detail: 'Détaillants divers (Balleyara)' },
};
// Correspondance avec les marchés déjà enregistrés (Niamey)
const ALIAS = { 'petit marche': 'Petit marché', 'nouveaux marche': 'Nouveau marché', 'marche wadata': 'Wadata', wadata: 'Wadata', 'marche bonkaney': 'Bonkaney', 'nouveaux bonkaney': 'Bonkaney', 'marche katako': 'Katako', 'marche gamkale': 'Gamkallé', 'marche aeroport': 'Aéroport', 'marche dole': 'Dolé', 'marche yantala': 'Yantala' };
const ZONE_MARCHE = { loga: 'Dosso' };

// Dates saisies « 0206 » au lieu de « 2026 »
function corrigeDate(iso, brut, region, ligne, champ) {
  if (iso && iso >= '2026-01-01' && iso <= AUJ) return iso;
  const m = String(brut || '').match(/^(\d{1,2})\/(\d{1,2})\/0?206$/);
  if (m) { const d = `2026-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; note(region, 'Date corrigée', `${champ} ligne ${ligne} : « ${brut} » lue comme ${d}.`); return d; }
  if (iso && iso.startsWith('2028-')) { const d = '2026' + iso.slice(4); note(region, 'Date corrigée', `${champ} ligne ${ligne} : ${iso} (année 2028) lue comme ${d}.`); return d; }
  return iso && iso <= AUJ ? iso : null;
}

const resp = { KON: null, NY1: null, NY2: null, BAL: null };
const stats = {};
for (const [cle, R] of Object.entries(REG)) {
  const F = SRC[cle];
  const E = eq(R.eq);
  const region = R.lib;
  // Responsable de l'équipe
  resp[R.eq] = t(F.chef);
  await call('ref.save', { table: 'equipes', row: { id: E.id, responsable: t(F.chef) }, motif: `Chef d’équipe indiqué dans ${R.fichier}` });

  // Marchés
  const M = {};
  const marcheId = async (nom) => {
    const n = t(nom); if (!n) return null;
    if (M[k(n)]) return M[k(n)];
    const alias = ALIAS[k(n)];
    let ex = S.marches.find((m) => k(m.nom) === k(alias || n.replace(/^Marché\s+/i, '')));
    if (!ex) {
      let lib = n.replace(/^Marché\s+/i, '');
      if (k(lib) === 'secteur') { lib = `Secteur non précisé (${region})`; note(region, 'Marché à préciser', `Le marché « Secteur » est utilisé dans le fichier : créé sous le nom « ${lib} », à renommer.`); }
      if (k(lib) === 'grand marche') lib = 'Grand Marché';
      ex = S.marches.find((m) => k(m.nom) === k(lib));
      if (!ex) ex = (await call('ref.save', { table: 'marches', row: { nom: lib, commune: R.zone === 'Niamey' ? 'Niamey' : lib, zone_id: zone(ZONE_MARCHE[k(lib)] || R.zone), equipe_id: lib === 'Grand Marché' ? null : E.id } })).row;
    }
    M[k(n)] = ex.id; return ex.id;
  };
  for (const m of F.marches) await marcheId(m);

  // Agents
  const A = {};
  let na = 0;
  const seen = new Set();
  for (const a of F.agents) {
    const nom = t(a.nom); if (!nom || seen.has(k(nom))) continue; seen.add(k(nom));
    const ex = S.agents.find((x) => x.equipe_id === E.id && k(x.nom) === k(nom));
    if (ex) { A[k(nom)] = ex.id; continue; }
    let code; do { na++; code = `${R.prefix}-${String(na).padStart(2, '0')}`; } while (S.agents.some((x) => x.code === code));
    A[k(nom)] = (await call('ref.save', { table: 'agents', row: { code, nom, telephone: t(a.tel) || null, equipe_id: E.id, zone_id: E.zone_id } })).row.id;
  }

  // Clients
  const C = {};
  const clientId = async (nomBrut) => {
    const n = t(nomBrut); if (!n) return null;
    if (C[k(n)]) return C[k(n)];
    const m = n.match(/^Clien?t?\s*([A-Z0-9]+)\s*-\s*(.*)$/i);
    const lettre = m ? m[1].toUpperCase() : null;
    let nom = m ? t(m[2]) : n;
    const detail = /d[ée]taillant/i.test(nom);
    let type = detail ? 'Détaillant' : null;
    if (detail) nom = R.detail;
    else if (!nom) { nom = `Client ${lettre} — ${region} (nom à compléter)`; note(region, 'Client sans nom', `« ${n} » n’a pas de nom dans le fichier : créé sous « ${nom} » (code ${R.prefix}-${lettre}), à compléter dans Référentiels > Clients.`); }
    const tel = F.clients.find((c) => k(c.nom) === k(n))?.tel;
    const id = (await call('ref.save', { table: 'clients', row: { code: lettre ? `${R.prefix}-${lettre}` : null, nom, type, telephone: tel && !/X/.test(String(tel)) ? String(tel) : null } })).row.id;
    C[k(n)] = id; return id;
  };
  for (const c of F.clients) if (t(c.nom).match(/-\s*\S/)) await clientId(c.nom);

  const st = stats[region] = { fichier: R.fichier, dg: F.totaux, lignes_ignorees: 0 };
  const reel = (r) => r.date_brute !== 'TOTAUX' && (t(r.agent) || r.quantite);
  // Ventes au comptant
  const rowsC = [];
  for (const v of F.comptant) {
    if (!reel(v)) { if (v.date_brute !== 'TOTAUX') st.lignes_ignorees++; continue; }
    if (!(v.quantite > 0) || !(v.prix > 0)) { note(region, 'Ligne incomplète', `Journal Comptant ligne ${v.ligne} (${v.date || v.date_brute}, ${t(v.agent)}) : quantité ou prix manquant, ligne non reprise (montant du fichier : ${v.montant ?? 'vide'}).`); continue; }
    const date = corrigeDate(v.date, v.date_brute, region, v.ligne, 'Journal Comptant');
    if (!date) { note(region, 'Date invalide', `Journal Comptant ligne ${v.ligne} : date « ${v.date_brute} » illisible, ligne non reprise.`); continue; }
    rowsC.push({ ligne: v.ligne, data: { date, agent_id: A[k(v.agent)] || null, marche_id: await marcheId(v.marche), client_id: await clientId(v.client), observation: t(v.observation) || null, ref_externe: `TB-${R.prefix}-Comptant-L${v.ligne}` },
      lignes: [{ produit_id: PROD[k(v.produit)], unite: /pack/i.test(v.unite) ? 'pack' : 'carton', quantite: v.quantite, prix_unitaire: v.prix }] });
    if (!A[k(v.agent)]) note(region, 'Agent inconnu', `Journal Comptant ligne ${v.ligne} : agent « ${t(v.agent)} » absent de la liste des agents.`);
  }
  const r1 = await call('import.run', { type: 'ventes_comptant', fichier: `${R.fichier} — Journal Comptant`, rows: rowsC });
  r1.refuses.forEach((x) => note(region, 'Refus', `Comptant ligne ${x.ligne} : ${x.erreur}`));

  // Ventes à crédit
  const rowsK = [], creditsReels = [];
  for (const c of F.credit) {
    if (!reel(c)) { if (c.date_brute !== 'TOTAUX') st.lignes_ignorees++; continue; }
    if (!(c.quantite > 0) || !(c.prix > 0)) { note(region, 'Ligne incomplète', `Journal Crédit ligne ${c.ligne} : quantité ou prix manquant, ligne non reprise.`); continue; }
    const date = corrigeDate(c.date, c.date_brute, region, c.ligne, 'Journal Crédit');
    let ech = c.promesse;
    if (!ech) { if (c.promesse_brute && c.promesse_brute !== 'None') note(region, 'Échéance invalide', `Journal Crédit ligne ${c.ligne} : la colonne « Date promesse » contient « ${c.promesse_brute} » au lieu d’une date ; échéance par défaut appliquée.`); }
    else if (ech < date) { note(region, 'Échéance invalide', `Journal Crédit ligne ${c.ligne} : promesse ${ech} antérieure à la vente du ${date} ; échéance par défaut appliquée.`); ech = null; }
    creditsReels.push({ ...c, date, ech });
    rowsK.push({ ligne: c.ligne, data: { date, agent_id: A[k(c.agent)] || null, marche_id: await marcheId(c.marche), client_id: await clientId(c.client), echeance: ech, observation: null, ref_externe: `TB-${R.prefix}-Credit-L${c.ligne}` },
      lignes: [{ produit_id: PROD[k(c.produit)], unite: /pack/i.test(c.unite) ? 'pack' : 'carton', quantite: c.quantite, prix_unitaire: c.prix }] });
  }
  const r2 = await call('import.run', { type: 'ventes_credit', fichier: `${R.fichier} — Journal Crédit`, rows: rowsK });
  r2.refuses.forEach((x) => note(region, 'Refus', `Crédit ligne ${x.ligne} : ${x.erreur}`));

  // Remboursements (montant cumulé du fichier, une ligne par vente)
  const byRef = new Map(S.ventes.map((v) => [v.ref_externe, v]));
  const rowsR = [];
  for (const c of creditsReels) {
    if (!(c.rembourse > 0)) continue;
    const v = byRef.get(`TB-${R.prefix}-Credit-L${c.ligne}`); if (!v) continue;
    let date = corrigeDate(c.date_remb, c.date_remb_brute, region, c.ligne, 'Journal Crédit (date de remboursement)');
    let com = `Reprise ${R.fichier} (montant remboursé cumulé)`;
    if (!date) {
      date = c.ech && c.ech <= AUJ ? c.ech : c.date;
      com += ` — date de remboursement absente : ${c.ech && c.ech <= AUJ ? 'date de promesse' : 'date de la vente'} retenue`;
      note(region, 'Date manquante', `Journal Crédit ligne ${c.ligne} (${t(c.client)}) : remboursement de ${c.rembourse} FCFA sans date ; ${c.ech && c.ech <= AUJ ? `date de promesse ${c.ech}` : `date de la vente ${c.date}`} retenue.`);
    }
    if (date < c.date) { note(region, 'Date corrigée', `Journal Crédit ligne ${c.ligne} : remboursement daté du ${date}, avant la vente du ${c.date} ; date de la vente retenue.`); date = c.date; }
    rowsR.push({ ligne: c.ligne, data: { vente_id: v.id, date, montant: c.rembourse, mode: null, reference: null, commentaire: com } });
  }
  const r3 = await call('import.run', { type: 'remboursements', fichier: `${R.fichier} — Journal Crédit (remboursements)`, rows: rowsR });
  r3.refuses.forEach((x) => note(region, 'Refus', `Remboursement ligne ${x.ligne} : ${x.erreur}`));

  // Éléments signalés mais non repris
  note(region, 'Non repris', `Feuille « Stock » : 500 cartons d’Arôme DADI Poulet « pris chez le gros client » le 28/04/2026 à 14 000 FCFA, sans nom de dépositaire (même ligne que dans les autres fichiers) : à confirmer avant reprise dans Stock confié.`);
  if (F.plafond) note(region, 'Paramètre', `Le fichier fixe un plafond de cumul de créances de ${F.plafond} cartons pour l’équipe ; la plateforme applique un plafond par client (1 000 cartons par défaut, modifiable client par client).`);
}

// Contrôles par région
const I = buildIndex(S);
const pref = Object.fromEntries(Object.values(REG).map((R) => [R.lib, R.prefix]));
for (const [region, st] of Object.entries(stats)) {
  const p = pref[region];
  const vs = S.ventes.filter((v) => (v.ref_externe || '').startsWith(`TB-${p}-`));
  const comp = vs.filter((v) => v.mode === 'comptant'), cred = vs.filter((v) => v.mode === 'credit').map((v) => creditInfo(v, I, AUJ));
  Object.assign(st, {
    ventes_comptant: comp.length, ca_comptant: comp.reduce((s, v) => s + venteTotals(v, I).montant, 0), cartons_comptant: comp.reduce((s, v) => s + venteTotals(v, I).cartons, 0),
    ventes_credit: cred.length, ca_credit: cred.reduce((s, c) => s + c.montant, 0), rembourse: cred.reduce((s, c) => s + c.rembourse, 0), solde: cred.reduce((s, c) => s + c.solde, 0),
    en_retard: cred.filter((c) => c.statut === 'En retard').length, cartons_dus: cred.reduce((s, c) => s + c.cartonsRestants, 0),
  });
}

const out = { tables: {}, updates: [], controle: stats, rapport };
for (const [tb, rows] of Object.entries(S)) {
  if (['roles', 'compteurs', 'utilisateurs', 'equipes'].includes(tb)) continue;
  const n = rows.filter((r) => !initial.has(r));
  if (tb === 'audit_log') n.forEach((r) => delete r.id);
  if (n.length) out.tables[tb] = n;
}
for (const [code, r] of Object.entries(resp)) if (r) out.updates.push({ table: 'equipes', id: eq(code).id, responsable: r });
out.compteurs = S.compteurs;
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(JSON.stringify(stats, null, 1));
console.log('Tables :', Object.fromEntries(Object.entries(out.tables).map(([a, b]) => [a, b.length])));
console.log('Remarques :', rapport.length);
