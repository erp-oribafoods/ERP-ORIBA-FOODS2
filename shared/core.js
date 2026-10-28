// Cœur applicatif : toutes les opérations passent par ici, avec contrôle des droits côté serveur,
// règles de gestion et journal d'audit. Le même code tourne dans la fonction Netlify et dans la démo.
import { MODULES, REFS, WRITABLE, DEFAULT_PARAMS, DEFAULT_ROLES, STOCK_TYPES } from './schema.js';
import {
  buildIndex, creditInfo, encoursClient, plafondClient, niveauPlafond, lots, lineCalc, today, nowISO, moisDe,
  isDate, num, round2, addDays, moisClos, fmtF, fmtQ,
} from './logic.js';

export class AppError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}
const fail = (m, s = 400) => { throw new AppError(m, s); };

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const pick = (o, keys) => { const r = {}; for (const k of keys) if (o && Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k] === '' ? null : o[k]; return r; };
const clean = (s) => (s === undefined || s === null ? null : String(s).trim() || null);
const low = (s) => String(s || '').trim().toLowerCase();

export function userPerms(user, roles) {
  if (!user) return {};
  const role = roles.find((r) => r.id === user.role_id && r.actif !== false);
  return role ? role.permissions || {} : {};
}
export function can(perms, m, a) { return (perms?.[m] || []).includes(a); }

function publicUser(u, roles) {
  const role = roles.find((r) => r.id === u.role_id);
  return {
    id: u.id, nom: u.nom, prenom: u.prenom, username: u.username, email: u.email, telephone: u.telephone,
    role_id: u.role_id, role_nom: role?.nom || null, perimetre_type: u.perimetre_type, perimetre_ids: u.perimetre_ids || [],
    statut: u.statut, must_change_password: u.must_change_password, last_login: u.last_login, created_at: u.created_at,
    permissions: role && role.actif !== false ? role.permissions : {},
  };
}
const userName = (u) => (u ? [u.prenom, u.nom].filter(Boolean).join(' ') : 'Système');
const stripUser = (u) => { if (!u) return u; const { mot_de_passe_hash, echecs, verrou_jusqua, token_version, ...r } = u; return r; };

function checkPassword(p) {
  if (!p || String(p).length < 8) fail('Le mot de passe doit contenir au moins 8 caractères.');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) fail('Le mot de passe doit contenir au moins une lettre et un chiffre.');
}

async function audit(t, user, action, table, id, avant, apres, motif, ip) {
  await t.insert('audit_log', {
    created_at: nowISO(), user_id: user?.id || null, user_nom: userName(user), action, table_name: table,
    objet_id: id ? String(id) : null, avant: avant ?? null, apres: apres ?? null, motif: motif || null, ip: ip || null,
  });
}

async function nextNumero(t, prefix, date) {
  const y = String(date || today()).slice(0, 4);
  const n = await t.nextSeq(`${prefix}-${y}`);
  return `${prefix}-${y}-${String(n).padStart(5, '0')}`;
}

function inScope(user, equipeId, zoneId) {
  const type = user.perimetre_type || 'global';
  const ids = user.perimetre_ids || [];
  if (type === 'global') return true;
  if (type === 'equipe') return !!equipeId && ids.includes(equipeId);
  if (type === 'zone') return !!zoneId && ids.includes(zoneId);
  return true;
}

async function getParams(t) {
  const rows = await t.select('parametres');
  const p = { ...DEFAULT_PARAMS };
  for (const r of rows) p[r.cle] = r.valeur;
  return p;
}

async function one(t, table, id, label) {
  if (!id) fail(`${label} manquant.`);
  const [r] = await t.select(table, { id });
  if (!r) fail(`${label} introuvable.`, 404);
  return r;
}

// Charge les données nécessaires au calcul des créances d'un client
async function creditIndexForClient(t, clientId) {
  const clients = await t.select('clients', { id: clientId }); const produits = await t.select('produits'); const parametres = await t.select('parametres');
  const ventes = await t.select('ventes', { client_id: clientId, mode: 'credit' });
  const ids = ventes.map((v) => v.id);
  const vente_lignes = ids.length ? await t.select('vente_lignes', { vente_id: ids }) : [];
  const remboursements = ids.length ? await t.select('remboursements', { vente_id: ids }) : [];
  return buildIndex({ clients, produits, parametres, ventes, vente_lignes, remboursements });
}

async function creditIndexForVente(t, v) {
  const produits = await t.select('produits'); const parametres = await t.select('parametres');
  const vente_lignes = await t.select('vente_lignes', { vente_id: v.id });
  const remboursements = await t.select('remboursements', { vente_id: v.id });
  return buildIndex({ produits, parametres, ventes: [v], vente_lignes, remboursements });
}

// ---------- Ventes ----------
async function validateVente(t, h, lignes, { historique = false } = {}) {
  if (!isDate(h.date)) fail('Date de vente invalide.');
  if (!['comptant', 'credit'].includes(h.mode)) fail('Mode de vente invalide.');
  if (!h.agent_id && !historique) fail('Choisissez l’agent.');
  if (!h.marche_id && !historique) fail('Choisissez le marché / village.');
  if (h.agent_id) await one(t, 'agents', h.agent_id, 'Agent');
  if (h.marche_id) await one(t, 'marches', h.marche_id, 'Marché');
  if (h.mode === 'credit' && !h.client_id) fail('Le client / débiteur est obligatoire pour une vente à crédit.');
  if (h.client_id) await one(t, 'clients', h.client_id, 'Client');
  if (h.mode === 'credit' && h.echeance && !isDate(h.echeance)) fail('Date d’échéance invalide.');
  if (h.mode === 'credit' && h.echeance && h.echeance < h.date) fail('L’échéance ne peut pas précéder la date de vente.');
  if (!Array.isArray(lignes) || !lignes.filter((l) => !l.annulee).length) fail('Ajoutez au moins une ligne d’article.');
  const produits = await t.select('produits');
  const out = [];
  for (const [i, l] of lignes.entries()) {
    if (l.annulee) { out.push(l); continue; }
    const pr = produits.find((p) => p.id === l.produit_id);
    if (!pr) fail(`Ligne ${i + 1} : produit introuvable.`);
    if (!['carton', 'pack'].includes(l.unite)) fail(`Ligne ${i + 1} : unité invalide.`);
    if (!(num(l.quantite) > 0)) fail(`Ligne ${i + 1} : la quantité doit être positive.`);
    if (l.prix_unitaire === '' || l.prix_unitaire === null || l.prix_unitaire === undefined || num(l.prix_unitaire) < 0) fail(`Ligne ${i + 1} : saisissez le prix unitaire.`);
    const c = lineCalc(pr, l.unite, l.quantite, l.prix_unitaire);
    out.push({ id: l.id, produit_id: l.produit_id, unite: l.unite, quantite: num(l.quantite), prix_unitaire: num(l.prix_unitaire), montant: c.montant, cartons: c.cartons });
  }
  return out;
}

async function plafondCheck(t, clientId, nouveauxCartons, excludeVenteId) {
  const I = await creditIndexForClient(t, clientId);
  const client = I.clients.get(clientId);
  const e = encoursClient(clientId, I, excludeVenteId);
  const plafond = plafondClient(client, I);
  const total = e.cartons + nouveauxCartons;
  const pct = plafond > 0 ? (total / plafond) * 100 : 0;
  const niv = niveauPlafond(pct, I.p.seuils_plafond);
  const res = { client: client.nom, encoursAvant: e.cartons, ajout: nouveauxCartons, total, plafond, pct, marge: plafond - total, ...niv };
  if (total > plafond && I.p.blocage_credit_depassement) {
    fail(`Crédit refusé : le plafond de ${fmtQ(plafond)} cartons de ${client.nom} serait dépassé (${fmtQ(total)} cartons). Le blocage automatique est activé.`, 409);
  }
  return res;
}

