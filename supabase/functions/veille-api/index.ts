// ORIBA FOODS — API Veille & Enquêtes.
// Mêmes personnes que l'ERP Gestion commerciale (table erp.utilisateurs : nom, rôle, statut),
// mais un MOT DE PASSE PROPRE à la Veille (table veille.comptes), obligatoirement différent de celui de la Gestion commerciale.
// Les jetons de session portent app = "veille" : un jeton Veille n'ouvre pas la Gestion commerciale, et inversement.
import pg from "npm:pg@8.13.1";
import bcrypt from "npm:bcryptjs@3.0.3";
import { SignJWT, jwtVerify } from "npm:jose@6.2.13";

pg.types.setTypeParser(1700, (v: string) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v: string) => (v === null ? null : parseInt(v, 10)));
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(1184, (v: string) => (v === null ? null : new Date(v).toISOString()));
const pool = new pg.Pool({ connectionString: Deno.env.get("SUPABASE_DB_URL"), max: 3 });
const q = (s: string, p: any[] = []) => pool.query(s, p);

class AppError extends Error { status: number; constructor(m: string, s = 400) { super(m); this.status = s; } }
const fail = (m: string, s = 400): never => { throw new AppError(m, s); };

let key: Uint8Array | null = null;
async function secret() {
  if (key) return key;
  const s = Deno.env.get("ERP_JWT_SECRET") || (await q(`select valeur from erp.config where cle = 'jwt_secret'`)).rows[0]?.valeur;
  if (!s || s.length < 32) fail("Configuration serveur incomplète (clé de session).", 500);
  key = new TextEncoder().encode(s);
  return key;
}
const issue = async (u: any, c: any) => new SignJWT({ tv: c.token_version || 0, app: "veille" }).setProtectedHeader({ alg: "HS256" }).setSubject(u.id).setIssuedAt().setExpirationTime("10h").sign(await secret());

const low = (s: any) => String(s ?? "").trim().toLowerCase();
const clean = (s: any, max = 200) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const up = (s: any, max = 120) => clean(s, max).normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase();
const userName = (u: any) => (u ? [u.prenom, u.nom].filter(Boolean).join(" ") : "Système");
const num = (v: any) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : fail("Valeur numérique invalide."); };

async function audit(user: any, action: string, table: string, id: any, apres: any, ip: string | null, motif: string | null = null) {
  try {
    await q(`insert into erp.audit_log (created_at, user_id, user_nom, action, table_name, objet_id, avant, apres, motif, ip) values (now(), $1, $2, $3, $4, $5, null, $6, $7, $8)`,
      [user?.id || null, userName(user), action, table, id ? String(id) : null, apres ? JSON.stringify(apres) : null, motif, ip]);
  } catch (e) { console.error("audit", e); }
}

// ---------- Mot de passe propre à la Veille ----------
const compte = async (userId: string) => (await q(`select * from veille.comptes where user_id = $1`, [userId])).rows[0] || null;
function checkPassword(p: string) {
  if (p.length < 8 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) fail("Le mot de passe doit contenir au moins 8 caractères, dont une lettre et un chiffre.");
}
async function differentDeGestion(u: any, p: string) {
  if (u?.mot_de_passe_hash && (await bcrypt.compare(p, u.mot_de_passe_hash))) fail("Ce mot de passe est celui de l’ERP Gestion commerciale : choisissez un mot de passe différent pour la Veille.");
}
async function definirMotDePasse(userId: string, p: string, mustChange: boolean) {
  await q(`insert into veille.comptes (user_id, mot_de_passe_hash, must_change_password, echecs, verrou_jusqua, token_version, updated_at) values ($1, $2, $3, 0, null, 1, now())
    on conflict (user_id) do update set mot_de_passe_hash = excluded.mot_de_passe_hash, must_change_password = excluded.must_change_password, echecs = 0, verrou_jusqua = null,
    token_version = veille.comptes.token_version + 1, updated_at = now()`, [userId, await bcrypt.hash(p, 10), mustChange]);
  return compte(userId);
}

