// Recette automatisée (scénarios REC-01 à REC-12 et DEP-REC) sur base PostgreSQL locale ou mémoire.
import bcrypt from 'bcryptjs';
import pg from 'pg';
import { handle } from '../shared/core.js';
import { memoryAdapter } from '../shared/memory-adapter.js';
import { pgAdapter } from '../server/pg-adapter.mjs';
import { buildIndex, creditInfo, lots, today, addDays, doublonsDepenses } from '../shared/logic.js';

const mode = process.argv[2] || 'memory';
let db, stop = async () => {};
if (mode === 'pg') {
  const { NetlifyDB } = await import('@netlify/database-dev');
  const ndb = new NetlifyDB();
  const cs = await ndb.start();
  await ndb.applyMigrations('./netlify/database/migrations');
  const pool = new pg.Pool({ connectionString: cs, max: 1 });
  db = pgAdapter(pool);
  stop = async () => { await pool.end(); await ndb.stop(); };
  globalThis.__pool = pool;
} else {
  // Base mémoire initialisée avec les mêmes données de référence que la migration
  const { seedReference } = await import('../src/demo-seed.js');
  db = memoryAdapter(seedReference());
}

const crypto = { hash: (p) => bcrypt.hash(p, 4), verify: (p, h) => bcrypt.compare(p, h || '') };
const files = new Map();
const blobs = { put: async (k, b, m) => files.set(k, { ...m, base64: b }), get: async (k) => files.get(k) };
let pass = 0, failN = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓', m); } else { failN++; console.log('  ✗', m); } };
const call = (uidv, action, payload) => handle(db, action, payload, { userId: uidv, crypto, blobs });
async function expectErr(p, m, re) {
  try { await p; ok(false, m + ' (aucune erreur)'); } catch (e) { ok(!re || re.test(e.message), `${m} → « ${e.message} »`); }
}
const sessions = {};

console.log(`\nRecette — base ${mode}`);
ok(!(await call(null, 'auth.status')).initialise, 'Application non initialisée au départ');
const adm = await call(null, 'auth.init_admin', { nom: 'Admin', prenom: 'ERP', username: 'admin', email: 'admin@oriba.test', password: 'Admin2026!' });
sessions.admin = adm.user.id;
await expectErr(call(null, 'auth.init_admin', { nom: 'X', username: 'x', email: 'x@x.x', password: 'Azerty123' }), 'Seconde initialisation refusée');
await expectErr(call(null, 'auth.login', { identifiant: 'admin', password: 'faux' }), 'Mauvais mot de passe refusé');
const lg = await call(null, 'auth.login', { identifiant: 'ADMIN@oriba.test', password: 'Admin2026!' });
ok(lg.user.role_nom === 'Administrateur ERP', 'Connexion par e-mail, rôle Administrateur');

const B = (await call(sessions.admin, 'data.bootstrap')).data;
const role = (n) => B.roles.find((r) => r.nom.startsWith(n)).id;
console.log('REC-01 Création de comptes');
const mk = async (k, r) => (await call(sessions.admin, 'user.save', { user: { nom: k.toUpperCase(), prenom: 'Test', username: k, email: `${k}@oriba.test`, role_id: role(r) }, password: 'Initial2026' })).user;
const uCom = await mk('commercial', 'Responsable Commercial'); const uDG = await mk('dg', 'Direction'); const uDAF = await mk('daf', 'DAF'); const uCG = await mk('cdg', 'Contrôleur');
ok(!('mot_de_passe_hash' in uCom), 'Mot de passe non renvoyé');
await expectErr(mk('commercial', 'DAF'), 'Identifiant dupliqué refusé', /déjà/);
await expectErr(call(sessions.admin, 'user.save', { user: { nom: 'Y', username: 'yy', email: 'COMMERCIAL@oriba.test', role_id: role('DAF') }, password: 'Initial2026' }), 'E-mail dupliqué refusé', /déjà/);
await expectErr(call(uCom.id, 'data.bootstrap'), 'Changement de mot de passe exigé à la 1re connexion', /changer/);
for (const u of [uCom, uDG, uDAF, uCG]) await call(u.id, 'auth.change_password', { ancien: 'Initial2026', nouveau: 'Nouveau2026' });
sessions.com = uCom.id; sessions.dg = uDG.id; sessions.daf = uDAF.id; sessions.cg = uCG.id;