async function createVente(t, user, h, lignes, opts = {}) {
  const L = await validateVente(t, h, lignes, opts);
  const p = await getParams(t);
  const head = pick(h, ['date', 'mode', 'agent_id', 'marche_id', 'client_id', 'echeance', 'observation', 'ref_externe']);
  if (head.mode === 'credit' && !head.echeance) head.echeance = addDays(head.date, num(p.delai_paiement_jours) || 30);
  if (head.mode === 'comptant') head.echeance = null;
  let plafond = null;
  if (head.mode === 'credit' && !opts.historique) plafond = await plafondCheck(t, head.client_id, L.reduce((s, l) => s + l.cartons, 0), null);
  const id = uid();
  const v = await t.insert('ventes', {
    id, ...head, numero: await nextNumero(t, head.mode === 'credit' ? 'VR' : 'VC', head.date), statut: 'validee',
    historique: !!opts.historique, source: opts.source || null, lot_id: opts.lot_id || null, import_id: opts.import_id || null,
    created_by: user.id, created_at: nowISO(),
  });
  const rows = [];
  for (const l of L) rows.push(await t.insert('vente_lignes', { id: uid(), vente_id: id, produit_id: l.produit_id, unite: l.unite, quantite: l.quantite, prix_unitaire: l.prix_unitaire, montant: l.montant, cartons: l.cartons, annulee: false, created_at: nowISO() }));
  await audit(t, user, 'CREATION', 'ventes', id, null, { ...v, lignes: rows }, null, opts.ip);
  return { vente: v, lignes: rows, plafond };
}

// ---------- Actions ----------
const A = {};

A['auth.status'] = async ({ t }) => {
  const users = await t.select('utilisateurs');
  return { initialise: users.length > 0 };
};

A['auth.init_admin'] = async ({ t, payload, crypto, ip }) => {
  const users = await t.select('utilisateurs');
  if (users.length) fail('L’application est déjà initialisée.', 403);
  checkPassword(payload.password);
  const roles = await t.select('roles');
  const admin = roles.find((r) => r.nom === 'Administrateur ERP') || roles[0];
  if (!payload.nom || !payload.username || !payload.email) fail('Nom, identifiant et e-mail sont obligatoires.');
  const u = await t.insert('utilisateurs', {
    id: uid(), nom: clean(payload.nom), prenom: clean(payload.prenom), username: clean(payload.username), email: clean(payload.email),
    role_id: admin.id, perimetre_type: 'global', perimetre_ids: [], statut: 'actif',
    mot_de_passe_hash: await crypto.hash(payload.password), must_change_password: false, created_at: nowISO(),
  });
  await audit(t, u, 'INITIALISATION', 'utilisateurs', u.id, null, stripUser(u), 'Création du premier administrateur', ip);
  return { user: publicUser(u, roles), userRow: u };
};

A['auth.login'] = async ({ t, payload, crypto, ip }) => {
  const ident = low(payload.identifiant);
  if (!ident || !payload.password) fail('Saisissez votre identifiant et votre mot de passe.');
  const users = await t.select('utilisateurs');
  const u = users.find((x) => low(x.username) === ident || low(x.email) === ident);
  const generic = 'Identifiant ou mot de passe incorrect.';
  if (!u) { await audit(t, null, 'CONNEXION_ECHEC', 'utilisateurs', null, null, { identifiant: ident }, null, ip); fail(generic, 401); }
  if (u.verrou_jusqua && new Date(u.verrou_jusqua) > new Date()) {
    const min = Math.ceil((new Date(u.verrou_jusqua) - new Date()) / 60000);
    fail(`Compte verrouillé après plusieurs essais. Réessayez dans ${min} min ou demandez une réinitialisation à l’administrateur.`, 423);
  }
  if (u.statut !== 'actif') fail('Ce compte est suspendu ou désactivé. Contactez l’administrateur ERP.', 403);
  const ok = await crypto.verify(payload.password, u.mot_de_passe_hash);
  if (!ok) {
    const echecs = (u.echecs || 0) + 1;
    const patch = echecs >= 5 ? { echecs: 0, verrou_jusqua: new Date(Date.now() + 15 * 60000).toISOString() } : { echecs };
    await t.update('utilisateurs', u.id, patch);
    await audit(t, u, 'CONNEXION_ECHEC', 'utilisateurs', u.id, null, { echecs }, null, ip);
    fail(echecs >= 5 ? 'Trop d’essais : compte verrouillé 15 minutes.' : generic, 401);
  }
  const u2 = await t.update('utilisateurs', u.id, { echecs: 0, verrou_jusqua: null, last_login: nowISO() });
  await audit(t, u, 'CONNEXION', 'utilisateurs', u.id, null, null, null, ip);
  const roles = await t.select('roles');
  return { user: publicUser(u2, roles), userRow: u2 };
};

A['auth.me'] = async ({ t, user }) => ({ user: publicUser(user, await t.select('roles')) });

A['auth.change_password'] = async ({ t, user, payload, crypto, ip }) => {
  const ok = await crypto.verify(payload.ancien || '', user.mot_de_passe_hash);
  if (!ok) fail('Mot de passe actuel incorrect.');
  checkPassword(payload.nouveau);
  if (payload.nouveau === payload.ancien) fail('Choisissez un mot de passe différent de l’actuel.');
  const u = await t.update('utilisateurs', user.id, { mot_de_passe_hash: await crypto.hash(payload.nouveau), must_change_password: false, token_version: (user.token_version || 0) + 1, updated_at: nowISO() });
  await audit(t, user, 'CHANGEMENT_MOT_DE_PASSE', 'utilisateurs', user.id, null, null, null, ip);
  return { user: publicUser(u, await t.select('roles')), userRow: u };
};

A['data.bootstrap'] = async ({ t, user, perms }) => {
  const P = (m, a = 'lire') => can(perms, m, a);
  const names = ['zones', 'equipes', 'agents', 'marches', 'clients', 'produits', 'vehicules', 'categories_depense', 'parametres', 'roles', 'utilisateurs', 'clotures'];
  const D = {};
  for (const n of names) D[n] = await t.select(n);
  D.utilisateurs = D.utilisateurs.map((u) => {
    const r = stripUser(u);
    if (!P('utilisateurs')) { delete r.email; delete r.telephone; }
    return r;
  });
  const agents = new Map(D.agents.map((a) => [a.id, a]));
  const marches = new Map(D.marches.map((m) => [m.id, m]));
  const venteScope = (v) => inScope(user, agents.get(v.agent_id)?.equipe_id || marches.get(v.marche_id)?.equipe_id, marches.get(v.marche_id)?.zone_id || agents.get(v.agent_id)?.zone_id);
  if (P('ventes') || P('creances') || P('remboursements') || P('dashboard') || P('stock')) {
    D.ventes = (await t.select('ventes')).filter(venteScope);
    const ids = new Set(D.ventes.map((v) => v.id));
    D.vente_lignes = (await t.select('vente_lignes')).filter((l) => ids.has(l.vente_id));
    D.remboursements = (await t.select('remboursements')).filter((r) => ids.has(r.vente_id));
    D.relances = (await t.select('relances')).filter((r) => ids.has(r.vente_id));
  } else { D.ventes = []; D.vente_lignes = []; D.remboursements = []; D.relances = []; }
  D.stock_mouvements = P('stock') || P('dashboard') ? await t.select('stock_mouvements') : [];
  if (P('depenses')) {
    const cats = new Map(D.categories_depense.map((c) => [c.id, c]));
    const all = (await t.select('depenses')).filter((d) => inScope(user, d.equipe_id, d.zone_id) || d.created_by === user.id);
    const visibles = P('salaires') ? all : all.filter((d) => !cats.get(d.categorie_id)?.sensible);
    if (!P('salaires')) {
      // Agrégats des dépenses sensibles (sans détail nominatif)
      const agg = new Map();
      for (const d of all) {
        if (!cats.get(d.categorie_id)?.sensible || d.statut !== 'validee') continue;
        const k = `${d.mois}|${d.equipe_id}|${d.categorie_id}`;
        agg.set(k, (agg.get(k) || 0) + num(d.montant));
      }
      D.depenses_agregats = [...agg.entries()].map(([k, m]) => { const [mois, equipe_id, categorie_id] = k.split('|'); return { mois, equipe_id: equipe_id === 'null' ? null : equipe_id, categorie_id, montant: m }; });
    } else D.depenses_agregats = [];
    D.depenses = visibles;
    const ids = new Set(visibles.map((d) => d.id));
    D.depense_repartitions = (await t.select('depense_repartitions')).filter((r) => ids.has(r.depense_id));
    D.depense_validations = (await t.select('depense_validations')).filter((r) => ids.has(r.depense_id));
  } else { D.depenses = []; D.depense_repartitions = []; D.depense_validations = []; D.depenses_agregats = []; }
  D.budgets = P('budgets') || P('depenses') ? await t.select('budgets') : [];
  D.anomalies = P('audit') ? await t.select('anomalies') : (await t.select('anomalies', { created_by: user.id }));
  D.imports = P('import', 'creer') || P('audit') ? await t.select('imports') : [];
  return { data: D, user: publicUser(user, D.roles), serverDate: today() };
};