async function rolePerms(u: any) {
  const r = (await q(`select nom, permissions, actif from erp.roles where id = $1`, [u.role_id])).rows[0];
  return { role_nom: r?.nom || null, perms: r && r.actif !== false ? r.permissions || {} : {} };
}
const has = (p: any, m: string, a: string) => Array.isArray(p?.[m]) && p[m].includes(a);
const NIVEAUX = ["aucun", "lecture", "saisie", "complet"];
function niveauDefaut(perms: any) {
  if (has(perms, "utilisateurs", "modifier") || has(perms, "ventes", "creer")) return "complet";
  if (has(perms, "veille", "creer")) return "saisie";
  return "lecture";
}
async function acces(u: any) {
  const { role_nom, perms } = await rolePerms(u);
  const row = (await q(`select niveau from veille.acces where user_id = $1`, [u.id])).rows[0];
  const niveau = row?.niveau || niveauDefaut(perms);
  return { role_nom, perms, niveau, defini: !!row };
}
function droits(niveau: string, perms: any) {
  return { lire: niveau !== "aucun", ecrire: niveau === "saisie" || niveau === "complet", supprimer: niveau === "complet", gerer: has(perms, "utilisateurs", "modifier") };
}
async function publicUser(u: any, c: any) {
  const a = await acces(u);
  return { id: u.id, nom: u.nom, prenom: u.prenom, username: u.username, role_nom: a.role_nom, niveau: a.niveau, must_change_password: !!c?.must_change_password, droits: droits(a.niveau, a.perms) };
}

const TYPES = ["PRESENCE", "CALEBASSE", "SONDAGE", "PRIX"];
const SEGS = ["BOUILLON", "MAYONNAISE"];
const CATS = ["Promotion / bonus", "Nouveau produit", "Changement de prix", "Rupture de stock", "Animation / activation", "Affichage / PLV", "Distribution / nouveau grossiste", "Autre"];

const A: Record<string, (c: any) => Promise<any>> = {};

A["auth.login"] = async ({ payload, ip }) => {
  const ident = low(payload.identifiant);
  if (!ident || !payload.password) fail("Saisissez votre identifiant et votre mot de passe.");
  const u = (await q(`select * from erp.utilisateurs where lower(username) = $1 or lower(email) = $1 limit 1`, [ident])).rows[0];
  const generic = "Identifiant ou mot de passe incorrect.";
  if (!u) { await audit(null, "CONNEXION_ECHEC", "utilisateurs", null, { identifiant: ident, app: "veille" }, ip); fail(generic, 401); }
  const c = await compte(u.id);
  if (!c) { await audit(u, "CONNEXION_ECHEC", "utilisateurs", u.id, { motif: "pas de mot de passe Veille", app: "veille" }, ip); fail("Ce compte n’a pas encore de mot de passe pour la Veille. Demandez à l’administrateur de vous en attribuer un.", 401); }
  if (c.verrou_jusqua && new Date(c.verrou_jusqua) > new Date()) {
    const min = Math.ceil((new Date(c.verrou_jusqua).getTime() - Date.now()) / 60000);
    fail(`Compte verrouillé après plusieurs essais. Réessayez dans ${min} min ou demandez une réinitialisation à l’administrateur.`, 423);
  }
  if (u.statut !== "actif") fail("Ce compte est suspendu ou désactivé. Contactez l’administrateur ERP.", 403);
  if (!(await bcrypt.compare(String(payload.password), c.mot_de_passe_hash || ""))) {
    const echecs = (c.echecs || 0) + 1;
    if (echecs >= 5) await q(`update veille.comptes set echecs = 0, verrou_jusqua = now() + interval '15 minutes' where user_id = $1`, [u.id]);
    else await q(`update veille.comptes set echecs = $2 where user_id = $1`, [u.id, echecs]);
    await audit(u, "CONNEXION_ECHEC", "utilisateurs", u.id, { echecs, app: "veille" }, ip);
    fail(echecs >= 5 ? "Trop d’essais : compte verrouillé 15 minutes." : generic, 401);
  }
  if ((await acces(u)).niveau === "aucun") fail("Votre compte n’a pas accès au module Veille & Enquêtes. Contactez l’administrateur.", 403);
  const c2 = (await q(`update veille.comptes set echecs = 0, verrou_jusqua = null where user_id = $1 returning *`, [u.id])).rows[0];
  const u2 = (await q(`update erp.utilisateurs set last_login = now() where id = $1 returning *`, [u.id])).rows[0];
  await audit(u2, "CONNEXION", "utilisateurs", u2.id, { app: "veille" }, ip);
  return { user: await publicUser(u2, c2), token: await issue(u2, c2) };
};

