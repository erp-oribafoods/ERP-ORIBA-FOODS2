// Accès PostgreSQL (Netlify Database) pour le cœur applicatif.
import pg from 'pg';

pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // int8
pg.types.setTypeParser(1082, (v) => v); // date -> 'YYYY-MM-DD'
pg.types.setTypeParser(1184, (v) => (v === null ? null : new Date(v).toISOString())); // timestamptz

const IDENT = /^[a-z_][a-z0-9_]*$/;
const id = (s) => { if (!IDENT.test(s)) throw new Error('Identifiant SQL invalide : ' + s); return `"${s}"`; };
const val = (v) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);

function where(w, params) {
  const parts = [];
  for (const [k, v] of Object.entries(w || {})) {
    if (Array.isArray(v)) {
      if (!v.length) { parts.push('false'); continue; }
      params.push(v); parts.push(`${id(k)} = any($${params.length})`);
    } else if (v === null) parts.push(`${id(k)} is null`);
    else { params.push(v); parts.push(`${id(k)} = $${params.length}`); }
  }
  return parts.length ? ' where ' + parts.join(' and ') : '';
}

function ops(q) {
  const o = {
    async select(table, w = {}) {
      const params = [];
      const order = ['audit_log'].includes(table) ? ' order by id desc' : '';
      const r = await q(`select * from ${id(table)}${where(w, params)}${order}`, params);
      return r.rows;
    },
    async insert(table, row) {
      const keys = Object.keys(row).filter((k) => row[k] !== undefined);
      const params = keys.map((k) => val(row[k]));
      const r = await q(`insert into ${id(table)} (${keys.map(id).join(',')}) values (${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, params);
      return r.rows[0];
    },
    async update(table, rowId, patch) {
      return o.updateWhere(table, { id: rowId }, patch);
    },
    async updateWhere(table, w, patch) {
      const keys = Object.keys(patch).filter((k) => patch[k] !== undefined);
      const params = keys.map((k) => val(patch[k]));
      const set = keys.map((k, i) => `${id(k)} = $${i + 1}`).join(', ');
      const r = await q(`update ${id(table)} set ${set}${where(w, params)} returning *`, params);
      return r.rows[0];
    },
    async nextSeq(cle) {
      const r = await q('insert into compteurs (cle, valeur) values ($1, 1) on conflict (cle) do update set valeur = compteurs.valeur + 1 returning valeur', [cle]);
      return Number(r.rows[0].valeur);
    },
    async auditList({ du, au, table, user_id, limit }) {
      const params = []; const parts = [];
      if (du) { params.push(du); parts.push(`created_at >= $${params.length}::date`); }
      if (au) { params.push(au); parts.push(`created_at < ($${params.length}::date + 1)`); }
      if (table) { params.push(table); parts.push(`table_name = $${params.length}`); }
      if (user_id) { params.push(user_id); parts.push(`user_id = $${params.length}`); }
      params.push(limit || 500);
      const r = await q(`select * from audit_log${parts.length ? ' where ' + parts.join(' and ') : ''} order by id desc limit $${params.length}`, params);
      return r.rows;
    },
  };
  return o;
}

export function pgAdapter(pool) {
  const base = ops((s, p) => pool.query(s, p));
  base.sp = (fn) => fn();
  base.tx = async (fn) => {
    const c = await pool.connect();
    let n = 0;
    try {
      await c.query('begin');
      const t = ops((s, p) => c.query(s, p));
      t.sp = async (f) => {
        const name = 'sp' + ++n;
        await c.query('savepoint ' + name);
        try { const r = await f(); await c.query('release savepoint ' + name); return r; }
        catch (e) { await c.query('rollback to savepoint ' + name); throw e; }
      };
      const r = await fn(t);
      await c.query('commit');
      return r;
    } catch (e) {
      try { await c.query('rollback'); } catch { /* ignore */ }
      throw e;
    } finally { c.release(); }
  };
  return base;
}
