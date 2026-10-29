// Lecture directe des tableaux de bord régionaux « TB … ORIBA FOODS » (Journal Comptant, Journal Crédit, Stock, Paramètres).
// Les lignes déjà présentes dans la plateforme sont reconnues (rien n'est importé deux fois) ;
// les remboursements sont déduits des colonnes « Montant remboursé » / « Date remboursement » du Journal Crédit.
import { App, nm } from '../app.js';
import { fmtN, fmtD } from './ui.js';
import { venteTotals, creditInfo, isDate, num, round2, lineCalc, today } from '../../shared/logic.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const t = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const vide = (v) => v === '' || v === null || v === undefined;
const toNum = (v) => { if (vide(v)) return null; if (typeof v === 'number') return v; const n = Number(String(v).replace(/[\s  ]/g, '').replace(',', '.')); return Number.isNaN(n) ? NaN : n; };
function toISO(v) {
  if (vide(v)) return null;
  if (v instanceof Date && !isNaN(v)) { const j = new Date(v.getTime() + 12 * 3600 * 1000); return new Date(Date.UTC(j.getFullYear(), j.getMonth(), j.getDate())).toISOString().slice(0, 10); } // arrondi au jour le plus proche (dates Excel décalées de quelques secondes)
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) { let y = m[3]; if (y.length === 2) y = '20' + y; if (/^0?206$/.test(y)) y = '2026'; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
// Dates saisies avec une année erronée (0206, 2028…) : ramenées en 2026 et signalées
function dateSure(v, msgs, champ, futurOk = false) {
  let d = toISO(v);
  if (!d) return null;
  const y = Number(d.slice(0, 4));
  if (y < 2020 || y > 2027 || (!futurOk && d > today())) {
    const c = `2026${d.slice(4)}`;
    if (c <= today() && isDate(c)) { msgs.push(`${champ} « ${v instanceof Date ? fmtD(d) : v} » lue comme ${fmtD(c)}`); d = c; } else return null;
  }
  return isDate(d) ? d : null;
}

// Colonnes reconnues (entêtes du fichier TB normalisés)
const COLS = {
  date: ['date', 'date_vente'], agent: ['nom_de_l_agent', 'agent', 'nom_agent'], marche: ['marche_village', 'marche', 'village'], client: ['client_acheteur', 'client_debiteur', 'client'],
  produit: ['produit'], unite: ['unite'], quantite: ['quantite'], prix: ['prix_unitaire_fcfa', 'prix_unitaire'], montant: ['montant_fcfa', 'montant'], observation: ['observation'],
  promesse: ['date_promesse', 'echeance'], rembourse: ['montant_rembourse_fcfa', 'montant_rembourse'], date_remb: ['date_remboursement'],
  date_prise: ['date_prise'], quantite_prise: ['quantite_prise_cartons', 'quantite_prise'],
};
function lireFeuille(ws) {
  const X = window.XLSX;
  const rows = X.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
  const h = rows.findIndex((r, i) => i < 15 && r.some((c) => norm(c) === 'date' || norm(c) === 'date_prise') && r.some((c) => norm(c).startsWith('quantite')));
  if (h < 0) return [];
  const head = rows[h].map(norm);
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, al]) => [k, head.findIndex((c) => al.includes(c))]));
  const out = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i];
    const g = (k) => (idx[k] >= 0 ? r[idx[k]] : '');
    if (norm(r[0]) === 'totaux' || norm(r[0]).startsWith('total')) continue;
    const o = { _ligne: i + 1 };
    for (const k of Object.keys(COLS)) o[k] = g(k);
    if (vide(o.date) && vide(o.date_prise) && vide(o.agent) && vide(o.quantite) && vide(o.quantite_prise)) continue;
    out.push(o);
  }
  return out;
}

export function estTB(wb) { return wb.SheetNames.some((n) => /^journal\s+(comptant|cr[eé]dit)/i.test(n.trim())); }
const feuille = (wb, re) => wb.SheetNames.find((n) => re.test(n.trim()));
const FEUILLE = { ventes_comptant: /^journal\s+comptant/i, ventes_credit: /^journal\s+cr[eé]dit/i, remboursements: /^journal\s+cr[eé]dit/i, stock_remises: /^stock$/i };
export const TYPES_TB = Object.keys(FEUILLE);