A["auth.me"] = async ({ user, cpt }) => ({ user: await publicUser(user, cpt) });

A["auth.change_password"] = async ({ user, cpt, payload, ip }) => {
  if (!(await bcrypt.compare(String(payload.ancien || ""), cpt.mot_de_passe_hash || ""))) fail("Mot de passe actuel incorrect.");
  const p = String(payload.nouveau || "");
  checkPassword(p);
  if (p === payload.ancien) fail("Choisissez un mot de passe différent de l’actuel.");
  await differentDeGestion(user, p);
  const c = await definirMotDePasse(user.id, p, false);
  await audit(user, "CHANGEMENT_MOT_DE_PASSE", "utilisateurs", user.id, { app: "veille" }, ip);
  return { user: await publicUser(user, c), token: await issue(user, c) };
};

A["data.load"] = async () => {
  const f = (await q(`select id, type, segment, zone, marche, date, agent, echantillon, lignes, observations, source, created_at, created_by_nom from veille.fiches order by date desc, created_at desc`)).rows;
  const a = (await q(`select id, date, marche, marque, categorie, impact, agent, description, created_at, created_by_nom from veille.actions order by date desc, created_at desc`)).rows;
  return { fiches: f, actions: a, serverTime: new Date().toISOString() };
};

function validerFiche(x: any) {
  const type = String(x.type || "").toUpperCase(), segment = String(x.segment || "").toUpperCase();
  if (!TYPES.includes(type)) fail("Type d’étude invalide.");
  if (!SEGS.includes(segment)) fail("Segment invalide.");
  const zone = up(x.zone), marche = up(x.marche), agent = up(x.agent);
  if (!zone || !marche || !agent) fail("Renseignez la zone, le marché et l’agent.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.date || ""))) fail("Date invalide.");
  if (String(x.date) > new Date(Date.now() + 864e5).toISOString().slice(0, 10)) fail("La date ne peut pas être dans le futur.");
  const lignesIn = Array.isArray(x.lignes) ? x.lignes.slice(0, 80) : [];
  let ech: number | null = null, lignes: any[] = [];
  if (type === "PRIX") {
    lignes = lignesIn.map((l: any) => ({ produit: up(l.produit), poids: num(l.poids), qtyCtn: num(l.qtyCtn), prixGros: num(l.prixGros), prixDemiGros: num(l.prixDemiGros), prixDetail: num(l.prixDetail), prixConso: num(l.prixConso) }))
      .filter((l: any) => l.produit && (l.prixGros || l.prixConso));
    if (!lignes.length) fail("Saisissez au moins un prix.");
  } else {
    ech = num(x.echantillon);
    if (!ech || !Number.isInteger(ech)) fail("Indiquez la taille de l’échantillon (nombre entier).");
    lignes = lignesIn.map((l: any) => ({ marque: up(l.marque), format: clean(l.format, 20), score: num(l.score) })).filter((l: any) => l.marque && l.score !== null);
    if (!lignes.length) fail("Saisissez au moins un score de marque.");
    if (lignes.some((l: any) => l.score > (ech as number))) fail("Un score dépasse l’échantillon.");
  }
  return { type, segment, zone, marche, date: String(x.date), agent, echantillon: ech, lignes, observations: clean(x.observations, 2000) };
}

A["fiche.save"] = async ({ user, d, payload, ip }) => {
  if (!d.ecrire) fail("Votre accès au module Veille est en consultation : la saisie n’est pas autorisée.", 403);
  const f = validerFiche(payload.fiche || {});
  const id = "f-" + crypto.randomUUID();
  const row = (await q(`insert into veille.fiches (id, type, segment, zone, marche, date, agent, echantillon, lignes, observations, source, created_by, created_by_nom) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'terrain',$11,$12) returning *`,
    [id, f.type, f.segment, f.zone, f.marche, f.date, f.agent, f.echantillon, JSON.stringify(f.lignes), f.observations, user.id, userName(user)])).rows[0];
  await audit(user, "CREATION", "veille_fiches", id, { type: f.type, segment: f.segment, marche: f.marche, date: f.date }, ip);
  return { fiche: row };
};

const canon = (l: any[]) => JSON.stringify([...l].map((x) => Object.keys(x).sort().reduce((o: any, k) => { if (x[k] !== null && x[k] !== undefined && x[k] !== "") o[k] = x[k]; return o; }, {})).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
async function cleAction(date: string, marque: string, description: string) {
  return (await q(`select md5($1) as h`, [`${date}|${marque.toLowerCase()}|${description.toLowerCase()}`])).rows[0].h;
}

A["import.excel"] = async ({ user, d, payload, ip }) => {
  if (!d.ecrire) fail("Votre accès au module Veille est en consultation : l’import n’est pas autorisé.", 403);
  const fiches = Array.isArray(payload.fiches) ? payload.fiches.slice(0, 300) : [];
  const actions = Array.isArray(payload.actions) ? payload.actions.slice(0, 300) : [];
  const st = { ajoutees: 0, mises_a_jour: 0, inchangees: 0, deja_saisies: 0, actions_ajoutees: 0, actions_existantes: 0, erreurs: [] as any[] };
  for (const x of fiches) {
    let f: any;
    try { f = validerFiche(x); } catch (e: any) { st.erreurs.push({ ref: x.ref || "", erreur: e.message }); continue; }
    const ex = (await q(`select id, source, zone, echantillon, lignes, observations from veille.fiches where type=$1 and segment=$2 and marche=$3 and date=$4 and agent=$5 limit 1`, [f.type, f.segment, f.marche, f.date, f.agent])).rows[0];
    if (ex && ex.source !== "import") { st.deja_saisies++; continue; }
    if (ex) {
      if (canon(ex.lignes) === canon(f.lignes) && ex.zone === f.zone && Number(ex.echantillon || 0) === Number(f.echantillon || 0) && (ex.observations || "") === f.observations) { st.inchangees++; continue; }
      await q(`update veille.fiches set zone=$2, echantillon=$3, lignes=$4, observations=$5 where id=$1`, [ex.id, f.zone, f.echantillon, JSON.stringify(f.lignes), f.observations]);
      st.mises_a_jour++; continue;
    }
    const id = ("imp-" + f.type + "-" + f.segment.slice(0, 4) + "-" + f.marche + "-" + f.date + "-" + f.agent).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) + "-" + crypto.randomUUID().slice(0, 6);
    await q(`insert into veille.fiches (id, type, segment, zone, marche, date, agent, echantillon, lignes, observations, source, created_by, created_by_nom) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'import',$11,$12)`,
      [id, f.type, f.segment, f.zone, f.marche, f.date, f.agent, f.echantillon, JSON.stringify(f.lignes), f.observations, user.id, userName(user) + " (import Excel)"]);
    st.ajoutees++;
  }
  for (const x of actions) {
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.date || ""))) fail("Date invalide.");
      const marque = up(x.marque), description = clean(x.description, 2000);
      if (!marque || !description) fail("Marque et description obligatoires.");
      const cle = await cleAction(x.date, marque, description);
      const r = await q(`insert into veille.actions (date, marche, marque, categorie, impact, agent, description, created_by, created_by_nom, cle) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (cle) do nothing`,
        [x.date, up(x.marche) || null, marque, CATS.includes(x.categorie) ? x.categorie : "Autre", ["Faible", "Moyen", "Fort"].includes(x.impact) ? x.impact : "Moyen", up(x.agent) || null, description, user.id, userName(user) + " (import Excel)", cle]);
      if (r.rowCount) st.actions_ajoutees++; else st.actions_existantes++;
    } catch (e: any) { st.erreurs.push({ ref: x.ref || "", erreur: e.message }); }
  }
  if (st.ajoutees || st.mises_a_jour || st.actions_ajoutees) await audit(user, "IMPORT", "veille_fiches", null, { fichier: clean(payload.fichier, 120), ...st, erreurs: st.erreurs.length }, ip);
  return st;
};

