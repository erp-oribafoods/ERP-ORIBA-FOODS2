// API unique de l'ERP : authentification, droits et règles de gestion appliqués côté serveur.
import type { Config, Context } from "@netlify/functions";
import { getConnectionString } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import pg from "pg";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { handle, AppError } from "../../shared/core.js";
import { pgAdapter } from "../../server/pg-adapter.mjs";

let pool: pg.Pool | null = null;
function db() {
  if (!pool) pool = new pg.Pool({ connectionString: getConnectionString(), max: 4 });
  return pgAdapter(pool);
}

function secret() {
  const s = Netlify.env.get("JWT_SECRET");
  if (!s || s.length < 32) throw new AppError("Configuration serveur incomplète (JWT_SECRET manquant).", 500);
  return new TextEncoder().encode(s);
}

async function issue(u: any) {
  return new SignJWT({ tv: u.token_version || 0 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(u.id)
    .setIssuedAt()
    .setExpirationTime("10h")
    .sign(secret());
}

const cryptoImpl = {
  hash: (p: string) => bcrypt.hash(p, 10),
  verify: (p: string, h: string) => bcrypt.compare(p, h || ""),
};

const blobsImpl = {
  async put(key: string, base64: string, meta: any) {
    await getStore({ name: "justificatifs", consistency: "strong" }).setJSON(key, { ...meta, base64 });
  },
  async get(key: string) {
    return getStore({ name: "justificatifs", consistency: "strong" }).get(key, { type: "json" });
  },
};

function mapError(e: any) {
  if (e instanceof AppError) return { status: e.status, message: e.message };
  if (e?.code === "P0001") return { status: 400, message: e.message };
  if (e?.code === "23505") return { status: 409, message: "Doublon : cet enregistrement existe déjà." };
  if (e?.code === "23503") return { status: 400, message: "Référence invalide (élément lié introuvable)." };
  if (e?.code === "23514") return { status: 400, message: "Valeur non autorisée par les règles de la base." };
  console.error(e);
  return { status: 500, message: "Erreur serveur inattendue. Réessayez ; si le problème persiste, contactez l’administrateur." };
}

const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return json({ ok: false, error: "Méthode non autorisée" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: "Requête invalide" }, 400); }
  const action = String(body?.action || "");
  try {
    let userId: string | undefined, tokenVersion: number | undefined;
    const auth = req.headers.get("authorization") || "";
    if (auth.startsWith("Bearer ")) {
      try {
        const { payload } = await jwtVerify(auth.slice(7), secret());
        userId = payload.sub as string;
        tokenVersion = Number(payload.tv || 0);
      } catch { /* jeton invalide ou expiré : traité comme non connecté */ }
    }
    const result: any = await handle(db(), action, body.payload || {}, {
      userId, tokenVersion, crypto: cryptoImpl, blobs: blobsImpl, ip: context.ip,
    });
    if (result?.userRow) {
      result.token = await issue(result.userRow);
      delete result.userRow;
    }
    return json({ ok: true, data: result });
  } catch (e: any) {
    const m = mapError(e);
    return json({ ok: false, error: m.message }, m.status);
  }
};

export const config: Config = { path: "/api" };