// Équipe du fichier : chef d'équipe (feuille Paramètres) ou agents des journaux
export function detecterEquipe(wb) {
  const p = feuille(wb, /^param/i);
  const noms = new Set();
  if (p) for (const r of window.XLSX.utils.sheet_to_json(wb.Sheets[p], { header: 1, defval: '' })) if (/^chef d.?.quipe/i.test(t(r[0]))) noms.add(norm(r[1]));
  const votes = new Map();
  const vote = (nom, w) => { for (const a of App.D.agents || []) if (a.equipe_id && norm(a.nom) === nom) votes.set(a.equipe_id, (votes.get(a.equipe_id) || 0) + w); for (const e of App.D.equipes || []) if (e.responsable && norm(e.responsable) === nom) votes.set(e.id, (votes.get(e.id) || 0) + w); };
  for (const n of noms) vote(n, 10);
  for (const re of [FEUILLE.ventes_comptant, FEUILLE.ventes_credit]) { const f = feuille(wb, re); if (f) for (const r of lireFeuille(wb.Sheets[f]).slice(0, 300)) vote(norm(r.agent), 1); }
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}
export function chefFichier(wb) {
  const p = feuille(wb, /^param/i); if (!p) return null;
  for (const r of window.XLSX.utils.sheet_to_json(wb.Sheets[p], { header: 1, defval: '' })) if (/^chef d.?.quipe/i.test(t(r[0])) && t(r[1])) return t(r[1]);
  return null;
}

// Deux noms sont proches s'ils partagent un mot significatif (hors « Elh », « El Hadj »…)
const motsNom = (s) => norm(s).split('_').filter((w) => w.length > 2 && !['elh', 'hadj', 'hadji', 'alh'].includes(w));
const procheNom = (a, b) => { const A = new Set(motsNom(a)); return motsNom(b).some((w) => A.has(w)); };
// Correspondances avec les référentiels, en privilégiant l'équipe du fichier
const ALIAS = { petit_marche: 'petit_marche', nouveaux_marche: 'nouveau_marche', nouveau_marche: 'nouveau_marche', gamkale: 'gamkalle', aeroport: 'aeroport', grand_marche: 'grand_marche' };
const sansMarche = (s) => norm(t(s).replace(/^march[eé]\s+/i, ''));
function referentiels(eqId) {
  const eq = (App.D.equipes || []).find((e) => e.id === eqId);
  const code = eq?.code || 'X';
  const agents = (App.D.agents || []).filter((a) => a.actif !== false);
  const marches = (App.D.marches || []).filter((m) => m.actif !== false);
  const clients = (App.D.clients || []).filter((c) => c.actif !== false);
  const produits = (App.D.produits || []).filter((p) => p.actif !== false);
  return {
    eq, code,
    agent(nom) { const n = norm(nom); if (!n) return null; const l = agents.filter((a) => norm(a.nom) === n); return (l.find((a) => a.equipe_id === eqId) || (l.length === 1 ? l[0] : null))?.id || undefined; },
    marche(nom) { const n = sansMarche(nom); if (!n) return null; const k = ALIAS[n] || n; const l = marches.filter((m) => (ALIAS[sansMarche(m.nom)] || sansMarche(m.nom)) === k); return (l.find((m) => m.equipe_id === eqId) || l.find((m) => m.zone_id === eq?.zone_id) || l[0])?.id || undefined; },
    client(lib) {
      const s = t(lib); if (!s) return null;
      const m = s.match(/^Clien?t?\s*([A-Z0-9]+)\s*-\s*(.*)$/i);
      const nom = m ? t(m[2]) : s;
      // Le nom prime sur la lettre : un même fichier peut donner la même lettre à deux clients différents
      const l = nom && !/^d[ée]taillants?$/i.test(nom) ? clients.filter((c) => norm(c.nom) === norm(nom)) : [];
      if (l.length === 1) return l[0].id;
      if (m) { const c = clients.find((x) => norm(x.code) === norm(`${code}-${m[1]}`) && (!nom || /^d[ée]taillants?$/i.test(nom) || /nom à compléter/.test(x.nom) || /^d[ée]taillants divers/i.test(x.nom) || procheNom(x.nom, nom))); if (c) return c.id; }
      return l.length > 1 ? l[0].id : undefined;
    },
    produit(nom) { const n = norm(nom); return produits.find((p) => norm(p.nom) === n || norm(p.code) === n)?.id || (n ? undefined : null); },
  };
}

