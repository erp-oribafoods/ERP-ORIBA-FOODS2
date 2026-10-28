// Données de référence (identiques à la migration) et jeu de démonstration fictif.
import { DEFAULT_ROLES, DEFAULT_PARAMS, DEFAULT_CATEGORIES, DEFAULT_ZONES, DEFAULT_EQUIPES, DEFAULT_MARCHES } from '../shared/schema.js';
import { uid, handle } from '../shared/core.js';
import { today, addDays } from '../shared/logic.js';

const now = () => new Date().toISOString();

export function seedReference() {
  const S = {};
  S.parametres = Object.entries(DEFAULT_PARAMS).map(([cle, valeur]) => ({ cle, valeur, updated_at: now() }));
  S.roles = DEFAULT_ROLES.map((r) => ({ id: uid(), ...r, systeme: true, actif: true, created_at: now() }));
  S.zones = DEFAULT_ZONES.map((nom) => ({ id: uid(), nom, actif: true, created_at: now() }));
  const zid = (n) => S.zones.find((z) => z.nom === n)?.id || null;
  S.equipes = DEFAULT_EQUIPES.map(([code, nom, z]) => ({ id: uid(), code, nom, zone_id: zid(z), responsable: null, actif: true, created_at: now() }));
  const eid = (c) => S.equipes.find((e) => e.code === c)?.id || null;
  S.marches = DEFAULT_MARCHES.map(([nom, eq]) => ({ id: uid(), nom, commune: 'Niamey', zone_id: zid('Niamey'), equipe_id: eid(eq), actif: true, created_at: now() }));
  S.categories_depense = DEFAULT_CATEGORIES.map(([code, libelle, famille, j, v, d, s]) => ({ id: uid(), code, libelle, famille, justif_obligatoire: !!j, vehicule_obligatoire: !!v, description_obligatoire: !!d, sensible: !!s, actif: true, created_at: now() }));
  S.vehicules = [{ id: uid(), immatriculation: 'Véhicule commercial Zinder (immatriculation à compléter)', modele: null, equipe_id: eid('ZIN'), conducteur: null, actif: true, created_at: now() }];
  for (const t of ['agents', 'clients', 'produits', 'utilisateurs', 'compteurs', 'ventes', 'vente_lignes', 'remboursements', 'relances', 'stock_mouvements', 'depenses', 'depense_repartitions', 'depense_validations', 'budgets', 'clotures', 'anomalies', 'imports', 'audit_log']) S[t] = [];
  return S;
}

// Générateur pseudo-aléatoire reproductible
function rng(seed) { let s = seed; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; }

export const DEMO_PASSWORD = 'Demo2026';
export const DEMO_USERS = [
  ['admin', 'Administrateur ERP', 'Administrateur', 'Démo'],
  ['dg', 'Direction Générale', 'Directeur Général', 'Démo'],
  ['commercial', 'Responsable Commercial', 'Resp. Commercial', 'Démo'],
  ['cdg', 'Contrôleur', 'Contrôleur de Gestion', 'Démo'],
  ['daf', 'DAF', 'DAF', 'Démo'],
  ['superviseur', 'Superviseur', 'Superviseur Niamey 1', 'Démo'],
  ['rh', 'Ressources Humaines', 'Ressources Humaines', 'Démo'],
];

