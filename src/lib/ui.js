// Composants d'interface : échappement, modales, notifications, tableaux, exports, graphiques.
import { fmtF, fmtN, fmtQ, fmtD, today } from '../../shared/logic.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export { fmtF, fmtN, fmtQ, fmtD };

export function icon(name) {
  const P = {
    plus: 'M12 5v14M5 12h14', x: 'M6 6l12 12M18 6L6 18', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
    download: 'M12 4v11m0 0l-4-4m4 4l4-4M5 19h14', refresh: 'M20 11a8 8 0 0 0-14.9-3.9M4 4v4h4M4 13a8 8 0 0 0 14.9 3.9M20 20v-4h-4',
    menu: 'M4 7h16M4 12h16M4 17h16', logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10', alert: 'M12 9v4m0 4h.01M10.3 3.9L2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    check: 'M5 13l4 4L19 7', edit: 'M4 20h4L19 9l-4-4L4 16v4z', file: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6zM14 3v6h6',
    flag: 'M5 21V4m0 0h11l-2 4 2 4H5',
    chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2', cash: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 10v4m12-4v4', credit: 'M3 6h18v12H3zM3 10h18M7 15h4',
    box: 'M3 8l9-5 9 5v8l-9 5-9-5V8zm0 0l9 5 9-5M12 13v8', wallet: 'M3 7a2 2 0 0 1 2-2h12v4M3 7v10a2 2 0 0 0 2 2h14V9H5a2 2 0 0 1-2-2zm14 7h.01',
    receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3zm3 5h6m-6 4h6m-6 4h3', gauge: 'M4 15a8 8 0 1 1 16 0M12 15l4-5M5 19h14', warehouse: 'M3 10l9-6 9 6v10H3V10zm4 10v-6h10v6',
    users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zm-6 9a6 6 0 0 1 12 0M16 4a3.5 3.5 0 0 1 0 7m2 9a6 6 0 0 0-3-5.2', store: 'M4 9l1.5-5h13L20 9M4 9v11h16V9M4 9h16M9 20v-6h6v6',
    coins: 'M8 8a5 2.5 0 1 0 10 0A5 2.5 0 1 0 8 8zm0 0v4c0 1.4 2.2 2.5 5 2.5s5-1.1 5-2.5V8M6 12v4c0 1.4 2.2 2.5 5 2.5m-5-6.5c-1.2.4-2 1.1-2 2', calc: 'M6 3h12v18H6zM9 7h6m-6 5h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01',
    target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-4a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', fuel: 'M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M3 21h13M7 8h5m3 2h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3',
    truck: 'M2 6h11v10H2zM13 10h4l3 3v3h-7M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zm-3 9l2 2 4-4',
    pie: 'M12 3v9h9A9 9 0 1 1 12 3zm3 0a6 6 0 0 1 6 6h-6V3z', spark: 'M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6',
    home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9z', map: 'M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14', tag: 'M3 12V4h8l10 10-8 8L3 12zm4-4h.01',
    clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-13v5l3 2', check2: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm-4-9l3 3 5-6', lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm8-3l2-1-2-4-2 .5-1.5-1.5L16 4h-4l-.5 2L10 7.5 8 7 6 11l2 1v0l-2 1 2 4 2-.5 1.5 1.5.5 2h4l.5-2 1.5-1.5 2 .5 2-4-2-1z', db: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3', eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', upload: 'M12 20V9m0 0l-4 4m4-4l4 4M5 5h14',
  };
  return `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[name] || ''}"/></svg>`;
}