// Référentiels
A['ref.save'] = async ({ t, user, perms, payload, ip }) => {
  if (!can(perms, 'referentiels', 'modifier')) fail('Droit insuffisant pour modifier les référentiels.', 403);
  const { table } = payload;
  if (!REFS[table]) fail('Référentiel inconnu.');
  const row = pick(payload.row || {}, WRITABLE[table]);
  for (const f of REFS[table].f) {
    if (f.req && (row[f.k] === null || row[f.k] === undefined) && !payload.row?.id) fail(`Le champ « ${f.l} » est obligatoire.`);
    if (f.t === 'number' && row[f.k] !== undefined && row[f.k] !== null) { if (isNaN(Number(row[f.k]))) fail(`« ${f.l} » doit être un nombre.`); row[f.k] = Number(row[f.k]); }
    if (f.t === 'bool' && row[f.k] !== undefined) row[f.k] = !!row[f.k];
    if (f.t === 'date' && row[f.k] && !isDate(row[f.k])) fail(`« ${f.l} » : date invalide.`);
  }
  if (table === 'produits' && row.packs_par_carton !== undefined && !(row.packs_par_carton > 0)) fail('Le nombre de packs par carton doit être positif.');
  const existing = await t.select(table);
  const labelKey = table === 'vehicules' ? 'immatriculation' : table === 'categories_depense' ? 'libelle' : 'nom';
  const id = payload.row?.id;
  if (row.code) {
    const dup = existing.find((r) => r.id !== id && low(r.code) === low(row.code));
    if (dup) fail(`Le code « ${row.code} » est déjà utilisé par « ${dup[labelKey]} ».`);
  }
  if (row[labelKey] && ['zones', 'equipes', 'produits', 'categories_depense', 'vehicules'].includes(table)) {
    const dup = existing.find((r) => r.id !== id && low(r[labelKey]) === low(row[labelKey]));
    if (dup) fail(`« ${row[labelKey]} » existe déjà.`);
  }
  if (id) {
    const avant = existing.find((r) => r.id === id);
    if (!avant) fail('Élément introuvable.', 404);
    const r = await t.update(table, id, { ...row, updated_at: nowISO() });
    await audit(t, user, 'MODIFICATION', table, id, avant, r, payload.motif, ip);
    return { row: r };
  }
  const r = await t.insert(table, { id: uid(), actif: true, ...row, created_at: nowISO() });
  await audit(t, user, 'CREATION', table, r.id, null, r, null, ip);
  return { row: r };
};

A['ref.archive'] = async ({ t, user, perms, payload, ip }) => {
  if (!can(perms, 'referentiels', 'modifier')) fail('Droit insuffisant.', 403);
  if (!REFS[payload.table]) fail('Référentiel inconnu.');
  const avant = await one(t, payload.table, payload.id, 'Élément');
  const r = await t.update(payload.table, payload.id, { actif: !!payload.actif, updated_at: nowISO() });
  await audit(t, user, payload.actif ? 'REACTIVATION' : 'ARCHIVAGE', payload.table, payload.id, avant, r, null, ip);
  return { row: r };
};

A['param.save'] = async ({ t, user, perms, payload, ip }) => {
  if (!can(perms, 'parametres', 'modifier')) fail('Droit insuffisant pour modifier les paramètres.', 403);
  const { cle } = payload;
  if (!(cle in DEFAULT_PARAMS)) fail('Paramètre inconnu.');
  if (!clean(payload.motif)) fail('Indiquez le motif de la modification (historisé).');
  let v = payload.valeur;
  const d = DEFAULT_PARAMS[cle];
  if (typeof d === 'number') { v = Number(v); if (isNaN(v) || v < 0) fail('Valeur numérique positive attendue.'); }
  else if (typeof d === 'boolean') v = !!v;
  else if (Array.isArray(d)) {
    v = (Array.isArray(v) ? v : String(v).split(/[;,\s]+/)).filter((x) => x !== '').map(Number);
    if (v.length !== 3 || v.some((x) => isNaN(x) || x <= 0) || !(v[0] < v[1] && v[1] <= v[2])) fail('Trois seuils croissants attendus, par exemple 75, 90, 100.');
  }
  const [avant] = await t.select('parametres', { cle });
  let r;
  if (avant) r = await t.updateWhere('parametres', { cle }, { valeur: v, updated_at: nowISO(), updated_by: user.id });
  else r = await t.insert('parametres', { cle, valeur: v, updated_at: nowISO(), updated_by: user.id });
  await audit(t, user, 'PARAMETRE', 'parametres', cle, avant ? { valeur: avant.valeur } : null, { valeur: v }, payload.motif, ip);
  return { row: r };
};

// Ventes
A['vente.create'] = async ({ t, user, perms, payload, ip }) => {
  if (!can(perms, 'ventes', 'creer')) fail('Seul le Responsable Commercial & Force de Vente peut saisir des ventes.', 403);
  return createVente(t, user, payload.vente || {}, payload.lignes || [], { ip });
};

