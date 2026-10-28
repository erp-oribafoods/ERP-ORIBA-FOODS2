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
  const agents = [];
  let i = 1;
  for (const m of state.marches) agents.push(await ref('agents', { code: `AG${String(i++).padStart(2, '0')}`, nom: `Agent ${m.nom} (démo)`, equipe_id: m.equipe_id, zone_id: m.zone_id, date_affectation: '2026-04-01' }));
  const clients = [];
  const noms = ['Ets Moussa & Fils', 'Boutique Al Barka', 'Grossiste Hamani', 'Ets Issoufou Commerce', 'Alimentation Nafissa', 'Dépôt Garba', 'Ets Salifou', 'Supérette Yacouba', 'Ets Mariama Négoce', 'Boutique Zeinabou'];
  for (const [k, n] of noms.entries()) clients.push(await ref('clients', { code: `CL${String(k + 1).padStart(3, '0')}`, nom: `${n} (démo)`, type: k < 4 ? 'Grossiste' : k < 7 ? 'Demi-grossiste' : 'Boutique', marche_id: state.marches[k % state.marches.length].id }));
  const depot = await ref('clients', { code: 'CL900', nom: 'Grand dépôt Katako (démo)', type: 'Grossiste', marche_id: state.marches.find((m) => m.nom === 'Katako').id, depositaire: true });
  await handle(db, 'param.save', { cle: 'plafond_cartons_client', valeur: 1000, motif: 'Valeur de référence du fichier (1 000 cartons par client)' }, ctx(U.daf));

  // Ventes de mai à aujourd'hui
  const start = '2026-05-02', end = today();
  let d = start;
  const ventesCredit = [];
  while (d <= end) {
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const ai = Math.floor(r() * agents.length); const ag = agents[ai]; const m = state.marches[ai];
      const credit = r() < 0.35;
      const cl = credit ? clients[Math.floor(r() * 6)] : pick(clients);
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

  // Dépenses mensuelles par équipe
  const cat = (c) => state.categories_depense.find((x) => x.code === c);
  const veh = state.vehicules[0];
  const months = []; for (let m = 5; m <= Number(end.slice(5, 7)); m++) months.push(`2026-${String(m).padStart(2, '0')}`);
  const teams = ['NY1', 'NY2', 'BAL', 'DOS', 'ZIN', 'TAH', 'KON', 'MAR', 'MAY', 'CTR'];
  for (const mo of months) {
    for (const tcode of teams) {
      const e = eq(tcode);
      const items = [['CARB', 30000 + Math.round(r() * 40) * 1000], ['SALA', 150000], ['GADG', r() < 0.4 ? 25000 : 0]];
      if (tcode === 'ZIN') items.push(['VIDA', r() < 0.5 ? 35000 : 0], ['REPA', r() < 0.3 ? 85000 : 0]);
      for (const [cc, mt] of items) {
        if (!mt) continue;
        const day = `${mo}-${String(3 + Math.floor(r() * 24)).padStart(2, '0')}`;
        if (day > end) continue;
        const c = cat(cc);
        const isVeh = c.vehicule_obligatoire || (tcode === 'ZIN' && cc === 'CARB');
        let res = await handle(db, 'dep.save', { depense: { date: day, categorie_id: c.id, montant: mt, equipe_id: e.id, zone_id: e.zone_id, vehicule_id: isVeh ? veh.id : null, beneficiaire: cc === 'CARB' ? 'Station (démo)' : cc === 'SALA' ? 'Agents de terrain' : 'Fournisseur (démo)', mode_paiement: 'Espèces', reference_piece: `PC-${mo}-${tcode}-${cc}`, description: c.description_obligatoire ? `${c.libelle} ${e.nom}` : null }, soumettre: !c.justif_obligatoire }, C);
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
  for (const mo of months.slice(-2)) for (const tcode of teams) await handle(db, 'budget.save', { budget: { mois: mo, equipe_id: eq(tcode).id, montant: tcode === 'ZIN' ? 320000 : 230000 } }, ctx(U.daf));
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