export async function seedDemo(db, crypto, state) {
  const r = rng(20261028);
  const pick = (a) => a[Math.floor(r() * a.length)];
  state.__blobs = state.__blobs || {};
  const blobs = { put: async (k, b, m) => { state.__blobs[k] = { ...m, base64: b }; }, get: async (k) => state.__blobs[k] || null };
  const ctx = (u) => ({ userId: u, crypto, blobs });
  const recu = receiptPNG();
  const adm = await handle(db, 'auth.init_admin', { nom: 'Administrateur', prenom: 'Démo', username: 'admin', email: 'admin@demo.oriba', password: DEMO_PASSWORD }, ctx(null));
  const U = { admin: adm.user.id };
  const roleId = (p) => state.roles.find((x) => x.nom.startsWith(p)).id;
  for (const [k, rp, nom] of DEMO_USERS.slice(1)) {
    const res = await handle(db, 'user.save', { user: { nom, prenom: 'Démo', username: k, email: `${k}@demo.oriba`, role_id: roleId(rp), ...(k === 'superviseur' ? { perimetre_type: 'equipe', perimetre_ids: [state.equipes.find((e) => e.code === 'NY1').id] } : {}) }, password: DEMO_PASSWORD }, ctx(U.admin));
    U[k] = res.user.id;
  }
  for (const u of state.utilisateurs) u.must_change_password = false;
  const C = ctx(U.commercial);
  const ref = async (table, row) => (await handle(db, 'ref.save', { table, row }, C)).row;
  const eq = (c) => state.equipes.find((e) => e.code === c);
  const produits = [
    await ref('produits', { code: 'P-ARO10', nom: 'Arôme en sachet 10 g (démo)', gamme: 'DADI', packs_par_carton: 12, prix_ref: 13000 }),
    await ref('produits', { code: 'P-EPI', nom: 'Épices en sachet (démo)', gamme: 'DADI', packs_par_carton: 12, prix_ref: 11500 }),
    await ref('produits', { code: 'P-MAY', nom: 'Mayonnaise 500 ml (démo)', gamme: 'Oriba', packs_par_carton: 12, prix_ref: 18000 }),
  ];
  // Marchés fictifs hors Niamey, un agent par marché, clients répartis dans toutes les zones
  const AUTRES = { BAL: ['Marché de Balleyara', 'Marché de Tagazar'], DOS: ['Grand marché de Dosso', 'Marché de Gaya'], ZIN: ['Grand marché de Zinder', 'Marché de Mirriah'],
    TAH: ['Grand marché de Tahoua', 'Marché de Madaoua'], KON: ['Marché de Birni N’Konni', 'Marché de Malbaza'], MAR: ['Grand marché de Maradi', 'Marché de Tessaoua'] };
  for (const [code, list] of Object.entries(AUTRES)) {
    const e = eq(code);
    for (const n of list) await ref('marches', { nom: `${n} (démo)`, commune: n.replace(/^(Grand )?[Mm]arché (de |d’)?/, ''), zone_id: e.zone_id, equipe_id: e.id });
  }
  const agents = [];
  let i = 1;
  for (const m of state.marches) agents.push(await ref('agents', { code: `AG${String(i++).padStart(2, '0')}`, nom: `Agent ${m.nom.replace(' (démo)', '')} (démo)`, equipe_id: m.equipe_id, zone_id: m.zone_id, date_affectation: '2026-04-01' }));
  agents.push(await ref('agents', { code: `AG${String(i++).padStart(2, '0')}`, nom: 'Agent Mayonnaise (démo)', equipe_id: eq('MAY').id, zone_id: null, date_affectation: '2026-05-01' }));
  const clients = [];
  const noms = ['Ets Moussa & Fils', 'Boutique Al Barka', 'Grossiste Hamani', 'Ets Issoufou Commerce', 'Alimentation Nafissa', 'Dépôt Garba', 'Ets Salifou', 'Supérette Yacouba', 'Ets Mariama Négoce', 'Boutique Zeinabou',
    'Ets Abdou Commerce', 'Grossiste Ibrahim', 'Dépôt Souley', 'Boutique Hadiza', 'Ets Oumarou', 'Grossiste Kader', 'Alimentation Rabi', 'Ets Boubacar', 'Dépôt Amadou', 'Boutique Fati',
    'Ets Seyni', 'Grossiste Moctar', 'Alimentation Balkissa', 'Ets Adamou', 'Dépôt Lawali', 'Boutique Ramatou', 'Ets Chaibou', 'Grossiste Tanko'];
  for (const [k, n] of noms.entries()) {
    const m = state.marches[(k * 7) % state.marches.length];
    clients.push(await ref('clients', { code: `CL${String(k + 1).padStart(3, '0')}`, nom: `${n} (démo)`, type: /Grossiste|Dépôt/.test(n) ? 'Grossiste' : k % 3 === 0 ? 'Demi-grossiste' : n.startsWith('Boutique') ? 'Boutique' : 'Détaillant', marche_id: m.id }));
  }
  const depot = await ref('clients', { code: 'CL900', nom: 'Grand dépôt Katako (démo)', type: 'Grossiste', marche_id: state.marches.find((m) => m.nom === 'Katako').id, depositaire: true });
  const depot2 = await ref('clients', { code: 'CL901', nom: 'Grand dépôt Zinder (démo)', type: 'Grossiste', marche_id: state.marches.find((m) => m.nom.startsWith('Grand marché de Zinder')).id, depositaire: true });
  const clientsDuMarche = (mid) => clients.filter((c) => c.marche_id === mid);
  await handle(db, 'param.save', { cle: 'plafond_cartons_client', valeur: 1000, motif: 'Valeur de référence du fichier (1 000 cartons par client)' }, ctx(U.daf));

  // Ventes de mai à aujourd'hui
  const start = '2026-05-02', end = today();
  let d = start;
  const ventesCredit = [];
  while (d <= end) {
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const ai = Math.floor(r() * agents.length); const ag = agents[ai]; const m = state.marches[ai] || pick(state.marches);
      const credit = r() < 0.35;
      const local = clientsDuMarche(m.id).concat(clients.filter((c) => state.marches.find((x) => x.id === c.marche_id)?.equipe_id === m.equipe_id));
      const cl = local.length && r() < 0.8 ? pick(local) : pick(clients);
      const nbl = r() < 0.25 ? 2 : 1;
      const lignes = [];
      for (let l = 0; l < nbl; l++) {
        const p = produits[l === 0 ? Math.floor(r() * 3) : (Math.floor(r() * 3) + 1) % 3];
        const pack = r() < 0.15;
        lignes.push({ produit_id: p.id, unite: pack ? 'pack' : 'carton', quantite: pack ? 6 + Math.floor(r() * 18) : credit ? 8 + Math.floor(r() * 40) : 2 + Math.floor(r() * 25), prix_unitaire: pack ? Math.round(p.prix_ref / 12 + 100) : p.prix_ref + Math.round((r() - 0.5) * 8) * 100 });
      }
      const res = await handle(db, 'vente.create', { vente: { date: d, mode: credit ? 'credit' : 'comptant', agent_id: ag.id, marche_id: m?.id || state.marches[0].id, client_id: cl.id, echeance: credit ? addDays(d, 21 + Math.floor(r() * 3) * 7) : null } , lignes }, C);
      if (credit) ventesCredit.push(res);
    }
    d = addDays(d, 1 + Math.floor(r() * 2));
  }
  // Remboursements
  for (const v of ventesCredit) {
    const tot = v.lignes.reduce((s, l) => s + l.montant, 0);
    const age = (Date.parse(end) - Date.parse(v.vente.date)) / 86400000;
    const x = r();
    if (age > 12 && x < 0.72) await handle(db, 'remb.create', { vente_id: v.vente.id, date: addDays(v.vente.date, Math.min(age, 20)), montant: tot, mode: pick(['Espèces', 'Mobile money']) }, C);
    else if (age > 5 && x < 0.92) await handle(db, 'remb.create', { vente_id: v.vente.id, date: addDays(v.vente.date, Math.min(age, 7)), montant: Math.round((tot * (0.3 + r() * 0.4)) / 500) * 500, mode: 'Espèces' }, C);
  }
  const late = ventesCredit.find((v) => v.vente.echeance < end);
  if (late) await handle(db, 'relance.create', { vente_id: late.vente.id, date: addDays(end, -6), canal: 'Visite', resultat: 'Promesse de paiement', prochaine_action: 'Repasser encaisser', promesse_date: addDays(end, -2), promesse_montant: 50000 }, C);

  // Stock confié
  const lot1 = (await handle(db, 'stock.create', { type: 'remise', client_id: depot.id, produit_id: produits[0].id, date: '2026-06-03', quantite: 500, valeur_unitaire: 12500, document: 'BL-2026-0141' }, C)).mouvement;
  const lot2 = (await handle(db, 'stock.create', { type: 'remise', client_id: depot.id, produit_id: produits[2].id, date: '2026-08-12', quantite: 200, valeur_unitaire: 17000, document: 'BL-2026-0233' }, C)).mouvement;
  for (const [dt, q] of [['2026-06-20', 80], ['2026-07-15', 120], ['2026-08-21', 95], ['2026-09-18', 60]]) await handle(db, 'stock.create', { type: 'vente', lot_id: lot1.id, date: dt, quantite: q, document: 'Relevé dépositaire', vente: { mode: 'comptant', prix_unitaire: 13000, agent_id: agents[6].id, marche_id: depot.marche_id } }, C);
  await handle(db, 'stock.create', { type: 'vente', lot_id: lot2.id, date: '2026-08-30', quantite: 40, vente: { mode: 'credit', prix_unitaire: 18000, agent_id: agents[6].id, marche_id: depot.marche_id } }, C);
  await handle(db, 'stock.create', { type: 'inventaire', lot_id: lot1.id, date: '2026-10-01', quantite: 140 }, C);
  const lot3 = (await handle(db, 'stock.create', { type: 'remise', client_id: depot2.id, produit_id: produits[1].id, date: '2026-07-05', quantite: 300, valeur_unitaire: 11000, document: 'BL-2026-0187' }, C)).mouvement;
  const agZ = agents.find((a) => a.nom.includes('Grand marché de Zinder'));
  for (const [dt, q] of [['2026-07-25', 70], ['2026-08-28', 55]]) await handle(db, 'stock.create', { type: 'vente', lot_id: lot3.id, date: dt, quantite: q, vente: { mode: 'credit', prix_unitaire: 12000, agent_id: agZ.id, marche_id: depot2.marche_id } }, C);

  // Dépenses mensuelles par équipe
  const cat = (c) => state.categories_depense.find((x) => x.code === c);
  const veh = state.vehicules[0];
  await handle(db, 'ref.save', { table: 'vehicules', row: { id: veh.id, immatriculation: 'Véhicule commercial Zinder (immatriculation à compléter)', modele: 'Toyota Hilux (démo)', equipe_id: eq('ZIN').id, conducteur: 'Chauffeur Zinder (démo)' } }, C);
  const flotte = [veh];
  for (const [code, immat, modele] of [['NY1', '8A-1452-RN (démo)', 'Toyota Hilux'], ['NY2', '8B-2210-RN (démo)', 'Nissan NP300'], ['DOS', '3C-0874-RN (démo)', 'Tricycle cargo'], ['TAH', '5A-3317-RN (démo)', 'Toyota Hilux'], ['MAR', '4B-6620-RN (démo)', 'Mitsubishi L200'], ['MAY', '8C-9031-RN (démo)', 'Camionnette Isuzu']])
    flotte.push(await ref('vehicules', { immatriculation: immat, modele: `${modele} (démo)`, equipe_id: eq(code).id, conducteur: `Chauffeur ${eq(code).nom} (démo)` }));
  const vehDe = (tcode) => flotte.find((v) => v.equipe_id === eq(tcode).id);
  // Documents et entretien des véhicules
  const docs = async (v, cc, date, montant, debut, fin, extra = {}) => {
    const c = cat(cc); const e = state.equipes.find((x) => x.id === v.equipe_id);
    let res = await handle(db, 'dep.save', { depense: { date, categorie_id: c.id, montant, equipe_id: e.id, zone_id: e.zone_id, vehicule_id: v.id, beneficiaire: { ASSU: 'Assureur (démo)', VIGN: 'Trésor public (démo)', VTEC: 'Centre de contrôle technique (démo)', VIDA: 'Garage (démo)', REPA: 'Garage (démo)', FILT: 'Garage (démo)' }[cc], mode_paiement: 'Espèces', reference_piece: `${cc}-${v.immatriculation.slice(0, 9)}-${date}`, description: c.description_obligatoire ? (extra.description || `${c.libelle} ${v.immatriculation}`) : null, validite_debut: debut, validite_fin: fin, ...extra } }, C);
    await handle(db, 'dep.upload', { depense_id: res.depense.id, nom: `piece-${cc.toLowerCase()}.png`, type: 'image/png', base64: recu }, C);
    res = await handle(db, 'dep.save', { depense: { id: res.depense.id }, soumettre: true }, C);
    if (date < addDays(end, -10)) await handle(db, 'dep.decision', { id: res.depense.id, decision: 'valider' }, ctx(U.daf));
  };
  const plans = [ // [assurance début, vignette fin, visite technique fin]
    ['2026-01-10', '2026-12-31', '2026-12-05'], ['2025-11-08', '2026-12-31', '2026-11-12'], ['2026-03-01', '2026-12-31', '2026-10-20'],
    ['2026-06-15', '2026-12-31', '2027-01-30'], ['2025-12-02', '2026-12-31', '2026-11-03'], ['2026-02-20', '2026-12-31', '2027-02-14'], ['2026-04-01', '2026-12-31', '2026-12-20'],
  ];
  for (const [k, v] of flotte.entries()) {
    const [a0, vfin, tfin] = plans[k];
    await docs(v, 'ASSU', a0 < start ? start : a0, 185000 + k * 15000, a0, addDays(a0, 364));
    await docs(v, 'VIGN', '2026-05-05', 45000, '2026-01-01', vfin);
    await docs(v, 'VTEC', addDays(tfin, -183) < start ? start : addDays(tfin, -183), 25000, addDays(tfin, -183), tfin);
    let km = 41000 + k * 9000;
    for (const mo of ['2026-05-18', '2026-07-16', '2026-09-14']) { km += 4800 + Math.round(r() * 1500); if (mo <= end) await docs(v, 'VIDA', mo, 35000, null, null, { kilometrage: km }); }
    if (k % 2 === 0) await docs(v, 'REPA', `2026-0${6 + k % 3}-22`, 95000 + k * 20000, null, null, { description: ['Remplacement plaquettes de frein', 'Réparation embrayage', 'Changement pneus avant', 'Batterie et alternateur'][k % 4] + ' (démo)' });
  }
  const months = []; for (let m = 5; m <= Number(end.slice(5, 7)); m++) months.push(`2026-${String(m).padStart(2, '0')}`);
  const teams = ['NY1', 'NY2', 'BAL', 'DOS', 'ZIN', 'TAH', 'KON', 'MAR', 'MAY', 'CTR'];
  for (const mo of months) {
    for (const tcode of teams) {
      const e = eq(tcode);
      const items = [['CARB', 30000 + Math.round(r() * 40) * 1000], ['SALA', 150000], ['GADG', r() < 0.4 ? 25000 : 0]];
      if (tcode === 'ZIN') items.push(['INSA', r() < 0.4 ? 15000 : 0], ['AUTO', mo === '2026-06' ? 30000 : 0]);
      if (vehDe(tcode)) items.push(['FILT', r() < 0.35 ? 18000 : 0]);
      if (mo === '2026-05' && tcode !== 'CTR') items.push(['PATE', 60000]);
      if (mo === '2026-06') items.push(['CCAA', 20000]);
      items.push(['CCAN', r() < 0.15 ? 12000 : 0], ['AUTR', r() < 0.12 ? 15000 + Math.round(r() * 10) * 1000 : 0]);
      for (const [cc, mt] of items) {
        if (!mt) continue;
        const day = `${mo}-${String(3 + Math.floor(r() * 24)).padStart(2, '0')}`;
        if (day > end) continue;
        const c = cat(cc);
        const vt = vehDe(tcode);
        const isVeh = c.vehicule_obligatoire || (cc === 'CARB' && vt);
        let res = await handle(db, 'dep.save', { depense: { date: day, categorie_id: c.id, montant: mt, equipe_id: e.id, zone_id: e.zone_id, vehicule_id: isVeh ? (vt || veh).id : null, litres: cc === 'CARB' && vt ? Math.round(mt / 700) : null, beneficiaire: cc === 'CARB' ? 'Station (démo)' : cc === 'SALA' ? 'Agents de terrain' : 'Fournisseur (démo)', mode_paiement: 'Espèces', reference_piece: `PC-${mo}-${tcode}-${cc}`, description: c.description_obligatoire ? `${c.libelle} ${e.nom}` : null }, soumettre: !c.justif_obligatoire }, C);
        if (c.justif_obligatoire) {
          await handle(db, 'dep.upload', { depense_id: res.depense.id, nom: `recu-${cc.toLowerCase()}-${mo}.png`, type: 'image/png', base64: recu }, C);
          res = await handle(db, 'dep.save', { depense: { id: res.depense.id }, soumettre: true }, C);
        }
        const recent = mo === end.slice(0, 7);
        if (!recent || r() < 0.4) {
          if (cc !== 'SALA') await handle(db, 'dep.decision', { id: res.depense.id, decision: 'controler' }, C);
          await handle(db, 'dep.decision', { id: res.depense.id, decision: 'valider' }, ctx(U.daf));
        }
      }
    }
  }
  // Objectifs commerciaux (agents, zones, produits) de mai au mois en cours
  for (const mo of months) {
    await handle(db, 'objectif.bulk', { mois: mo, axe: 'agent', lignes: agents.map((ag) => { const q = 30 + Math.round(r() * 12) * 5; return { cible_id: ag.id, objectif_cartons: q, objectif_ca: q * 13500 }; }) }, C);
    await handle(db, 'objectif.bulk', { mois: mo, axe: 'zone', lignes: state.zones.filter((z) => z.nom !== 'Agadez').map((z) => { const q = z.nom === 'Niamey' ? 420 : 110 + Math.round(r() * 8) * 10; return { cible_id: z.id, objectif_cartons: q, objectif_ca: q * 13500 }; }) }, C);
    await handle(db, 'objectif.bulk', { mois: mo, axe: 'produit', lignes: produits.map((p, k) => ({ cible_id: p.id, objectif_cartons: [450, 260, 180][k], objectif_ca: [450, 260, 180][k] * p.prix_ref })) }, C);
    await handle(db, 'objectif.bulk', { mois: mo, axe: 'marche', lignes: state.marches.slice(0, 12).map((m) => ({ cible_id: m.id, objectif_cartons: 40 + Math.round(r() * 6) * 5 })) }, C);
  }
  // Fiches mensuelles des agents terrain (présence, déstockage, évaluation)
  for (const mo of months) {
    const enCours = mo === months[months.length - 1];
    await handle(db, 'suivi.bulk', { mois: mo, lignes: agents.map((ag) => {
      const jp = enCours ? 18 + Math.round(r() * 6) : 24 + Math.round(r() * 6), nj = r() < 0.2 ? 1 + Math.round(r()) : 0;
      const od = 40 + Math.round(r() * 6) * 5, note = Math.min(10, Math.round((5 + r() * 5) * 2) / 2);
      return { agent_id: ag.id, jours_presents: jp, retards: Math.round(r() * 3), abs_j: r() < 0.3 ? 1 : 0, abs_nj: nj, obj_destock: od, destock: Math.round(od * (0.55 + r() * 0.6)),
        visites: 15 + Math.round(r() * 25), nouveaux_clients: Math.round(r() * 5), plv: Math.round(r() * 8), note: enCours ? null : note, commentaire: nj ? 'Absence non justifiée à régulariser (démo)' : '' };
    }) }, C);
  }
  for (const mo of months.slice(-2)) for (const tcode of teams) await handle(db, 'budget.save', { budget: { mois: mo, equipe_id: eq(tcode).id, montant: tcode === 'ZIN' ? 320000 : 230000 } }, ctx(U.daf));
  // Demandes de carburant et de vidange
  {
    const fl = state.vehicules.filter((v) => v.actif !== false && v.equipe_id).slice(0, 3);
    const dd = (k) => { const x = new Date(Date.now() - k * 86400000); return x.toISOString().slice(0, 10); };
    for (const [i, v] of fl.entries()) {
      const km = 42000 + i * 9000;
      const c1 = (await handle(db, 'demande.save', { demande: { type: 'carburant', date: dd(6 - i), equipe_id: v.equipe_id, vehicule_id: v.id, km_actuel: km, montant_demande: 50000 + i * 10000, motif: 'Tournée des marchés et livraisons grossistes (démo)' } }, C)).demande;
      if (i < 2) await handle(db, 'demande.decision', { id: c1.id, decision: 'accordee', creer_depense: i === 0, direction: { solde_carte_avant: 850000 - i * 120000, montant_accorde: 50000 + i * 10000, plafond_restant: 180000 - i * 40000 } }, ctx(U.dg));
      if (i === 1) await handle(db, 'demande.save', { demande: { type: 'vidange', date: dd(1), equipe_id: v.equipe_id, vehicule_id: v.id, km_actuel: km + 350, km_derniere_vidange: km - 4700, motif: 'Vidange périodique (5 000 km atteints)' } }, C);
    }
  }
  for (const mo of months.slice(0, -2)) await handle(db, 'cloture.set', { mois: mo, statut: 'cloture', commentaire: 'Clôture démo' }, ctx(U.daf));
  await handle(db, 'anomalie.create', { objet_type: 'depenses', description: 'Carburant Zinder en hausse : vérifier les relevés kilométriques (démo).' }, ctx(U.cdg));
  return U;
}

// Petite image de reçu fictif (générée dans le navigateur ; 1 pixel en dehors)
function receiptPNG() {
  try {
    const c = document.createElement('canvas'); c.width = 360; c.height = 220;
    const g = c.getContext('2d');
    g.fillStyle = '#fffdf6'; g.fillRect(0, 0, 360, 220); g.strokeStyle = '#999'; g.strokeRect(6, 6, 348, 208);
    g.fillStyle = '#222'; g.font = 'bold 20px sans-serif'; g.fillText('REÇU — DÉMONSTRATION', 24, 46);
    g.font = '15px sans-serif'; g.fillText('Pièce fictive générée pour la démo', 24, 84); g.fillText('ORIBA FOODS — ERP', 24, 112);
    g.fillStyle = '#c0392b'; g.font = 'bold 26px sans-serif'; g.fillText('SPÉCIMEN', 24, 176);
    return c.toDataURL('image/png').split(',')[1];
  } catch { return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; }
}