A['vente.correct'] = async ({ t, user, perms, payload, ip }) => {
  if (!can(perms, 'ventes', 'modifier')) fail('Droit insuffisant pour corriger une vente.', 403);
  const motif = clean(payload.motif);
  if (!motif) fail('Le motif de correction est obligatoire.');
  const v = await one(t, 'ventes', payload.id, 'Vente');
  if (v.statut !== 'validee') fail('Seule une vente active peut être corrigée.');
  const h = { ...v, ...pick(payload.vente || {}, ['date', 'agent_id', 'marche_id', 'client_id', 'echeance', 'observation']), mode: v.mode };
  const oldL = await t.select('vente_lignes', { vente_id: v.id });
  const L = await validateVente(t, h, payload.lignes || [], { historique: v.historique });
  if (v.mode === 'credit') {
    const total = L.filter((l) => !l.annulee).reduce((s, l) => s + l.montant, 0);
    const rembs = (await t.select('remboursements', { vente_id: v.id })).filter((r) => r.statut === 'valide');
    const paid = rembs.reduce((s, r) => s + num(r.montant), 0);
    if (total + 0.001 < paid) fail(`Le nouveau montant (${fmtF(total)}) serait inférieur aux remboursements déjà encaissés (${fmtF(paid)}).`);
    if (!v.historique) await plafondCheck(t, h.client_id, L.filter((l) => !l.annulee).reduce((s, l) => s + l.cartons, 0), v.id);
  }
  const keepIds = new Set(L.filter((l) => l.id).map((l) => l.id));
  for (const o of oldL) if (!o.annulee && !keepIds.has(o.id)) await t.update('vente_lignes', o.id, { annulee: true });
  for (const l of L) {
    if (l.annulee) continue;
    if (l.id && oldL.some((o) => o.id === l.id)) await t.update('vente_lignes', l.id, { produit_id: l.produit_id, unite: l.unite, quantite: l.quantite, prix_unitaire: l.prix_unitaire, montant: l.montant, cartons: l.cartons });
    else await t.insert('vente_lignes', { id: uid(), vente_id: v.id, produit_id: l.produit_id, unite: l.unite, quantite: l.quantite, prix_unitaire: l.prix_unitaire, montant: l.montant, cartons: l.cartons, annulee: false, created_at: nowISO() });
  }
  const patch = pick(h, ['date', 'agent_id', 'marche_id', 'client_id', 'echeance', 'observation']);
  if (v.mode === 'comptant') patch.echeance = null;
  const v2 = await t.update('ventes', v.id, { ...patch, motif, updated_by: user.id, updated_at: nowISO() });
  const newL = await t.select('vente_lignes', { vente_id: v.id });
  await audit(t, user, 'CORRECTION', 'ventes', v.id, { ...v, lignes: oldL }, { ...v2, lignes: newL }, motif, ip);
  return { vente: v2 };
};

async function cancelVente(t, user, perms, id, motif, ip) {
  if (!can(perms, 'ventes', 'annuler')) fail('Droit insuffisant pour annuler une vente.', 403);
  if (!clean(motif)) fail('Le motif d’annulation est obligatoire.');
  const v = await one(t, 'ventes', id, 'Vente');
  if (v.statut === 'annulee') fail('Cette vente est déjà annulée.');
  const rembs = (await t.select('remboursements', { vente_id: id })).filter((r) => r.statut === 'valide');
  if (rembs.length) fail('Cette vente a des remboursements actifs : annulez-les d’abord.');
  const v2 = await t.update('ventes', id, { statut: 'annulee', motif, updated_by: user.id, updated_at: nowISO() });
  await audit(t, user, 'ANNULATION', 'ventes', id, v, v2, motif, ip);
  return v2;
}

A['vente.cancel'] = async ({ t, user, perms, payload, ip }) => {
  const v = await cancelVente(t, user, perms, payload.id, payload.motif, ip);
  // Vente issue du stock confié : on annule aussi le mouvement de stock
  const mv = (await t.select('stock_mouvements', { vente_id: v.id })).filter((m) => m.statut === 'valide');
  for (const m of mv) {
    const m2 = await t.update('stock_mouvements', m.id, { statut: 'annule', motif: payload.motif, updated_by: user.id, updated_at: nowISO() });
    await audit(t, user, 'ANNULATION', 'stock_mouvements', m.id, m, m2, payload.motif, ip);
  }
  return { vente: v };
};

// Remboursements
A['remb.create'] = async ({ t, user, perms, payload, ip }) => createRemb(t, user, perms, payload, { ip });

async function createRemb(t, user, perms, payload, opts = {}) {
  if (!can(perms, 'remboursements', 'creer')) fail('Seul le Responsable Commercial & Force de Vente peut enregistrer des remboursements.', 403);
  const v = await one(t, 'ventes', payload.vente_id, 'Vente à crédit');
  if (v.mode !== 'credit' || v.statut !== 'validee') fail('Le remboursement doit porter sur une vente à crédit active.');
  if (!isDate(payload.date)) fail('Date de remboursement invalide.');
  if (payload.date < v.date) fail('Le remboursement ne peut pas précéder la date de vente.');
  const montant = round2(payload.montant);
  if (!(montant > 0)) fail('Le montant doit être positif.');
  const I = await creditIndexForVente(t, v);
  const ci = creditInfo(v, I, '9999-12-31');
  const tol = num(I.p.tolerance_solde_fcfa);
  if (montant > ci.soldeBrut + tol + 0.001) fail(`Montant supérieur au solde restant (${fmtF(ci.soldeBrut)}). Les trop-perçus doivent être traités à part.`);
  const r = await t.insert('remboursements', {
    id: uid(), numero: await nextNumero(t, 'RB', payload.date), vente_id: v.id, date: payload.date, montant,
    mode: clean(payload.mode), reference: clean(payload.reference), commentaire: clean(payload.commentaire), statut: 'valide',
    historique: !!opts.historique, import_id: opts.import_id || null, created_by: user.id, created_at: nowISO(),
  });
  await audit(t, user, 'CREATION', 'remboursements', r.id, null, r, null, opts.ip);
  return { remboursement: r, solde: round2(ci.soldeBrut - montant) };
}

A['remb.cancel'] = async ({ t, user, perms, payload, ip }) => {
  if (!can(perms, 'remboursements', 'annuler')) fail('Droit insuffisant pour annuler un remboursement.', 403);
  if (!clean(payload.motif)) fail('Le motif d’annulation est obligatoire.');
  const r = await one(t, 'remboursements', payload.id, 'Remboursement');
  if (r.statut !== 'valide') fail('Ce remboursement est déjà annulé.');
  const r2 = await t.update('remboursements', r.id, { statut: 'annule', motif: payload.motif, updated_by: user.id, updated_at: nowISO() });
  await audit(t, user, 'ANNULATION', 'remboursements', r.id, r, r2, payload.motif, ip);
  return { remboursement: r2 };
};

A['relance.create'] = async ({ t, user, perms, payload, ip }) => {
  if (!can(perms, 'creances', 'creer')) fail('Droit insuffisant pour enregistrer une relance.', 403);
  const v = await one(t, 'ventes', payload.vente_id, 'Vente à crédit');
  if (v.mode !== 'credit') fail('Relance possible uniquement sur une vente à crédit.');
  if (!isDate(payload.date)) fail('Date de relance invalide.');
  if (payload.promesse_date && !isDate(payload.promesse_date)) fail('Date de promesse invalide.');
  if (payload.date_prochaine && !isDate(payload.date_prochaine)) fail('Date de prochaine action invalide.');
  const r = await t.insert('relances', {
    id: uid(), vente_id: v.id, date: payload.date, canal: clean(payload.canal), resultat: clean(payload.resultat),
    prochaine_action: clean(payload.prochaine_action), date_prochaine: payload.date_prochaine || null,
    promesse_date: payload.promesse_date || null, promesse_montant: payload.promesse_montant ? num(payload.promesse_montant) : null,
    created_by: user.id, created_at: nowISO(),
  });
  await audit(t, user, 'CREATION', 'relances', r.id, null, r, null, ip);
  return { relance: r };
};

// Stock confié
async function stockLotIndex(t) {
  const stock_mouvements = await t.select('stock_mouvements'); const parametres = await t.select('parametres');
  return buildIndex({ stock_mouvements, parametres });
}

A['stock.create'] = async ({ t, user, perms, payload, ip }) => createStock(t, user, perms, payload, { ip });