// Éléments à créer avant l'import (agents, marchés, clients absents)
function aCreer(rows, R, eq) {
  const ag = new Map(), ma = new Map(), cl = new Map();
  for (const r of rows) {
    if (t(r.agent) && R.agent(r.agent) === undefined) ag.set(norm(r.agent), t(r.agent));
    if (t(r.marche) && R.marche(r.marche) === undefined) ma.set(sansMarche(r.marche), t(r.marche).replace(/^march[eé]\s+/i, ''));
    if (t(r.client) && R.client(r.client) === undefined) cl.set(norm(r.client), t(r.client));
  }
  return { agents: [...ag.values()], marches: [...ma.values()], clients: [...cl.values()], eq };
}
export async function creerManquants(manq) {
  const eq = manq.eq; if (!eq) return;
  const lignes = [];
  if (manq.marches.length) await App.act('import.run', { type: 'marches', mode: 'courant', fichier: 'Import TB — nouveaux marchés', rows: manq.marches.map((nom, i) => ({ ligne: i + 1, data: { nom, zone_id: eq.zone_id, equipe_id: eq.id } })) }, null);
  if (manq.agents.length) {
    const pris = new Set((App.D.agents || []).map((a) => a.code));
    let n = 0;
    const code = () => { let c; do { n++; c = `${eq.code}-${String(n).padStart(2, '0')}`; } while (pris.has(c)); pris.add(c); return c; };
    await App.act('import.run', { type: 'agents', mode: 'courant', fichier: 'Import TB — nouveaux agents', rows: manq.agents.map((nom, i) => ({ ligne: i + 1, data: { code: code(), nom, equipe_id: eq.id, zone_id: eq.zone_id } })) }, null);
  }
  if (manq.clients.length) {
    const pris = new Set((App.D.clients || []).map((c) => c.code));
    await App.act('import.run', { type: 'clients', mode: 'courant', fichier: 'Import TB — nouveaux clients', rows: manq.clients.map((lib, i) => {
      const m = lib.match(/^Clien?t?\s*([A-Z0-9]+)\s*-\s*(.*)$/i);
      let code = m ? `${eq.code}-${m[1].toUpperCase()}` : null; if (code && pris.has(code)) { let n = 2; while (pris.has(`${code}${n}`)) n++; code = `${code}${n}`; } if (code) pris.add(code);
      const det = /d[ée]taillant/i.test(lib);
      const nom = det ? `Détaillants divers (${eq.nom})` : m && t(m[2]) ? t(m[2]) : `${m ? 'Client ' + m[1] : lib} — ${eq.nom} (nom à compléter)`;
      return { ligne: i + 1, data: { code, nom, type: det ? 'Détaillant' : null } };
    }) }, null);
  }
  return lignes;
}

// Clés de comparaison avec ce qui existe déjà
const cle = (date, agent, client, produit, cartons, montant) => [date, agent || '', client || '', produit || '', round2(cartons), Math.round(montant)].join('|');
function stockVentes(mode) {
  const m = new Map();
  for (const v of App.D.ventes || []) {
    if (v.statut !== 'validee' || v.mode !== mode) continue;
    const tt = venteTotals(v, App.I);
    for (const l of tt.lignes) { const k = cle(v.date, v.agent_id, v.client_id, l.produit_id, num(l.cartons), num(l.montant)); if (!m.has(k)) m.set(k, []); m.get(k).push(v); }
  }
  return m;
}

