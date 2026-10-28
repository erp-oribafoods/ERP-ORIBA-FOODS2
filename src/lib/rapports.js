// Rapports périodiques : hebdomadaire (1 page) et mensuel (3 à 6 pages), en PDF ou en Excel.
// Toutes les données viennent de ce que l'utilisateur a le droit de voir (mêmes droits qu'à l'écran).
import { App, nm } from '../app.js';
import { esc, $, $$, modal, toast, busy, icon, saveBlob, fmtN, fmtD } from './ui.js';
import { salesFacts, rembFacts, openCredits, venteCtx, monthsBetween, moisLabel } from './facts.js';
import { alertes, plafondsClients, lots, depenseAllocations, today, addDays, num } from '../../shared/logic.js';
import { budgetsAvecRealise } from '../pages/depenses.js';
import { lignesSuivi } from '../pages/suivi.js';
import { LOGO } from '../assets/logo.js';

const N = (v, d = 0) => (v === null || v === undefined || Number.isNaN(v) ? '—' : fmtN(v, d).replace(/[  ]/g, ' '));
const P = (v) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${N(v, 0)} %`);
const pct = (a, b) => (b ? (a / b) * 100 : null);
const finMois = (m) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10); };
const decale = (m, d) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm - 1 + d, 1)).toISOString().slice(0, 7); };
const lundi = (d) => { const t = new Date(d + 'T00:00:00Z'); const k = (t.getUTCDay() + 6) % 7; return addDays(d, -k); };
const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const moisLong = (m) => `${MOIS_LONG[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const voitVentes = () => App.can('ventes') || App.can('dashboard') || App.can('creances');

function depensesPeriode(du, au, mois) {
  const ag = (App.D.depenses_agregats || []).filter((a) => mois && a.mois === mois).map((a) => ({ agrege: true, mois: a.mois, date: `${a.mois}-01`, categorie_id: a.categorie_id, equipe_id: a.equipe_id, montant: a.montant, statut: 'validee' }));
  const ds = (App.D.depenses || []).filter((d) => !['annulee', 'rejetee'].includes(d.statut) && (mois ? d.mois === mois : d.date >= du && d.date <= au));
  return [...ds, ...ag];
}

// ---------- Collecte des chiffres d'une période ----------
function collecte(du, au, mois = null) {
  const I = App.I, asOf = au < today() ? au : today();
  const R = { du, au, mois, asOf, ventes: voitVentes(), depenses: App.can('depenses'), suivi: App.can('suivi') };
  const f = { preset: 'perso', du, au };
  const sf = R.ventes ? salesFacts(I, f) : [];
  const rf = R.ventes ? rembFacts(I, f) : [];
  const credits = R.ventes ? openCredits(I, { preset: 'tout' }, asOf).filter((x) => x.v.date <= asOf) : [];
  const sum = (a, k = 'montant') => a.reduce((s, x) => s + num(typeof k === 'function' ? k(x) : x[k]), 0);
  const ouverts = credits.filter((x) => x.ci.solde > 0);
  const retard = ouverts.filter((x) => x.ci.statut === 'En retard');
  const deps = R.depenses ? depensesPeriode(du, au, mois) : [];
  const cartons = sum(sf, 'cartons');
  R.k = {
    ca: sum(sf), comptant: sum(sf.filter((x) => x.mode === 'comptant')), credit: sum(sf.filter((x) => x.mode === 'credit')), cartons,
    nbVentes: new Set(sf.map((x) => x.v.id)).size, encaisse: sum(rf), encours: sum(ouverts, (x) => x.ci.solde), cartonsDus: sum(ouverts, (x) => x.ci.cartonsRestants),
    nbRetard: retard.length, mtRetard: sum(retard, (x) => x.ci.solde), depEng: sum(deps), depVal: sum(deps.filter((d) => d.statut === 'validee')),
    depAttente: deps.filter((d) => ['soumise', 'controlee', 'a_completer', 'brouillon'].includes(d.statut)).length,
  };
  R.k.coutCarton = cartons ? R.k.depEng / cartons : null;
  // Par équipe
  const EQ = new Map();
  const e = (id) => { const k = id || '—'; if (!EQ.has(k)) EQ.set(k, { equipe: id ? nm.equipe(id) : 'Sans équipe', zone: id ? (App.I.equipes.get(id)?.zone_id ? nm.zone(App.I.equipes.get(id).zone_id) : '') : '', comptant: 0, credit: 0, cartons: 0, encaisse: 0, encours: 0, retard: 0, dep: 0 }); return EQ.get(k); };
  for (const x of sf) { const o = e(x.equipe_id); o[x.mode === 'credit' ? 'credit' : 'comptant'] += x.montant; o.cartons += x.cartons; }
  for (const x of rf) e(venteCtx(x.v, I).equipe_id).encaisse += x.montant;
  for (const x of ouverts) { const o = e(venteCtx(x.v, I).equipe_id); o.encours += x.ci.solde; if (x.ci.statut === 'En retard') o.retard++; }
  for (const d of deps) for (const a of depenseAllocations(d, I)) e(a.equipe_id).dep += a.montant;
  R.equipes = [...EQ.values()].map((o) => ({ ...o, ca: o.comptant + o.credit, cout: o.cartons ? o.dep / o.cartons : null })).sort((a, b) => b.ca - a.ca || b.dep - a.dep);
  // Agents, produits, marchés, clients
  const grp = (key, lib) => { const m = new Map(); for (const x of sf) { const k = x[key]; if (!m.has(k)) m.set(k, { id: k, nom: lib(k), ca: 0, cartons: 0, ventes: new Set(), equipe: '' }); const o = m.get(k); o.ca += x.montant; o.cartons += x.cartons; o.ventes.add(x.v.id); if (key === 'agent_id') o.equipe = nm.equipe(x.equipe_id); } return [...m.values()].map((o) => ({ ...o, nb: o.ventes.size })).sort((a, b) => b.ca - a.ca); };
  R.agents = grp('agent_id', (k) => (k ? nm.agent(k) : 'Agent non renseigné'));
  if (mois) {
    const objs = (App.D.objectifs || []).filter((o) => o.mois === mois && o.axe === 'agent' && !o.produit_id);
    for (const a of R.agents) { const o = objs.find((x) => x.cible_id === a.id); a.objQ = o ? nv(o.objectif_cartons) : null; a.objCA = o ? nv(o.objectif_ca) : null; a.taux = a.objCA ? pct(a.ca, a.objCA) : a.objQ ? pct(a.cartons, a.objQ) : null; }
  }
  R.produits = grp('produit_id', (k) => nm.produit(k));
  R.marches = grp('marche_id', (k) => (k ? nm.marche(k) : 'Non renseigné'));
  R.clients = grp('client_id', (k) => (k ? nm.client(k) : 'Clients comptant non identifiés'));
  R.retards = retard.sort((a, b) => b.ci.solde - a.ci.solde).map((x) => ({ numero: x.v.numero, client: nm.client(x.v.client_id), equipe: nm.equipe(venteCtx(x.v, I).equipe_id), date: x.v.date, echeance: x.v.echeance, solde: x.ci.solde, jours: x.ci.joursRetard }));
  R.plafonds = R.ventes ? plafondsClients(I).filter((p) => p.pct >= (I.p.seuils_plafond?.[0] || 75)).map((p) => ({ client: p.client.nom, encours: p.encours, plafond: p.plafond, pct: p.pct, fcfa: p.fcfa })) : [];
  // Dépenses par nature
  const CAT = new Map();
  for (const d of deps) { const k = d.categorie_id; if (!CAT.has(k)) CAT.set(k, { nature: nm.categorie(k), eng: 0, val: 0, nb: 0 }); const o = CAT.get(k); o.eng += num(d.montant); if (d.statut === 'validee') o.val += num(d.montant); o.nb++; }
  R.categories = [...CAT.values()].sort((a, b) => b.eng - a.eng).map((o) => ({ ...o, part: pct(o.eng, R.k.depEng), parCarton: cartons ? o.eng / cartons : null }));
  // Demandes carburant / vidange
  const dem = (App.D.demandes || []).filter((d) => d.date >= du && d.date <= au && d.statut !== 'annulee');
  R.demandes = { liste: dem, carb: dem.filter((d) => d.type === 'carburant'), vid: dem.filter((d) => d.type === 'vidange') };
  R.demandes.carbAccorde = sum(R.demandes.carb.filter((d) => d.statut === 'accordee'), 'montant_accorde');
  R.demandes.vidCout = sum(R.demandes.vid.filter((d) => d.statut === 'accordee'), 'cout_pris_en_charge');
  R.demandes.attente = dem.filter((d) => d.statut === 'soumise').length;
  // Budgets, suivi terrain, stock, alertes
  R.budgets = mois && (App.can('budgets') || R.depenses) ? budgetsAvecRealise(mois) : [];
  R.terrain = R.suivi ? lignesSuivi(mois || du.slice(0, 7)).filter((r) => r.saisi) : [];
  R.stock = App.can('stock') ? lots(I, asOf).filter((l) => l.restant > 0) : [];
  R.alertes = alertes(I, asOf, App.user.permissions);
  return R;
}
const nv = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Évolution des 6 derniers mois (rapport mensuel)
function evolution(mois) {
  return monthsBetween(`${decale(mois, -5)}-01`, `${mois}-01`).map((m) => {
    const r = collecte(`${m}-01`, finMois(m) > today() ? today() : finMois(m), m);
    return { mois: moisLabel(m), ca: r.k.ca, cartons: r.k.cartons, encaisse: r.k.encaisse, dep: r.k.depEng, cout: r.k.coutCarton, encours: r.k.encours };
  });
}

// ---------- PDF ----------
const VIOLET = [69, 48, 122], VERT = [62, 142, 65], ORANGE = [224, 123, 0], GRIS = [110, 110, 110], ENCRE = [40, 32, 70];
let logoPNG = null;
async function logo() {
  if (logoPNG) return logoPNG;
  const img = new Image(); img.src = LOGO; await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0);
  return (logoPNG = { data: c.toDataURL('image/png'), r: img.naturalWidth / img.naturalHeight });
}
async function entete(doc, titre, sousTitre) {
  const W = doc.internal.pageSize.getWidth();
  try { const L = await logo(); doc.addImage(L.data, 'PNG', 28, 14, 30 * L.r, 30, 'logo-oriba'); } catch { /* facultatif */ }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...VIOLET); doc.text(titre, W - 28, 30, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...VERT); doc.text(sousTitre, W - 28, 42, { align: 'right' });
  doc.setDrawColor(...VERT); doc.setLineWidth(1.5); doc.line(28, 50, W - 28, 50);
}
function pied(doc) {
  const n = doc.getNumberOfPages(), W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  const u = App.user;
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5); doc.setTextColor(...GRIS);
    doc.text(`ORIBA FOODS — ORIBA ERP · édité le ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' })} par ${[u.prenom, u.nom].filter(Boolean).join(' ')} (${u.role_nom || ''}) · montants en FCFA, quantités en cartons`, 28, H - 14);
    doc.text(`Page ${i} / ${n}`, W - 28, H - 14, { align: 'right' });
  }
}
function kpis(doc, x, y, w, items, h = 38) {
  const g = 6, cw = (w - g * (items.length - 1)) / items.length;
  items.forEach(([l, v, s, c], i) => {
    const xx = x + i * (cw + g);
    doc.setFillColor(246, 243, 251); doc.roundedRect(xx, y, cw, h, 3, 3, 'F');
    doc.setFillColor(...(c || VIOLET)); doc.rect(xx, y, 2.5, h, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.3); doc.setTextColor(...GRIS); doc.text(l.toUpperCase(), xx + 7, y + 10, { maxWidth: cw - 10 });
    doc.setFontSize(10.5); doc.setTextColor(...ENCRE); doc.text(String(v), xx + 7, y + 24, { maxWidth: cw - 10 });
    if (s) { doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); doc.setTextColor(...GRIS); doc.text(String(s), xx + 7, y + 33, { maxWidth: cw - 10 }); }
  });
  return y + h;
}
function titreBloc(doc, t, x, y, w, col = VIOLET) {
  doc.setFillColor(...col); doc.rect(x, y, w, 13, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255); doc.text(t, x + 4, y + 9.3);
  return y + 13;
}
function tableau(doc, { x, y, w, head, body, max, fs = 6.6, foot, col, align }) {
  const al = align || head.map((_, i) => (i === 0 ? 'left' : 'right'));
  const rows = max && body.length > max ? [...body.slice(0, max - 1), [`… et ${body.length - max + 1} autre(s)`, ...head.slice(1).map(() => '')]] : body;
  doc.autoTable({ startY: y, margin: { left: x, right: doc.internal.pageSize.getWidth() - x - w }, tableWidth: w, head: [head], body: rows.length ? rows : [[{ content: 'Aucune donnée sur la période', colSpan: head.length, styles: { textColor: GRIS, fontStyle: 'italic' } }]], foot: foot ? [foot] : undefined,
    theme: 'grid', styles: { font: 'helvetica', fontSize: fs, cellPadding: 1.8, lineColor: [225, 220, 235], lineWidth: 0.4, textColor: ENCRE, overflow: 'ellipsize' },
    headStyles: { fillColor: col || [236, 231, 246], textColor: VIOLET, fontStyle: 'bold' }, footStyles: { fillColor: [246, 243, 251], textColor: ENCRE, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(al.map((a, i) => [i, { halign: a }])), pageBreak: 'avoid', rowPageBreak: 'avoid',
    didParseCell: (d) => { if (d.section !== 'body' && d.cell.colSpan === 1) d.cell.styles.halign = al[d.column.index]; } });
  return doc.lastAutoTable.finalY;
}

// Rapport hebdomadaire : une seule page A4 paysage
async function pdfHebdo(R, lim = 1) {
  const J = window.jspdf.jsPDF; const doc = new J({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const W = doc.internal.pageSize.getWidth(), M = 28, CW = W - 2 * M;
  await entete(doc, 'RAPPORT HEBDOMADAIRE', `Semaine du ${fmtD(R.du)} au ${fmtD(R.au)} · état des créances au ${fmtD(R.asOf)}`);
  const L = (n) => Math.max(3, Math.floor(n * lim));
  let y = kpis(doc, M, 58, CW, [
    ['Chiffre d’affaires', N(R.k.ca), `${N(R.k.nbVentes)} ventes`], ['Ventes au comptant', N(R.k.comptant), '', VERT], ['Ventes à crédit', N(R.k.credit), '', ORANGE],
    ['Cartons vendus', N(R.k.cartons, 1), ''], ['Encaissements crédit', N(R.k.encaisse), '', VERT], ['Encours créances', N(R.k.encours), `${N(R.k.cartonsDus)} ctn dus`, ORANGE],
    ['Crédits en retard', N(R.k.nbRetard), `${N(R.k.mtRetard)} FCFA`, [200, 40, 60]], ['Dépenses engagées', N(R.k.depEng), R.k.coutCarton ? `${N(R.k.coutCarton)} FCFA / carton` : ''],
  ]) + 8;
  const c3 = (CW - 16) / 3;
  const y0 = y;
  let a = titreBloc(doc, 'VENTES PAR ÉQUIPE', M, y0, c3);
  a = tableau(doc, { x: M, y: a, w: c3, head: ['Équipe', 'Comptant', 'Crédit', 'Cartons', 'Encours'], body: R.equipes.filter((o) => o.ca || o.encours).map((o) => [o.equipe, N(o.comptant), N(o.credit), N(o.cartons, 1), N(o.encours)]), max: L(12),
    foot: ['Total', N(R.k.comptant), N(R.k.credit), N(R.k.cartons, 1), N(R.k.encours)] });
  let b = titreBloc(doc, 'MEILLEURS AGENTS DE LA SEMAINE', M + c3 + 8, y0, c3);
  b = tableau(doc, { x: M + c3 + 8, y: b, w: c3, head: ['Agent', 'Équipe', 'Cartons', 'CA'], body: R.agents.map((o) => [o.nom, o.equipe, N(o.cartons, 1), N(o.ca)]), max: L(12) });
  let c = titreBloc(doc, 'CRÉANCES EN RETARD (LES PLUS ÉLEVÉES)', M + 2 * (c3 + 8), y0, c3, [200, 40, 60]);
  c = tableau(doc, { x: M + 2 * (c3 + 8), y: c, w: c3, head: ['Client', 'Équipe', 'Solde', 'Jours'], body: R.retards.map((o) => [o.client, o.equipe, N(o.solde), N(o.jours)]), max: L(12) });
  y = Math.max(a, b, c) + 10;
  a = titreBloc(doc, 'DÉPENSES DE LA SEMAINE PAR NATURE', M, y, c3, ORANGE);
  a = tableau(doc, { x: M, y: a, w: c3, head: ['Nature', 'Engagé', 'Validé', 'Part'], body: R.depenses ? R.categories.map((o) => [o.nature, N(o.eng), N(o.val), P(o.part)]) : [], max: L(8), foot: R.depenses ? ['Total', N(R.k.depEng), N(R.k.depVal), ''] : undefined });
  const dm = R.demandes;
  b = titreBloc(doc, 'LOGISTIQUE : DEMANDES DE LA SEMAINE', M + c3 + 8, y, c3, ORANGE);
  b = tableau(doc, { x: M + c3 + 8, y: b, w: c3, head: ['Indicateur', 'Valeur'], body: R.depenses ? [
    ['Demandes de carburant', `${dm.carb.length} (${dm.carb.filter((d) => d.statut === 'accordee').length} accordées)`], ['Carburant accordé (FCFA)', N(dm.carbAccorde)],
    ['Demandes de vidange', `${dm.vid.length} (${dm.vid.filter((d) => d.statut === 'accordee').length} accordées)`], ['Coût des vidanges accordées', N(dm.vidCout)],
    ['Demandes en attente de décision', N(dm.attente)], ['Dépenses en attente de validation', N(R.k.depAttente)]] : [] });
  const al = R.alertes;
  const parType = [...al.reduce((m, x) => m.set(x.type, (m.get(x.type) || 0) + 1), new Map())].sort((p, q) => q[1] - p[1]);
  c = titreBloc(doc, 'POINTS D’ATTENTION', M + 2 * (c3 + 8), y, c3, [200, 40, 60]);
  c = tableau(doc, { x: M + 2 * (c3 + 8), y: c, w: c3, head: ['Alerte', 'Nombre'], body: parType.map(([t, n]) => [t, N(n)]), max: L(8) });
  return doc;
}

// Rapport mensuel : une section par page (3 à 6 pages)
async function pdfMensuel(R, EV, lim = 1) {
  const J = window.jspdf.jsPDF; const doc = new J({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), M = 28, CW = W - 2 * M, demi = (CW - 10) / 2;
  const L = (n) => Math.max(4, Math.floor(n * lim));
  const st = `${moisLong(R.mois).replace(/^./, (c) => c.toUpperCase())} · du ${fmtD(R.du)} au ${fmtD(R.au)}`;
  let page = 0;
  const nouvelle = async (t) => { if (page++) doc.addPage(); await entete(doc, `RAPPORT MENSUEL — ${t}`, st); return 60; };
  const P0 = R.precedent;
  // 1. Synthèse
  let y = await nouvelle('SYNTHÈSE');
  y = kpis(doc, M, y, CW, [['Chiffre d’affaires', N(R.k.ca), `${N(R.k.nbVentes)} ventes`], ['Cartons vendus', N(R.k.cartons, 1), ''], ['Encaissements', N(R.k.encaisse), '', VERT], ['Encours fin de mois', N(R.k.encours), `${N(R.k.nbRetard)} en retard`, ORANGE]]) + 6;
  y = kpis(doc, M, y, CW, [['Dépenses engagées', N(R.k.depEng), `${N(R.k.depVal)} validées`, ORANGE], ['Coût par carton', R.k.coutCarton ? N(R.k.coutCarton) : '—', 'dépenses ÷ cartons vendus'], ['Agents suivis', N(R.terrain.length), R.terrain.length ? `note moyenne ${N(R.terrain.filter((t) => t.note !== null).reduce((s, t) => s + t.note, 0) / (R.terrain.filter((t) => t.note !== null).length || 1), 1)}/10` : ''], ['Alertes ouvertes', N(R.alertes.length), `${R.alertes.filter((a) => a.sev === 'crit').length} critiques`, [200, 40, 60]]]) + 12;
  y = titreBloc(doc, 'COMPARAISON AVEC LE MOIS PRÉCÉDENT', M, y, CW);
  const lig = (l, a, b, d = 0) => [l, N(a, d), N(b, d), a !== null && b !== null ? `${a - b >= 0 ? '+' : ''}${N(a - b, d)}` : '—', b ? P(((a - b) / Math.abs(b)) * 100) : '—'];
  y = tableau(doc, { x: M, y, w: CW, head: ['Indicateur', moisLabel(R.mois), moisLabel(P0.mois), 'Écart', 'Variation'], body: [
    lig('Chiffre d’affaires (FCFA)', R.k.ca, P0.k.ca), lig('dont comptant', R.k.comptant, P0.k.comptant), lig('dont crédit', R.k.credit, P0.k.credit), lig('Cartons vendus', R.k.cartons, P0.k.cartons, 1),
    lig('Encaissements sur crédits', R.k.encaisse, P0.k.encaisse), lig('Encours des créances', R.k.encours, P0.k.encours), lig('Crédits en retard (nombre)', R.k.nbRetard, P0.k.nbRetard),
    lig('Dépenses engagées', R.k.depEng, P0.k.depEng), lig('Coût par carton', R.k.coutCarton, P0.k.coutCarton)], fs: 7.5 }) + 12;
  y = titreBloc(doc, 'ÉVOLUTION SUR 6 MOIS', M, y, CW);
  tableau(doc, { x: M, y, w: CW, head: ['Mois', 'Chiffre d’affaires', 'Cartons', 'Encaissements', 'Dépenses', 'Coût / carton', 'Encours fin de mois'], body: EV.map((e) => [e.mois, N(e.ca), N(e.cartons, 1), N(e.encaisse), N(e.dep), e.cout ? N(e.cout) : '—', N(e.encours)]), fs: 7.5 });
  // 2. Ventes
  if (R.ventes) {
    y = await nouvelle('VENTES');
    y = titreBloc(doc, 'VENTES PAR ÉQUIPE', M, y, CW);
    y = tableau(doc, { x: M, y, w: CW, head: ['Équipe', 'Zone', 'Comptant', 'Crédit', 'Total', 'Cartons', 'Encaissé', 'Encours'], body: R.equipes.filter((o) => o.ca || o.encours).map((o) => [o.equipe, o.zone, N(o.comptant), N(o.credit), N(o.ca), N(o.cartons, 1), N(o.encaisse), N(o.encours)]), max: L(14),
      foot: ['Total', '', N(R.k.comptant), N(R.k.credit), N(R.k.ca), N(R.k.cartons, 1), N(R.k.encaisse), N(R.k.encours)], align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'] }) + 10;
    const y1 = y;
    let a = titreBloc(doc, 'PAR PRODUIT', M, y1, demi);
    a = tableau(doc, { x: M, y: a, w: demi, head: ['Produit', 'Cartons', 'CA', 'Part'], body: R.produits.map((o) => [o.nom, N(o.cartons, 1), N(o.ca), P(pct(o.ca, R.k.ca))]), max: L(6) });
    let b = titreBloc(doc, 'MARCHÉS LES PLUS ACTIFS', M + demi + 10, y1, demi);
    b = tableau(doc, { x: M + demi + 10, y: b, w: demi, head: ['Marché', 'Cartons', 'CA'], body: R.marches.map((o) => [o.nom, N(o.cartons, 1), N(o.ca)]), max: L(14) });
    y = Math.max(a, b) + 10;
    y = titreBloc(doc, 'PRINCIPAUX CLIENTS', M, y, CW);
    tableau(doc, { x: M, y, w: CW, head: ['Client', 'Ventes', 'Cartons', 'CA', 'Part du CA'], body: R.clients.map((o) => [o.nom, N(o.nb), N(o.cartons, 1), N(o.ca), P(pct(o.ca, R.k.ca))]), max: L(14) });
  }
  // 3. Force de vente
  if (R.ventes || R.terrain.length) {
    y = await nouvelle('FORCE DE VENTE');
    if (R.ventes) {
    y = titreBloc(doc, 'AGENTS : RÉALISATIONS ET OBJECTIFS DU MOIS', M, y, CW);
    y = tableau(doc, { x: M, y, w: CW, head: ['Agent', 'Équipe', 'Ventes', 'Cartons', 'CA', 'Objectif ctn', 'Objectif FCFA', 'Atteinte'], body: R.agents.map((o) => [o.nom, o.equipe, N(o.nb), N(o.cartons, 1), N(o.ca), o.objQ !== null && o.objQ !== undefined ? N(o.objQ) : '—', o.objCA ? N(o.objCA) : '—', P(o.taux)]), max: L(R.terrain.length ? 22 : 40), align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'] }) + 10;
    }
    if (R.terrain.length) {
      y = titreBloc(doc, 'SUIVI DES AGENTS TERRAIN (PRÉSENCE, DÉSTOCKAGE, ÉVALUATION)', M, y, CW, VERT);
      tableau(doc, { x: M, y, w: CW, head: ['Agent', 'Équipe', 'Présence', 'Retards', 'Abs. NJ', 'Déstock.', 'Obj. déstock.', 'Nouv. clients', 'Note', 'Prime'], body: R.terrain.sort((p, q) => (q.note ?? -1) - (p.note ?? -1)).map((t) => [t.nom, t.equipe, P(t.presence), N(t.retards), N(t.abs_nj), N(t.destock, 1), N(t.objD, 1), N(t.nc), t.note === null ? '—' : N(t.note, 1), t.prime ? N(t.prime) : '—']), max: L(18), align: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'] });
    }
  }
  // 4. Créances
  if (R.ventes) {
    y = await nouvelle('CRÉANCES ET RECOUVREMENT');
    y = kpis(doc, M, y, CW, [['Encours au ' + fmtD(R.asOf), N(R.k.encours), `${N(R.k.cartonsDus)} cartons dus`, ORANGE], ['Crédits en retard', N(R.k.nbRetard), `${N(R.k.mtRetard)} FCFA`, [200, 40, 60]], ['Encaissé dans le mois', N(R.k.encaisse), '', VERT], ['Taux de recouvrement du mois', P(pct(R.k.encaisse, R.k.credit)), 'encaissé ÷ crédits du mois']]) + 12;
    y = titreBloc(doc, 'CRÉANCES EN RETARD', M, y, CW, [200, 40, 60]);
    y = tableau(doc, { x: M, y, w: CW, head: ['N° vente', 'Client', 'Équipe', 'Date', 'Échéance', 'Solde', 'Jours de retard'], body: R.retards.map((o) => [o.numero, o.client, o.equipe, fmtD(o.date), fmtD(o.echeance), N(o.solde), N(o.jours)]), max: L(22), align: ['left', 'left', 'left', 'left', 'left', 'right', 'right'] }) + 10;
    y = titreBloc(doc, 'CLIENTS PROCHES OU AU-DELÀ DU PLAFOND', M, y, CW, ORANGE);
    tableau(doc, { x: M, y, w: CW, head: ['Client', 'Encours (ctn)', 'Plafond (ctn)', 'Utilisation', 'Encours FCFA'], body: R.plafonds.map((p) => [p.client, N(p.encours, 1), N(p.plafond), P(p.pct), N(p.fcfa)]), max: L(12) });
  }
  // 5. Dépenses et logistique
  if (R.depenses) {
    y = await nouvelle('DÉPENSES ET LOGISTIQUE');
    y = titreBloc(doc, 'CHARGES DU MOIS PAR NATURE', M, y, CW, ORANGE);
    y = tableau(doc, { x: M, y, w: CW, head: ['Nature', 'Engagé', 'Validé', 'Part', 'FCFA par carton', 'Mois précédent (engagé)'], body: R.categories.map((o) => [o.nature, N(o.eng), N(o.val), P(o.part), o.parCarton ? N(o.parCarton, 1) : '—', N(P0.categories.find((x) => x.nature === o.nature)?.eng || 0)]), max: L(15),
      foot: ['Dépenses totales', N(R.k.depEng), N(R.k.depVal), '100 %', R.k.coutCarton ? N(R.k.coutCarton, 1) : '—', N(P0.k.depEng)] }) + 10;
    y = titreBloc(doc, 'COÛT PAR CARTON PAR ÉQUIPE', M, y, CW, ORANGE);
    y = tableau(doc, { x: M, y, w: CW, head: ['Équipe', 'Dépenses', 'Cartons vendus', 'Coût par carton'], body: R.equipes.filter((o) => o.dep || o.cartons).sort((p, q) => q.dep - p.dep).map((o) => [o.equipe, N(o.dep), N(o.cartons, 1), o.cout ? N(o.cout) : '—']), max: L(12) }) + 10;
    const y1 = y;
    let a = titreBloc(doc, 'BUDGETS DU MOIS', M, y1, demi);
    a = tableau(doc, { x: M, y: a, w: demi, head: ['Périmètre', 'Budget', 'Réalisé', 'Taux'], body: R.budgets.map((b) => [b.perimetre, N(b.montant), N(b.real), P(b.pct)]), max: L(8) });
    const dm = R.demandes;
    let b = titreBloc(doc, 'DEMANDES CARBURANT ET VIDANGE', M + demi + 10, y1, demi);
    b = tableau(doc, { x: M + demi + 10, y: b, w: demi, head: ['Indicateur', 'Valeur'], body: [['Demandes de carburant', `${dm.carb.length} (${dm.carb.filter((d) => d.statut === 'accordee').length} accordées)`], ['Carburant accordé (FCFA)', N(dm.carbAccorde)], ['Demandes de vidange', `${dm.vid.length} (${dm.vid.filter((d) => d.statut === 'accordee').length} accordées)`], ['Coût des vidanges accordées', N(dm.vidCout)], ['En attente de décision', N(dm.attente)], ['Dépenses en attente de validation', N(R.k.depAttente)]] });
  }
  // 6. Points d'attention
  y = await nouvelle('POINTS D’ATTENTION');
  const parType = [...R.alertes.reduce((m, x) => m.set(x.type, (m.get(x.type) || 0) + 1), new Map())].sort((p, q) => q[1] - p[1]);
  y = titreBloc(doc, 'ALERTES PAR TYPE', M, y, CW, [200, 40, 60]);
  y = tableau(doc, { x: M, y, w: CW, head: ['Type d’alerte', 'Nombre'], body: parType.map(([t, n]) => [t, N(n)]) }) + 10;
  y = titreBloc(doc, 'DÉTAIL DES ALERTES CRITIQUES', M, y, CW, [200, 40, 60]);
  y = tableau(doc, { x: M, y, w: CW, head: ['Type', 'Détail'], body: R.alertes.filter((a) => a.sev === 'crit').map((a) => [a.type, a.msg]), max: L(20), align: ['left', 'left'] }) + 10;
  if (R.stock.length) { y = titreBloc(doc, 'STOCK CONFIÉ RESTANT CHEZ LES DÉPOSITAIRES', M, y, CW); tableau(doc, { x: M, y, w: CW, head: ['Dépositaire', 'Produit', 'Remis le', 'Restant (ctn)'], body: R.stock.map((l) => [nm.client(l.client_id), nm.produit(l.produit_id), fmtD(l.date), N(l.restant, 1)]), max: L(8) }); }
  return doc;
}

// ---------- Excel ----------
function excel(R, type, EV) {
  const X = window.XLSX; const wb = X.utils.book_new();
  const add = (nom, rows, widths) => { const ws = X.utils.aoa_to_sheet(rows); ws['!cols'] = (widths || rows[0].map(() => 16)).map((w) => ({ wch: w })); X.utils.book_append_sheet(wb, ws, nom.slice(0, 31)); };
  const titre = type === 'hebdo' ? `Rapport hebdomadaire du ${fmtD(R.du)} au ${fmtD(R.au)}` : `Rapport mensuel — ${moisLong(R.mois)}`;
  add('Synthèse', [[`ORIBA FOODS — ${titre}`], [`Édité le ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' })}`], [],
    ['Indicateur', 'Valeur'], ['Chiffre d’affaires (FCFA)', R.k.ca], ['Ventes au comptant', R.k.comptant], ['Ventes à crédit', R.k.credit], ['Nombre de ventes', R.k.nbVentes], ['Cartons vendus', R.k.cartons],
    ['Encaissements sur crédits', R.k.encaisse], ['Encours des créances', R.k.encours], ['Cartons dus', R.k.cartonsDus], ['Crédits en retard', R.k.nbRetard], ['Montant en retard', R.k.mtRetard],
    ['Dépenses engagées', R.k.depEng], ['Dépenses validées', R.k.depVal], ['Coût par carton', R.k.coutCarton ?? ''], ['Dépenses en attente de validation', R.k.depAttente], ['Alertes ouvertes', R.alertes.length]], [34, 18]);
  if (EV) add('Évolution 6 mois', [['Mois', 'CA', 'Cartons', 'Encaissements', 'Dépenses', 'Coût par carton', 'Encours'], ...EV.map((e) => [e.mois, e.ca, e.cartons, e.encaisse, e.dep, e.cout ?? '', e.encours])]);
  if (R.ventes) {
    add('Ventes par équipe', [['Équipe', 'Zone', 'Comptant', 'Crédit', 'Total', 'Cartons', 'Encaissé', 'Encours', 'Crédits en retard', 'Dépenses', 'Coût par carton'], ...R.equipes.map((o) => [o.equipe, o.zone, o.comptant, o.credit, o.ca, o.cartons, o.encaisse, o.encours, o.retard, o.dep, o.cout ?? ''])]);
    add('Agents', [['Agent', 'Équipe', 'Ventes', 'Cartons', 'CA', ...(R.mois ? ['Objectif cartons', 'Objectif FCFA', 'Atteinte %'] : [])], ...R.agents.map((o) => [o.nom, o.equipe, o.nb, o.cartons, o.ca, ...(R.mois ? [o.objQ ?? '', o.objCA ?? '', o.taux === null || o.taux === undefined ? '' : Math.round(o.taux)] : [])])]);
    add('Produits', [['Produit', 'Ventes', 'Cartons', 'CA'], ...R.produits.map((o) => [o.nom, o.nb, o.cartons, o.ca])]);
    add('Marchés', [['Marché', 'Ventes', 'Cartons', 'CA'], ...R.marches.map((o) => [o.nom, o.nb, o.cartons, o.ca])]);
    add('Clients', [['Client', 'Ventes', 'Cartons', 'CA'], ...R.clients.map((o) => [o.nom, o.nb, o.cartons, o.ca])]);
    add('Créances en retard', [['N° vente', 'Client', 'Équipe', 'Date', 'Échéance', 'Solde', 'Jours de retard'], ...R.retards.map((o) => [o.numero, o.client, o.equipe, fmtD(o.date), fmtD(o.echeance), o.solde, o.jours])]);
    add('Plafonds clients', [['Client', 'Encours (ctn)', 'Plafond (ctn)', 'Utilisation %', 'Encours FCFA'], ...R.plafonds.map((p) => [p.client, p.encours, p.plafond, Math.round(p.pct), p.fcfa])]);
  }
  if (R.depenses) {
    add('Dépenses par nature', [['Nature', 'Nombre', 'Engagé', 'Validé', 'Part %', 'FCFA par carton'], ...R.categories.map((o) => [o.nature, o.nb, o.eng, o.val, o.part === null ? '' : Math.round(o.part), o.parCarton ?? ''])]);
    if (R.budgets.length) add('Budgets', [['Périmètre', 'Budget', 'Réalisé', 'Taux %'], ...R.budgets.map((b) => [b.perimetre, b.montant, b.real, Math.round(b.pct || 0)])]);
    add('Demandes carb. vidange', [['N°', 'Type', 'Date', 'Équipe', 'Véhicule', 'Km', 'Demandé', 'Accordé / coût', 'Statut', 'Demandeur'], ...R.demandes.liste.map((d) => [d.numero, d.type, fmtD(d.date), nm.equipe(d.equipe_id), nm.vehicule(d.vehicule_id), num(d.km_actuel), d.montant_demande ?? '', d.type === 'carburant' ? d.montant_accorde ?? '' : d.cout_pris_en_charge ?? '', d.statut, d.demandeur_nom || ''])]);
  }
  if (R.terrain.length) add('Agents terrain', [['Agent', 'Équipe', 'Jours présents', 'Retards', 'Abs. justifiées', 'Abs. non justifiées', 'Présence %', 'Déstockage', 'Objectif déstockage', 'Visites', 'Nouveaux clients', 'PLV', 'Note /10', 'Prime'], ...R.terrain.map((t) => [t.nom, t.equipe, t.jp ?? '', t.retards ?? '', t.abs_j ?? '', t.abs_nj ?? '', t.presence === null ? '' : Math.round(t.presence), t.destock ?? '', t.objD ?? '', t.visites ?? '', t.nc ?? '', t.plv ?? '', t.note ?? '', t.prime || ''])]);
  add('Alertes', [['Gravité', 'Type', 'Détail'], ...R.alertes.map((a) => [{ crit: 'Critique', warn: 'Attention', info: 'Information' }[a.sev] || a.sev, a.type, a.msg])], [12, 26, 90]);
  return new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---------- Génération et fenêtre de choix ----------
export async function genererRapport(type, ref, format) {
  if (format === 'pdf' && !window.jspdf?.jsPDF) throw new Error('Module PDF non chargé : vérifiez la connexion puis réessayez.');
  if (format === 'xlsx' && !window.XLSX) throw new Error('Module Excel non chargé : vérifiez la connexion puis réessayez.');
  let R, EV = null, nom;
  if (type === 'hebdo') {
    const du = lundi(ref), au = addDays(du, 6);
    R = collecte(du, au);
    nom = `Rapport_hebdomadaire_ORIBA_${du}_au_${au}`;
  } else {
    const mois = ref.slice(0, 7), fin = finMois(mois);
    R = collecte(`${mois}-01`, fin > today() ? today() : fin, mois);
    const pm = decale(mois, -1); R.precedent = collecte(`${pm}-01`, finMois(pm), pm); R.precedent.mois = pm;
    EV = evolution(mois);
    nom = `Rapport_mensuel_ORIBA_${mois}`;
  }
  if (format === 'xlsx') { await saveBlob(`${nom}.xlsx`, excel(R, type, EV)); return { pages: null }; }
  // Respect du format : 1 page (hebdomadaire), 6 pages au plus (mensuel) — on réduit les listes si besoin
  let doc;
  for (const lim of [1, 0.8, 0.6, 0.45, 0.3]) {
    doc = type === 'hebdo' ? await pdfHebdo(R, lim) : await pdfMensuel(R, EV, lim);
    if (doc.getNumberOfPages() <= (type === 'hebdo' ? 1 : 6)) break;
  }
  pied(doc);
  const pages = doc.getNumberOfPages();
  await saveBlob(`${nom}.pdf`, doc.output('blob'));
  return { pages };
}

export function ouvrirRapports(type0 = 'hebdo') {
  const t = today();
  modal({ title: 'Rapports périodiques', wide: true,
    body: `<div class="seg" role="group" id="rp-type"><button data-t="hebdo" class="${type0 === 'hebdo' ? 'on' : ''}">Rapport hebdomadaire (1 page)</button><button data-t="mensuel" class="${type0 === 'mensuel' ? 'on' : ''}">Rapport mensuel (3 à 6 pages)</button></div>
      <div class="filters" style="margin-top:12px"><label class="ff" id="rp-w"><span>Semaine contenant le</span><input type="date" id="rp-date" value="${t}"></label>
      <label class="ff" id="rp-m" hidden><span>Mois</span><input type="month" id="rp-mois" value="${t.slice(0, 7)}"></label></div>
      <p class="muted small" id="rp-desc"></p>
      <ul class="small rp-list" id="rp-cont"></ul>`,
    footer: `<button class="btn ghost" data-close>Fermer</button><button class="btn" id="rp-xlsx">${icon('download')} Excel</button><button class="btn primary" id="rp-pdf">${icon('download')} PDF</button>`,
    onMount: (m) => {
      let type = type0;
      const maj = () => {
        $$('[data-t]', m).forEach((b) => b.classList.toggle('on', b.dataset.t === type));
        $('#rp-w', m).hidden = type !== 'hebdo'; $('#rp-m', m).hidden = type === 'hebdo';
        if (type === 'hebdo') { const du = lundi($('#rp-date', m).value || t); $('#rp-desc', m).textContent = `Semaine du ${fmtD(du)} au ${fmtD(addDays(du, 6))}, regroupée sur une seule page A4 (paysage).`; }
        else $('#rp-desc', m).textContent = `${moisLong($('#rp-mois', m).value || t.slice(0, 7))} : une rubrique par page, 6 pages au maximum, avec comparaison au mois précédent et évolution sur 6 mois.`;
        const items = type === 'hebdo'
          ? ['Chiffre d’affaires, comptant, crédit, cartons, encaissements, encours, retards, dépenses', 'Ventes par équipe', 'Meilleurs agents', 'Créances en retard', 'Dépenses par nature', 'Demandes de carburant et de vidange', 'Points d’attention (alertes)']
          : ['Page 1 — Synthèse : indicateurs, comparaison au mois précédent, évolution sur 6 mois', 'Page 2 — Ventes : par équipe, produit, marché, principaux clients', 'Page 3 — Force de vente : agents et objectifs, suivi des agents terrain', 'Page 4 — Créances et recouvrement : retards, plafonds', 'Page 5 — Dépenses et logistique : charges par nature, coût par carton par équipe, budgets, demandes carburant et vidange', 'Page 6 — Points d’attention : alertes, stock confié'];
        $('#rp-cont', m).innerHTML = items.map((x) => `<li>${esc(x)}</li>`).join('') + '<li class="muted">L’Excel reprend les mêmes rubriques avec toutes les lignes, une feuille par rubrique.</li>';
      };
      $$('[data-t]', m).forEach((b) => b.addEventListener('click', () => { type = b.dataset.t; maj(); }));
      $('#rp-date', m).addEventListener('change', maj); $('#rp-mois', m).addEventListener('change', maj);
      maj();
      const go = (fmt) => (ev) => busy(ev.currentTarget, async () => {
        try {
          const r = await genererRapport(type, type === 'hebdo' ? $('#rp-date', m).value || t : `${$('#rp-mois', m).value || t.slice(0, 7)}-01`, fmt);
          toast(fmt === 'pdf' ? `Rapport PDF généré (${r.pages} page${r.pages > 1 ? 's' : ''}).` : 'Rapport Excel généré.');
        } catch (e) { toast(e.message, 'err'); }
      });
      $('#rp-pdf', m.parentElement).addEventListener('click', go('pdf'));
      $('#rp-xlsx', m.parentElement).addEventListener('click', go('xlsx'));
    } });
}