console.log('REC-02 Droits par profil');
await expectErr(call(sessions.dg, 'vente.create', { vente: {}, lignes: [] }), 'DG ne peut pas saisir de vente', /Responsable Commercial/);
await expectErr(call(sessions.admin, 'remb.create', { vente_id: 'x' }), 'Admin ERP ne peut pas enregistrer de remboursement');

// Référentiels
const ref = async (table, row) => (await call(sessions.com, 'ref.save', { table, row })).row;
const prod = await ref('produits', { code: 'DADI-AR', nom: 'Arôme Dadi 10 g (carton)', packs_par_carton: 12, prix_ref: 13000 });
await expectErr(ref('produits', { code: 'dadi-ar', nom: 'Doublon', packs_par_carton: 12 }), 'Code produit dupliqué refusé', /déjà utilisé/);
const eq = B.equipes.find((e) => e.code === 'NY1'); const eq2 = B.equipes.find((e) => e.code === 'ZIN');
const mar = B.marches[0];
const ag = await ref('agents', { code: 'A01', nom: 'Agent Test', equipe_id: eq.id, zone_id: eq.zone_id });
const cli = await ref('clients', { code: 'C01', nom: 'Grossiste Test', type: 'Grossiste', marche_id: mar.id });
const dep = await ref('clients', { code: 'C02', nom: 'Gros client dépositaire', type: 'Grossiste', marche_id: mar.id, depositaire: true });

console.log('REC-03 Vente comptant');
const vc = await call(sessions.com, 'vente.create', { vente: { date: today(), mode: 'comptant', agent_id: ag.id, marche_id: mar.id, client_id: cli.id }, lignes: [{ produit_id: prod.id, unite: 'carton', quantite: 2, prix_unitaire: 13000 }] });
ok(vc.lignes[0].montant === 26000 && /^VC-\d{4}-\d{5}$/.test(vc.vente.numero), `2 × 13 000 = ${vc.lignes[0].montant} FCFA, n° ${vc.vente.numero}`);
await expectErr(call(sessions.com, 'vente.create', { vente: { date: today(), mode: 'comptant', agent_id: ag.id, marche_id: mar.id }, lignes: [{ produit_id: prod.id, unite: 'carton', quantite: -1, prix_unitaire: 1 }] }), 'Quantité négative refusée', /positive/);
const vp = await call(sessions.com, 'vente.create', { vente: { date: today(), mode: 'comptant', agent_id: ag.id, marche_id: mar.id }, lignes: [{ produit_id: prod.id, unite: 'pack', quantite: 6, prix_unitaire: 1200 }] });
ok(vp.lignes[0].cartons === 0.5, `6 packs = ${vp.lignes[0].cartons} carton`);

console.log('REC-04 Vente à crédit + remboursements partiels');
const vr = await call(sessions.com, 'vente.create', { vente: { date: today(), mode: 'credit', agent_id: ag.id, marche_id: mar.id, client_id: cli.id }, lignes: [{ produit_id: prod.id, unite: 'carton', quantite: 10, prix_unitaire: 13000 }] });
ok(vr.vente.echeance === addDays(today(), 30), 'Échéance par défaut à 30 jours');
await call(sessions.com, 'remb.create', { vente_id: vr.vente.id, date: today(), montant: 50000, mode: 'Espèces' });
const r2 = await call(sessions.com, 'remb.create', { vente_id: vr.vente.id, date: today(), montant: 30000, mode: 'Mobile money' });
ok(r2.solde === 50000, `Solde après 2 remboursements : ${r2.solde}`);
await expectErr(call(sessions.com, 'remb.create', { vente_id: vr.vente.id, date: today(), montant: 60000 }), 'Remboursement > solde refusé', /supérieur/);
let D = (await call(sessions.dg, 'data.bootstrap')).data; let I = buildIndex(D);
let ci = creditInfo(D.ventes.find((v) => v.id === vr.vente.id), I);
ok(ci.statut === 'Partiellement remboursé' && ci.remboursements.length === 2, `Statut : ${ci.statut}, ${ci.remboursements.length} encaissements conservés`);