// ---------- Notifications ----------
export function toast(msg, type = 'ok') {
  let host = $('#toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('role', 'status'); document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => t.classList.add('out'), type === 'err' ? 6500 : 3500);
  setTimeout(() => t.remove(), type === 'err' ? 7000 : 4000);
}

// ---------- Modales ----------
const stack = [];
export function modal({ title, body, wide = false, size, onMount, footer = '' }) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''} ${size || ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header class="modal-h"><h2>${esc(title)}</h2><button class="btn-icon" data-close aria-label="Fermer">${icon('x')}</button></header>
      <div class="modal-b">${body}</div>${footer ? `<footer class="modal-f">${footer}</footer>` : ''}</div>`;
    document.body.appendChild(ov);
    stack.push(ov);
    const close = (v) => { ov.remove(); stack.splice(stack.indexOf(ov), 1); resolve(v); };
    ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(null); });
    $$('[data-close]', ov).forEach((b) => b.addEventListener('click', () => close(null)));
    const first = ov.querySelector('input:not([type=hidden]):not([disabled]), select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    onMount?.(ov.querySelector('.modal'), close);
  });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && stack.length) stack[stack.length - 1].querySelector('[data-close]')?.click(); });

export function confirmBox({ title, message, okLabel = 'Confirmer', danger = false, motif = false, motifLabel = 'Motif', motifRequired = true }) {
  return modal({
    title,
    body: `<p class="lead">${message}</p>${motif ? `<label class="fld"><span>${esc(motifLabel)}${motifRequired ? ' *' : ''}</span><textarea id="cb-motif" rows="3"></textarea></label>` : ''}<p class="err" hidden></p>`,
    footer: `<button class="btn ghost" data-close>Retour</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button>`,
    onMount: (m, close) => {
      $('[data-ok]', m.parentElement).addEventListener('click', () => {
        const v = motif ? $('#cb-motif', m).value.trim() : true;
        if (motif && motifRequired && !v) { const e = $('.err', m); e.hidden = false; e.textContent = 'Le motif est obligatoire.'; return; }
        close(v || (motif ? '' : true));
      });
    },
  });
}

// ---------- Formulaires ----------
export function field(f, value, opts = {}) {
  const id = `f-${f.k}`;
  const req = f.req ? ' *' : '';
  const v = value ?? f.def ?? '';
  const help = f.help ? `<small>${esc(f.help)}</small>` : '';
  const dis = f.disabled ? ' disabled' : '';
  if (f.t === 'bool') return `<label class="chk"><input type="checkbox" id="${id}" name="${f.k}" ${v ? 'checked' : ''}${dis}> <span>${esc(f.l)}</span></label>`;
  let input;
  if (f.t === 'textarea') input = `<textarea id="${id}" name="${f.k}" rows="${f.rows || 3}"${dis}>${esc(v)}</textarea>`;
  else if (f.t?.startsWith('select:')) input = `<select id="${id}" name="${f.k}"${dis}><option value="">—</option>${f.t.slice(7).split('|').map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else if (f.t === 'options') input = `<select id="${id}" name="${f.k}"${dis}>${f.empty === false ? '' : `<option value="">${esc(f.emptyLabel || '—')}</option>`}${(f.options || []).map((o) => `<option value="${esc(o.v)}" ${String(o.v) === String(v) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`;
  else input = `<input id="${id}" name="${f.k}" type="${f.t === 'number' ? 'number' : f.t === 'date' ? 'date' : f.t === 'month' ? 'month' : f.t === 'password' ? 'password' : f.t === 'email' ? 'email' : 'text'}" ${f.t === 'number' ? `step="${f.step || 'any'}" min="${f.min ?? ''}"` : ''} value="${esc(v)}" ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''} ${f.auto ? `autocomplete="${f.auto}"` : ''}${dis}>`;
  return `<label class="fld ${f.wide ? 'span2' : ''} ${opts.cls || ''}"><span>${esc(f.l)}${req}</span>${input}${help}</label>`;
}

export function readForm(root) {
  const o = {};
  for (const e of $$('input[name], select[name], textarea[name]', root)) {
    if (e.type === 'checkbox') o[e.name] = e.checked;
    else if (e.type === 'number') o[e.name] = e.value === '' ? null : Number(e.value);
    else o[e.name] = e.value === '' ? null : e.value;
  }
  return o;
}

export function showErr(root, msg) {
  const e = $('.err', root);
  if (e) { e.hidden = !msg; e.textContent = msg || ''; if (msg) e.scrollIntoView({ block: 'nearest' }); } else if (msg) toast(msg, 'err');
}

export async function busy(btn, fn) {
  if (btn.disabled) return;
  const t = btn.innerHTML;
  btn.disabled = true; btn.classList.add('loading');
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove('loading'); btn.innerHTML = t; }
}

// ---------- Tableau de données ----------
export class Table {
  constructor({ cols, rows, pageSize = 25, onRow, empty = 'Aucune ligne pour ces critères.', select = false, sort, title, meta, exportable = true, foot }) {
    Object.assign(this, { cols, rows, pageSize, onRow, empty, select, title, meta, exportable, foot });
    this.page = 0; this.q = ''; this.sortK = sort?.k ?? null; this.sortDir = sort?.dir ?? -1; this.sel = new Set();
  }
  filtered() {
    let r = this.rows;
    if (this.q) {
      const q = this.q.toLowerCase();
      r = r.filter((row) => this.cols.some((c) => String(c.txt ? c.txt(row) : c.v ? c.v(row) : row[c.k] ?? '').toLowerCase().includes(q)));
    }
    if (this.sortK !== null) {
      const c = this.cols.find((x) => x.k === this.sortK);
      if (c) {
        const val = (row) => (c.v ? c.v(row) : row[c.k]);
        r = r.slice().sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * this.sortDir; });
      }
    }
    return r;
  }
  mount(host) {
    this.host = host;
    host.innerHTML = `<div class="tbl-tools">
        <label class="search">${icon('search')}<input type="search" placeholder="Rechercher dans la liste" aria-label="Rechercher"></label>
        <span class="tbl-count"></span>
        ${this.exportable ? `<span class="tbl-exp"><button class="btn sm ghost" data-exp="xlsx">${icon('download')} Excel</button><button class="btn sm ghost" data-exp="csv">CSV</button><button class="btn sm ghost" data-exp="pdf">PDF</button></span>` : ''}
      </div><div class="tbl-wrap"><table class="tbl"></table></div><div class="tbl-pager"></div>`;
    $('.search input', host).addEventListener('input', (e) => { this.q = e.target.value; this.page = 0; this.draw(); });
    $$('[data-exp]', host).forEach((b) => b.addEventListener('click', () => exportRows(b.dataset.exp, this.title || 'export', this.cols.filter((c) => !c.noexp), this.filtered(), this.meta?.())));
    this.draw();
    return this;
  }
  draw() {
    const rows = this.filtered();
    const pages = Math.max(1, Math.ceil(rows.length / this.pageSize));
    if (this.page >= pages) this.page = pages - 1;
    const slice = rows.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize);
    const th = this.cols.map((c) => `<th class="${c.num ? 'n' : ''} ${c.cls || ''}" ${c.nosort ? '' : `data-sort="${c.k}" tabindex="0"`} aria-sort="${this.sortK === c.k ? (this.sortDir > 0 ? 'ascending' : 'descending') : 'none'}">${esc(c.l)}${this.sortK === c.k ? (this.sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const body = slice.map((r) => `<tr data-id="${esc(r.id ?? '')}" class="${this.onRow ? 'click' : ''} ${r._cls || ''}">${this.select ? `<td class="sel"><input type="checkbox" data-sel="${esc(r.id)}" ${this.sel.has(r.id) ? 'checked' : ''} ${this.select(r) ? '' : 'disabled'} aria-label="Sélectionner"></td>` : ''}${this.cols.map((c) => `<td class="${c.num ? 'n' : ''} ${c.cls || ''}">${c.f ? c.f(r) : esc(c.v ? c.v(r) : r[c.k] ?? '')}</td>`).join('')}</tr>`).join('');
    const foot = this.foot ? `<tfoot><tr>${this.select ? '<td></td>' : ''}${this.cols.map((c) => `<td class="${c.num ? 'n' : ''}">${this.foot(c, rows) ?? ''}</td>`).join('')}</tr></tfoot>` : '';
    $('table', this.host).innerHTML = `<thead><tr>${this.select ? '<th class="sel"></th>' : ''}${th}</tr></thead><tbody>${body || `<tr><td class="empty" colspan="${this.cols.length + (this.select ? 1 : 0)}">${esc(this.empty)}</td></tr>`}</tbody>${foot}`;
    $('.tbl-count', this.host).textContent = `${fmtN(rows.length)} ligne${rows.length > 1 ? 's' : ''}`;
    $('.tbl-pager', this.host).innerHTML = pages > 1 ? `<button class="btn sm ghost" data-p="-1" ${this.page === 0 ? 'disabled' : ''}>Précédent</button><span>Page ${this.page + 1} / ${pages}</span><button class="btn sm ghost" data-p="1" ${this.page >= pages - 1 ? 'disabled' : ''}>Suivant</button>` : '';
    $$('[data-p]', this.host).forEach((b) => b.addEventListener('click', () => { this.page += Number(b.dataset.p); this.draw(); }));
    $$('th[data-sort]', this.host).forEach((h) => {
      const go = () => { const k = h.dataset.sort; if (this.sortK === k) this.sortDir *= -1; else { this.sortK = k; this.sortDir = -1; } this.draw(); };
      h.addEventListener('click', go); h.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    });
    if (this.onRow) $$('tbody tr[data-id]', this.host).forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.closest('input,button,a')) return; const r = slice.find((x) => String(x.id) === tr.dataset.id); if (r) this.onRow(r); }));
    $$('[data-sel]', this.host).forEach((c) => c.addEventListener('change', () => { if (c.checked) this.sel.add(c.dataset.sel); else this.sel.delete(c.dataset.sel); this.onSel?.(this.sel); }));
  }
}