async function createStock(t, user, perms, payload, opts = {}) {
  if (!can(perms, 'stock', 'creer')) fail('Droit insuffisant sur le stock confié.', 403);
  const type = payload.type;
  if (!STOCK_TYPES[type]) fail('Type de mouvement inconnu.');
  if (!isDate(payload.date)) fail('Date invalide.');
  const q = num(payload.quantite);
  if (type === 'inventaire' ? q < 0 : !(q > 0)) fail('Quantité invalide.');
  if (['perte', 'ajustement_plus', 'ajustement_moins', 'retour'].includes(type) && !clean(payload.motif)) fail('Le motif est obligatoire pour ce mouvement.');
  if (type === 'remise') {
    const cl = await one(t, 'clients', payload.client_id, 'Dépositaire');
    if (!cl.depositaire) fail(`${cl.nom} n’est pas déclaré comme gros client dépositaire (voir Référentiels > Clients).`);
    await one(t, 'produits', payload.produit_id, 'Produit');
    const id = uid();
    const m = await t.insert('stock_mouvements', {
      id, lot_id: id, numero: await nextNumero(t, 'SK', payload.date), client_id: cl.id, produit_id: payload.produit_id, date: payload.date,
      type, quantite: q, valeur_unitaire: payload.valeur_unitaire ? num(payload.valeur_unitaire) : null, document: clean(payload.document),
      motif: clean(payload.motif), statut: 'valide', historique: !!opts.historique, import_id: opts.import_id || null, created_by: user.id, created_at: nowISO(),
    });
    await audit(t, user, 'CREATION', 'stock_mouvements', id, null, m, null, opts.ip);
    return { mouvement: m };
  }
  const lot = await one(t, 'stock_mouvements', payload.lot_id, 'Lot');
  if (lot.type !== 'remise' || lot.statut !== 'valide') fail('Lot invalide.');
  if (payload.date < lot.date) fail('Le mouvement ne peut pas précéder la date de remise du lot.');
  const I = await stockLotIndex(t);
  const L = lots(I).find((l) => l.id === lot.id);
  if (['vente', 'retour', 'perte', 'ajustement_moins'].includes(type) && q > L.restant + 0.0001) fail(`Quantité supérieure au stock restant du lot (${fmtQ(L.restant)} cartons).`);
  let venteId = null, vente = null;
  if (type === 'vente') {
    if (!can(perms, 'ventes', 'creer')) fail('La facturation d’une vente imputée nécessite le droit de créer des ventes.', 403);
    const vt = payload.vente || {};
    if (vt.prix_unitaire === undefined || vt.prix_unitaire === '' || vt.prix_unitaire === null) fail('Saisissez le prix unitaire facturé.');
    const res = await createVente(t, user, {
      date: payload.date, mode: vt.mode || 'comptant', agent_id: vt.agent_id, marche_id: vt.marche_id, client_id: lot.client_id,
      echeance: vt.echeance, observation: `Vente imputée sur stock confié — lot ${lot.numero}${payload.document ? ' — ' + payload.document : ''}`,
    }, [{ produit_id: lot.produit_id, unite: 'carton', quantite: q, prix_unitaire: vt.prix_unitaire }], { source: 'stock', lot_id: lot.id, ip: opts.ip });
    venteId = res.vente.id; vente = res;
  }
  const m = await t.insert('stock_mouvements', {
    id: uid(), lot_id: lot.id, numero: await nextNumero(t, 'SK', payload.date), client_id: lot.client_id, produit_id: lot.produit_id, date: payload.date,
    type, quantite: q, valeur_unitaire: payload.valeur_unitaire ? num(payload.valeur_unitaire) : null, document: clean(payload.document),
    motif: clean(payload.motif), vente_id: venteId, statut: 'valide', created_by: user.id, created_at: nowISO(),
  });
  await audit(t, user, 'CREATION', 'stock_mouvements', m.id, null, m, payload.motif, opts.ip);
  return { mouvement: m, vente };
}

A['stock.cancel'] = async ({ t, user, perms, payload, ip }) => {
  if (!can(perms, 'stock', 'annuler')) fail('Droit insuffisant pour annuler un mouvement de stock.', 403);
  if (!clean(payload.motif)) fail('Le motif est obligatoire.');
  const m = await one(t, 'stock_mouvements', payload.id, 'Mouvement');
  if (m.statut !== 'valide') fail('Mouvement déjà annulé.');
  if (m.type === 'remise') {
    const others = (await t.select('stock_mouvements', { lot_id: m.id })).filter((x) => x.id !== m.id && x.statut === 'valide');
    if (others.length) fail('Ce lot a des mouvements actifs : annulez-les d’abord.');
  }
  if (m.vente_id) await cancelVente(t, user, perms, m.vente_id, payload.motif, ip);
  const m2 = await t.update('stock_mouvements', m.id, { statut: 'annule', motif: payload.motif, updated_by: user.id, updated_at: nowISO() });
  await audit(t, user, 'ANNULATION', 'stock_mouvements', m.id, m, m2, payload.motif, ip);
  return { mouvement: m2 };
};

// Dépenses
async function checkClosed(t, perms, mois) {
  const D = { clotures: await t.select('clotures') };
  if (moisClos(D, mois) && !can(perms, 'cloture', 'modifier')) fail(`La période ${mois} est clôturée. Seule la DAF peut y apporter une correction motivée.`, 423);
  return moisClos(D, mois);
}

async function requireComplete(t, d) {
  const cat = await one(t, 'categories_depense', d.categorie_id, 'Catégorie');
  if (d.historique) return cat;
  if (cat.vehicule_obligatoire && !d.vehicule_id) fail(`Le véhicule est obligatoire pour la catégorie « ${cat.libelle} ».`);
  if (cat.description_obligatoire && !clean(d.description)) fail(`La description / motif est obligatoire pour « ${cat.libelle} ».`);
  if (cat.justif_obligatoire && !d.justificatif_cle) {
    if (!d.sans_piece) fail(`Joignez le justificatif (obligatoire pour « ${cat.libelle} ») ou cochez « sans pièce » avec une justification.`);
    if (!clean(d.description)) fail('Une dépense « sans pièce » doit être justifiée dans la description.');
  }
  if (!d.justificatif_cle && !d.reference_piece && !d.sans_piece) fail('Indiquez une référence de pièce, joignez un justificatif ou cochez « sans pièce ».');
  return cat;
}

const DEP_FIELDS = ['date', 'categorie_id', 'description', 'montant', 'equipe_id', 'zone_id', 'vehicule_id', 'beneficiaire', 'mode_paiement', 'reference_piece', 'sans_piece', 'kilometrage', 'litres', 'station', 'partagee'];

A['dep.save'] = async ({ t, user, perms, payload, ip }) => saveDepense(t, user, perms, payload, { ip });

