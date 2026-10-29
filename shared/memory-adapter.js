// Base en mémoire (démo navigateur et tests) — même interface que l'adaptateur PostgreSQL.
// Les transactions utilisent un journal d'annulation (pas de copie complète de la base).
import { AppError } from './core.js';

const clone = (x) => (x === null || typeof x !== 'object' ? x : typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)));

function match(r, w) {
  for (const [k, v] of Object.entries(w || {})) {
    if (Array.isArray(v)) { if (!v.includes(r[k])) return false; }
    else if (v === null) { if (r[k] !== null && r[k] !== undefined) return false; }
    else if (r[k] !== v) return false;
  }
  return true;
}

export function memoryAdapter(state, onChange = () => {}) {
  let auditSeq = (state.audit_log || []).reduce((m, r) => Math.max(m, r.id || 0), 0);
  const T = (n) => (state[n] = state[n] || []);
  const undo = [];
  const o = {
    async select(table, w = {}) { return T(table).filter((r) => match(r, w)).map(clone); },
    async insert(table, row) {
      const r = clone(row);
      if (table === 'audit_log') r.id = ++auditSeq;
      if (table === 'utilisateurs' && T(table).some((u) => u.username.toLowerCase() === r.username.toLowerCase() || u.email.toLowerCase() === r.email.toLowerCase())) throw new AppError('Doublon : identifiant ou e-mail déjà utilisé.', 409);
      if (r.numero && T(table).some((x) => x.numero === r.numero)) throw new AppError('Numéro déjà utilisé.', 409);
      for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
      if (!('created_at' in r) && table !== 'parametres' && table !== 'compteurs') r.created_at = new Date().toISOString();
      T(table).push(r);
      undo.push(() => { const a = T(table); const i = a.lastIndexOf(r); if (i >= 0) a.splice(i, 1); });
      onChange();
      return clone(r);
    },
    async update(table, id, patch) { return o.updateWhere(table, { id }, patch); },
    async updateWhere(table, w, patch) {
      if (table === 'audit_log') throw new AppError('Le journal d’audit ne peut pas être modifié.', 403);
      let last = null;
      for (const r of T(table)) if (match(r, w)) {
        const prev = {};
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) { prev[k] = { had: k in r, v: r[k] }; r[k] = clone(v); }
        undo.push(() => { for (const [k, p] of Object.entries(prev)) { if (p.had) r[k] = p.v; else delete r[k]; } });
        last = r;
      }
      onChange();
      return last ? clone(last) : null;
    },
    async remove(table, w) {
      if (!w || !Object.keys(w).length) throw new Error('Suppression sans critère refusée');
      if (table === 'audit_log') throw new AppError('Le journal d’audit ne peut pas être modifié.', 403);
      const arr = T(table); const gone = [];
      for (let i = arr.length - 1; i >= 0; i--) if (match(arr[i], w)) gone.push([i, arr.splice(i, 1)[0]]);
      undo.push(() => { for (const [i, r] of gone.slice().reverse()) arr.splice(i, 0, r); });
      if (gone.length) onChange();
      return gone.length;
    },
    async nextSeq(cle) {
      let c = T('compteurs').find((x) => x.cle === cle);
      if (!c) { c = { cle, valeur: 0 }; T('compteurs').push(c); }
      c.valeur += 1;
      undo.push(() => { c.valeur -= 1; });
      return c.valeur;
    },
    async auditList({ du, au, table, user_id, limit }) {
      return T('audit_log').filter((r) => (!du || r.created_at.slice(0, 10) >= du) && (!au || r.created_at.slice(0, 10) <= au) && (!table || r.table_name === table) && (!user_id || r.user_id === user_id))
        .slice().sort((a, b) => b.id - a.id).slice(0, limit || 500).map(clone);
    },
    async sp(fn) {
      const mark = undo.length;
      try { return await fn(); } catch (e) { while (undo.length > mark) undo.pop()(); onChange(); throw e; }
    },
    async tx(fn) {
      const mark = undo.length;
      try { const r = await o.sp(() => fn(o)); if (mark === 0) undo.length = 0; return r; } catch (e) { if (mark === 0) undo.length = 0; throw e; }
    },
  };
  return o;
}
