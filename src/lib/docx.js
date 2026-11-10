// Génération des documents administratifs au format Word (.docx) sur le papier à en-tête Foods Oriba.
// Aucun module externe : archive ZIP « stockée » (sans compression) écrite à la main.
import { ENTETE } from '../assets/entete.js';
import { FAMILLES_DOC } from '../../shared/documents.js';

const NAVY = '1F3A5F', VERT = '2E7D32', GRIS = '5F6B7A', FOND = 'EEF2F7', BORD = '9AA7B6';
const LARGEUR = 9638; // largeur utile : 11906 − 2 × 1134
const EXEMPLAIRES = ['Blanc — original', 'Jaune — copie', 'Rose — souche'];

// ---------- ZIP ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8) { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const enc = new TextEncoder();
function b64(s) { if (typeof atob === 'function') { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; } return new Uint8Array(Buffer.from(s, 'base64')); }

export function zip(files) { // files : [[nom, Uint8Array]]
  const locals = [], centrals = []; let offset = 0;
  for (const [nom, data] of files) {
    const n = enc.encode(nom), crc = crc32(data), sz = data.length;
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint16(10, 0, true); h.setUint16(12, 0x21, true); h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true);
    h.setUint16(26, n.length, true); h.setUint16(28, 0, true);
    locals.push(new Uint8Array(h.buffer), n, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
    c.setUint16(12, 0, true); c.setUint16(14, 0x21, true); c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true);
    c.setUint16(28, n.length, true); c.setUint32(42, offset, true);
    centrals.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + sz;
  }
  const cdSize = centrals.reduce((s, a) => s + a.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(e.buffer)];
  const out = new Uint8Array(parts.reduce((s, a) => s + a.length, 0)); let p = 0;
  for (const a of parts) { out.set(a, p); p += a.length; }
  return out;
}