async function saveDepense(t, user, perms, payload, opts = {}) {
  const inp = payload.depense || {};
  const id = inp.id;
  let avant = null;
  if (id) {
    avant = await one(t, 'depenses', id, 'Dépense');
    const own = avant.created_by === user.id;
    if (['validee', 'rejetee', 'annulee'].includes(avant.statut)) fail('Une dépense validée, rejetée ou annulée ne peut plus être modifiée. Annulez-la puis ressaisissez-la.');
    if (!(can(perms, 'depenses', 'modifier') || (own && can(perms, 'depenses', 'creer')))) fail('Droit insuffisant pour modifier cette dépense.', 403);
    if (avant.statut === 'controlee' && !can(perms, 'depenses', 'valider')) fail('Dépense déjà contrôlée : demandez une remise « à compléter ».');
  } else if (!can(perms, 'depenses', 'creer')) fail('Droit insuffisant pour saisir une dépense.', 403);
  const d = { ...(avant || {}), ...pick(inp, DEP_FIELDS) };
  if (!isDate(d.date)) fail('Date de dépense invalide.');
  d.montant = round2(d.montant);
  if (!(d.montant > 0)) fail('Le montant doit être strictement positif.');
  if (!d.categorie_id) fail('Choisissez la catégorie.');
  await one(t, 'categories_depense', d.categorie_id, 'Catégorie');
  if (!d.equipe_id && !d.partagee) fail('Choisissez l’équipe / centre de coût.');
  if (d.equipe_id) await one(t, 'equipes', d.equipe_id, 'Équipe');
  if (d.vehicule_id) await one(t, 'vehicules', d.vehicule_id, 'Véhicule');
  d.sans_piece = !!d.sans_piece; d.partagee = !!d.partagee;
  let mois = moisDe(d.date);
  if (inp.mois && inp.mois !== mois) {
    if (!can(perms, 'cloture', 'modifier') || !clean(payload.motif)) fail('Le mois de rattachement ne peut être corrigé que par la DAF, avec motif.');
    if (!/^\d{4}-\d{2}$/.test(inp.mois)) fail('Mois invalide (AAAA-MM).');
    mois = inp.mois;
  }
  d.mois = mois;
  await checkClosed(t, perms, mois);
  if (avant && avant.mois !== mois) await checkClosed(t, perms, avant.mois);
  if (!inScope(user, d.equipe_id, d.zone_id) && !(d.partagee && !d.equipe_id)) fail('Cette équipe est hors de votre périmètre.', 403);
  let reps = [];
  if (d.partagee) {
    reps = (payload.repartitions || []).filter((r) => r.equipe_id && num(r.montant) > 0).map((r) => ({ equipe_id: r.equipe_id, montant: round2(r.montant) }));
    if (reps.length < 2) fail('Une dépense partagée doit être répartie sur au moins deux équipes.');
    const s = round2(reps.reduce((a, r) => a + r.montant, 0));
    if (Math.abs(s - d.montant) > 0.5) fail(`La répartition (${fmtF(s)}) doit être égale au montant total (${fmtF(d.montant)}).`);
    if (!d.equipe_id) d.equipe_id = reps[0].equipe_id;
  }
  let statut = avant ? avant.statut : 'brouillon';
  if (payload.soumettre) {
    await requireComplete(t, d);
    statut = 'soumise';
  }
  const row = pick(d, DEP_FIELDS);
  row.mois = mois;
  let r;
  if (avant) r = await t.update('depenses', id, { ...row, statut, motif: clean(payload.motif), updated_by: user.id, updated_at: nowISO() });
  else r = await t.insert('depenses', { id: uid(), numero: await nextNumero(t, 'DP', d.date), ...row, statut, historique: !!opts.historique, import_id: opts.import_id || null, created_by: user.id, created_at: nowISO() });
  if (d.partagee || (avant && avant.partagee)) {
    for (const old of await t.select('depense_repartitions', { depense_id: r.id })) if (old.actif !== false) await t.update('depense_repartitions', old.id, { actif: false });
    for (const rp of reps) await t.insert('depense_repartitions', { id: uid(), depense_id: r.id, equipe_id: rp.equipe_id, montant: rp.montant, actif: true, created_by: user.id, created_at: nowISO() });
  }
  if (payload.soumettre) await t.insert('depense_validations', { id: uid(), depense_id: r.id, etape: 'soumission', decision: 'soumise', commentaire: null, user_id: user.id, created_at: nowISO() });
  await audit(t, user, avant ? 'MODIFICATION' : 'CREATION', 'depenses', r.id, avant, { ...r, repartitions: reps }, payload.motif, opts.ip);
  return { depense: r };
}

const MIME_OK = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];

A['dep.upload'] = async ({ t, user, perms, payload, blobs, ip }) => {
  const d = await one(t, 'depenses', payload.depense_id, 'Dépense');
  if (['validee', 'rejetee', 'annulee'].includes(d.statut)) fail('Impossible d’ajouter une pièce à une dépense clôturée dans le circuit.');
  if (!(can(perms, 'depenses', 'modifier') || (d.created_by === user.id && can(perms, 'depenses', 'creer')))) fail('Droit insuffisant.', 403);
  if (!MIME_OK.includes(payload.type)) fail('Format accepté : PDF, JPG, PNG, WEBP.');
  const size = Math.floor(String(payload.base64 || '').length * 0.75);
  if (!size) fail('Fichier vide.');
  if (size > 4 * 1024 * 1024) fail('Fichier trop lourd (4 Mo maximum). Réduisez la photo et réessayez.');
  const key = `${d.id}/${Date.now()}-${String(payload.nom || 'piece').replace(/[^\w.\-]+/g, '_').slice(0, 80)}`;
  await blobs.put(key, payload.base64, { type: payload.type, nom: payload.nom });
  const r = await t.update('depenses', d.id, { justificatif_cle: key, justificatif_nom: payload.nom, updated_by: user.id, updated_at: nowISO() });
  await audit(t, user, 'JUSTIFICATIF', 'depenses', d.id, { justificatif: d.justificatif_nom }, { justificatif: payload.nom }, null, ip);
  return { depense: r };
};

A['dep.file'] = async ({ t, user, perms, payload, blobs }) => {
  if (!can(perms, 'depenses', 'lire')) fail('Droit insuffisant.', 403);
  const d = await one(t, 'depenses', payload.id, 'Dépense');
  const cat = await one(t, 'categories_depense', d.categorie_id, 'Catégorie');
  if (cat.sensible && !can(perms, 'salaires', 'lire')) fail('Pièce réservée aux profils habilités.', 403);
  if (!inScope(user, d.equipe_id, d.zone_id) && d.created_by !== user.id) fail('Hors périmètre.', 403);
  if (!d.justificatif_cle) fail('Aucun justificatif joint.', 404);
  const f = await blobs.get(d.justificatif_cle);
  if (!f) fail('Fichier introuvable.', 404);
  return { nom: d.justificatif_nom, type: f.type, base64: f.base64 };
};

async function decideDepense(t, user, perms, id, decision, commentaire, ip) {
  const d = await one(t, 'depenses', id, 'Dépense');
  const com = clean(commentaire);
  let statut;
  if (decision === 'controler') {
    if (!can(perms, 'depenses', 'controler')) fail('Droit de contrôle manquant.', 403);
    if (d.statut !== 'soumise') fail('Seule une dépense soumise peut être contrôlée.');
    if (!inScope(user, d.equipe_id, d.zone_id)) fail('Hors périmètre.', 403);
    statut = 'controlee';
  } else if (decision === 'valider') {
    if (!can(perms, 'depenses', 'valider')) fail('Droit de validation manquant.', 403);
    if (!['soumise', 'controlee'].includes(d.statut)) fail('Seule une dépense soumise ou contrôlée peut être validée.');
    if (d.created_by === user.id && !d.historique) fail('Séparation des tâches : vous ne pouvez pas valider une dépense que vous avez saisie.', 403);
    await requireComplete(t, d);
    statut = 'validee';
  } else if (decision === 'rejeter' || decision === 'a_completer') {
    if (!(can(perms, 'depenses', 'valider') || (decision === 'a_completer' && can(perms, 'depenses', 'controler')))) fail('Droit insuffisant.', 403);
    if (!['soumise', 'controlee'].includes(d.statut)) fail('Décision impossible à ce stade.');
    if (!com) fail(decision === 'rejeter' ? 'Le motif du rejet est obligatoire.' : 'Précisez ce qui doit être complété.');
    statut = decision === 'rejeter' ? 'rejetee' : 'a_completer';
  } else fail('Décision inconnue.');
  await checkClosed(t, perms, d.mois);
  const r = await t.update('depenses', id, { statut, motif: com, updated_by: user.id, updated_at: nowISO() });
  await t.insert('depense_validations', { id: uid(), depense_id: id, etape: decision === 'controler' ? 'controle' : 'validation', decision: statut, commentaire: com, user_id: user.id, created_at: nowISO() });
  await audit(t, user, 'DECISION_' + decision.toUpperCase(), 'depenses', id, { statut: d.statut }, { statut }, com, ip);
  return r;
}

A['dep.decision'] = async ({ t, user, perms, payload, ip }) => ({ depense: await decideDepense(t, user, perms, payload.id, payload.decision, payload.commentaire, ip) });

