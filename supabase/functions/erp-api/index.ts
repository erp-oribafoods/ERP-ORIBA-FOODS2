// ORIBA FOODS — API de l'ERP sur Supabase Edge Functions.
// Le cœur applicatif (droits, règles de gestion, audit) est le même code que la version Netlify.
import pg from "npm:pg@8.13.1";
import bcrypt from "npm:bcryptjs@3.0.3";
import { SignJWT, jwtVerify } from "npm:jose@6.2.13";
import { handle, AppError } from "https://raw.githubusercontent.com/ibro50/ERP-ORIBA-FOODS2/be7ba52c6d8efc329005a7c0dd68811d32ee0d99/shared/core.js";

const SCHEMA = "erp";
pg.types.setTypeParser(1700, (v: string) => (v === null ? null : parseFloat(v)));
pg.types.setTypeParser(20, (v: string) => (v === null ? null : parseInt(v, 10)));
pg.types.setTypeParser(1082, (v: string) => v);
pg.types.setTypeParser(1184, (v: string) => (v === null ? null : new Date(v).toISOString()));

const pool = new pg.Pool({ connectionString: Deno.env.get("SUPABASE_DB_URL"), max: 3 });
const IDENT = /^[a-z_][a-z0-9_]*$/;
const col = (s: string) => { if (!IDENT.test(s)) throw new Error("Identifiant invalide"); return `"${s}"`; };
const tbl = (s: string) => `${SCHEMA}.${col(s)}`;
const val = (v: any) => (v !== null && typeof v === "object" && !(v instanceof Date) ? JSON.stringify(v) : v);

function where(w: Record<string, any>, params: any[]) {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(w || {})) {
    if (Array.isArray(v)) { if (!v.length) { parts.push("false"); continue; } params.push(v); parts.push(`${col(k)} = any($${params.length})`); }
    else if (v === null) parts.push(`${col(k)} is null`);
    else { params.push(v); parts.push(`${col(k)} = $${params.length}`); }
  }
  return parts.length ? " where " + parts.join(" and ") : "";
}

function ops(q: (s: string, p?: any[]) => Promise<any>) {
  const o: any = {
    async select(table: string, w = {}) { const p: any[] = []; return (await q(`select * from ${tbl(table)}${where(w, p)}${table === "audit_log" ? " order by id desc" : ""}`, p)).rows; },
    async insert(table: string, row: any) {
      const keys = Object.keys(row).filter((k) => row[k] !== undefined);
      const r = await q(`insert into ${tbl(table)} (${keys.map(col).join(",")}) values (${keys.map((_, i) => "$" + (i + 1)).join(",")}) returning *`, keys.map((k) => val(row[k])));
      return r.rows[0];
    },
    async update(table: string, id: string, patch: any) { return o.updateWhere(table, { id }, patch); },
    async updateWhere(table: string, w: any, patch: any) {
      const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
      const p = keys.map((k) => val(patch[k]));
      const r = await q(`update ${tbl(table)} set ${keys.map((k, i) => `${col(k)} = $${i + 1}`).join(", ")}${where(w, p)} returning *`, p);
      return r.rows[0];
    },
    async nextSeq(cle: string) {
      const r = await q(`insert into ${SCHEMA}.compteurs (cle, valeur) values ($1, 1) on conflict (cle) do update set valeur = ${SCHEMA}.compteurs.valeur + 1 returning valeur`, [cle]);
      return Number(r.rows[0].valeur);
    },
    async auditList({ du, au, table, user_id, limit }: any) {
      const p: any[] = []; const parts: string[] = [];
      if (du) { p.push(du); parts.push(`created_at >= $${p.length}::date`); }
      if (au) { p.push(au); parts.push(`created_at < ($${p.length}::date + 1)`); }
      if (table) { p.push(table); parts.push(`table_name = $${p.length}`); }
      if (user_id) { p.push(user_id); parts.push(`user_id = $${p.length}`); }
      p.push(limit || 500);
      return (await q(`select * from ${SCHEMA}.audit_log${parts.length ? " where " + parts.join(" and ") : ""} order by id desc limit $${p.length}`, p)).rows;
    },
  };
  return o;
}

