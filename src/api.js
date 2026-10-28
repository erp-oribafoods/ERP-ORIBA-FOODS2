// Client API : serveur Netlify (production) ou base locale (démonstration).
import bcrypt from 'bcryptjs';
import { handle } from '../shared/core.js';
import { memoryAdapter } from '../shared/memory-adapter.js';
import { seedReference, seedDemo } from './demo-seed.js';

const ss = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* ignoré */ } },
};

export class ApiError extends Error { constructor(m, status) { super(m); this.status = status; } }

export function serverApi() {
  let token = ss.get('erp_token');
  return {
    demo: false,
    hasSession: () => !!token,
    logout() { token = null; ss.set('erp_token', null); },
    async call(action, payload = {}) {
      let res;
      try {
        res = await fetch(window.ERP_API_URL || '/api', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ action, payload }) });
      } catch { throw new ApiError('Connexion au serveur impossible. Vérifiez votre accès internet puis réessayez.', 0); }
      let j;
      try { j = await res.json(); } catch { throw new ApiError(`Réponse inattendue du serveur (${res.status}).`, res.status); }
      if (!j.ok) throw new ApiError(j.error || 'Erreur', res.status);
      if (j.data?.token) { token = j.data.token; ss.set('erp_token', token); }
      return j.data;
    },
  };
}

const LS_KEY = 'oriba_erp_demo_v4';
function lsGet() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; } }
function lsSet(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); return true; } catch { return false; } }

export async function demoApi(onProgress = () => {}) {
  const crypto = { hash: (p) => bcrypt.hash(p, 4), verify: (p, h) => bcrypt.compare(p, h || '') };
  let state = lsGet();
  let saveTimer = null;
  const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => lsSet(state), 400); };
  let db;
  if (!state || !state.utilisateurs?.length) {
    onProgress('Préparation des données de démonstration…');
    state = seedReference();
    db = memoryAdapter(state, () => {});
    await seedDemo(db, crypto, state);
    lsSet(state);
  }
  db = memoryAdapter(state, persist);
  let session = JSON.parse(ss.get('erp_demo_session') || 'null');
  const blobs = {
    put: async (k, b64, meta) => { if (b64.length > 1.5e6) throw new ApiError('En démonstration, les pièces sont limitées à 1 Mo.', 400); state.__blobs[k] = { ...meta, base64: b64 }; persist(); },
    get: async (k) => state.__blobs?.[k] || null,
  };
  return {
    demo: true,
    hasSession: () => !!session,
    logout() { session = null; ss.set('erp_demo_session', null); },
    reset() { try { localStorage.removeItem(LS_KEY); } catch { /* ignoré */ } ss.set('erp_demo_session', null); },
    async call(action, payload = {}) {
      try {
        const r = await handle(db, action, payload, { userId: session?.id, tokenVersion: session?.tv, crypto, blobs, ip: 'démo' });
        if (r?.userRow) { session = { id: r.userRow.id, tv: r.userRow.token_version || 0 }; ss.set('erp_demo_session', JSON.stringify(session)); delete r.userRow; }
        return r;
      } catch (e) {
        if (e.status) throw new ApiError(e.message, e.status);
        console.error(e);
        throw new ApiError('Erreur inattendue : ' + e.message, 500);
      }
    },
  };
}