// ---------- Exports ----------
let exportContext = () => ({ user: '', filtres: '' });
export function setExportContext(fn) { exportContext = fn; }
let saver = null;
export function setSaver(fn) { saver = fn; }

async function saveBlob(filename, blob) {
  if (saver) { try { if (await saver(filename, blob)) return; } catch { /* repli */ } }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export { saveBlob };

const plain = (c, r) => { const v = c.x ? c.x(r) : c.v ? c.v(r) : r[c.k]; return v === null || v === undefined ? '' : v; };

export async function exportRows(fmt, title, cols, rows, extraMeta) {
  const ctx = exportContext();
  const stamp = new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' });
  const meta = [`ORIBA FOODS — ${title}`, `Édité le ${stamp} par ${ctx.user}`, ctx.filtres ? `Filtres : ${ctx.filtres}` : '', extraMeta || ''].filter(Boolean);
  const fname = `${title.replace(/[^\w\-]+/g, '_')}_${today()}`;
  if (fmt === 'csv') {
    const line = (a) => a.map((v) => { const s = String(v).replace(/"/g, '""'); return /[;"\n]/.test(s) ? `"${s}"` : s; }).join(';');
    const txt = '﻿' + [...meta.map((m) => line([m])), '', line(cols.map((c) => c.l)), ...rows.map((r) => line(cols.map((c) => { const v = plain(c, r); return typeof v === 'number' ? String(v).replace('.', ',') : v; })))].join('\r\n');
    return saveBlob(fname + '.csv', new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  }
  if (fmt === 'xlsx') {
    if (!window.XLSX) return toast('Module Excel non chargé : vérifiez la connexion internet.', 'err');
    const aoa = [...meta.map((m) => [m]), [], cols.map((c) => c.l), ...rows.map((r) => cols.map((c) => plain(c, r)))];
    const ws = window.XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = cols.map((c) => ({ wch: Math.max(10, Math.min(40, c.l.length + 4)) }));
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, title.slice(0, 30).replace(/[\\/?*[\]:]/g, ' '));
    const out = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return saveBlob(fname + '.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  }
  if (fmt === 'pdf') {
    const J = window.jspdf?.jsPDF;
    if (!J) return toast('Module PDF non chargé : vérifiez la connexion internet.', 'err');
    const doc = new J({ orientation: cols.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(meta[0], 36, 40);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
    meta.slice(1).forEach((m, i) => doc.text(doc.splitTextToSize(m, doc.internal.pageSize.getWidth() - 72), 36, 56 + i * 12));
    const fmtCell = (v) => (typeof v === 'number' ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v).replace(/ | /g, ' ') : String(v));
    doc.autoTable({
      startY: 60 + meta.length * 12, head: [cols.map((c) => c.l)], body: rows.map((r) => cols.map((c) => fmtCell(plain(c, r)))),
      styles: { fontSize: 7.5, cellPadding: 3 }, headStyles: { fillColor: [24, 58, 66] },
      columnStyles: Object.fromEntries(cols.map((c, i) => [i, c.num ? { halign: 'right' } : {}])),
      didDrawPage: (d) => { doc.setFontSize(7); doc.text(`Page ${d.pageNumber}`, doc.internal.pageSize.getWidth() - 60, doc.internal.pageSize.getHeight() - 16); },
    });
    return saveBlob(fname + '.pdf', doc.output('blob'));
  }
}

// ---------- Graphiques ----------
const charts = new Map();
export function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
export function palette() { return ['--c1', '--c2', '--c3', '--c4', '--c5', '--c6', '--c7', '--c8'].map(cssVar); }
export function destroyCharts() { for (const c of charts.values()) c.destroy(); charts.clear(); }
export function chart(canvas, cfg) {
  if (!window.Chart || !canvas) return null;
  const key = canvas.id || Math.random();
  charts.get(key)?.destroy();
  const ink = cssVar('--ink-2'), grid = cssVar('--line');
  window.Chart.defaults.font.family = cssVar('--f-body') || 'sans-serif';
  window.Chart.defaults.color = ink;
  const scales = cfg.type === 'doughnut' || cfg.type === 'pie' ? {} : {
    x: { grid: { color: grid, display: cfg.gridX ?? false }, ticks: { color: ink, maxRotation: 0, autoSkip: true }, stacked: !!cfg.stacked },
    y: { grid: { color: grid }, ticks: { color: ink, callback: cfg.yfmt || ((v) => compact(v)) }, stacked: !!cfg.stacked, beginAtZero: true },
    ...(cfg.y2 ? { y2: { position: 'right', grid: { display: false }, ticks: { color: ink, callback: (v) => compact(v) }, beginAtZero: true } } : {}),
  };
  if (cfg.horizontal) { const t = scales.x; scales.x = { ...scales.y, grid: { color: grid } }; scales.y = { ...t, grid: { display: false }, ticks: { color: ink, autoSkip: false } }; }
  const c = new window.Chart(canvas, {
    type: cfg.type, data: cfg.data,
    options: {
      responsive: true, maintainAspectRatio: false, animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 350 },
      indexAxis: cfg.horizontal ? 'y' : 'x', cutout: cfg.cutout, rotation: cfg.rotation, circumference: cfg.circumference,
      interaction: { mode: cfg.type === 'doughnut' ? 'nearest' : 'index', intersect: cfg.type === 'doughnut' },
      plugins: {
        legend: { display: cfg.legend ?? true, position: cfg.legendPos || 'bottom', labels: { boxWidth: 10, boxHeight: 10, color: ink, usePointStyle: true } },
        tooltip: { callbacks: { label: cfg.tip || ((ctx) => `${ctx.dataset.label || ctx.label}: ${cfg.money === false ? fmtN(ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed, 1) : fmtF(ctx.parsed.y ?? (cfg.horizontal ? ctx.parsed.x : ctx.parsed))}`) } },
      },
      scales, onClick: cfg.onClick,
    },
  });
  charts.set(key, c);
  return c;
}
export function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return fmtN(v / 1e9, 1) + ' Md';
  if (a >= 1e6) return fmtN(v / 1e6, 1) + ' M';
  if (a >= 1e3) return fmtN(v / 1e3, 0) + ' k';
  return fmtN(v, 1);
}
export function alpha(hex, a) {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

export function pill(text, sev) { return `<span class="pill ${sev || ''}">${esc(text)}</span>`; }
export function statutCreditPill(s) {
  const m = { 'Soldé': 'ok', 'En retard': 'crit', 'Partiellement remboursé': 'warn', 'En attente': 'info', 'Annulée': 'mute' };
  return pill(s, m[s]);
}

// ---------- Habillage dynamique des indicateurs ----------
const TONES = ['t-violet', 't-vert', 't-sarcelle', 't-ambre', 't-bleu', 't-rose'];
const KPI_ICONS = [
  [/retard|expir|critique|anomal/i, 'alert', 't-rose'], [/plafond/i, 'gauge'], [/comptant/i, 'cash'], [/crédit/i, 'credit'], [/encaisse|rembours/i, 'wallet'],
  [/créance/i, 'receipt'], [/stock|lot/i, 'warehouse'], [/coût par carton|par carton/i, 'calc', 't-ambre'], [/carburant/i, 'fuel'], [/véhicule|parc/i, 'truck'],
  [/document|assurance|renouvel/i, 'shield'], [/budget/i, 'pie'], [/objectif/i, 'target'], [/atteint/i, 'check2', 't-vert'], [/agent/i, 'users'], [/client|grossiste/i, 'store'],
  [/carton|quantité/i, 'box'], [/dépense|charge|engag|validé|logisti|entretien|réparation|frais/i, 'coins'], [/attente|soumis/i, 'clock'], [/sans|doublon|rejet/i, 'alert', 't-ambre'],
  [/annul/i, 'lock'], [/vente|CA|chiffre|réalisé/i, 'chart'],
];
function parseNum(txt) {
  const m = txt.replace(/\u202f|\u00a0/g, ' ').match(/^(\D*?)(-?\d(?:[\d ]*\d)?(?:,\d+)?)(.*)$/s);
  if (!m) return null;
  const n = Number(m[2].replace(/ /g, '').replace(',', '.'));
  if (!isFinite(n)) return null;
  return { pre: m[1], n, dec: (m[2].split(',')[1] || '').length, post: m[3] };
}
function countUp(el) {
  const p = parseNum(el.textContent);
  if (!p || Math.abs(p.n) < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const fmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec });
  const t0 = performance.now(), dur = 900;
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    el.textContent = p.pre + fmt.format(p.n * e) + p.post;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
export function decorate(root) {
  let i = 0;
  for (const k of root.querySelectorAll('.kpi:not([data-dec])')) {
    k.dataset.dec = '1';
    const label = k.querySelector('.kpi-l')?.textContent || '';
    const hit = KPI_ICONS.find(([re]) => re.test(label)) || [null, 'spark'];
    const tone = k.classList.contains('crit') ? 't-rose' : k.classList.contains('warn') ? 't-ambre' : k.classList.contains('ok') ? 't-vert' : hit[2] || TONES[i % TONES.length];
    if (!TONES.some((t) => k.classList.contains(t))) k.classList.add(tone);
    k.style.setProperty('--i', i);
    if (!k.querySelector('.kpi-ic')) k.insertAdjacentHTML('afterbegin', `<span class="kpi-ic" aria-hidden="true">${icon(hit[1])}</span>`);
    const v = k.querySelector('.kpi-v'); if (v) countUp(v);
    i++;
  }
  let j = 0;
  for (const c of root.querySelectorAll('.card:not([data-dec]), .zcard:not([data-dec])')) { c.dataset.dec = '1'; c.style.setProperty('--i', Math.min(j++, 12)); }
  for (const [n, z] of [...root.querySelectorAll('.zcard')].entries()) z.style.setProperty('--zc', `var(--c${(n % 8) + 1})`);
}