// Analyse d'une feuille TB pour un type d'import ; même format de résultat que l'import standard
export function analyseTB(type, wb, opts = {}) {
  const f = feuille(wb, FEUILLE[type]);
  if (!f) return { res: [], nomOnglet: null, manquants: null };
  const rows = lireFeuille(wb.Sheets[f]);
  const R = referentiels(opts.equipe_id);
  const out = [];
  const push = (r, msgs, payload, apercu, extra = {}) => out.push({ ligne: r._ligne, statut: msgs.length ? 'rejet' : extra.statut || 'ok', msg: msgs.join(' ; ') || extra.msg || '', payload: { ligne: r._ligne, ...payload }, apercu });
  if (type === 'ventes_comptant' || type === 'ventes_credit') {
    const mode = type === 'ventes_credit' ? 'credit' : 'comptant';
    const existants = stockVentes(mode);
    const manq = aCreer(rows, R, R.eq);
    for (const r of rows) {
      const msgs = [], notes = [];
      const date = dateSure(r.date, notes, 'Date');
      if (!date) msgs.push('Date manquante ou illisible');
      const q = toNum(r.quantite), p = toNum(r.prix);
      if (!(q > 0) || !(p > 0)) { push(r, ['Quantité ou prix manquant : ligne non reprise'], { data: {}, lignes: [] }, `${t(r.agent)} · ${t(r.client)}`); continue; }
      const ag = R.agent(r.agent), ma = R.marche(r.marche), cl = R.client(r.client), pr = R.produit(r.produit);
      const auto = opts.creer && R.eq;
      if (ag === undefined && !auto) msgs.push(`Agent inconnu : « ${t(r.agent)} »`);
      if (ma === undefined && !auto) msgs.push(`Marché inconnu : « ${t(r.marche)} »`);
      if (cl === undefined && !auto) msgs.push(`Client inconnu : « ${t(r.client)} »`);
      if (!pr) msgs.push(`Produit inconnu : « ${t(r.produit)} »`);
      if (mode === 'credit' && vide(r.client)) msgs.push('Client obligatoire pour un crédit');
      const unite = /pack/i.test(r.unite) ? 'pack' : 'carton';
      const prod = App.I.produits.get(pr);
      const lc = prod ? lineCalc(prod, unite, q, p) : { cartons: q, montant: q * p };
      const data = { date, agent_id: ag || null, marche_id: ma || null, client_id: cl || null, observation: t(r.observation) || null, ref_externe: null, _a: t(r.agent), _m: t(r.marche), _c: t(r.client) };
      if (mode === 'credit') {
        let ech = dateSure(r.promesse, notes, 'Date de promesse', true);
        if (ech && date && ech < date) { notes.push(`promesse antérieure à la vente : échéance par défaut`); ech = null; }
        data.echeance = ech;
      }
      let extra = {};
      const k = cle(date, ag, cl, pr, lc.cartons, lc.montant);
      const ex = existants.get(k);
      if (ex && ex.length) { ex.shift(); extra = { statut: 'identique', msg: 'Déjà dans la plateforme' }; }
      else if (notes.length) extra = { msg: notes.join(' ; ') };
      if (!ex?.length && (ag === undefined || ma === undefined || cl === undefined) && !msgs.length) extra.msg = [extra.msg, 'Agent, marché ou client nouveau : créé automatiquement à l’import'].filter(Boolean).join(' ; ');
      push(r, msgs, { data, lignes: [{ produit_id: pr, unite, quantite: q, prix_unitaire: p }] }, `${date ? fmtD(date) : '?'} · ${t(r.agent) || '—'} · ${t(r.client) || '—'} · ${fmtN(q)} ${unite} · ${fmtN(lc.montant)} FCFA`, extra);
    }
    return { res: out, nomOnglet: f, manquants: opts.creer ? manq : null };
  }
  if (type === 'remboursements') {
    const existants = stockVentes('credit');
    for (const r of rows) {
      const fichier = toNum(r.rembourse);
      if (!(fichier > 0)) continue;
      const msgs = [], notes = [];
      const date = dateSure(r.date, [], 'Date');
      const q = toNum(r.quantite), p = toNum(r.prix);
      const pr = R.produit(r.produit), ag = R.agent(r.agent), cl = R.client(r.client);
      const prod = App.I.produits.get(pr);
      const lc = prod && q > 0 && p > 0 ? lineCalc(prod, /pack/i.test(r.unite) ? 'pack' : 'carton', q, p) : null;
      const v = lc ? existants.get(cle(date, ag, cl, pr, lc.cartons, lc.montant))?.shift() : null;
      if (!v) { push(r, ['Vente à crédit correspondante introuvable : importez d’abord les ventes à crédit de ce fichier'], { data: {} }, `${t(r.client)} · ${fmtN(fichier)} FCFA`); continue; }
      const ci = creditInfo(v, App.I, today());
      const deja = ci.rembourse;
      const delta = round2(fichier - deja);
      if (Math.abs(delta) < 1) { push(r, [], { data: {} }, `${v.numero} · ${t(r.client)} · ${fmtN(fichier)} FCFA remboursés`, { statut: 'identique', msg: 'Remboursement déjà enregistré' }); continue; }
      if (delta < 0) { push(r, [`Le fichier indique ${fmtN(fichier)} FCFA remboursés, la plateforme ${fmtN(deja)} FCFA : à vérifier (aucune correction automatique)`], { data: {} }, `${v.numero} · ${t(r.client)}`); continue; }
      let d = dateSure(r.date_remb, notes, 'Date de remboursement');
      if (!d) { const pm = dateSure(r.promesse, [], 'Promesse', true); d = pm && pm <= today() ? pm : today(); notes.push(`date de remboursement absente : ${pm && pm <= today() ? 'date de promesse' : 'date du jour'} retenue`); }
      if (d < v.date) { notes.push('remboursement daté avant la vente : date de la vente retenue'); d = v.date; }
      push(r, msgs, { data: { vente_id: v.id, date: d, montant: delta, mode: null, reference: null, commentaire: `Import tableau de bord (cumul du fichier : ${fmtN(fichier)} FCFA)` } }, `${v.numero} · ${t(r.client)} · +${fmtN(delta)} FCFA (cumul ${fmtN(fichier)})`, { msg: notes.join(' ; ') || (deja ? `Complément : ${fmtN(deja)} FCFA déjà enregistrés` : '') });
    }
    return { res: out, nomOnglet: f, manquants: null };
  }
  if (type === 'stock_remises') {
    const dep = opts.depositaire_id;
    for (const r of rows) {
      const msgs = [];
      const date = dateSure(r.date_prise || r.date, [], 'Date');
      const q = toNum(r.quantite_prise ?? r.quantite), p = toNum(r.prix), pr = R.produit(r.produit);
      if (!date) msgs.push('Date de prise manquante');
      if (!(q > 0)) msgs.push('Quantité prise manquante');
      if (!pr) msgs.push(`Produit inconnu : « ${t(r.produit)} »`);
      if (!dep) msgs.push('Choisissez le dépositaire (gros client) au-dessus du contrôle : le fichier ne le précise pas');
      const deja = (App.D.stock_mouvements || []).some((m) => m.type === 'remise' && m.statut !== 'annule' && m.client_id === dep && m.produit_id === pr && m.date === date && Math.abs(num(m.quantite) - q) < 0.001);
      push(r, msgs, { data: { date, client_id: dep || null, produit_id: pr, quantite: q, valeur_unitaire: p, document: t(r.observation) || null } }, `${date ? fmtD(date) : '?'} · ${t(r.produit)} · ${fmtN(q)} ctn${dep ? ' · ' + nm.client(dep) : ''}`, deja ? { statut: 'identique', msg: 'Remise déjà enregistrée' } : {});
    }
    return { res: out, nomOnglet: f, manquants: null };
  }
  return { res: [], nomOnglet: f, manquants: null };
}

