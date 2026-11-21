// Vente de mayonnaise — équipe de nuit (Mayonnaise Oriba, Mayonnaise Aïda, Mayonnaise Délice).
// Fiches journalières (stock initial, packs vendus comptant / crédit, stock final, montants), visites des vendeurs
// (prise de commande, marques présentes = présence des concurrents), objectifs mensuels, import du classeur de suivi.
import { App } from '../app.js';
import { esc, $, $$, fmtN, fmtF, fmtD, Table, chart, modal, confirmBox, toast, showErr, busy, icon } from '../lib/ui.js';
import { today, num, estVerrouille } from '../../shared/logic.js';
import { MAYO_PRODUITS, MAYO_MARQUES, MAYO_AXES } from '../../shared/schema.js';

const COUL = { oriba: '#C00000', aida: '#1F4E79', delice: '#548235' };
const LEADERS = new Set(['CHAMPION', 'BISTROS']);
const NOUS = new Set(MAYO_MARQUES.filter((m) => m.nous).map((m) => m.k));
const libMarque = (k) => MAYO_MARQUES.find((m) => m.k === k)?.l || k.charAt(0) + k.slice(1).toLowerCase();
const libProduit = (k) => MAYO_PRODUITS.find((p) => p.k === k)?.l || k;
const prix = (k) => num(App.I.p[MAYO_PRODUITS.find((p) => p.k === k)?.prix]);
const sum = (l, f) => l.reduce((s, x) => s + num(typeof f === 'function' ? f(x) : x[f]), 0);
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const libMois = (m) => `${MOIS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const carte = (lib, val, cls, sous = '') => `<div class="tbc ${cls}"><span class="tbc-l">${lib}</span><span class="tbc-v">${val}</span>${sous ? `<span class="tbc-s">${sous}</span>` : ''}</div>`;
const peutSaisir = () => App.can('mayo', 'creer');
const lundi = (d) => { const x = new Date(d + 'T12:00:00Z'); const j = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - j); return x.toISOString().slice(0, 10); };
const cle = (d, g) => (g === 'mois' ? d.slice(0, 7) : g === 'semaine' ? lundi(d) : d);
const libCle = (k, g) => (g === 'mois' ? libMois(k) : g === 'semaine' ? `Sem. du ${k.slice(8, 10)}/${k.slice(5, 7)}` : `${k.slice(8, 10)}/${k.slice(5, 7)}`);
function periodes(du, au, g) {
  const out = []; const d = new Date(du + 'T12:00:00Z'), fin = new Date(au + 'T12:00:00Z');
  for (; d <= fin; d.setUTCDate(d.getUTCDate() + 1)) { const k = cle(d.toISOString().slice(0, 10), g); if (out[out.length - 1] !== k) out.push(k); }
  return out.slice(-120);
}

// Fiches validées enrichies de leurs lignes
function fiches() {
  const parFiche = new Map();
  for (const l of App.D.mayo_lignes || []) { if (!parFiche.has(l.fiche_id)) parFiche.set(l.fiche_id, []); parFiche.get(l.fiche_id).push(l); }
  return (App.D.mayo_fiches || []).map((f) => {
    const lignes = (parFiche.get(f.id) || []).map((l) => ({ ...l, vendu: num(l.vendu_comptant) + num(l.vendu_credit), final: num(l.stock_initial) - num(l.vendu_comptant) - num(l.vendu_credit), mc: num(l.vendu_comptant) * num(l.prix), mk: num(l.vendu_credit) * num(l.prix) }));
    return { ...f, lignes, si: sum(lignes, 'stock_initial'), vendu: sum(lignes, 'vendu'), vc: sum(lignes, 'vendu_comptant'), vk: sum(lignes, 'vendu_credit'), final: sum(lignes, 'final'), mc: sum(lignes, 'mc'), mk: sum(lignes, 'mk'), total: sum(lignes, 'mc') + sum(lignes, 'mk') };
  });
}
const visites = () => (App.D.mayo_visites || []).map((v) => ({ ...v, marques: Array.isArray(v.marques) ? v.marques : typeof v.marques === 'string' ? JSON.parse(v.marques || '[]') : [] }));
const vendeursConnus = () => [...new Set([...(App.D.mayo_fiches || []).map((f) => f.vendeur), ...(App.D.mayo_visites || []).map((v) => v.agent)].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));

const F = () => (App.filters.mayo = App.filters.mayo || { o: 'tb', du: '', au: today(), g: 'jour', produit: '', axe: '', vendeur: '' });

export function renderMayo(root) {
  const f = F();
  const tabs = [['tb', 'Tableau de bord'], ['fiches', 'Saisie journalière'], ['visites', 'Visites et concurrence'], ['objectifs', 'Objectifs mensuels'], ...(peutSaisir() ? [['import', 'Import du classeur']] : [])];
  if (!tabs.some((t) => t[0] === f.o)) f.o = 'tb';
  root.innerHTML = `<section class="tb-band mayo-band"><h2>Vente de mayonnaise · équipe de nuit</h2><p>Mayonnaise Oriba (${fmtF(prix('oriba'))} le pack), Mayonnaise Aïda (${fmtF(prix('aida'))}), Mayonnaise Délice (${fmtF(prix('delice'))}) — stocks, ventes au comptant et à crédit, visites des vendeurs et présence des concurrents.</p></section>
    <div class="seg onglets" role="tablist">${tabs.map(([k, l]) => `<button data-o="${k}" class="${f.o === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="my-host"></div>`;
  $$('[data-o]', root).forEach((b) => b.addEventListener('click', () => { f.o = b.dataset.o; renderMayo(root); }));
  const host = $('#my-host', root);
  ({ tb: tableauDeBord, fiches: ongletFiches, visites: ongletVisites, objectifs: ongletObjectifs, import: ongletImport })[f.o](host);
}

// ---------------------------------------------------------------- Tableau de bord
function tableauDeBord(root) {
  const f = F();
  const FI = fiches().filter((x) => x.statut !== 'annulee'), VI = visites().filter((v) => v.statut !== 'annulee');
  const premiere = [...FI.map((x) => x.date), ...VI.map((v) => v.date)].reduce((m, d) => (d < m ? d : m), today());
  const vend = vendeursConnus();
  root.innerHTML = `<div class="filters per-bar">
      <label class="ff"><span>Période du</span><input type="date" id="m-du" value="${f.du || premiere}" max="${today()}"></label>
      <label class="ff"><span>au</span><input type="date" id="m-au" value="${f.au}" max="${today()}"></label>
      <label class="ff"><span>Produit</span><select id="m-pr"><option value="">Les 3 mayonnaises</option>${MAYO_PRODUITS.map((p) => `<option value="${p.k}" ${f.produit === p.k ? 'selected' : ''}>${p.l}</option>`).join('')}</select></label>
      <label class="ff"><span>Axe</span><select id="m-ax"><option value="">Tous les axes</option>${MAYO_AXES.map((a) => `<option ${f.axe === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
      <label class="ff"><span>Vendeur</span><select id="m-vd"><option value="">Tous</option>${vend.map((a) => `<option ${f.vendeur === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
      <div class="seg" id="m-g">${[['jour', 'Par jour'], ['semaine', 'Par semaine'], ['mois', 'Par mois']].map(([k, l]) => `<button data-g="${k}" class="${f.g === k ? 'on' : ''}" type="button">${l}</button>`).join('')}</div>
      <button class="btn ghost" id="m-tout" type="button">Toute la période</button></div>
    <section class="tbc-grid" id="m-k1"></section>
    <section class="tbc-grid ctrl" id="m-k2"></section>
    <div class="grid2"><article class="card"><header><h3>Évolution des ventes (FCFA)</h3><span class="muted small" id="m-gl1"></span></header><div class="cv h300"><canvas id="m-g1"></canvas></div></article>
      <article class="card"><header><h3>Packs vendus</h3><span class="muted small" id="m-gl2"></span></header><div class="cv h300"><canvas id="m-g2"></canvas></div></article></div>
    <article class="card tb-sec rouge"><header><h3>Présence des marques chez les vendeurs visités</h3><span class="muted small">part des points de vente où la marque est présente — Champion et Bistro, leaders du marché, en rouge</span></header>
      <div class="grid2 flat"><div class="cv h340"><canvas id="m-g3"></canvas></div><div class="cv h340"><canvas id="m-g4"></canvas></div></div><div id="m-pres"></div></article>
    <div class="grid2"><article class="card"><header><h3>Présence des marques par axe</h3><span class="muted small">nombre de points de vente</span></header><div class="cv h300"><canvas id="m-g5"></canvas></div></article>
      <article class="card"><header><h3>Visites et prises de commande</h3><span class="muted small" id="m-gl6"></span></header><div class="cv h300"><canvas id="m-g6"></canvas></div></article></div>
    <div class="grid2"><article class="card"><header><h3>Objectif du mois et réalisé</h3><span class="muted small" id="m-gl7"></span></header><div class="cv h300"><canvas id="m-g7"></canvas></div></article>
      <article class="card"><header><h3>Stock initial, vendu et stock final</h3><span class="muted small">packs, sur la période</span></header><div class="cv h300"><canvas id="m-g8"></canvas></div></article></div>
    <article class="card tb-sec bleu"><header><h3>Ventes par produit</h3></header><div id="m-tp"></div></article>
    <article class="card tb-sec marine"><header><h3>Évolution détaillée</h3></header><div id="m-te"></div></article>
    <div class="grid2"><article class="card tb-sec ambre"><header><h3>Pourquoi les vendeurs ne prennent pas</h3></header><div id="m-mot"></div></article>
      <article class="card tb-sec vert"><header><h3>Vendeurs à relancer</h3></header><div id="m-rel"></div></article></div>
    <article class="card tb-sec violet"><header><h3>Observations et réactions du terrain</h3></header><div id="m-obs"></div></article>`;
  const draw = () => {
    const d0 = f.du || premiere, du = d0 <= f.au ? d0 : f.au, au = d0 <= f.au ? f.au : d0;
    const okF = (x) => x.date >= du && x.date <= au && (!f.axe || x.axe === f.axe) && (!f.vendeur || x.vendeur === f.vendeur);
    const fp = FI.filter(okF);
    const lignes = fp.flatMap((x) => x.lignes.map((l) => ({ ...l, date: x.date, vendeur: x.vendeur }))).filter((l) => !f.produit || l.produit === f.produit);
    const vp = VI.filter((v) => v.date >= du && v.date <= au && (!f.axe || v.axe === f.axe) && (!f.vendeur || v.agent === f.vendeur));
    const prises = vp.filter((v) => v.prise).length;
    const ca = sum(lignes, (l) => l.mc + l.mk);
    // Stock final : dernière fiche de chaque vendeur sur la période
    const derniere = new Map(); for (const x of fp) { const d = derniere.get(x.vendeur); if (!d || x.date > d.date) derniere.set(x.vendeur, x); }
    const stockFinal = sum([...derniere.values()].flatMap((x) => x.lignes).filter((l) => !f.produit || l.produit === f.produit), 'final');
    const moisCourant = au.slice(0, 7);
    const objs = (App.D.mayo_objectifs || []).filter((o) => o.mois === moisCourant);
    const objPacks = sum(objs.filter((o) => o.produit !== 'visites' && (!f.produit || o.produit === f.produit)), 'objectif');
    const realMois = sum(FI.filter((x) => x.date.startsWith(moisCourant) && (!f.axe || x.axe === f.axe) && (!f.vendeur || x.vendeur === f.vendeur)).flatMap((x) => x.lignes).filter((l) => !f.produit || l.produit === f.produit), 'vendu');
    const taux = objPacks ? (realMois / objPacks) * 100 : null;
    $('#m-k1', root).innerHTML = [
      carte('Packs vendus', fmtN(sum(lignes, 'vendu')), 'marine', `${fmtN(fp.length)} fiche(s) journalière(s)`),
      carte('Chiffre d’affaires (FCFA)', fmtN(ca), 'bleu'),
      carte('Vente au comptant (FCFA)', fmtN(sum(lignes, 'mc')), 'vert', `${fmtN(sum(lignes, 'vendu_comptant'))} packs`),
      carte('Vente à crédit (FCFA)', fmtN(sum(lignes, 'mk')), 'rouge', `${fmtN(sum(lignes, 'vendu_credit'))} packs`),
      carte('Stock initial cumulé', `${fmtN(sum(lignes, 'stock_initial'))} packs`, 'violet'),
      carte('Stock final (dernière fiche)', `${fmtN(stockFinal)} packs`, 'ambre', `${derniere.size} vendeur(s)`),
    ].join('');
    const concur = vp.filter((v) => v.marques.some((m) => !NOUS.has(m))).length;
    const leaders = vp.filter((v) => v.marques.some((m) => LEADERS.has(m))).length;
    const nous = vp.filter((v) => v.marques.some((m) => NOUS.has(m))).length;
    $('#m-k2', root).innerHTML = [
      carte('Vendeurs visités', fmtN(vp.length), 'clair', `${new Set(vp.map((v) => (v.client || '').toLowerCase() + '|' + (v.lieu || '').toLowerCase())).size} point(s) de vente distinct(s)`),
      carte('Prises de commande', fmtN(prises), 'clair', vp.length ? `taux de prise ${fmtN((prises / vp.length) * 100, 1)} %` : ''),
      carte('Présence Champion / Bistro', vp.length ? `${fmtN((leaders / vp.length) * 100, 0)} %` : '—', 'clair t-crit', `${leaders} point(s) de vente`),
      carte('Présence d’un concurrent', vp.length ? `${fmtN((concur / vp.length) * 100, 0)} %` : '—', 'clair t-warn', `${concur} point(s) de vente`),
      carte('Présence de nos marques', vp.length ? `${fmtN((nous / vp.length) * 100, 0)} %` : '—', 'clair', `${nous} point(s) de vente`),
      carte(`Objectif ${libMois(moisCourant)}`, taux === null ? 'Non fixé' : `${fmtN(taux, 0)} %`, `clair ${taux !== null && taux < 50 ? 't-warn' : ''}`, objPacks ? `${fmtN(realMois)} / ${fmtN(objPacks)} packs` : 'onglet Objectifs mensuels'),
    ].join('');

    // Évolutions
    const ks = periodes(du, au, f.g), lib = ks.map((k) => libCle(k, f.g));
    const gLib = f.g === 'mois' ? 'par mois' : f.g === 'semaine' ? 'par semaine' : 'par jour';
    $('#m-gl1', root).textContent = gLib; $('#m-gl2', root).textContent = gLib; $('#m-gl6', root).textContent = gLib;
    const prods = MAYO_PRODUITS.filter((p) => !f.produit || p.k === f.produit);
    const serie = (pk, fn) => ks.map((k) => sum(lignes.filter((l) => l.produit === pk && cle(l.date, f.g) === k), fn));
    chart($('#m-g1', root), { type: 'bar', stacked: true, data: { labels: lib, datasets: prods.map((p) => ({ label: p.l, data: serie(p.k, (l) => l.mc + l.mk), backgroundColor: COUL[p.k], borderRadius: 3 })) } });
    chart($('#m-g2', root), { type: 'line', money: false, data: { labels: lib, datasets: [
      ...prods.map((p) => ({ label: p.l, data: serie(p.k, 'vendu'), borderColor: COUL[p.k], backgroundColor: COUL[p.k], tension: 0.3, borderWidth: 2 })),
      { label: 'dont à crédit', data: ks.map((k) => sum(lignes.filter((l) => cle(l.date, f.g) === k), 'vendu_credit')), borderColor: '#BF8F00', backgroundColor: '#BF8F00', borderDash: [5, 4], tension: 0.3, borderWidth: 2 }] },
      tip: (c) => `${c.dataset.label} : ${fmtN(c.parsed.y)} packs` });

    // Présence des marques
    const cpt = new Map();
    for (const v of vp) for (const m of v.marques) cpt.set(m, (cpt.get(m) || 0) + 1);
    const pres = [...cpt.entries()].map(([k, n]) => ({ id: k, k, nom: libMarque(k), n, part: vp.length ? (n / vp.length) * 100 : 0, nous: NOUS.has(k), leader: LEADERS.has(k),
      parAxe: MAYO_AXES.map((a) => vp.filter((v) => v.axe === a && v.marques.includes(k)).length) })).sort((a, b) => b.n - a.n);
    const col = (r) => (r.nous ? '#548235' : r.leader ? '#C00000' : '#8C8C8C');
    chart($('#m-g3', root), { type: 'bar', horizontal: true, legend: false, data: { labels: pres.map((r) => r.nom), datasets: [{ label: 'Présence', data: pres.map((r) => Math.round(r.part * 10) / 10), backgroundColor: pres.map(col), borderRadius: 3 }] },
      yfmt: (v) => v, tip: (c) => `${c.label} : présente chez ${fmtN(c.parsed.x, 1)} % des vendeurs visités (${pres[c.dataIndex].n})` });
    const totNous = sum(pres.filter((r) => r.nous), 'n'), totLead = sum(pres.filter((r) => r.leader), 'n'), totAutres = sum(pres.filter((r) => !r.nous && !r.leader), 'n');
    chart($('#m-g4', root), { type: 'doughnut', cutout: '55%', legendPos: 'right', data: { labels: ['Nos marques (Oriba, Aïda, Délice, Adelco)', 'Champion et Bistro (leaders)', 'Autres concurrents'], datasets: [{ data: [totNous, totLead, totAutres], backgroundColor: ['#548235', '#C00000', '#8C8C8C'], borderWidth: 1 }] },
      tip: (c) => { const t = totNous + totLead + totAutres; return `${c.label} : ${c.parsed} citation(s) — ${fmtN(t ? (c.parsed / t) * 100 : 0, 1)} % des marques relevées`; } });
    new Table({ rows: pres, sort: { k: 'n', dir: -1 }, pageSize: 20, title: 'Présence des marques',
      cols: [{ k: 'nom', l: 'Marque', f: (r) => `<b class="${r.nous ? 't-ok' : r.leader ? 't-crit' : ''}">${esc(r.nom)}</b>${r.nous ? ' <span class="pill ok">Oriba Foods</span>' : r.leader ? ' <span class="pill crit">Leader</span>' : ''}`, txt: (r) => r.nom },
        { k: 'n', l: 'Points de vente', num: 1 }, { k: 'part', l: 'Taux de présence', num: 1, f: (r) => `<div class="mini"><div class="bar ${r.nous ? 'ok' : r.leader ? 'crit' : ''}"><i style="width:${Math.min(100, r.part)}%"></i></div>${fmtN(r.part, 1)} %</div>`, txt: (r) => `${fmtN(r.part, 1)} %` },
        ...MAYO_AXES.map((a, i) => ({ k: 'ax' + i, l: a.replace('Rond-point', 'RP'), num: 1, v: (r) => r.parAxe[i] }))], empty: 'Aucune visite sur la période : saisissez les visites ou importez le classeur de suivi.' }).mount($('#m-pres', root));
    const top = pres.slice(0, 7);
    chart($('#m-g5', root), { type: 'bar', money: false, data: { labels: MAYO_AXES.map((a) => a.replace('Rond-point ', 'RP ')), datasets: top.map((r, i) => ({ label: r.nom, data: r.parAxe, backgroundColor: r.nous ? ['#548235', '#70AD47', '#A9D18E', '#385723'][i % 4] : r.leader ? (r.k === 'CHAMPION' ? '#C00000' : '#FF5B5B') : ['#7F7F7F', '#A5A5A5', '#BF8F00', '#5B9BD5', '#7030A0'][i % 5], borderRadius: 3 })) },
      tip: (c) => `${c.dataset.label} : ${c.parsed.y} point(s) de vente` });
    chart($('#m-g6', root), { type: 'bar', money: false, data: { labels: lib, datasets: [
      { label: 'Vendeurs visités', data: ks.map((k) => vp.filter((v) => cle(v.date, f.g) === k).length), backgroundColor: '#9DC3E6', borderRadius: 3 },
      { label: 'Prises de commande', data: ks.map((k) => vp.filter((v) => v.prise && cle(v.date, f.g) === k).length), backgroundColor: '#1F4E79', borderRadius: 3 }] }, tip: (c) => `${c.dataset.label} : ${c.parsed.y}` });

    // Objectifs
    $('#m-gl7', root).textContent = libMois(moisCourant);
    const objRows = [...MAYO_PRODUITS.map((p) => ({ k: p.k, l: p.l })), { k: 'visites', l: 'Vendeurs visités' }].map((p) => ({ ...p, obj: num(objs.find((o) => o.produit === p.k)?.objectif),
      real: p.k === 'visites' ? VI.filter((v) => v.date.startsWith(moisCourant)).length : sum(FI.filter((x) => x.date.startsWith(moisCourant)).flatMap((x) => x.lignes).filter((l) => l.produit === p.k), 'vendu') }));
    chart($('#m-g7', root), { type: 'bar', money: false, data: { labels: objRows.map((r) => r.l), datasets: [
      { label: 'Objectif', data: objRows.map((r) => r.obj), backgroundColor: '#D9D9D9', borderRadius: 3 }, { label: 'Réalisé', data: objRows.map((r) => r.real), backgroundColor: objRows.map((r) => COUL[r.k] || '#7030A0'), borderRadius: 3 }] },
      tip: (c) => `${c.dataset.label} : ${fmtN(c.parsed.y)}${objRows[c.dataIndex].k === 'visites' ? ' visite(s)' : ' packs'}` });
    chart($('#m-g8', root), { type: 'bar', money: false, data: { labels: prods.map((p) => p.l), datasets: [
      { label: 'Stock initial', data: prods.map((p) => sum(lignes.filter((l) => l.produit === p.k), 'stock_initial')), backgroundColor: '#BDD7EE', borderRadius: 3 },
      { label: 'Vendu', data: prods.map((p) => sum(lignes.filter((l) => l.produit === p.k), 'vendu')), backgroundColor: prods.map((p) => COUL[p.k]), borderRadius: 3 },
      { label: 'Stock final', data: prods.map((p) => sum(lignes.filter((l) => l.produit === p.k), 'final')), backgroundColor: '#FFD966', borderRadius: 3 }] }, tip: (c) => `${c.dataset.label} : ${fmtN(c.parsed.y)} packs` });

    // Tableaux
    const foot = (keys) => (c, rs) => (c.k === 'l' || c.k === 'nom' ? '<b>Total</b>' : keys.includes(c.k) ? `<b>${fmtN(rs.reduce((s, r) => s + num(r[c.k]), 0))}</b>` : '');
    new Table({ rows: prods.map((p) => { const l = lignes.filter((x) => x.produit === p.k); return { id: p.k, l: p.l, prix: prix(p.k), si: sum(l, 'stock_initial'), vc: sum(l, 'vendu_comptant'), vk: sum(l, 'vendu_credit'), v: sum(l, 'vendu'), fin: sum(l, 'final'), mc: sum(l, 'mc'), mk: sum(l, 'mk'), t: sum(l, 'mc') + sum(l, 'mk') }; }),
      sort: { k: 't', dir: -1 }, title: 'Ventes de mayonnaise par produit', foot: foot(['si', 'vc', 'vk', 'v', 'fin', 'mc', 'mk', 't']),
      cols: [{ k: 'l', l: 'Produit', f: (r) => `<b>${r.l}</b>` }, { k: 'prix', l: 'Prix du pack', num: 1, f: (r) => fmtN(r.prix) }, { k: 'si', l: 'Stock initial', num: 1 }, { k: 'vc', l: 'Vendu comptant', num: 1 }, { k: 'vk', l: 'Vendu crédit', num: 1 },
        { k: 'v', l: 'Total vendu', num: 1, f: (r) => `<b>${fmtN(r.v)}</b>` }, { k: 'fin', l: 'Stock final', num: 1 }, { k: 'mc', l: 'Montant comptant', num: 1, f: (r) => fmtN(r.mc) }, { k: 'mk', l: 'Montant crédit', num: 1, f: (r) => fmtN(r.mk) }, { k: 't', l: 'CA total', num: 1, f: (r) => `<b>${fmtN(r.t)}</b>` }] }).mount($('#m-tp', root));
    new Table({ rows: ks.map((k) => { const l = lignes.filter((x) => cle(x.date, f.g) === k); const v = vp.filter((x) => cle(x.date, f.g) === k);
      return { id: k, nom: libCle(k, f.g), k, ...Object.fromEntries(MAYO_PRODUITS.map((p) => [p.k, sum(l.filter((x) => x.produit === p.k), 'vendu')])), v: sum(l, 'vendu'), mc: sum(l, 'mc'), mk: sum(l, 'mk'), t: sum(l, 'mc') + sum(l, 'mk'), vis: v.length, pr: v.filter((x) => x.prise).length }; }),
      sort: { k: 'k', dir: 1 }, pageSize: 31, title: `Ventes de mayonnaise ${gLib}`, foot: foot(['oriba', 'aida', 'delice', 'v', 'mc', 'mk', 't', 'vis', 'pr']),
      cols: [{ k: 'nom', l: f.g === 'mois' ? 'Mois' : f.g === 'semaine' ? 'Semaine' : 'Jour', v: (r) => r.k, f: (r) => `<b>${r.nom}</b>`, txt: (r) => r.nom }, ...MAYO_PRODUITS.map((p) => ({ k: p.k, l: `${p.l.replace('Mayonnaise ', '')} (packs)`, num: 1 })),
        { k: 'v', l: 'Total packs', num: 1, f: (r) => `<b>${fmtN(r.v)}</b>` }, { k: 'mc', l: 'Comptant', num: 1, f: (r) => fmtN(r.mc) }, { k: 'mk', l: 'Crédit', num: 1, f: (r) => fmtN(r.mk) }, { k: 't', l: 'CA total', num: 1, f: (r) => `<b>${fmtN(r.t)}</b>` },
        { k: 'vis', l: 'Visites', num: 1 }, { k: 'pr', l: 'Prises', num: 1 }] }).mount($('#m-te', root));
    const mot = new Map();
    for (const v of vp.filter((x) => !x.prise)) { const m = (v.motif || 'Non précisé').trim(); const k = m.toLowerCase(); const o = mot.get(k) || { id: k, motif: m, n: 0 }; o.n++; mot.set(k, o); }
    new Table({ rows: [...mot.values()], sort: { k: 'n', dir: -1 }, pageSize: 10, title: 'Motifs de non-prise', cols: [{ k: 'motif', l: 'Motif' }, { k: 'n', l: 'Vendeurs', num: 1 }] }).mount($('#m-mot', root));
    new Table({ rows: vp.filter((v) => v.date_relance || !v.prise).map((v) => ({ ...v, marq: v.marques.map(libMarque).join(', ') })), sort: { k: 'date_relance', dir: 1 }, pageSize: 10, title: 'Vendeurs à relancer',
      cols: [{ k: 'client', l: 'Vendeur', f: (r) => `<b>${esc(r.client)}</b>` }, { k: 'telephone', l: 'Téléphone' }, { k: 'lieu', l: 'Lieu' }, { k: 'marq', l: 'Marques en place' }, { k: 'date_relance', l: 'Relance', f: (r) => (r.date_relance ? fmtD(r.date_relance) : '—') }] }).mount($('#m-rel', root));
    const obs = [...fp.filter((x) => x.observation || x.reaction).map((x) => ({ id: x.id, date: x.date, source: 'Fiche journalière', qui: x.vendeur, axe: x.axe || '', obs: x.observation || '', rea: x.reaction || '' })),
      ...vp.filter((v) => v.observation || v.motif).map((v) => ({ id: v.id, date: v.date, source: `Visite · ${v.client}`, qui: v.agent || '', axe: v.axe || '', obs: v.observation || '', rea: v.prise ? 'A pris la commande' : v.motif || '' }))];
    new Table({ rows: obs, sort: { k: 'date', dir: -1 }, pageSize: 15, title: 'Observations et réactions du terrain',
      cols: [{ k: 'date', l: 'Date', f: (r) => fmtD(r.date) }, { k: 'source', l: 'Source' }, { k: 'qui', l: 'Agent' }, { k: 'axe', l: 'Axe' }, { k: 'obs', l: 'Observation' }, { k: 'rea', l: 'Réaction' }], empty: 'Aucune observation sur la période.' }).mount($('#m-obs', root));
  };
  $('#m-du', root).addEventListener('change', (e) => { f.du = e.target.value; draw(); });
  $('#m-au', root).addEventListener('change', (e) => { f.au = e.target.value || today(); draw(); });
  $('#m-pr', root).addEventListener('change', (e) => { f.produit = e.target.value; draw(); });
  $('#m-ax', root).addEventListener('change', (e) => { f.axe = e.target.value; draw(); });
  $('#m-vd', root).addEventListener('change', (e) => { f.vendeur = e.target.value; draw(); });
  $$('[data-g]', root).forEach((b) => b.addEventListener('click', () => { f.g = b.dataset.g; $$('[data-g]', root).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  $('#m-tout', root).addEventListener('click', () => { f.du = ''; f.au = today(); $('#m-du', root).value = premiere; $('#m-au', root).value = f.au; draw(); });
  draw();
}

// ---------------------------------------------------------------- Saisie journalière
function ongletFiches(root) {
  const FI = fiches();
  root.innerHTML = `<div class="page-h"><div><h1>Fiches journalières</h1><p class="sub">Une fiche par vendeur et par jour : stock initial, packs vendus au comptant et à crédit, stock final calculé, observations et réactions du terrain. Une fiche reste modifiable le jour de sa saisie.</p></div>
    <div class="page-act">${peutSaisir() ? `<button class="btn primary" id="mf-new">${icon('plus')} Nouvelle fiche du jour</button>` : ''}</div></div><div id="mf-t"></div>`;
  new Table({ rows: FI.map((x) => ({ ...x, _cls: x.statut === 'annulee' ? 'annule' : '' })), sort: { k: 'date', dir: -1 }, pageSize: 25, title: 'Fiches journalières mayonnaise', onRow: (r) => detailFiche(FI.find((x) => x.id === r.id)),
    cols: [{ k: 'numero', l: 'N°' }, { k: 'date', l: 'Date', f: (r) => fmtD(r.date) }, { k: 'vendeur', l: 'Vendeur', f: (r) => `<b>${esc(r.vendeur)}</b>` }, { k: 'axe', l: 'Axe' },
      ...MAYO_PRODUITS.map((p) => ({ k: p.k, l: `${p.l.replace('Mayonnaise ', '')} vendus`, num: 1, v: (r) => sum(r.lignes.filter((l) => l.produit === p.k), 'vendu') })),
      { k: 'si', l: 'Stock initial', num: 1 }, { k: 'vendu', l: 'Packs vendus', num: 1, f: (r) => `<b>${fmtN(r.vendu)}</b>` }, { k: 'final', l: 'Stock final', num: 1 },
      { k: 'mc', l: 'Comptant', num: 1, f: (r) => fmtN(r.mc) }, { k: 'mk', l: 'Crédit', num: 1, f: (r) => fmtN(r.mk) }, { k: 'total', l: 'Total FCFA', num: 1, f: (r) => `<b>${fmtN(r.total)}</b>` },
      { k: 'statut', l: 'Statut', f: (r) => (r.statut === 'annulee' ? '<span class="pill mute">Annulée</span>' : estVerrouille(r) ? '<span class="pill ok">Définitive</span>' : '<span class="pill info">Modifiable aujourd’hui</span>'), txt: (r) => r.statut }],
    empty: 'Aucune fiche pour le moment. Cliquez sur « Nouvelle fiche du jour ».' }).mount($('#mf-t', root));
  $('#mf-new', root)?.addEventListener('click', () => formFiche());
}

function formFiche(fiche) {
  const L = new Map((fiche?.lignes || []).map((l) => [l.produit, l]));
  const vend = vendeursConnus();
  const body = `<div class="grid3">
      <label class="fld"><span>Date *</span><input type="date" id="ff-date" value="${fiche?.date || today()}" max="${today()}"></label>
      <label class="fld"><span>Vendeur *</span><input type="text" id="ff-vend" list="ff-vl" value="${esc(fiche?.vendeur || '')}" placeholder="Nom du vendeur"><datalist id="ff-vl">${vend.map((v) => `<option value="${esc(v)}">`).join('')}</datalist></label>
      <label class="fld"><span>Axe</span><select id="ff-axe"><option value="">—</option>${MAYO_AXES.map((a) => `<option ${fiche?.axe === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label></div>
    <div class="tbl-wrap"><table class="tbl mayo-saisie"><thead><tr><th>Produit</th><th class="n">Prix pack</th><th class="n">Stock initial</th><th class="n">Vendu comptant</th><th class="n">Vendu crédit</th><th>Client du crédit</th><th class="n">Stock final</th><th class="n">Montant comptant</th><th class="n">Montant crédit</th></tr></thead>
      <tbody>${MAYO_PRODUITS.map((p) => { const l = L.get(p.k) || {}; return `<tr data-p="${p.k}"><td><b>${p.l}</b></td><td class="n">${fmtN(prix(p.k))}</td>
        <td><input type="number" min="0" step="1" data-c="stock_initial" value="${l.stock_initial ?? ''}"></td><td><input type="number" min="0" step="1" data-c="vendu_comptant" value="${l.vendu_comptant ?? ''}"></td>
        <td><input type="number" min="0" step="1" data-c="vendu_credit" value="${l.vendu_credit ?? ''}"></td><td><input type="text" data-c="client_credit" value="${esc(l.client_credit || '')}" placeholder="si crédit"></td>
        <td class="n" data-o="final">0</td><td class="n" data-o="mc">0</td><td class="n" data-o="mk">0</td></tr>`; }).join('')}</tbody>
      <tfoot><tr><td><b>Total</b></td><td></td><td class="n" data-t="si"></td><td class="n" data-t="vc"></td><td class="n" data-t="vk"></td><td></td><td class="n" data-t="final"></td><td class="n" data-t="mc"></td><td class="n" data-t="mk"></td></tr></tfoot></table></div>
    <p class="muted small" id="ff-tot"></p>
    <div class="grid2 flat"><label class="fld"><span>Observations sur le terrain</span><textarea id="ff-obs" rows="3" placeholder="Ce que le vendeur a constaté : concurrence, prix pratiqués, ruptures…">${esc(fiche?.observation || '')}</textarea></label>
      <label class="fld"><span>Réactions sur le terrain</span><textarea id="ff-rea" rows="3" placeholder="Ce que disent les vendeurs et les clients : goût, prix, emballage…">${esc(fiche?.reaction || '')}</textarea></label></div><p class="err" hidden></p>`;
  modal({ title: fiche ? `Modifier la fiche ${fiche.numero}` : 'Nouvelle fiche journalière — mayonnaise', body, wide: true, size: 'xl',
    footer: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="ff-ok">${icon('check')} Enregistrer la fiche</button>`,
    onMount: (m, close) => {
      const calc = () => {
        const t = { si: 0, vc: 0, vk: 0, final: 0, mc: 0, mk: 0 };
        for (const tr of $$('tr[data-p]', m)) {
          const g = (c) => num($(`[data-c="${c}"]`, tr).value);
          const si = g('stock_initial'), vc = g('vendu_comptant'), vk = g('vendu_credit'), p = prix(tr.dataset.p), fin = si - vc - vk;
          $('[data-o="final"]', tr).innerHTML = fin < 0 ? `<b class="t-crit">${fmtN(fin)}</b>` : fmtN(fin);
          $('[data-o="mc"]', tr).textContent = fmtN(vc * p); $('[data-o="mk"]', tr).textContent = fmtN(vk * p);
          Object.assign(t, { si: t.si + si, vc: t.vc + vc, vk: t.vk + vk, final: t.final + fin, mc: t.mc + vc * p, mk: t.mk + vk * p });
        }
        for (const [k, v] of Object.entries(t)) $(`[data-t="${k}"]`, m).innerHTML = `<b>${fmtN(v)}</b>`;
        $('#ff-tot', m).textContent = `Packs vendus : ${fmtN(t.vc + t.vk)} · chiffre d’affaires : ${fmtF(t.mc + t.mk)} dont crédit ${fmtF(t.mk)}.`;
      };
      $$('input', m).forEach((i) => i.addEventListener('input', calc)); calc();
      $('#ff-ok', m.parentElement).addEventListener('click', async (e) => {
        const err = $('.err', m); err.hidden = true;
        const payload = { fiche: { id: fiche?.id, date: $('#ff-date', m).value, vendeur: $('#ff-vend', m).value, axe: $('#ff-axe', m).value || null, observation: $('#ff-obs', m).value, reaction: $('#ff-rea', m).value,
          lignes: $$('tr[data-p]', m).map((tr) => ({ produit: tr.dataset.p, ...Object.fromEntries($$('[data-c]', tr).map((i) => [i.dataset.c, i.type === 'number' ? (i.value === '' ? 0 : Number(i.value)) : i.value])) })) } };
        try { await busy(e.currentTarget, () => App.act('mayo.fiche.save', payload, 'Fiche enregistrée.')); close(true); } catch (x) { err.hidden = false; err.textContent = x.message; }
      });
    } });
}

function detailFiche(x) {
  if (!x) return;
  const modifiable = x.statut !== 'annulee' && !estVerrouille(x) && peutSaisir();
  modal({ title: `Fiche ${x.numero} — ${x.vendeur}`, wide: true,
    body: `<p class="lead">${fmtD(x.date)}${x.axe ? ` · ${esc(x.axe)}` : ''}${x.statut === 'annulee' ? ` · <b class="t-crit">Annulée — ${esc(x.motif || '')}</b>` : ''}</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produit</th><th class="n">Stock initial</th><th class="n">Comptant</th><th class="n">Crédit</th><th>Client du crédit</th><th class="n">Stock final</th><th class="n">Montant comptant</th><th class="n">Montant crédit</th></tr></thead>
      <tbody>${x.lignes.map((l) => `<tr><td><b>${libProduit(l.produit)}</b></td><td class="n">${fmtN(l.stock_initial)}</td><td class="n">${fmtN(l.vendu_comptant)}</td><td class="n">${fmtN(l.vendu_credit)}</td><td>${esc(l.client_credit || '—')}</td><td class="n">${fmtN(l.final)}</td><td class="n">${fmtN(l.mc)}</td><td class="n">${fmtN(l.mk)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td><b>Total</b></td><td class="n"><b>${fmtN(x.si)}</b></td><td class="n"><b>${fmtN(x.vc)}</b></td><td class="n"><b>${fmtN(x.vk)}</b></td><td></td><td class="n"><b>${fmtN(x.final)}</b></td><td class="n"><b>${fmtN(x.mc)}</b></td><td class="n"><b>${fmtN(x.mk)}</b></td></tr></tfoot></table></div>
      <dl class="dl"><dt>Observations</dt><dd>${esc(x.observation || '—')}</dd><dt>Réactions</dt><dd>${esc(x.reaction || '—')}</dd></dl>
      ${x.statut !== 'annulee' && estVerrouille(x) ? '<p class="note">🔒 Fiche définitive : sa journée de saisie est terminée.</p>' : ''}`,
    footer: `${modifiable && App.can('mayo', 'annuler') ? '<button class="btn danger" id="fd-an">Annuler la fiche</button>' : ''}<span class="grow"></span>${modifiable ? '<button class="btn" id="fd-ed">Modifier</button>' : ''}<button class="btn ghost" data-close>Fermer</button>`,
    onMount: (m, close) => {
      $('#fd-ed', m.parentElement)?.addEventListener('click', () => { close(); formFiche(x); });
      $('#fd-an', m.parentElement)?.addEventListener('click', async () => {
        const motif = await confirmBox({ title: 'Annuler la fiche', message: `La fiche ${x.numero} de ${esc(x.vendeur)} sera annulée (elle reste visible dans l’historique).`, danger: true, motif: true, okLabel: 'Annuler la fiche' });
        if (!motif) return;
        try { await App.act('mayo.fiche.annuler', { id: x.id, motif }, 'Fiche annulée.'); close(); } catch (e) { showErr(e); }
      });
    } });
}

// ---------------------------------------------------------------- Visites et concurrence
function ongletVisites(root) {
  const VI = visites();
  root.innerHTML = `<div class="page-h"><div><h1>Vendeurs visités</h1><p class="sub">Chaque visite indique si le vendeur a pris la commande, les marques de mayonnaise présentes chez lui (nos marques et les concurrents) et la raison d’un refus.</p></div>
    <div class="page-act">${peutSaisir() ? `<button class="btn primary" id="mv-new">${icon('plus')} Nouvelle visite</button>` : ''}</div></div><div id="mv-t"></div>`;
  new Table({ rows: VI.map((v) => ({ ...v, marq: v.marques.map(libMarque).join(', '), _cls: v.statut === 'annulee' ? 'annule' : '' })), sort: { k: 'date', dir: -1 }, pageSize: 25, title: 'Visites des vendeurs de mayonnaise', onRow: (r) => detailVisite(VI.find((v) => v.id === r.id)),
    cols: [{ k: 'date', l: 'Date', f: (r) => fmtD(r.date) }, { k: 'agent', l: 'Agent' }, { k: 'axe', l: 'Axe' }, { k: 'client', l: 'Vendeur visité', f: (r) => `<b>${esc(r.client)}</b>` }, { k: 'telephone', l: 'Téléphone' }, { k: 'lieu', l: 'Lieu' },
      { k: 'prise', l: 'Prise', f: (r) => (r.prise ? '<span class="pill ok">Oui</span>' : '<span class="pill warn">Non</span>'), txt: (r) => (r.prise ? 'Oui' : 'Non') },
      { k: 'marq', l: 'Marques présentes', f: (r) => r.marques.map((m) => `<span class="pill ${NOUS.has(m) ? 'ok' : LEADERS.has(m) ? 'crit' : 'mute'}">${esc(libMarque(m))}</span>`).join(' '), txt: (r) => r.marq },
      { k: 'motif', l: 'Si non, pourquoi' }, { k: 'date_relance', l: 'Relance', f: (r) => (r.date_relance ? fmtD(r.date_relance) : '') }, { k: 'statut', l: 'Statut', f: (r) => (r.statut === 'annulee' ? '<span class="pill mute">Annulée</span>' : '') }],
    empty: 'Aucune visite. Saisissez-les ici ou importez le classeur de suivi des vendeurs.' }).mount($('#mv-t', root));
  $('#mv-new', root)?.addEventListener('click', () => formVisite());
}

function formVisite(v) {
  const vend = vendeursConnus(), sel = new Set(v?.marques || []);
  const autres = [...sel].filter((m) => !MAYO_MARQUES.some((b) => b.k === m));
  const body = `<div class="grid3">
      <label class="fld"><span>Date *</span><input type="date" id="fv-date" value="${v?.date || today()}" max="${today()}"></label>
      <label class="fld"><span>Agent</span><input type="text" id="fv-agent" list="fv-al" value="${esc(v?.agent || '')}"><datalist id="fv-al">${vend.map((a) => `<option value="${esc(a)}">`).join('')}</datalist></label>
      <label class="fld"><span>Axe</span><select id="fv-axe"><option value="">—</option>${MAYO_AXES.map((a) => `<option ${v?.axe === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
      <label class="fld"><span>Vendeur visité *</span><input type="text" id="fv-client" value="${esc(v?.client || '')}"></label>
      <label class="fld"><span>Téléphone</span><input type="text" id="fv-tel" value="${esc(v?.telephone || '')}"></label>
      <label class="fld"><span>Lieu</span><input type="text" id="fv-lieu" value="${esc(v?.lieu || '')}"></label></div>
    <div class="seg prise-seg" id="fv-prise"><button type="button" data-v="1" class="${v?.prise ? 'on' : ''}">A pris la commande</button><button type="button" data-v="0" class="${v && !v.prise ? 'on' : ''}">N’a pas pris</button></div>
    <fieldset class="mayo-marques"><legend>Marques de mayonnaise présentes chez ce vendeur</legend>
      ${MAYO_MARQUES.map((b) => `<label class="chk ${b.nous ? 'nous' : LEADERS.has(b.k) ? 'leader' : ''}"><input type="checkbox" value="${b.k}" ${sel.has(b.k) ? 'checked' : ''}> <span>${b.l}</span></label>`).join('')}
      <label class="fld"><span>Autre marque</span><input type="text" id="fv-autre" value="${esc(autres.join(', '))}" placeholder="séparer par des virgules"></label></fieldset>
    <div class="grid2 flat"><label class="fld"><span>Si non, pourquoi</span><input type="text" id="fv-motif" list="fv-ml" value="${esc(v?.motif || '')}"><datalist id="fv-ml"><option value="Prix élevé"><option value="Beaucoup de stock"><option value="Très fidèle à son fournisseur / crédit"><option value="Va nous rappeler"></datalist></label>
      <label class="fld"><span>Date de relance</span><input type="date" id="fv-rel" value="${v?.date_relance || ''}"></label></div>
    <label class="fld"><span>Observation</span><textarea id="fv-obs" rows="2">${esc(v?.observation || '')}</textarea></label><p class="err" hidden></p>`;
  modal({ title: v ? 'Modifier la visite' : 'Nouvelle visite d’un vendeur', body, wide: true,
    footer: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="fv-ok">${icon('check')} Enregistrer</button>`,
    onMount: (m, close) => {
      let prise = v ? !!v.prise : null;
      $$('#fv-prise button', m).forEach((b) => b.addEventListener('click', () => { prise = b.dataset.v === '1'; $$('#fv-prise button', m).forEach((x) => x.classList.toggle('on', x === b)); }));
      $('#fv-ok', m.parentElement).addEventListener('click', async (e) => {
        const err = $('.err', m); err.hidden = true;
        if (prise === null) { err.hidden = false; err.textContent = 'Indiquez si le vendeur a pris la commande.'; return; }
        const marques = [...$$('.mayo-marques input[type=checkbox]:checked', m).map((i) => i.value), ...$('#fv-autre', m).value.split(/[,/;]/).map((s) => s.trim()).filter(Boolean)];
        const visite = { id: v?.id, date: $('#fv-date', m).value, agent: $('#fv-agent', m).value, axe: $('#fv-axe', m).value || null, client: $('#fv-client', m).value, telephone: $('#fv-tel', m).value, lieu: $('#fv-lieu', m).value,
          prise, marques, motif: prise ? null : $('#fv-motif', m).value, date_relance: $('#fv-rel', m).value || null, observation: $('#fv-obs', m).value };
        try { await busy(e.currentTarget, () => App.act('mayo.visite.save', { visite }, 'Visite enregistrée.')); close(true); } catch (x) { err.hidden = false; err.textContent = x.message; }
      });
    } });
}

function detailVisite(v) {
  if (!v) return;
  const modifiable = v.statut !== 'annulee' && !estVerrouille(v) && peutSaisir();
  modal({ title: `Visite — ${v.client}`, wide: true,
    body: `<dl class="dl">${[['Date', fmtD(v.date)], ['Agent', v.agent || '—'], ['Axe', v.axe || '—'], ['Téléphone', v.telephone || '—'], ['Lieu', v.lieu || '—'], ['A pris la commande', v.prise ? 'Oui' : 'Non'],
      ['Marques présentes', v.marques.map(libMarque).join(', ') || '—'], ['Si non, pourquoi', v.motif || '—'], ['Observation', v.observation || '—'], ['Date de relance', v.date_relance ? fmtD(v.date_relance) : '—'],
      ['Origine', v.ref_externe ? 'Import du classeur de suivi' : 'Saisie'], ['Statut', v.statut === 'annulee' ? `Annulée — ${v.motif_annulation || ''}` : 'Valide']].map(([k, x]) => `<dt>${k}</dt><dd>${esc(x)}</dd>`).join('')}</dl>
      ${v.statut !== 'annulee' && estVerrouille(v) ? '<p class="note">🔒 Visite définitive : sa journée de saisie est terminée.</p>' : ''}`,
    footer: `${modifiable && App.can('mayo', 'annuler') ? '<button class="btn danger" id="vd-an">Annuler la visite</button>' : ''}<span class="grow"></span>${modifiable ? '<button class="btn" id="vd-ed">Modifier</button>' : ''}<button class="btn ghost" data-close>Fermer</button>`,
    onMount: (m, close) => {
      $('#vd-ed', m.parentElement)?.addEventListener('click', () => { close(); formVisite(v); });
      $('#vd-an', m.parentElement)?.addEventListener('click', async () => {
        const motif = await confirmBox({ title: 'Annuler la visite', message: `La visite de ${esc(v.client)} sera annulée.`, danger: true, motif: true, okLabel: 'Annuler la visite' });
        if (!motif) return;
        try { await App.act('mayo.visite.annuler', { id: v.id, motif }, 'Visite annulée.'); close(); } catch (e) { showErr(e); }
      });
    } });
}

// ---------------------------------------------------------------- Objectifs mensuels
function ongletObjectifs(root) {
  const f = F(); f.mois = f.mois || today().slice(0, 7);
  const draw = () => {
    const objs = (App.D.mayo_objectifs || []).filter((o) => o.mois === f.mois);
    const FI = fiches().filter((x) => x.statut !== 'annulee' && x.date.startsWith(f.mois));
    const VI = visites().filter((v) => v.statut !== 'annulee' && v.date.startsWith(f.mois));
    const rows = [...MAYO_PRODUITS.map((p) => ({ k: p.k, l: p.l, u: 'packs', real: sum(FI.flatMap((x) => x.lignes).filter((l) => l.produit === p.k), 'vendu'), ca: sum(FI.flatMap((x) => x.lignes).filter((l) => l.produit === p.k), (l) => l.mc + l.mk) })),
      { k: 'visites', l: 'Vendeurs visités', u: 'visites', real: VI.length }].map((r) => ({ ...r, obj: num(objs.find((o) => o.produit === r.k)?.objectif) }));
    const [y, mo] = f.mois.split('-').map(Number), jours = new Date(y, mo, 0).getDate();
    const ecoules = f.mois < today().slice(0, 7) ? jours : f.mois > today().slice(0, 7) ? 0 : +today().slice(8, 10);
    root.innerHTML = `<div class="page-h"><div><h1>Objectifs de vente mensuels</h1><p class="sub">Objectif en packs pour chaque mayonnaise et nombre de vendeurs à visiter dans le mois. Le réalisé vient des fiches journalières et des visites.</p></div>
      <div class="page-act"><label class="ff"><span>Mois</span><input type="month" id="mo-m" value="${f.mois}"></label></div></div>
      <article class="card"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produit</th><th class="n">Objectif du mois</th><th class="n">Réalisé</th><th class="n">Taux d’atteinte</th><th class="n">Reste à faire</th><th class="n">Rythme nécessaire / jour</th><th class="n">CA réalisé (FCFA)</th></tr></thead>
      <tbody>${rows.map((r) => { const t = r.obj ? (r.real / r.obj) * 100 : null, reste = Math.max(0, r.obj - r.real), jr = jours - ecoules;
        return `<tr><td><b>${r.l}</b></td><td class="n">${peutSaisir() ? `<input type="number" min="0" step="1" data-k="${r.k}" value="${r.obj || ''}" class="n" style="max-width:110px"> ${r.u}` : `${fmtN(r.obj)} ${r.u}`}</td><td class="n"><b>${fmtN(r.real)}</b></td>
          <td class="n">${t === null ? '—' : `<div class="mini"><div class="bar ${t >= 100 ? 'ok' : t >= 60 ? '' : 'warn'}"><i style="width:${Math.min(100, t)}%"></i></div>${fmtN(t, 0)} %</div>`}</td><td class="n">${r.obj ? fmtN(reste) : '—'}</td>
          <td class="n">${r.obj && jr > 0 ? fmtN(reste / jr, 1) : '—'}</td><td class="n">${r.ca !== undefined ? fmtN(r.ca) : ''}</td></tr>`; }).join('')}</tbody></table></div>
      ${peutSaisir() ? `<div class="form-act"><button class="btn primary" id="mo-ok">${icon('check')} Enregistrer les objectifs de ${libMois(f.mois)}</button></div>` : ''}
      <p class="muted small">${ecoules} jour(s) écoulé(s) sur ${jours}. Valeur de l’objectif en FCFA : ${fmtF(sum(rows.filter((r) => r.k !== 'visites'), (r) => r.obj * prix(r.k)))}.</p></article>`;
    $('#mo-m', root).addEventListener('change', (e) => { f.mois = e.target.value || today().slice(0, 7); draw(); });
    $('#mo-ok', root)?.addEventListener('click', async (e) => {
      const objectifs = $$('[data-k]', root).map((i) => ({ produit: i.dataset.k, objectif: i.value === '' ? 0 : Number(i.value) }));
      try { await busy(e.currentTarget, () => App.act('mayo.objectif.save', { mois: f.mois, objectifs }, 'Objectifs enregistrés.')); } catch (x) { showErr(x); }
    });
  };
  draw();
}

// ---------------------------------------------------------------- Import du classeur de suivi
const AXE_ONGLET = [[/enam/i, MAYO_AXES[0]], [/yantala/i, MAYO_AXES[1]], [/francophonie/i, MAYO_AXES[2]]];
const nettoie = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const isoDate = (x) => { if (typeof x === 'number' && x > 20000 && x < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(x) * 86400000).toISOString().slice(0, 10); if (x instanceof Date && !isNaN(x)) return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); const m = String(x || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}/.test(String(x)) ? String(x).slice(0, 10) : null; };
const titre = (s) => String(s || '').trim().toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());
export function lireClasseurMayo(wb) {
  const out = [];
  for (const nom of wb.SheetNames) {
    const ax = AXE_ONGLET.find(([re]) => re.test(nom)); if (!ax) continue;
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[nom], { header: 1, raw: true, defval: null });
    const h = rows.findIndex((r) => r.some((c) => nettoie(c).startsWith('date de visite'))); if (h < 0) continue;
    const H = rows[h].map(nettoie), col = (re) => H.findIndex((c) => re.test(c));
    const c = { n: col(/^n/), date: col(/^date de visite/), agent: col(/^agent/), client: col(/nom du client|client/), tel: col(/numero|telephone/), lieu: col(/^lieu/), prise: col(/^prise/), marques: col(/pourquoi|marque/), obs: col(/^observation/), rel: col(/relance/) };
    rows.slice(h + 1).forEach((r, i) => {
      const date = isoDate(r[c.date]), client = String(r[c.client] ?? '').trim();
      if (!date || !client) return;
      const prise = /^oui/i.test(String(r[c.prise] ?? '').trim()), obs = r[c.obs] != null ? String(r[c.obs]).trim() : '';
      out.push({ ref_externe: `XLS|${nom}|${r[c.n] ?? 'L' + (h + i + 2)}|${date}`, date, axe: ax[1], agent: titre(r[c.agent]), client, telephone: r[c.tel] != null ? String(r[c.tel]).trim() : null, lieu: r[c.lieu] != null ? String(r[c.lieu]).trim() : null,
        prise, marques: String(r[c.marques] ?? ''), motif: prise ? null : obs || null, observation: prise ? obs || null : null, date_relance: c.rel >= 0 ? isoDate(r[c.rel]) : null });
    });
  }
  return out;
}
function ongletImport(root) {
  root.innerHTML = `<div class="page-h"><div><h1>Importer le classeur de suivi des vendeurs</h1><p class="sub">Choisissez le fichier Excel « Suivi vendeurs équipe secteur mayo ». Les onglets Axe 1 (ENAM), Axe 2 (Yantala) et Axe 3 (Francophonie) sont lus : une ligne = une visite.
      La colonne « Si non, pourquoi » contient les marques présentes chez le vendeur ; la colonne « Observation » la raison du refus. Les lignes déjà importées sont ignorées : vous pouvez réimporter le même fichier mis à jour.</p></div></div>
    <article class="card"><label class="fld"><span>Fichier Excel</span><input type="file" id="mi-f" accept=".xlsx,.xls"></label><div id="mi-r"></div></article>`;
  $('#mi-f', root).addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!window.XLSX) return toast('Module Excel non chargé : vérifiez la connexion internet.', 'err');
    let lignes;
    try { lignes = lireClasseurMayo(window.XLSX.read(await file.arrayBuffer(), { type: 'array' })); } catch (x) { return showErr(x); }
    const host = $('#mi-r', root);
    if (!lignes.length) { host.innerHTML = '<p class="err">Aucune visite trouvée : le fichier doit contenir les onglets Axe1_Enam, Axe2_Yantala ou Axe3_Francophonie avec la colonne « Date de visite ».</p>'; return; }
    const parAxe = MAYO_AXES.map((a) => [a, lignes.filter((l) => l.axe === a).length]);
    host.innerHTML = `<p class="lead"><b>${lignes.length}</b> visite(s) lue(s) : ${parAxe.map(([a, n]) => `${esc(a)} : ${n}`).join(' · ')}.</p><div id="mi-t"></div><div class="form-act"><button class="btn primary" id="mi-ok">${icon('upload')} Importer ces visites</button></div>`;
    new Table({ rows: lignes.map((l, i) => ({ ...l, id: i })), pageSize: 10, exportable: false, cols: [{ k: 'date', l: 'Date', f: (r) => fmtD(r.date) }, { k: 'agent', l: 'Agent' }, { k: 'client', l: 'Vendeur' }, { k: 'lieu', l: 'Lieu' }, { k: 'prise', l: 'Prise', f: (r) => (r.prise ? 'Oui' : 'Non') }, { k: 'marques', l: 'Marques' }, { k: 'motif', l: 'Pourquoi' }] }).mount($('#mi-t', host));
    $('#mi-ok', host).addEventListener('click', async (ev) => {
      try {
        const r = await busy(ev.currentTarget, () => App.api.call('mayo.visites.import', { visites: lignes, fichier: file.name }));
        await App.refresh();
        toast(`${r.ajoutees} visite(s) importée(s)${r.deja ? `, ${r.deja} déjà présente(s)` : ''}${r.erreurs?.length ? `, ${r.erreurs.length} en erreur` : ''}.`);
        F().o = 'visites'; App.rerender();
      } catch (x) { showErr(x); }
    });
  });
}