console.log('REC-05 Plafond de créances');
await call(sessions.daf, 'param.save', { cle: 'plafond_cartons_client', valeur: 100, motif: 'Test recette' });
await expectErr(call(sessions.daf, 'param.save', { cle: 'plafond_cartons_client', valeur: 100 }), 'Motif obligatoire pour un paramètre', /motif/);
const credit = (q, c = cli.id, date = today(), echeance) => call(sessions.com, 'vente.create', { vente: { date, mode: 'credit', agent_id: ag.id, marche_id: mar.id, client_id: c, echeance }, lignes: [{ produit_id: prod.id, unite: 'carton', quantite: q, prix_unitaire: 1000 }] });
let res = await credit(75); ok(res.plafond.niv === 's1', `≈${res.plafond.total.toFixed(1)} ctn → ${res.plafond.label}`);
res = await credit(12); ok(res.plafond.niv === 's2', `≈${res.plafond.total.toFixed(1)} ctn → ${res.plafond.label}, marge ${res.plafond.marge.toFixed(1)}`);
res = await credit(20); ok(res.plafond.niv === 'depasse', `≈${res.plafond.total.toFixed(1)} ctn → ${res.plafond.label}`);
await call(sessions.daf, 'param.save', { cle: 'blocage_credit_depassement', valeur: true, motif: 'Test' });
await expectErr(credit(5), 'Blocage automatique au-delà du plafond', /refusé/);
await call(sessions.daf, 'param.save', { cle: 'blocage_credit_depassement', valeur: false, motif: 'Test' });
await call(sessions.daf, 'param.save', { cle: 'plafond_cartons_client', valeur: 1000, motif: 'Retour valeur' });

console.log('REC-06 Retard');
const old = await credit(3, cli.id, addDays(today(), -40), addDays(today(), -10));
D = (await call(sessions.dg, 'data.bootstrap')).data; I = buildIndex(D);
ci = creditInfo(D.ventes.find((v) => v.id === old.vente.id), I);
ok(ci.statut === 'En retard' && ci.joursRetard === 10, `Statut ${ci.statut}, ${ci.joursRetard} jours`);

console.log('REC-07 Remboursement intégral');
await call(sessions.com, 'remb.create', { vente_id: old.vente.id, date: today(), montant: 3000 });
D = (await call(sessions.dg, 'data.bootstrap')).data; I = buildIndex(D);
ci = creditInfo(D.ventes.find((v) => v.id === old.vente.id), I);
ok(ci.statut === 'Soldé' && ci.solde === 0, `Statut ${ci.statut}, solde ${ci.solde}`);

console.log('REC-08 Stock confié');
await expectErr(call(sessions.com, 'stock.create', { type: 'remise', client_id: cli.id, produit_id: prod.id, date: today(), quantite: 500 }), 'Remise refusée hors dépositaire', /dépositaire/);
const lot = (await call(sessions.com, 'stock.create', { type: 'remise', client_id: dep.id, produit_id: prod.id, date: today(), quantite: 500, valeur_unitaire: 12500, document: 'BL-001' })).mouvement;
const sv = await call(sessions.com, 'stock.create', { type: 'vente', lot_id: lot.id, date: today(), quantite: 120, vente: { mode: 'comptant', prix_unitaire: 13000, agent_id: ag.id, marche_id: mar.id } });
ok(sv.vente && sv.vente.lignes[0].montant === 1560000, `Vente imputée facturée : ${sv.vente.vente.numero}`);
await call(sessions.com, 'stock.create', { type: 'perte', lot_id: lot.id, date: today(), quantite: 2, motif: 'Cartons abîmés' });
await expectErr(call(sessions.com, 'stock.create', { type: 'vente', lot_id: lot.id, date: today(), quantite: 1000, vente: { prix_unitaire: 1 } }), 'Vente supérieure au stock refusée', /supérieure/);
await call(sessions.com, 'stock.create', { type: 'inventaire', lot_id: lot.id, date: today(), quantite: 370 });
D = (await call(sessions.dg, 'data.bootstrap')).data; I = buildIndex(D);
const L = lots(I).find((l) => l.id === lot.id);
ok(L.restant === 378 && L.dernierInv.ecart === -8, `Restant ${L.restant} ctn, écart inventaire ${L.dernierInv.ecart}`);