const db: any = ops((s, p) => pool.query(s, p));
db.sp = (fn: any) => fn();
db.tx = async (fn: any) => {
  const c = await pool.connect();
  let n = 0;
  try {
    await c.query("begin");
    const t: any = ops((s, p) => c.query(s, p));
    t.sp = async (f: any) => {
      const name = "sp" + ++n;
      await c.query("savepoint " + name);
      try { const r = await f(); await c.query("release savepoint " + name); return r; }
      catch (e) { await c.query("rollback to savepoint " + name); throw e; }
    };
    const r = await fn(t);
    await c.query("commit");
    return r;
  } catch (e) { try { await c.query("rollback"); } catch { /* ignoré */ } throw e; }
  finally { c.release(); }
};

let secretKey: Uint8Array | null = null;
async function secret() {
  if (secretKey) return secretKey;
  const s = Deno.env.get("ERP_JWT_SECRET") || (await pool.query(`select valeur from ${SCHEMA}.config where cle = 'jwt_secret'`)).rows[0]?.valeur;
  if (!s || s.length < 32) throw new AppError("Configuration serveur incomplète (clé de session).", 500);
  secretKey = new TextEncoder().encode(s);
  return secretKey;
}
const issue = async (u: any) => new SignJWT({ tv: u.token_version || 0 }).setProtectedHeader({ alg: "HS256" }).setSubject(u.id).setIssuedAt().setExpirationTime("10h").sign(await secret());
const cryptoImpl = { hash: (p: string) => bcrypt.hash(p, 10), verify: (p: string, h: string) => bcrypt.compare(p, h || "") };
const blobs = {
  async put(key: string, base64: string, meta: any) { await pool.query(`insert into ${SCHEMA}.fichiers (cle, type, nom, base64) values ($1, $2, $3, $4) on conflict (cle) do update set base64 = excluded.base64`, [key, meta.type, meta.nom, base64]); },
  async get(key: string) { const r = await pool.query(`select type, nom, base64 from ${SCHEMA}.fichiers where cle = $1`, [key]); return r.rows[0] || null; },
};

const ORIGINS = ["https://ibro50.github.io", "https://oriba-erp-gestion.netlify.app", "http://localhost:8888"];
function cors(req: Request) {
  const o = req.headers.get("origin") || "";
  return { "access-control-allow-origin": ORIGINS.includes(o) ? o : ORIGINS[0], "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type, authorization", "access-control-max-age": "86400", vary: "origin" };
}
const json = (req: Request, body: any, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors(req) } });

function mapError(e: any) {
  if (e instanceof AppError || e?.status) return { status: e.status || 400, message: e.message };
  if (e?.code === "P0001") return { status: 400, message: e.message };
  if (e?.code === "23505") return { status: 409, message: "Doublon : cet enregistrement existe déjà." };
  if (e?.code === "23503") return { status: 400, message: "Référence invalide (élément lié introuvable)." };
  if (e?.code === "23514") return { status: 400, message: "Valeur non autorisée par les règles de la base." };
  console.error(e);
  return { status: 500, message: "Erreur serveur inattendue. Réessayez ; si le problème persiste, contactez l’administrateur." };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "Méthode non autorisée" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json(req, { ok: false, error: "Requête invalide" }, 400); }
  try {
    let userId: string | undefined, tokenVersion: number | undefined;
    const auth = req.headers.get("authorization") || "";
    if (auth.startsWith("Bearer ")) {
      try { const { payload } = await jwtVerify(auth.slice(7), await secret()); userId = payload.sub as string; tokenVersion = Number(payload.tv || 0); } catch { /* non connecté */ }
    }
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
    const result: any = await handle(db, String(body?.action || ""), body.payload || {}, { userId, tokenVersion, crypto: cryptoImpl, blobs, ip });
    if (result?.userRow) { result.token = await issue(result.userRow); delete result.userRow; }
    return json(req, { ok: true, data: result });
  } catch (e) { const m = mapError(e); return json(req, { ok: false, error: m.message }, m.status); }
});