// ---------- WordprocessingML ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function run(t, o = {}) {
  const rp = `<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>${o.b ? '<w:b/>' : ''}${o.i ? '<w:i/>' : ''}${o.c ? `<w:color w:val="${o.c}"/>` : ''}<w:sz w:val="${o.sz || 20}"/><w:szCs w:val="${o.sz || 20}"/></w:rPr>`;
  return String(t ?? '').split('\n').map((l, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r>${rp}<w:t xml:space="preserve">${esc(l)}</w:t></w:r>`).join('');
}
function para(runs, o = {}) {
  const pp = `<w:pPr>${o.keep ? '<w:keepNext/>' : ''}${o.brk ? '<w:pageBreakBefore/>' : ''}${o.bord ? `<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="4" w:color="${o.bord}"/></w:pBdr>` : ''}<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 60}" w:line="${o.line || 252}" w:lineRule="auto"/>${o.jc ? `<w:jc w:val="${o.jc}"/>` : ''}</w:pPr>`;
  return `<w:p>${pp}${runs}</w:p>`;
}
function cell(content, w, o = {}) {
  const tc = `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.span ? `<w:gridSpan w:val="${o.span}"/>` : ''}${o.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.fill}"/>` : ''}<w:vAlign w:val="${o.va || 'center'}"/></w:tcPr>`;
  return `<w:tc>${tc}${content || para('')}</w:tc>`;
}
function table(widths, rows, o = {}) {
  const b = (n) => `<w:${n} w:val="single" w:sz="4" w:space="0" w:color="${BORD}"/>`;
  const tp = `<w:tblPr><w:tblW w:w="${widths.reduce((s, x) => s + x, 0)}" w:type="dxa"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="30" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="30" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>`;
  const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  const trs = rows.map((r) => `<w:tr><w:trPr>${r.h ? `<w:trHeight w:val="${r.h}"/>` : ''}<w:cantSplit/>${r.head && o.repeat !== false ? '<w:tblHeader/>' : ''}</w:trPr>${r.cells.join('')}</w:tr>`).join('');
  return `<w:tbl>${tp}${grid}${trs}</w:tbl>`;
}
const vide = (sz = 4) => para('', { after: 0, line: 240, sz });

function texteValeur(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return v.toLocaleString('fr-FR').replace(/[  ]/g, ' ');
  return String(v);
}
function choixRuns(choix, val) {
  const v = String(val ?? '').toLowerCase();
  return choix.map((c) => run(`${v && v === c.toLowerCase() ? '☒' : '☐'} ${c}`, { sz: 19 }) + run('     ', { sz: 19 })).join('');
}

// Bloc « champs » : tableau étiquette / valeur en deux colonnes doubles quand c'est court.
function blocChamps(champs, valeurs) {
  if (!champs?.length) return '';
  const L1 = 2350, V1 = LARGEUR / 2 - L1, rows = [];
  const lab = (l) => cell(para(run(l, { b: true, c: NAVY, sz: 18 }), { after: 0 }), L1, { fill: FOND });
  const courts = [], longs = [];
  for (const f of champs) {
    const def = typeof f === 'string' ? { l: f } : f;
    (def.zone || def.choix || /lettres|description|objet|motif|justification|trajet|mission/i.test(def.l) ? longs : courts).push(def);
  }
  for (let i = 0; i < courts.length; i += 2) {
    const a = courts[i], b = courts[i + 1];
    const val = (d) => cell(para(run(texteValeur(valeurs[d.l]), { sz: 20 }), { after: 0 }), V1);
    rows.push({ h: 400, cells: b ? [lab(a.l), val(a), lab(b.l), val(b)] : [lab(a.l), cell(para(run(texteValeur(valeurs[a.l]), { sz: 20 }), { after: 0 }), LARGEUR - L1, { span: 3 })] });
  }
  for (const d of longs) {
    const v = valeurs[d.l];
    const contenu = d.choix ? para(choixRuns(d.choix, v), { after: 0 }) : para(run(texteValeur(v), { sz: 20 }), { after: 0 });
    rows.push({ h: d.zone ? 1100 : 420, cells: [lab(d.l), cell(contenu, LARGEUR - L1, { span: 3, va: d.zone ? 'top' : 'center' })] });
  }
  return table([L1, V1, L1, V1], rows) + vide();
}

function blocTableau(t, lignes) {
  const n = t.cols.length;
  const poids = t.cols.map((c, i) => (i === 0 ? 2.2 : /observation|commentaire|explication|constat|réponse|libellé|action|description|trajet/i.test(c) ? 1.8 : 1));
  const tot = poids.reduce((s, x) => s + x, 0);
  const w = poids.map((p) => Math.floor((LARGEUR * p) / tot)); w[0] += LARGEUR - w.reduce((s, x) => s + x, 0);
  const rows = [{ head: true, h: 380, cells: t.cols.map((c, i) => cell(para(run(c, { b: true, c: 'FFFFFF', sz: 17 }), { after: 0, jc: 'center' }), w[i], { fill: NAVY })) }];
  const data = lignes && lignes.length ? lignes : null;
  const base = t.rows ? t.rows.map((r) => [r]) : [];
  const nb = Math.max(data ? data.length : 0, base.length, t.rows ? 0 : t.n || 8);
  for (let r = 0; r < nb; r++) {
    const ligne = (data && data[r]) || base[r] || [];
    rows.push({ h: 360, cells: t.cols.map((_, i) => cell(para(run(texteValeur(ligne[i]), { sz: 18, b: i === 0 && !!t.rows }), { after: 0, jc: i && typeof ligne[i] === 'number' ? 'right' : undefined }), w[i], { fill: i === 0 && t.rows ? FOND : undefined })) });
  }
  const tot2 = data && data.total ? [{ h: 360, cells: t.cols.map((_, i) => cell(para(run(texteValeur(data.total[i]), { b: true, sz: 18 }), { after: 0, jc: i ? 'right' : undefined }), w[i], { fill: FOND })) }] : [];
  return (t.titre ? para(run(t.titre, { b: true, c: NAVY, sz: 20 }), { keep: true, before: 60, after: 60 }) : '') + table(w, rows.concat(tot2)) + vide();
}

function blocSignatures(s) {
  if (!s?.length) return '';
  const n = s.length, w = Array(n).fill(Math.floor(LARGEUR / n)); w[0] += LARGEUR - w.reduce((a, b) => a + b, 0);
  return para(run('Visas et signatures', { b: true, c: NAVY, sz: 20 }), { keep: true, before: 120, after: 60 }) + table(w, [
    { h: 380, cells: s.map((x, i) => cell(para(run(x, { b: true, c: NAVY, sz: 17 }), { after: 0, jc: "center", keep: true }), w[i], { fill: FOND })) },
    { h: 1150, cells: s.map((_, i) => cell(para(run('Nom :', { sz: 16, c: GRIS }), { after: 340 }) + para(run('Date :', { sz: 16, c: GRIS }), { after: 0 }), w[i], { va: 'top' })) },
  ]);
}

function corps(def, d, exemplaire, brk) {
  const fam = FAMILLES_DOC[def.fam] || '';
  const c = d.contenu || {}, champs = c.champs || {};
  let x = '';
  x += para(run(`${fam.toUpperCase()}  ·  PROCÉDURE ${def.proc}`, { b: true, c: VERT, sz: 16 }), { brk, after: 20, jc: 'center' });
  x += para(run(def.titre.toUpperCase(), { b: true, c: NAVY, sz: 28 }), { after: 120, jc: 'center', bord: NAVY });
  const W = [2600, 2000, 2838, 2200];
  const lab = (t) => run(t, { sz: 15, c: GRIS });
  x += table(W, [{ h: 440, cells: [
    cell(para(lab('N° ') + run(d.numero || '……………………', { b: true, sz: 20, c: NAVY }), { after: 0 }), W[0]),
    cell(para(lab('Date : ') + run(d.dateTxt || '…… / …… / ……', { b: true, sz: 20 }), { after: 0 }), W[1]),
    cell(para(lab(def.dep ? 'Équipe / dépôt : ' : 'Service : ') + run(d.equipe || (def.dep ? '' : 'Force de Vente'), { b: true, sz: 19 }), { after: 0 }), W[2]),
    cell(para(lab('Exemplaire : ') + run(exemplaire || 'Original', { b: true, sz: 18 }), { after: 0 }), W[3], { fill: FOND }),
  ] }]) + vide(8);
  x += blocChamps(def.f, champs);
  (def.t || []).forEach((t, i) => { x += blocTableau(t, (c.lignes || [])[i]); });
  x += blocChamps(def.f2, champs);
  if (def.txt) x += def.txt.split('\n').map((l) => para(run(l, { sz: 21 }), { after: 120, line: 276, jc: 'both' })).join('') + vide();
  if (c.texte) x += para(run(c.texte, { sz: 20 }), { after: 120 });
  if (def.note) x += para(run(def.note, { i: true, sz: 17, c: GRIS }), { after: 80 });
  if (c.observation) x += para(run('Observation : ', { b: true, sz: 18, c: NAVY }) + run(c.observation, { sz: 18 }), { after: 80 });
  x += blocSignatures(def.s);
  x += para(run(`Établi par : ${def.etabli}  ·  Signé par : ${def.signe}  ·  Circulation : ${def.circ}`, { sz: 14, c: GRIS }), { before: 120, after: 0 });
  x += para(run(`Document généré par ORIBA ERP le ${d.genere || ''}${d.numero ? ` · réf. ${d.numero}` : ''}. Toute rature doit être barrée d’un trait, corrigée et visée.`, { sz: 14, c: GRIS, i: true }), { after: 0 });
  return x;
}

const NS = 'xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14"';
const SECT = '<w:sectPr><w:headerReference w:type="default" r:id="rId4"/><w:footerReference w:type="default" r:id="rId5"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="2410" w:right="1134" w:bottom="1840" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/><w:cols w:space="708"/></w:sectPr>';

export function avecCarnet(def) { return /blanc/i.test(def.circ || ''); }

// d : { numero, date (AAAA-MM-JJ), equipe, contenu: { champs, lignes, texte, observation }, copies }
export function documentXml(def, d) {
  const dateTxt = d.date ? d.date.split('-').reverse().join('/') : '';
  const genere = new Date().toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  const ex = d.copies === 3 && avecCarnet(def) ? EXEMPLAIRES : [d.copies === 3 ? 'Original' : (avecCarnet(def) ? 'Blanc — original' : 'Original')];
  const body = ex.map((e, i) => corps(def, { ...d, dateTxt, genere }, e, i > 0)).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}${SECT}</w:body></w:document>`;
}

export function genererDocx(def, d) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(`${def.titre}${d.numero ? ' — ' + d.numero : ''}`)}</dc:title><dc:creator>ORIBA ERP — Force de Vente</dc:creator><cp:lastModifiedBy>ORIBA ERP</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
  const files = [];
  for (const [k, v] of Object.entries(ENTETE)) files.push([k, k === 'docProps/core.xml' ? enc.encode(core) : b64(v)]);
  files.splice(1, 0, ['word/document.xml', enc.encode(documentXml(def, d))]);
  return zip(files);
}

export function nomFichier(def, d) {
  return `${(d.numero || def.code).replace(/[^\w-]+/g, '_')}_${def.titre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').slice(0, 40)}.docx`;
}

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