A["fiche.delete"] = async ({ user, d, payload, ip }) => {
  if (!d.supprimer) fail("Suppression réservée au Responsable commercial.", 403);
  const r = (await q(`delete from veille.fiches where id = $1 returning id, type, marche, date`, [String(payload.id || "")])).rows[0];
  if (!r) fail("Fiche introuvable.", 404);
  await audit(user, "SUPPRESSION", "veille_fiches", r.id, r, ip, clean(payload.motif, 300) || null);
  return { ok: true };
};

A["action.save"] = async ({ user, d, payload, ip }) => {
  if (!d.ecrire) fail("Votre accès au module Veille est en consultation.", 403);
  const x = payload.action || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(x.date || ""))) fail("Date invalide.");
  const marque = up(x.marque), description = clean(x.description, 2000);
  if (!marque || !description) fail("La marque et la description sont obligatoires.");
  const categorie = CATS.includes(x.categorie) ? x.categorie : "Autre";
  const impact = ["Faible", "Moyen", "Fort"].includes(x.impact) ? x.impact : "Moyen";
  const cle = await cleAction(x.date, marque, description);
  const row = (await q(`insert into veille.actions (date, marche, marque, categorie, impact, agent, description, created_by, created_by_nom, cle) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (cle) do nothing returning *`,
    [x.date, up(x.marche) || null, marque, categorie, impact, up(x.agent) || null, description, user.id, userName(user), cle])).rows[0];
  if (!row) fail("Cette action est déjà enregistrée.", 409);
  await audit(user, "CREATION", "veille_actions", row.id, { marque, categorie }, ip);
  return { action: row };
};