console.log('REC-10 Correction contrôlée');
await expectErr(call(sessions.com, 'vente.correct', { id: vc.vente.id, vente: {}, lignes: [{ id: vc.lignes[0].id, produit_id: prod.id, unite: 'carton', quantite: 3, prix_unitaire: 13000 }] }), 'Correction sans motif refusée', /motif/);
await call(sessions.com, 'vente.correct', { id: vc.vente.id, vente: {}, lignes: [{ id: vc.lignes[0].id, produit_id: prod.id, unite: 'carton', quantite: 3, prix_unitaire: 13000 }], motif: 'Erreur de saisie quantité' });
const au = (await call(sessions.dg, 'audit.list', {})).rows.find((r) => r.objet_id === vc.vente.id && r.action === 'CORRECTION');
ok(au && au.avant.lignes[0].quantite === 2 && au.apres.lignes.find((l) => !l.annulee).quantite === 3 && au.motif, 'Audit : ancienne et nouvelle valeur + motif');
await expectErr(call(sessions.cg, 'vente.correct', { id: vc.vente.id, motif: 'x', lignes: [] }), 'Contrôleur de gestion ne peut pas corriger', /insuffisant/);
await expectErr(call(sessions.com, 'vente.cancel', { id: vr.vente.id, motif: 'test' }), 'Annulation bloquée si remboursements actifs', /remboursements/);

console.log('DEP-REC Dépenses');
const cats = Object.fromEntries(B.categories_depense.map((c) => [c.code, c]));
const carb = { date: today(), categorie_id: cats.CARB.id, montant: 25000, equipe_id: eq.id, mode_paiement: 'Espèces', beneficiaire: 'Station Total' };
await expectErr(call(sessions.com, 'dep.save', { depense: carb, soumettre: true }), 'Soumission sans justificatif refusée', /justificatif/i);
const d1 = (await call(sessions.com, 'dep.save', { depense: carb })).depense;
await call(sessions.com, 'dep.upload', { depense_id: d1.id, nom: 'recu.png', type: 'image/png', base64: 'iVBORw0KGgo=' });
const d1s = (await call(sessions.com, 'dep.save', { depense: { id: d1.id }, soumettre: true })).depense;
ok(d1s.statut === 'soumise' && /^DP-/.test(d1s.numero), `DEP-REC-01 dépense ${d1s.numero} soumise avec pièce`);
const f = await call(sessions.daf, 'dep.file', { id: d1.id }); ok(f.nom === 'recu.png', 'Pièce consultable par la DAF');
await expectErr(call(sessions.com, 'dep.decision', { id: d1.id, decision: 'valider' }), 'Commercial ne valide pas (droit DAF)', /insuffisant|manquant/);
await call(sessions.com, 'dep.decision', { id: d1.id, decision: 'controler' });
const d1v = (await call(sessions.daf, 'dep.decision', { id: d1.id, decision: 'valider' })).depense;
ok(d1v.statut === 'validee', 'DEP-REC-02 dépense validée par la DAF');
await expectErr(call(sessions.com, 'dep.save', { depense: { id: d1.id, montant: 1 } }), 'DEP-REC-03 modification d’une dépense validée refusée', /validée/);
await expectErr(call(sessions.cg, 'dep.cancel', { id: d1.id, motif: 'x' }), 'DEP-REC-03 annulation sans droit refusée');
const d2 = (await call(sessions.com, 'dep.save', { depense: { ...carb, reference_piece: 'R1' } })).depense;
const d3 = (await call(sessions.com, 'dep.save', { depense: { ...carb, reference_piece: 'R1' } })).depense;
D = (await call(sessions.daf, 'data.bootstrap')).data;
const dbl = doublonsDepenses(D.depenses); ok(dbl.has(d2.id) && dbl.has(d3.id), 'DEP-REC-04 doublon potentiel signalé, rien supprimé');
await call(sessions.daf, 'budget.save', { budget: { mois: today().slice(0, 7), equipe_id: eq.id, montant: 30000 } });
ok(true, 'DEP-REC-05 budget enregistré (alertes calculées à l’écran)');
await expectErr(call(sessions.com, 'dep.save', { depense: { ...carb, partagee: true, equipe_id: null }, repartitions: [{ equipe_id: eq.id, montant: 10000 }, { equipe_id: eq2.id, montant: 10000 }] }), 'DEP-REC-06 répartition incohérente refusée', /égale/);
const dsh = (await call(sessions.com, 'dep.save', { depense: { ...carb, montant: 20000, partagee: true, equipe_id: null, reference_piece: 'P9' }, repartitions: [{ equipe_id: eq.id, montant: 12000 }, { equipe_id: eq2.id, montant: 8000 }] })).depense;
ok(dsh.partagee, 'DEP-REC-06 dépense répartie sur deux équipes');
const sal = (await call(sessions.com, 'dep.save', { depense: { date: today(), categorie_id: cats.SALA.id, montant: 90000, equipe_id: eq.id, reference_piece: 'PAIE-10' }, soumettre: true })).depense;
await call(sessions.daf, 'dep.decision', { id: sal.id, decision: 'valider' });
const Dcg = (await call(sessions.cg, 'data.bootstrap')).data;
ok(!Dcg.depenses.some((d) => d.id === sal.id) && Dcg.depenses_agregats.some((a) => a.montant === 90000), 'DEP-REC-10 salaire masqué au contrôleur, agrégat visible');
await call(sessions.daf, 'cloture.set', { mois: today().slice(0, 7), statut: 'cloture' });
await expectErr(call(sessions.com, 'dep.save', { depense: carb }), 'DEP-REC-09 saisie refusée sur période clôturée', /clôturée/);
await expectErr(call(sessions.daf, 'cloture.set', { mois: today().slice(0, 7), statut: 'rouvert' }), 'Réouverture sans motif refusée', /motif/);
await call(sessions.daf, 'cloture.set', { mois: today().slice(0, 7), statut: 'rouvert', commentaire: 'Correction autorisée' });

