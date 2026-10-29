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
{ const lgc = await call(null, 'auth.login', { identifiant: 'commercial', password: 'Nouveau2026' }); ok(lgc.user && !lgc.user.must_change_password, 'Chaque utilisateur change lui-même son mot de passe et se reconnecte avec'); }
await expectErr(call(null, 'auth.login', { identifiant: 'commercial', password: 'Initial2026' }), 'L’ancien mot de passe ne fonctionne plus');
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
console.log('Suivi des agents terrain');
const sa = await call(sessions.com, 'suivi.bulk', { mois: today().slice(0, 7), lignes: [{ agent_id: ag.id, jours_presents: 25, retards: 1, abs_j: 0, abs_nj: 1, obj_destock: 200, destock: 150, visites: 30, nouveaux_clients: 2, plv: 3, note: 8.5, commentaire: 'RAS' }] });
ok(sa.modifies === 1, 'Fiche mensuelle d’un agent enregistrée');
const sv2 = await call(sessions.com, 'suivi.bulk', { mois: today().slice(0, 7), lignes: [{ agent_id: ag.id, jours_presents: 26, retards: 1, abs_j: 0, abs_nj: 1, obj_destock: 200, destock: 150, visites: 30, nouveaux_clients: 2, plv: 3, note: 8.5, commentaire: 'RAS' }] });
D = (await call(sessions.dg, 'data.bootstrap')).data;
ok(sv2.modifies === 1 && D.suivi_agents.length === 1 && Number(D.suivi_agents[0].jours_presents) === 26, 'Fiche corrigée sans doublon, visible par la DG');
const sv3 = await call(sessions.com, 'suivi.bulk', { mois: today().slice(0, 7), lignes: [{ agent_id: ag.id, jours_presents: 26, retards: 1, abs_j: 0, abs_nj: 1, obj_destock: 200, destock: 150, visites: 30, nouveaux_clients: 2, plv: 3, note: 8.5, commentaire: 'RAS' }] });
ok(sv3.modifies === 0, 'Aucune écriture si rien ne change');
await expectErr(call(sessions.com, 'suivi.bulk', { mois: today().slice(0, 7), lignes: [{ agent_id: ag.id, note: 12 }] }), 'Note limitée à 10', /entre 0 et 10/);
await expectErr(call(sessions.daf, 'suivi.bulk', { mois: today().slice(0, 7), lignes: [] }), 'La DAF consulte le suivi sans le modifier', /insuffisant/);
console.log('Responsable commercial seul habilité (double contrôle désactivable)');
{
  const rc = (await call(sessions.admin, 'data.bootstrap')).data.roles.find((r) => r.nom.startsWith('Responsable Commercial'));
  await call(sessions.admin, 'role.save', { role: { ...rc, permissions: { ...rc.permissions, depenses: ['lire', 'creer', 'modifier', 'controler', 'valider', 'annuler', 'exporter'] } } });
  const dd = (await call(sessions.com, 'dep.save', { depense: { ...carb, montant: 31000, sans_piece: true, description: 'Ticket illisible' }, soumettre: true })).depense;
  await expectErr(call(sessions.com, 'dep.decision', { id: dd.id, decision: 'valider' }), 'Double contrôle actif : pas de validation de sa propre saisie', /Séparation/);
  await call(sessions.daf, 'param.save', { cle: 'double_controle', valeur: false, motif: 'Responsable commercial seul habilité' });
  const ok2 = (await call(sessions.com, 'dep.decision', { id: dd.id, decision: 'valider' })).depense;
  ok(ok2.statut === 'validee', 'Double contrôle désactivé : le Responsable commercial valide sa propre dépense');
  await call(sessions.daf, 'param.save', { cle: 'double_controle', valeur: true, motif: 'Retour au réglage de test' });
  await call(sessions.admin, 'role.save', { role: rc });
}
console.log('Import Excel depuis les rubriques');
const m0 = today().slice(0, 7);
let im = await call(sessions.com, 'import.run', { type: 'objectifs', mode: 'courant', fichier: 'obj.xlsx', rows: [{ ligne: 2, data: { mois: m0, axe: 'agent', cible_id: ag.id, produit_id: null, objectif_cartons: 75, objectif_ca: null } }] });
D = (await call(sessions.dg, 'data.bootstrap')).data;
ok(im.integrees.length === 1 && D.objectifs.find((o) => o.cible_id === ag.id && o.mois === m0).objectif_cartons === 75, 'Objectifs mis à jour par fichier Excel');
im = await call(sessions.com, 'import.run', { type: 'suivi_agents', mode: 'courant', rows: [{ ligne: 2, data: { mois: m0, agent_id: ag.id, jours_presents: 20, note: 9 } }] });
D = (await call(sessions.dg, 'data.bootstrap')).data;
ok(im.integrees.length === 1 && Number(D.suivi_agents.find((r) => r.agent_id === ag.id && r.mois === m0).jours_presents) === 20, 'Fiche agent mise à jour par fichier Excel');
im = await call(sessions.daf, 'import.run', { type: 'budgets', mode: 'courant', rows: [{ ligne: 2, data: { mois: '2027-01', equipe_id: eq.id, montant: 300000 } }, { ligne: 3, data: { mois: '2027-01', equipe_id: eq.id, montant: 350000 } }] });
D = (await call(sessions.daf, 'data.bootstrap')).data;
ok(im.integrees.length === 2 && D.budgets.filter((b) => b.mois === '2027-01').length === 1 && Number(D.budgets.find((b) => b.mois === '2027-01').montant) === 350000, 'Budget créé puis mis à jour par fichier, sans doublon');
im = await call(sessions.admin, 'import.run', { type: 'agents', mode: 'courant', rows: [{ ligne: 2, data: { id: ag.id, telephone: '90 00 00 00' } }, { ligne: 3, data: { code: 'A99', nom: 'Agent importé', equipe_id: eq.id } }] });
D = (await call(sessions.admin, 'data.bootstrap')).data;
ok(im.integrees.length === 2 && D.agents.find((a) => a.id === ag.id).telephone === '90 00 00 00' && D.agents.some((a) => a.code === 'A99'), 'Référentiel agents : mise à jour et ajout par fichier');
im = await call(sessions.com, 'import.run', { type: 'depenses', mode: 'courant', rows: [{ ligne: 2, data: { date: today(), equipe_id: eq.id, categorie_id: cats.CARB.id, montant: 12000, reference_piece: 'T-1' } }, { ligne: 3, data: { date: today(), equipe_id: eq.id, categorie_id: cats.CARB.id, montant: 13000, sans_piece: true, description: 'Ticket perdu' } }] });
ok(im.integrees.length === 2 && im.brouillons.length === 1, `Dépenses importées : 1 soumise, 1 en brouillon (${im.brouillons[0]?.motif})`);
await expectErr(call(sessions.daf, 'import.run', { type: 'objectifs', mode: 'courant', rows: [] }).then((r) => { if (!r) throw new Error('x'); return call(sessions.daf, 'import.run', { type: 'ventes_comptant', mode: 'historique', rows: [] }); }), 'La reprise historique reste réservée', /insuffisant/);
im = await call(sessions.daf, 'import.run', { type: 'objectifs', mode: 'courant', rows: [{ ligne: 2, data: { mois: m0, axe: 'agent', cible_id: ag.id, objectif_cartons: 1 } }] });
ok(im.integrees.length === 0 && /insuffisant/.test(im.refuses[0]?.erreur || ''), 'Import par rubrique : les droits du module s’appliquent (DAF refusée sur les objectifs)');
console.log('Demandes de carburant et de vidange');
const veh = B.vehicules[0];
const dc = (await call(sessions.com, 'demande.save', { demande: { type: 'carburant', date: today(), equipe_id: eq.id, vehicule_id: veh.id, km_actuel: 45210, montant_demande: 50000, motif: 'Tournée Dosso – Gaya' } })).demande;
ok(/^DEM-CARB-\d{5}$/.test(dc.numero) && dc.statut === 'soumise', `Demande de carburant enregistrée (${dc.numero})`);
await expectErr(call(sessions.com, 'demande.save', { demande: { type: 'vidange', date: today(), equipe_id: eq.id, vehicule_id: veh.id, km_actuel: 0 } }), 'Kilométrage obligatoire', /obligatoire/);
await expectErr(call(sessions.com, 'demande.save', { demande: { type: 'vidange', date: today(), equipe_id: eq.id, vehicule_id: veh.id, km_actuel: 40000 } }), 'Kilométrage inférieur à une demande antérieure refusé', /inférieur/);
await expectErr(call(sessions.com, 'demande.decision', { id: dc.id, decision: 'accordee' }), 'Le demandeur ne décide pas', /habilité/);
const dcd = (await call(sessions.dg, 'demande.decision', { id: dc.id, decision: 'accordee', creer_depense: true, direction: { solde_carte_avant: 400000, montant_accorde: 45000, plafond_restant: 155000 } })).demande;
D = (await call(sessions.com, 'data.bootstrap')).data;
const depC = D.depenses.find((d) => d.id === dcd.depense_id);
ok(dcd.statut === 'accordee' && Number(dcd.montant_accorde) === 45000 && depC && Number(depC.montant) === 45000 && depC.statut === 'brouillon' && depC.reference_piece === dc.numero, 'Accord de la DG : dépense carburant créée en brouillon avec le n° de demande');
const dvi = (await call(sessions.com, 'demande.save', { demande: { type: 'vidange', date: today(), equipe_id: eq.id, vehicule_id: veh.id, km_actuel: 45300, km_derniere_vidange: 40300, motif: 'Vidange périodique' } })).demande;
ok(/^DEM-VID-\d{5}$/.test(dvi.numero), `Demande de vidange enregistrée (${dvi.numero})`);
await expectErr(call(sessions.daf, 'demande.decision', { id: dvi.id, decision: 'refusee' }), 'Refus sans motif impossible', /motif/);
await expectErr(call(sessions.daf, 'demande.decision', { id: dvi.id, decision: 'accordee', direction: { prochaine_vidange_km: 45000 } }), 'Prochaine vidange au-delà du kilométrage actuel', /au-delà/);
const dvd = (await call(sessions.daf, 'demande.decision', { id: dvi.id, decision: 'accordee', direction: { cout_pris_en_charge: 35000, prochaine_vidange_km: 50300 } })).demande;
ok(dvd.statut === 'accordee' && !dvd.depense_id && Number(dvd.prochaine_vidange_km) === 50300, 'Vidange accordée par la DAF, sans dépense automatique');
await expectErr(call(sessions.com, 'demande.cancel', { id: dvi.id, motif: 'x' }), 'Demande décidée non annulable', /en attente/);
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
console.log('Suppression définitive (Responsable commercial seul)');
{
  await expectErr(call(sessions.daf, 'purge.preview', { cible: 'ventes_credit' }), 'La DAF ne peut pas supprimer', /Responsable Commercial/);
  const avant = (await call(sessions.dg, 'data.bootstrap')).data;
  const nbCredit = avant.ventes.filter((v) => v.mode === 'credit').length;
  const pv = await call(sessions.com, 'purge.preview', { cible: 'ventes_credit' });
  ok(pv.compte.ventes === nbCredit && pv.compte.remboursements >= 1, `Aperçu : ${pv.compte.ventes} vente(s) à crédit et ${pv.compte.remboursements} remboursement(s) liés`);
  await expectErr(call(sessions.com, 'purge.run', { cible: 'ventes_credit', motif: 'Test' }), 'Confirmation SUPPRIMER exigée', /SUPPRIMER/);
  await expectErr(call(sessions.com, 'purge.run', { cible: 'ventes_credit', confirmation: 'SUPPRIMER' }), 'Motif exigé', /motif/);
  const pr = await call(sessions.com, 'purge.run', { cible: 'ventes_credit', confirmation: 'SUPPRIMER', motif: 'Recette' });
  const apres = (await call(sessions.dg, 'data.bootstrap')).data;
  ok(pr.compte.ventes === nbCredit && !apres.ventes.some((v) => v.mode === 'credit') && !apres.remboursements.length && apres.ventes.some((v) => v.mode === 'comptant'), 'Ventes à crédit et remboursements supprimés, ventes au comptant conservées');
  const imp = apres.imports.find((i) => i.type === 'ventes_comptant');
  if (imp) { const pi = await call(sessions.com, 'purge.run', { cible: 'import', import_id: imp.id, confirmation: 'SUPPRIMER', motif: 'Défaire un import' }); ok(pi.compte.imports === 1, `Un import est défait (${pi.compte.ventes || 0} vente(s) retirée(s))`); }
  const au = (await call(sessions.admin, 'audit.list', {})).rows;
  ok(au.some((r) => r.action === 'SUPPRESSION'), 'La suppression est tracée dans le journal d’audit');
}
for (let i = 0; i < 5; i++) { try { await call(null, 'auth.login', { identifiant: 'dg', password: 'mauvais' }); } catch {} }
await expectErr(call(null, 'auth.login', { identifiant: 'dg', password: 'Nouveau2026' }), 'Verrouillage après 5 échecs', /verrouillé/);

console.log(`\n${pass} contrôles réussis, ${failN} en échec`);
await stop();
process.exit(failN ? 1 : 0);