A["action.delete"] = async ({ user, d, payload, ip }) => {
  if (!d.supprimer) fail("Suppression réservée au Responsable commercial.", 403);
  const r = (await q(`delete from veille.actions where id::text = $1 returning id, marque`, [String(payload.id || "")])).rows[0];
  if (!r) fail("Action introuvable.", 404);
  await audit(user, "SUPPRESSION", "veille_actions", r.id, r, ip);
  return { ok: true };
};

// ---------- Gestion des utilisateurs (Administrateur ERP) ----------
const gerer = (d: any) => { if (!d.gerer) fail("Gestion des utilisateurs réservée à l’Administrateur ERP.", 403); };
async function cible(id: any) {
  const u = (await q(`select * from erp.utilisateurs where id::text = $1`, [String(id || "")])).rows[0];
  if (!u) fail("Utilisateur introuvable.", 404);
  return u;
}

A["users.list"] = async ({ d }) => {
  gerer(d);
  const rows = (await q(`select u.id, u.username, u.prenom, u.nom, u.email, u.telephone, u.statut, u.last_login, r.nom as role_nom, r.permissions, a.niveau,
      c.user_id as a_mdp, c.must_change_password, c.verrou_jusqua
    from erp.utilisateurs u left join erp.roles r on r.id = u.role_id left join veille.acces a on a.user_id = u.id left join veille.comptes c on c.user_id = u.id
    where u.statut <> 'desactive' order by u.nom`)).rows;
  return { users: rows.map((r: any) => ({ id: r.id, username: r.username, prenom: r.prenom, nom: r.nom, email: r.email, telephone: r.telephone, statut: r.statut, last_login: r.last_login,
    must_change_password: !!r.must_change_password, sans_mot_de_passe_veille: !r.a_mdp, verrouille: !!(r.verrou_jusqua && new Date(r.verrou_jusqua) > new Date()), role_nom: r.role_nom,
    niveau: r.niveau || niveauDefaut(r.permissions || {}), defini: !!r.niveau, enqueteur: r.role_nom === "Enquêteur Veille marché" })) };
};