A['dep.bulk_validate'] = async ({ t, user, perms, payload, ip }) => {
  const ok = [], ko = [];
  for (const id of payload.ids || []) {
    try { await t.sp(() => decideDepense(t, user, perms, id, 'valider', payload.commentaire, ip)); ok.push(id); }
    catch (e) { if (!(e instanceof AppError)) throw e; ko.push({ id, erreur: e.message }); }
  }
  return { valides: ok, refuses: ko };
};

A['dep.cancel'] = async ({ t, user, perms, payload, ip }) => {
  const d = await one(t, 'depenses', payload.id, 'Dépense');
  const motif = clean(payload.motif);
  if (!motif) fail('Le motif d’annulation est obligatoire.');
  if (d.statut === 'annulee') fail('Dépense déjà annulée.');
  if (['validee', 'controlee', 'rejetee'].includes(d.statut)) {
    if (!can(perms, 'depenses', 'annuler')) fail('Seule la DAF peut annuler (contrepasser) une dépense validée.', 403);
  } else if (!(d.created_by === user.id || can(perms, 'depenses', 'annuler') || can(perms, 'depenses', 'modifier'))) fail('Droit insuffisant.', 403);
  await checkClosed(t, perms, d.mois);
  const r = await t.update('depenses', d.id, { statut: 'annulee', motif, updated_by: user.id, updated_at: nowISO() });
  await t.insert('depense_validations', { id: uid(), depense_id: d.id, etape: 'annulation', decision: 'annulee', commentaire: motif, user_id: user.id, created_at: nowISO() });
  await audit(t, user, 'ANNULATION', 'depenses', d.id, d, r, motif, ip);
  return { depense: r };
};

A['budget.save'] = async ({ t, user, perms, payload, ip }) => {
  if (!can(perms, 'budgets', 'modifier')) fail('Droit insuffisant pour définir les budgets.', 403);
  const b = pick(payload.budget || {}, ['mois', 'equipe_id', 'categorie_id', 'vehicule_id', 'montant', 'commentaire', 'actif']);
  if (!/^\d{4}-\d{2}$/.test(b.mois || '')) fail('Mois invalide (AAAA-MM).');
  b.montant = round2(b.montant);
  if (!(b.montant >= 0)) fail('Montant invalide.');
  const id = payload.budget?.id;
  if (id) {
    const avant = await one(t, 'budgets', id, 'Budget');
    const r = await t.update('budgets', id, { ...b, approuve_par: user.id, date_approbation: nowISO(), updated_at: nowISO() });
    await audit(t, user, 'MODIFICATION', 'budgets', id, avant, r, payload.motif, ip);
    return { budget: r };
  }
  const dup = (await t.select('budgets', { mois: b.mois })).find((x) => x.actif !== false && (x.equipe_id || null) === (b.equipe_id || null) && (x.categorie_id || null) === (b.categorie_id || null) && (x.vehicule_id || null) === (b.vehicule_id || null));
  if (dup) fail('Un budget existe déjà pour ce mois et ce périmètre : modifiez-le.');
  const r = await t.insert('budgets', { id: uid(), ...b, actif: b.actif !== false, approuve_par: user.id, date_approbation: nowISO(), created_at: nowISO() });
  await audit(t, user, 'CREATION', 'budgets', r.id, null, r, null, ip);
  return { budget: r };
};

A['cloture.set'] = async ({ t, user, perms, payload, ip }) => {
  if (!can(perms, 'cloture', 'modifier')) fail('Seule la DAF peut clôturer ou rouvrir une période.', 403);
  if (!/^\d{4}-\d{2}$/.test(payload.mois || '')) fail('Mois invalide.');
  if (!['cloture', 'rouvert'].includes(payload.statut)) fail('Statut invalide.');
  if (payload.statut === 'rouvert' && !clean(payload.commentaire)) fail('Le motif de réouverture est obligatoire.');
  const [avant] = await t.select('clotures', { mois: payload.mois });
  const data = { statut: payload.statut, commentaire: clean(payload.commentaire), user_id: user.id, updated_at: nowISO() };
  const r = avant ? await t.update('clotures', avant.id, data) : await t.insert('clotures', { id: uid(), mois: payload.mois, ...data });
  await audit(t, user, payload.statut === 'cloture' ? 'CLOTURE' : 'REOUVERTURE', 'clotures', payload.mois, avant, r, payload.commentaire, ip);
  return { cloture: r };
};

A['anomalie.create'] = async ({ t, user, perms, payload, ip }) => {
  if (!can(perms, 'audit', 'creer')) fail('Droit insuffisant pour signaler une anomalie.', 403);
  if (!clean(payload.description)) fail('Décrivez l’anomalie.');
  const r = await t.insert('anomalies', { id: uid(), objet_type: clean(payload.objet_type), objet_id: clean(payload.objet_id), description: clean(payload.description), statut: 'ouverte', created_by: user.id, created_at: nowISO() });
  await audit(t, user, 'ANOMALIE', 'anomalies', r.id, null, r, null, ip);
  return { anomalie: r };
};

A['anomalie.update'] = async ({ t, user, perms, payload, ip }) => {
  if (!can(perms, 'audit', 'creer')) fail('Droit insuffisant.', 403);
  const a = await one(t, 'anomalies', payload.id, 'Anomalie');
  const r = await t.update('anomalies', a.id, { statut: payload.statut === 'traitee' ? 'traitee' : 'ouverte', reponse: clean(payload.reponse), traite_par: user.id, traite_at: nowISO() });
  await audit(t, user, 'ANOMALIE_SUIVI', 'anomalies', a.id, a, r, payload.reponse, ip);
  return { anomalie: r };
};

// Utilisateurs & rôles
A['user.save'] = async ({ t, user, perms, payload, crypto, ip }) => {
  if (!can(perms, 'utilisateurs', 'modifier')) fail('Droit insuffisant pour gérer les comptes.', 403);
  const inp = payload.user || {};
  const row = pick(inp, ['nom', 'prenom', 'username', 'email', 'telephone', 'role_id', 'perimetre_type', 'perimetre_ids', 'statut']);
  for (const k of ['nom', 'prenom', 'username', 'email', 'telephone']) if (k in row) row[k] = clean(row[k]);
  if (!inp.id || 'username' in row) { if (!row.username || !/^[\w.\-@]{2,40}$/.test(row.username)) fail('Identifiant invalide (2 à 40 caractères : lettres, chiffres, point, tiret).'); }
  if (!inp.id || 'email' in row) { if (!row.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) fail('Adresse e-mail invalide.'); }
  if (!inp.id && !row.nom) fail('Le nom est obligatoire.');
  if (row.role_id) await one(t, 'roles', row.role_id, 'Rôle');
  if (row.perimetre_type && !['global', 'zone', 'equipe'].includes(row.perimetre_type)) fail('Périmètre invalide.');
  if (row.perimetre_type && row.perimetre_type !== 'global' && !(row.perimetre_ids || []).length) fail('Sélectionnez au moins une zone ou une équipe pour ce périmètre.');
  if (row.statut && !['actif', 'suspendu', 'desactive'].includes(row.statut)) fail('Statut invalide.');
  const users = await t.select('utilisateurs');
  if (row.username && users.some((u) => u.id !== inp.id && low(u.username) === low(row.username))) fail('Cet identifiant est déjà utilisé.');
  if (row.email && users.some((u) => u.id !== inp.id && low(u.email) === low(row.email))) fail('Cette adresse e-mail est déjà utilisée.');
  if (inp.id) {
    const avant = users.find((u) => u.id === inp.id);
    if (!avant) fail('Compte introuvable.', 404);
    if (avant.id === user.id && row.statut && row.statut !== 'actif') fail('Vous ne pouvez pas désactiver votre propre compte.');
    const patch = { ...row, updated_at: nowISO() };
    if ((row.statut && row.statut !== avant.statut && row.statut !== 'actif') || (row.role_id && row.role_id !== avant.role_id)) patch.token_version = (avant.token_version || 0) + 1;
    const r = await t.update('utilisateurs', inp.id, patch);
    await audit(t, user, 'MODIFICATION', 'utilisateurs', inp.id, stripUser(avant), stripUser(r), payload.motif, ip);
    return { user: stripUser(r) };
  }
  checkPassword(payload.password);
  const r = await t.insert('utilisateurs', {
    id: uid(), ...row, perimetre_type: row.perimetre_type || 'global', perimetre_ids: row.perimetre_ids || [], statut: row.statut || 'actif',
    mot_de_passe_hash: await crypto.hash(payload.password), must_change_password: true, created_by: user.id, created_at: nowISO(),
  });
  await audit(t, user, 'CREATION', 'utilisateurs', r.id, null, stripUser(r), null, ip);
  return { user: stripUser(r) };
};