// Nettoyage des champs internes avant envoi au serveur
export function payloadPropre(p) {
  if (!p?.data) return p;
  const { _a, _m, _c, ...data } = p.data;
  return { ...p, data };
}

// Modèle vierge au format du tableau de bord, avec les listes de l'équipe (aucune formule)
export function modeleTB(eqId) {
  const X = window.XLSX;
  const eq = (App.D.equipes || []).find((e) => e.id === eqId);
  const ag = (App.D.agents || []).filter((a) => a.actif !== false && (!eqId || a.equipe_id === eqId));
  const ma = (App.D.marches || []).filter((m) => m.actif !== false && (!eqId || m.equipe_id === eqId || m.zone_id === eq?.zone_id));
  const code = eq?.code;
  const cl = (App.D.clients || []).filter((c) => c.actif !== false && (!code || String(c.code || '').startsWith(code + '-')));
  const pr = (App.D.produits || []).filter((p) => p.actif !== false);
  const lib = (c) => { const m = String(c.code || '').match(/-([A-Z0-9]+)$/); return m ? `Client ${m[1]} - ${/^D[ée]taillants divers/.test(c.nom) ? 'Détaillant' : c.nom}` : c.nom; };
  const n = Math.max(ag.length, ma.length, cl.length, pr.length, 2);
  const par = [['PARAMÈTRES — ORIBA FOODS'], [], ['DIRECTION', '', '', 'AGENTS COMMERCIAUX', '', '', 'MARCHÉS / VILLAGES', '', 'CLIENTS', '', '', 'PRODUITS', '', '', '', 'UNITÉS'],
    [`Chef d'équipe ${eq ? 'Axe ' + eq.nom : ''}`, eq?.responsable || '', '', 'Nom', 'Téléphone', '', 'Nom', '', 'Nom', 'Téléphone', '', 'Produit', 'Prix Carton (FCFA)', 'Prix Pack (FCFA)', '', 'Type']];
  for (let i = 0; i < n; i++) par.push([i === 0 ? "Téléphone Chef d'équipe" : '', '', '', ag[i]?.nom || '', ag[i]?.telephone || '', '', ma[i] ? 'Marché ' + ma[i].nom : '', '', cl[i] ? lib(cl[i]) : '', cl[i]?.telephone || '', '', pr[i]?.nom || '', pr[i]?.prix_ref || '', '', '', ['Carton', 'Pack'][i] || '']);
  const wb = X.utils.book_new();
  const add = (nom, aoa, w) => { const ws = X.utils.aoa_to_sheet(aoa); ws['!cols'] = (w || aoa[aoa.length - 1].map(() => 16)).map((x) => ({ wch: x })); X.utils.book_append_sheet(wb, ws, nom); };
  add('Lisez-moi', [['Tableau de bord ORIBA FOODS — modèle d’import'], [], ['1. Une ligne par vente dans « Journal Comptant » et « Journal Crédit », comme dans vos tableaux habituels.'], ['2. Dans « Journal Crédit », complétez au fur et à mesure « Montant remboursé (FCFA) » (cumul) et « Date remboursement » : la plateforme n’enregistre que la différence avec ce qu’elle connaît déjà.'], ['3. « Stock » : une ligne par remise de stock chez le gros client (le dépositaire se choisit au moment de l’import).'], ['4. Les noms d’agents, de marchés et de clients doivent être ceux de la feuille « Paramètres ». Un nouveau nom sera créé automatiquement à l’import si vous cochez l’option.'], ['5. Vous pouvez réimporter le même fichier chaque semaine : les lignes déjà présentes sont reconnues et ignorées.']], [110]);
  add('Paramètres', par, [26, 22, 3, 24, 14, 3, 26, 3, 32, 14, 3, 22, 16, 14, 3, 10]);
  add('Journal Comptant', [['JOURNAL DES VENTES AU COMPTANT'], ['Date', "Nom de l'agent", 'Marché/Village', 'Client/Acheteur', 'Produit', 'Unité', 'Quantité', 'Prix unitaire (FCFA)', 'Montant (FCFA)', 'Observation']], [12, 22, 22, 30, 20, 8, 10, 14, 14, 24]);
  add('Journal Crédit', [['JOURNAL DES VENTES À CRÉDIT'], ['Date', 'Agent', 'Marché', 'Client/Débiteur', 'Produit', 'Unité', 'Quantité', 'Prix unitaire (FCFA)', 'Montant (FCFA)', 'Date promesse', 'Montant remboursé (FCFA)', 'Date remboursement']], [12, 22, 22, 30, 20, 8, 10, 14, 14, 14, 16, 16]);
  add('Stock', [['SUIVI DU STOCK PRIS CHEZ LE GROS CLIENT'], ['Date prise', 'Produit', 'Quantité prise (cartons)', 'Prix unitaire (FCFA)', 'Valeur stock pris (FCFA)', 'Observation']], [12, 20, 16, 14, 16, 24]);
  return new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