A["users.create"] = async ({ user, d, payload, ip }) => {
  gerer(d);
  const x = payload.user || {};
  const nom = clean(x.nom, 80), prenom = clean(x.prenom, 80) || null, username = clean(x.username, 40), telephone = clean(x.telephone, 30) || null;
  if (!nom) fail("Le nom est obligatoire.");
  if (!/^[\w.\-@]{2,40}$/.test(username)) fail("Identifiant invalide (2 à 40 caractères : lettres, chiffres, point, tiret, sans espace).");
  let email = clean(x.email, 120);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail("Adresse e-mail invalide.");
  if (!email) email = `${low(username)}@veille.oribafoods.local`;
  const niveau = NIVEAUX.includes(x.niveau) && x.niveau !== "aucun" ? x.niveau : "saisie";
  checkPassword(String(x.password || ""));
  const dup = (await q(`select 1 from erp.utilisateurs where lower(username) = $1 or lower(email) = $2`, [low(username), low(email)])).rows[0];
  if (dup) fail("Cet identifiant ou cet e-mail est déjà utilisé.", 409);
  const role = (await q(`select id from erp.roles where nom = 'Enquêteur Veille marché'`)).rows[0];
  if (!role) fail("Rôle « Enquêteur Veille marché » introuvable.", 500);
  // Mot de passe Gestion commerciale : aléatoire et inconnu (l'enquêteur n'utilise que la Veille ; l'administrateur pourra lui en attribuer un dans la Gestion commerciale).
  const u = (await q(`insert into erp.utilisateurs (nom, prenom, username, email, telephone, role_id, perimetre_type, perimetre_ids, statut, mot_de_passe_hash, must_change_password, created_by, created_at)
    values ($1,$2,$3,$4,$5,$6,'global','[]'::jsonb,'actif',$7,true,$8,now()) returning id, username`, [nom, prenom, username, email, telephone, role.id, await bcrypt.hash(crypto.randomUUID() + crypto.randomUUID(), 10), user.id])).rows[0];
  await definirMotDePasse(u.id, String(x.password), true);
  await q(`insert into veille.acces (user_id, niveau, updated_by) values ($1,$2,$3)`, [u.id, niveau, user.id]);
  await audit(user, "CREATION", "utilisateurs", u.id, { username, nom, prenom, role: "Enquêteur Veille marché", niveau_veille: niveau, app: "veille" }, ip);
  return { ok: true };
};