A['user.reset_password'] = async ({ t, user, perms, payload, crypto, ip }) => {
  if (!can(perms, 'utilisateurs', 'modifier')) fail('Droit insuffisant.', 403);
  const u = await one(t, 'utilisateurs', payload.id, 'Compte');
  checkPassword(payload.password);
  await t.update('utilisateurs', u.id, { mot_de_passe_hash: await crypto.hash(payload.password), must_change_password: true, echecs: 0, verrou_jusqua: null, token_version: (u.token_version || 0) + 1, updated_at: nowISO() });
  await audit(t, user, 'REINITIALISATION_MOT_DE_PASSE', 'utilisateurs', u.id, null, null, null, ip);
  return { ok: true };
};

A['role.save'] = async ({ t, user, perms, payload, ip }) => {
  if (!can(perms, 'utilisateurs', 'modifier')) fail('Droit insuffisant.', 403);
  const inp = payload.role || {};
  const nom = clean(inp.nom);
  if (!nom) fail('Le nom du rôle est obligatoire.');
  const permissions = {};
  for (const m of MODULES) {
    const a = (inp.permissions?.[m.k] || []).filter((x) => m.a.includes(x));
    if (a.length) permissions[m.k] = a;
  }
  const roles = await t.select('roles');
  if (roles.some((r) => r.id !== inp.id && low(r.nom) === low(nom))) fail('Un rôle porte déjà ce nom.');
  if (inp.id) {
    const avant = roles.find((r) => r.id === inp.id);
    if (!avant) fail('Rôle introuvable.', 404);
    if (avant.nom === 'Administrateur ERP' && !can(permissions, 'utilisateurs', 'modifier')) fail('Le rôle Administrateur ERP doit garder la gestion des utilisateurs.');
    const r = await t.update('roles', inp.id, { nom, description: clean(inp.description), permissions, actif: inp.actif !== false, updated_at: nowISO() });
    // Révocation des sessions des comptes concernés
    for (const u of await t.select('utilisateurs', { role_id: inp.id })) await t.update('utilisateurs', u.id, { token_version: (u.token_version || 0) + 1 });
    await audit(t, user, 'MODIFICATION', 'roles', inp.id, avant, r, payload.motif, ip);
    return { role: r };
  }
  const r = await t.insert('roles', { id: uid(), nom, description: clean(inp.description), permissions, systeme: false, actif: true, created_at: nowISO() });
  await audit(t, user, 'CREATION', 'roles', r.id, null, r, null, ip);
  return { role: r };
};

// Reprise de données historiques
A['import.run'] = async ({ t, user, perms, payload, ip }) => {
  if (!can(perms, 'import', 'creer')) fail('Droit insuffisant pour la reprise de données.', 403);
  const type = payload.type;
  const rows = payload.rows || [];
  if (rows.length > 2000) fail('Maximum 2 000 lignes par import : découpez le fichier.');
  const importId = uid();
  const ok = [], ko = [];
  const opts = { historique: true, import_id: importId, ip };
  for (const [i, r] of rows.entries()) {
    try {
      await t.sp(async () => {
      if (REFS[type]) {
        if (!can(perms, 'referentiels', 'modifier')) fail('Droit référentiels manquant.', 403);
        await A['ref.save']({ t, user, perms, payload: { table: type, row: r.data }, ip });
      } else if (type === 'ventes_comptant' || type === 'ventes_credit') {
        if (!can(perms, 'ventes', 'creer')) fail('Droit ventes manquant.', 403);
        await createVente(t, user, { ...r.data, mode: type === 'ventes_credit' ? 'credit' : 'comptant' }, r.lignes, opts);
      } else if (type === 'remboursements') {
        await createRemb(t, user, perms, r.data, opts);
      } else if (type === 'depenses_agregees') {
        if (!can(perms, 'depenses', 'creer')) fail('Droit dépenses manquant.', 403);
        const dd = r.data;
        await saveDepense(t, user, perms, { depense: { ...dd, date: `${dd.mois}-01`, reference_piece: 'Reprise historique (agrégé)', description: dd.description || `Total historique ${dd.mois}` }, soumettre: false }, opts)
          .then(async (res) => { await t.update('depenses', res.depense.id, { statut: 'soumise', historique: true }); });
      } else if (type === 'stock_remises') {
        await createStock(t, user, perms, { ...r.data, type: 'remise' }, opts);
      } else fail('Type d’import inconnu.');
      });
      ok.push(r.ligne ?? i + 1);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      ko.push({ ligne: r.ligne ?? i + 1, erreur: e.message });
    }
  }
  const stats = { recues: rows.length, integrees: ok.length, rejetees_serveur: ko.length, ...(payload.stats || {}) };
  const imp = await t.insert('imports', { id: importId, type, fichier: clean(payload.fichier), stats, rapport: { refusesServeur: ko, controleClient: payload.rapport || null }, created_by: user.id, created_at: nowISO() });
  await audit(t, user, 'IMPORT', 'imports', importId, null, { type, stats }, null, ip);
  return { import: imp, integrees: ok, refuses: ko };
};

A['audit.list'] = async ({ t, perms, payload }) => {
  if (!can(perms, 'audit', 'lire')) fail('Accès au journal d’audit réservé.', 403);
  const rows = await t.auditList({ du: payload.du, au: payload.au, table: payload.table, user_id: payload.user_id, limit: Math.min(num(payload.limit) || 500, 2000) });
  return { rows };
};

// Point d'entrée
const PUBLIC = new Set(['auth.status', 'auth.init_admin', 'auth.login']);
const READ_ONLY = new Set(['auth.status', 'auth.me', 'data.bootstrap', 'dep.file', 'audit.list']);

export async function handle(db, action, payload, ctx = {}) {
  const fn = A[action];
  if (!fn) fail('Action inconnue.', 404);
  const run = async (t) => {
    let user = null, perms = {};
    if (!PUBLIC.has(action)) {
      if (!ctx.userId) fail('Session expirée : reconnectez-vous.', 401);
      const [u] = await t.select('utilisateurs', { id: ctx.userId });
      if (!u || u.statut !== 'actif') fail('Compte désactivé ou introuvable.', 401);
      if (ctx.tokenVersion !== undefined && (u.token_version || 0) !== ctx.tokenVersion) fail('Session révoquée : reconnectez-vous.', 401);
      user = u;
      perms = userPerms(u, await t.select('roles'));
      if (u.must_change_password && !['auth.me', 'auth.change_password'].includes(action)) fail('Vous devez changer votre mot de passe avant de continuer.', 428);
    }
    return fn({ t, user, perms, payload: payload || {}, crypto: ctx.crypto, blobs: ctx.blobs, ip: ctx.ip });
  };
  return READ_ONLY.has(action) || action === 'auth.login' ? run(db) : db.tx(run);
}

export { DEFAULT_ROLES };