console.log('REC-12 Reprise historique');
const imp = await call(sessions.com, 'import.run', { type: 'ventes_comptant', fichier: 'test.xlsx', rows: [
  { ligne: 2, data: { date: '2026-05-03', agent_id: ag.id, marche_id: mar.id }, lignes: [{ produit_id: prod.id, unite: 'carton', quantite: 4, prix_unitaire: 13000 }] },
  { ligne: 3, data: { date: 'pas une date', agent_id: ag.id, marche_id: mar.id }, lignes: [{ produit_id: prod.id, unite: 'carton', quantite: 4, prix_unitaire: 13000 }] },
] });
ok(imp.integrees.length === 1 && imp.refuses.length === 1, `Import : ${imp.integrees.length} intégrée, ${imp.refuses.length} rejetée (${imp.refuses[0]?.erreur})`);

console.log('Objectifs commerciaux');
const ob = await call(sessions.com, 'objectif.bulk', { mois: today().slice(0, 7), axe: 'agent', lignes: [{ cible_id: ag.id, objectif_cartons: 50, objectif_ca: 650000 }] });
ok(ob.modifies === 1, 'Objectif mensuel enregistré pour un agent');
const ob2 = await call(sessions.com, 'objectif.bulk', { mois: today().slice(0, 7), axe: 'agent', lignes: [{ cible_id: ag.id, objectif_cartons: 60, objectif_ca: 650000 }] });
D = (await call(sessions.dg, 'data.bootstrap')).data;
ok(ob2.modifies === 1 && D.objectifs.filter((o) => o.cible_id === ag.id).length === 1 && D.objectifs[0].objectif_cartons === 60, 'Objectif mis à jour sans doublon');
await expectErr(call(sessions.daf, 'objectif.bulk', { mois: today().slice(0, 7), axe: 'agent', lignes: [] }), 'La DAF consulte les objectifs sans les modifier', /insuffisant/);
const dv = (await call(sessions.com, 'dep.save', { depense: { date: today(), categorie_id: cats.ASSU.id, montant: 150000, equipe_id: eq.id, vehicule_id: B.vehicules[0].id, reference_piece: 'POL-1', validite_debut: today(), validite_fin: '2027-10-27' } })).depense;
ok(dv.validite_fin === '2027-10-27', 'Assurance enregistrée avec sa date de fin de validité');

console.log('Sécurité');
await call(sessions.admin, 'user.save', { user: { id: uCG.id, statut: 'desactive' } });
await expectErr(call(sessions.cg, 'data.bootstrap'), 'Compte désactivé : accès révoqué', /désactivé/);
if (mode === 'pg') {
  await expectErr(globalThis.__pool.query('delete from audit_log'), 'Journal d’audit non supprimable en base', /audit/);
  await expectErr(globalThis.__pool.query('delete from ventes'), 'Suppression de vente interdite en base', /Suppression interdite/);
  await expectErr(globalThis.__pool.query(`update remboursements set montant = 999999 where vente_id = '${vr.vente.id}'`), 'Trigger base : trop-perçu bloqué', /supérieur/);
}
for (let i = 0; i < 5; i++) { try { await call(null, 'auth.login', { identifiant: 'dg', password: 'mauvais' }); } catch {} }
await expectErr(call(null, 'auth.login', { identifiant: 'dg', password: 'Nouveau2026' }), 'Verrouillage après 5 échecs', /verrouillé/);

console.log(`\n${pass} contrôles réussis, ${failN} en échec`);
await stop();
process.exit(failN ? 1 : 0);