A["users.set_niveau"] = async ({ user, d, payload, ip }) => {
  gerer(d);
  const u = await cible(payload.id);
  const niveau = String(payload.niveau || "");
  if (!NIVEAUX.includes(niveau)) fail("Niveau d’accès invalide.");
  if (u.id === user.id && niveau !== "complet") fail("Vous ne pouvez pas réduire votre propre accès.");
  await q(`insert into veille.acces (user_id, niveau, updated_by, updated_at) values ($1,$2,$3,now()) on conflict (user_id) do update set niveau = excluded.niveau, updated_by = excluded.updated_by, updated_at = now()`, [u.id, niveau, user.id]);
  await audit(user, "MODIFICATION", "veille_acces", u.id, { username: u.username, niveau }, ip);
  return { ok: true };
};

A["users.reset_password"] = async ({ user, d, payload, ip }) => {
  gerer(d);
  const u = await cible(payload.id);
  if (u.id === user.id) fail("Pour votre propre compte, utilisez « Mot de passe » en haut de l’écran.");
  const p = String(payload.password || "");
  checkPassword(p);
  await differentDeGestion(u, p);
  await definirMotDePasse(u.id, p, true);
  await audit(user, "REINITIALISATION_MOT_DE_PASSE", "utilisateurs", u.id, { username: u.username, app: "veille" }, ip);
  return { ok: true };
};

A["users.set_statut"] = async ({ user, d, payload, ip }) => {
  gerer(d);
  const u = await cible(payload.id);
  const statut = payload.statut === "actif" ? "actif" : "suspendu";
  if (u.id === user.id) fail("Vous ne pouvez pas suspendre votre propre compte.");
  await q(`update erp.utilisateurs set statut = $2, token_version = coalesce(token_version,0) + 1, echecs = 0, verrou_jusqua = null, updated_at = now() where id = $1`, [u.id, statut]);
  await q(`update veille.comptes set token_version = token_version + 1, echecs = 0, verrou_jusqua = null where user_id = $1`, [u.id]);
  await audit(user, statut === "actif" ? "REACTIVATION" : "SUSPENSION", "utilisateurs", u.id, { username: u.username, app: "veille" }, ip);
  return { ok: true };
};

const PUBLIC = new Set(["auth.login"]);
const cors = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "86400" };
const json = (body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Requête invalide" }, 400); }
  const action = String(body?.action || ""), payload = body?.payload || {};
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  try {
    const fn = A[action];
    if (!fn) fail("Action inconnue.", 404);
    let user: any = null, cpt: any = null, d: any = { lire: false, ecrire: false, supprimer: false, gerer: false };
    if (!PUBLIC.has(action)) {
      const auth = req.headers.get("authorization") || "";
      if (!auth.startsWith("Bearer ")) fail("Session expirée : reconnectez-vous.", 401);
      let sub = "", tv = 0, app = "";
      try { const { payload: p } = await jwtVerify(auth.slice(7), await secret()); sub = String(p.sub); tv = Number(p.tv || 0); app = String(p.app || ""); } catch { fail("Session expirée : reconnectez-vous.", 401); }
      if (app !== "veille") fail("Session expirée : reconnectez-vous.", 401);
      user = (await q(`select * from erp.utilisateurs where id = $1`, [sub])).rows[0];
      if (!user || user.statut !== "actif") fail("Compte désactivé ou introuvable.", 401);
      cpt = await compte(user.id);
      if (!cpt || (cpt.token_version || 0) !== tv) fail("Session révoquée : reconnectez-vous.", 401);
      if (cpt.must_change_password && !["auth.me", "auth.change_password"].includes(action)) fail("Vous devez changer votre mot de passe avant de continuer.", 428);
      const a = await acces(user);
      d = droits(a.niveau, a.perms);
      if (!d.lire) fail("Votre compte n’a pas accès au module Veille & Enquêtes.", 403);
    }
    const data = await fn({ user, cpt, d, payload, ip });
    return json({ ok: true, data });
  } catch (e: any) {
    if (e instanceof AppError) return json({ ok: false, error: e.message }, e.status);
    console.error(e);
    return json({ ok: false, error: "Erreur serveur inattendue. Réessayez." }, 500);
  }
});
