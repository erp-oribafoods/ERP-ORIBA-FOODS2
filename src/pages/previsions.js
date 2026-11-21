// Prévisions de vente mensuelles par agent, marché, zone et dépôt, comparées aux objectifs et aux réalisations.
import { App, nm, pageHead } from '../app.js';
import { esc, $, $$, fmtF, fmtN, Table, modal, chart, palette, icon, showErr, busy, confirmBox } from '../lib/ui.js';
import { salesFacts, moisLabel } from '../lib/facts.js';
import { today, num } from '../../shared/logic.js';
import { prevoir, reviser, repartition, series, effets, coefMois, evenementsDuMois, moisSuivant, listeMois, LIB_EVT, EVENEMENTS } from '../../shared/prevision.js';

const AXES = { agent: 'Par agent', marche: 'Par marché', zone: 'Par zone', depot: 'Par dépôt', pics: 'Calendrier des pics' };
const COL = { real: '#1F4E79', prev: '#C55A11', obj: '#7F7F7F', rev: '#BF8F00' };
const MOIS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const libM = (m) => `${MOIS_LONG[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const pct = (a, b) => (b ? (a / b) * 100 : null);
const signe = (x, f) => (x === null || x === undefined ? '—' : `<b class="${x >= 0 ? 't-ok' : 't-crit'}">${x > 0 ? '+' : ''}${f(x)}</b>`);
const carte = (lib, val, cls, sous = '') => `<div class="tbc ${cls}"><span class="tbc-l">${lib}</span><span class="tbc-v">${val}</span>${sous ? `<span class="tbc-s">${sous}</span>` : ''}</div>`;

const F = () => (App.filters.prev = App.filters.prev || { axe: 'agent', mois: today().slice(0, 7), mesure: 'cartons', tous: false });

// Dépôt d'un agent : lui-même s'il tient un dépôt, sinon le dépôt auquel il est rattaché
const depotDe = (agentId) => { const a = App.I.agents.get(agentId); return a ? (a.role_circuit === 'depot' ? a.id : a.depot_id || null) : null; };

function entites(axe) {
  const D = App.D;
  if (axe === 'agent') return (D.agents || []).filter((a) => a.actif !== false).map((a) => ({ id: a.id, nom: a.nom, info: [nm.equipe(a.equipe_id), a.role_circuit === 'depot' ? 'Dépôt' : ''].filter((x) => x && x !== '—').join(' · ') }));
  if (axe === 'marche') return (D.marches || []).filter((m) => m.actif !== false).map((m) => ({ id: m.id, nom: m.nom, info: nm.zone(m.zone_id) }));
  if (axe === 'zone') return (D.zones || []).filter((z) => z.actif !== false).map((z) => ({ id: z.id, nom: z.nom, info: '' }));
  return (D.agents || []).filter((a) => a.role_circuit === 'depot' && a.actif !== false).map((a) => ({ id: a.id, nom: a.nom, info: [a.responsable, nm.zone(a.zone_id)].filter((x) => x && x !== '—').join(' · ') }));
}
const cleFait = { agent: (f) => f.agent_id, marche: (f) => f.marche_id, zone: (f) => f.zone_id, depot: (f) => depotDe(f.agent_id) };

// Objectif d'une entité pour un mois : objectif fixé sur l'axe, sinon somme des objectifs de ses agents
function objectifs(axe, mesure) {
  const champ = mesure === 'cartons' ? 'objectif_cartons' : 'objectif_ca';
  const out = new Map(); // id -> Map(mois -> valeur)
  const add = (id, m, v) => { if (!id || v === null || v === undefined) return; if (!out.has(id)) out.set(id, new Map()); const x = out.get(id); x.set(m, (x.get(m) || 0) + num(v)); };
  const objs = (App.D.objectifs || []).filter((o) => o.actif !== false && !o.produit_id);
  const directs = objs.filter((o) => o.axe === axe);
  for (const o of directs) add(o.cible_id, o.mois, o[champ]);
  if (axe === 'agent') return out;
  const fixes = new Set(directs.filter((o) => o[champ] !== null && o[champ] !== undefined).map((o) => `${o.cible_id}|${o.mois}`));
  for (const o of objs.filter((x) => x.axe === 'agent')) {
    const a = App.I.agents.get(o.cible_id); if (!a) continue;
    const id = axe === 'marche' ? a.marche_id : axe === 'zone' ? a.zone_id || App.I.marches.get(a.marche_id)?.zone_id : depotDe(a.id);
    if (id && !fixes.has(`${id}|${o.mois}`)) add(id, o.mois, o[champ]);
  }
  return out;
}

// Calcul complet pour un axe
export function calculer(axe, moisCible, mesure) {
  const t = today(), mc = t.slice(0, 7), dernier = moisSuivant(mc, -1);
  const eff = effets(App.I.p), croissanceMax = num(App.I.p.prev_croissance_max ?? 10);
  const faits = salesFacts(App.I, { preset: 'perso', du: '2000-01-01', au: t });
  const debut = faits.reduce((m, f) => (!m || f.mois < m ? f.mois : m), null);
  const S = series(faits, cleFait[axe], mesure), O = objectifs(axe, mesure);
  const venteMoisCourant = faits.some((f) => f.mois === mc);
  const horizon = [moisCible, moisSuivant(moisCible), moisSuivant(moisCible, 2), moisSuivant(moisCible, 3)];
  const rows = entites(axe).map((e) => {
    const s = S.get(e.id) || new Map(), o = O.get(e.id) || new Map();
    const dernierObj = [...o.entries()].sort((a, b) => b[0].localeCompare(a[0]))[0]?.[1] ?? null;
    const pv = (m) => prevoir(s, m, { debut, dernier, eff, croissanceMax, base: o.get(m) ?? dernierObj });
    const p0 = pv(moisCible);
    const obj = o.has(moisCible) ? o.get(moisCible) : null;
    const real = moisCible <= mc ? num(s.get(moisCible)) : null;
    const rev = moisCible === mc && venteMoisCourant ? reviser(p0.valeur, real, mc, t, eff) : null;
    const ecRO = real !== null && obj !== null ? real - obj : null;
    const ecRP = real === null ? null : moisCible === mc ? (rev ? real - rev.attendu : null) : real - p0.valeur;
    const futurs = horizon.slice(1).map((m) => pv(m).valeur);
    const histo = debut ? listeMois(debut, dernier).map((m) => num(s.get(m))) : [];
    return { id: e.id, nom: e.nom, info: e.info, obj, prev: p0.valeur, source: p0.source, tendance: p0.tendance, real, rev, ecRO, ecRP, tRO: real !== null ? pct(real, obj) : null,
      ecPO: obj !== null ? p0.valeur - obj : null, f1: futurs[0], f2: futurs[1], f3: futurs[2], actif: histo.some((x) => x > 0) || obj !== null || num(real) > 0, serie: s, objMois: o, pv };
  });
  return { rows, debut, dernier, mc, eff, horizon, venteMoisCourant, faits };
}

export function renderPrevisions(root) {
  const f = F();
  const fmt = (x) => (f.mesure === 'cartons' ? `${fmtN(x, 0)} ctn` : fmtF(x));
  root.innerHTML = pageHead('Prévisions de vente', 'Prévision mensuelle construite à partir des ventes déjà enregistrées et des objectifs, ajustée aux périodes de pic (Ramadan, Korité, Tabaski, fêtes, rentrée) et à l’hivernage, puis comparée aux réalisations.', '') +
    `<div class="seg onglets" role="tablist">${Object.entries(AXES).map(([k, l]) => `<button data-axe="${k}" class="${f.axe === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="filters" id="pv-f" ${f.axe === 'pics' ? 'hidden' : ''}>
      <label class="ff"><span>Mois</span><input type="month" id="pv-m" value="${f.mois}"></label>
      <div class="seg" role="group"><button data-mes="cartons" class="${f.mesure === 'cartons' ? 'on' : ''}" type="button">En cartons</button><button data-mes="montant" class="${f.mesure === 'montant' ? 'on' : ''}" type="button">En FCFA</button></div>
      <label class="chk"><input type="checkbox" id="pv-tous" ${f.tous ? 'checked' : ''}> <span>Afficher aussi les entités sans vente ni objectif</span></label>
    </div><div id="pv-host"></div>`;
  $$('[data-axe]', root).forEach((b) => b.addEventListener('click', () => { f.axe = b.dataset.axe; renderPrevisions(root); }));
  $('#pv-m', root).addEventListener('change', (e) => { f.mois = e.target.value || today().slice(0, 7); draw(); });
  $$('[data-mes]', root).forEach((b) => b.addEventListener('click', () => { f.mesure = b.dataset.mes; renderPrevisions(root); }));
  $('#pv-tous', root).addEventListener('change', (e) => { f.tous = e.target.checked; draw(); });
  const host = $('#pv-host', root);
  const draw = () => (f.axe === 'pics' ? calendrier(host) : vueAxe(host, fmt));
  draw();
}

function vueAxe(root, fmt) {
  const f = F(), C = calculer(f.axe, f.mois, f.mesure);
  const { rows, mc, horizon } = C;
  const vis = rows.filter((r) => f.tous || r.actif);
  const enCours = f.mois === mc, passe = f.mois < mc, futur = f.mois > mc;
  const S = (k) => vis.reduce((s, r) => s + num(r[k]), 0);
  const avecObj = vis.filter((r) => r.obj !== null);
  const totObj = S('obj'), realObj = avecObj.reduce((s, r) => s + num(r.real), 0), totPrev = S('prev'), totReal = S('real'), totRev = vis.reduce((s, r) => s + num(r.rev ? r.rev.projection : r.prev), 0), totAtt = vis.reduce((s, r) => s + num(r.rev?.attendu), 0);
  const evts = evenementsDuMois(f.mois), coef = coefMois(f.mois, C.eff);
  const nomAxe = { agent: 'agent', marche: 'marché', zone: 'zone', depot: 'dépôt' }[f.axe];
  root.innerHTML = `
    ${enCours && !C.venteMoisCourant ? `<p class="note">Aucune vente n’est encore saisie pour ${libM(mc)} : la prévision du mois est affichée, mais l’écart avec le réalisé et la projection révisée apparaîtront dès les premières saisies.</p>` : ''}
    <section class="tbc-grid">
      ${carte(`Objectif ${libM(f.mois)}`, avecObj.length ? fmt(totObj) : 'Non fixé', 'marine', `${avecObj.length} ${nomAxe}(s) avec objectif`)}
      ${carte('Prévision du mois', fmt(totPrev), 'ambre', `coefficient saisonnier ${fmtN(coef, 2)}${evts.length ? ' · ' + [...new Set(evts.map((e) => LIB_EVT[e.cle]))].join(', ') : ''}`)}
      ${carte(futur ? 'Réalisé' : enCours ? 'Réalisé à ce jour' : 'Réalisé', futur ? '—' : fmt(totReal), 'bleu', enCours && C.venteMoisCourant ? `attendu à ce jour : ${fmt(totAtt)}` : '')}
      ${carte('Écart réalisé − objectif', futur || !avecObj.length ? '—' : `${realObj - totObj >= 0 ? '+' : ''}${fmt(realObj - totObj)}`, realObj >= totObj ? 'vert' : 'rouge', avecObj.length && !futur ? `${fmtN(pct(realObj, totObj) || 0, 0)} % de l’objectif (agents avec objectif)`.replace('agents', { agent: 'agents', marche: 'marchés', zone: 'zones', depot: 'dépôts' }[f.axe]) : '')}
      ${carte('Écart réalisé − prévision', futur || (enCours && !C.venteMoisCourant) ? '—' : `${(enCours ? totReal - totAtt : totReal - totPrev) >= 0 ? '+' : ''}${fmt(enCours ? totReal - totAtt : totReal - totPrev)}`, 'violet', enCours ? 'par rapport à ce qui était attendu à ce jour' : '')}
      ${carte(enCours ? 'Projection révisée fin de mois' : 'Écart prévision − objectif', enCours ? (C.venteMoisCourant ? fmt(totRev) : '—') : avecObj.length ? `${totPrev - totObj >= 0 ? '+' : ''}${fmt(totPrev - totObj)}` : '—', 'clair', enCours ? 'selon le rythme réellement observé' : 'risque ou marge par rapport à l’objectif')}
    </section>
    <div class="grid2"><article class="card"><header><h3>Réalisé, objectif et prévision par mois</h3><span class="muted small">total des ${nomAxe}s affichés</span></header><div class="cv h300"><canvas id="pv-g1"></canvas></div></article>
      <article class="card"><header><h3>Prévision ${libM(f.mois)} semaine par semaine</h3><span class="muted small">la prévision suit la montée des pics au lieu de rester plate</span></header><div class="cv h300"><canvas id="pv-g2"></canvas></div></article></div>
    <article class="card"><header><h3>Objectif, prévision et réalisé — ${libM(f.mois)}</h3><span class="muted small">cliquez sur une ligne pour voir le détail</span></header><div id="pv-t"></div>
      ${f.axe !== 'depot' && App.can('objectifs', 'modifier') ? `<div class="form-act"><button class="btn" id="pv-obj">${icon('check')} Proposer les prévisions comme objectifs de ${libM(horizon[1])}</button></div>` : ''}</article>
    <details class="card methode"><summary><b>Comment la prévision est calculée</b></summary><ol>
      <li>Les ventes validées de chaque ${nomAxe} sont totalisées mois par mois.</li>
      <li>Chaque mois passé est corrigé de son effet saisonnier (un mois de Ramadan ou de Tabaski n’est pas comparé tel quel à un mois d’hivernage).</li>
      <li>Le niveau de base est la moyenne des 3 derniers mois corrigés, le mois le plus récent pesant le plus (poids 1, 2, 3).</li>
      <li>La tendance (hausse ou baisse entre les mois anciens et récents) est prolongée, limitée à ${fmtN(num(App.I.p.prev_croissance_max ?? 10), 0)} % par mois et atténuée avec le temps.</li>
      <li>La prévision du mois = niveau × tendance × coefficient du mois. Le coefficient monte à l’approche des pics : Ramadan +${C.eff.ramadan} %, Korité +${C.eff.korite} %, Tabaski +${C.eff.tabaski} %, Maouloud +${C.eff.maouloud} %, rentrée +${C.eff.rentree} %, fêtes +${C.eff.fetes} %, hivernage ${C.eff.hivernage} % (réglables dans Administration › Paramètres › Prévisions).</li>
      <li>Pendant le mois en cours, la projection est revue chaque jour avec le rythme réellement constaté. Pour un mois passé, la prévision est celle qu’on aurait faite au début du mois, avec les seules données connues alors : l’écart mesure la fiabilité de la méthode.</li>
      <li>Sans historique de ventes, l’objectif sert de base (signalé « base objectif »). Plus les mois de ventes s’accumulent, plus la prévision s’affine.</li></ol></details>`;

  // Graphique mensuel
  const mois = listeMois(C.debut && C.debut < f.mois ? C.debut : moisSuivant(f.mois, -2), moisSuivant(f.mois, 3));
  const tot = (fn) => mois.map((m) => vis.reduce((s, r) => s + num(fn(r, m)), 0));
  const reals = tot((r, m) => (m <= mc ? r.serie.get(m) : null));
  const objs = tot((r, m) => r.objMois.get(m));
  const prevs = tot((r, m) => r.pv(m).valeur);
  chart($('#pv-g1', root), { type: 'bar', money: f.mesure !== 'cartons', data: { labels: mois.map(moisLabel), datasets: [
    { label: 'Réalisé', data: mois.map((m, i) => (m <= mc ? reals[i] : null)), backgroundColor: COL.real, borderRadius: 3, order: 3 },
    { type: 'line', label: 'Objectif', data: objs.map((v) => v || null), borderColor: COL.obj, backgroundColor: COL.obj, borderDash: [6, 4], pointRadius: 3, order: 2 },
    { type: 'line', label: 'Prévision', data: prevs, borderColor: COL.prev, backgroundColor: COL.prev, tension: 0.3, borderWidth: 2.5, pointRadius: 3, order: 1 }] },
    tip: (c) => `${c.dataset.label} : ${fmt(c.parsed.y)}` });
  // Répartition hebdomadaire progressive
  const jours = repartition(f.mois, totPrev, C.eff);
  const sem = []; for (const j of jours) { const d = new Date(j.date + 'T12:00:00Z'), k = Math.floor((d.getUTCDate() - 1) / 7); sem[k] = sem[k] || { l: `${String(k * 7 + 1).padStart(2, '0')}–${String(Math.min(k * 7 + 7, jours.length)).padStart(2, '0')}`, prev: 0, real: 0, evt: new Set() }; sem[k].prev += j.prev; for (const e of EVENEMENTS) if (j.date >= e.du && j.date <= e.au) sem[k].evt.add(LIB_EVT[e.cle]); }
  for (const fx of C.faits.filter((x) => x.mois === f.mois && vis.some((r) => r.id === cleFait[f.axe](x)))) { const k = Math.floor((+fx.date.slice(8, 10) - 1) / 7); if (sem[k]) sem[k].real += num(fx[f.mesure]); }
  chart($('#pv-g2', root), { type: 'bar', money: f.mesure !== 'cartons', data: { labels: sem.map((s) => `${s.l}${s.evt.size ? ' ★' : ''}`), datasets: [
    { label: 'Prévision', data: sem.map((s) => Math.round(s.prev * 10) / 10), backgroundColor: sem.map((s) => (s.evt.size ? '#C55A11' : '#F4B183')), borderRadius: 3 },
    ...(f.mois <= mc ? [{ label: 'Réalisé', data: sem.map((s) => s.real), backgroundColor: COL.real, borderRadius: 3 }] : [])] },
    tip: (c) => `${c.dataset.label} : ${fmt(c.parsed.y)}${sem[c.dataIndex].evt.size ? ` (${[...sem[c.dataIndex].evt].join(', ')})` : ''}` });

  // Tableau
  const f0 = (x) => (x === null || x === undefined ? '—' : fmt(x));
  const foot = (c, rs) => {
    if (c.k === 'nom') return '<b>Total</b>';
    if (['obj', 'prev', 'real', 'f1', 'f2', 'f3', 'ecRO', 'ecRP', 'proj'].includes(c.k)) { const v = rs.reduce((s, r) => s + num(c.v ? c.v(r) : r[c.k]), 0); return `<b>${fmt(v)}</b>`; }
    return '';
  };
  new Table({ rows: vis, sort: { k: 'prev', dir: -1 }, pageSize: 50, title: `Prévisions ${AXES[f.axe].toLowerCase()} — ${libM(f.mois)}`, foot, onRow: (r) => detail(r, C, fmt),
    cols: [
      { k: 'nom', l: nomAxe.charAt(0).toUpperCase() + nomAxe.slice(1), f: (r) => `<b>${esc(r.nom)}</b>${r.info ? `<br><span class="muted small">${esc(r.info)}</span>` : ''}`, txt: (r) => r.nom },
      { k: 'obj', l: 'Objectif du mois', num: 1, f: (r) => f0(r.obj) },
      { k: 'prev', l: 'Prévision', num: 1, f: (r) => `${f0(r.prev)}${r.source === 'objectif' ? '<br><span class="muted small">base objectif</span>' : ''}` },
      ...(futur ? [] : [
        { k: 'real', l: enCours ? 'Réalisé à ce jour' : 'Réalisé', num: 1, f: (r) => `<b>${f0(r.real)}</b>` },
        { k: 'tRO', l: 'Taux / objectif', num: 1, f: (r) => (r.tRO === null ? '—' : `<div class="mini"><div class="bar ${r.tRO >= 100 ? 'ok' : r.tRO >= 70 ? '' : 'warn'}"><i style="width:${Math.min(100, r.tRO)}%"></i></div>${fmtN(r.tRO, 0)} %</div>`), txt: (r) => (r.tRO === null ? '' : `${fmtN(r.tRO, 0)} %`) },
        { k: 'ecRO', l: 'Écart réalisé − objectif', num: 1, f: (r) => signe(r.ecRO, fmt) },
        { k: 'ecRP', l: enCours ? 'Écart / attendu à ce jour' : 'Écart réalisé − prévision', num: 1, f: (r) => signe(r.ecRP, fmt) }]),
      ...(enCours ? [{ k: 'proj', l: 'Projection fin de mois', num: 1, v: (r) => (r.rev ? r.rev.projection : null), f: (r) => (r.rev ? fmt(r.rev.projection) : '—') }] : []),
      ...(futur ? [{ k: 'ecPO', l: 'Écart prévision − objectif', num: 1, f: (r) => signe(r.ecPO, fmt) }] : []),
      { k: 'tendance', l: 'Tendance', num: 1, f: (r) => (r.source !== 'historique' ? '—' : `<span class="${r.tendance > 0.005 ? 't-ok' : r.tendance < -0.005 ? 't-crit' : ''}">${r.tendance > 0.005 ? '↗' : r.tendance < -0.005 ? '↘' : '→'} ${fmtN(r.tendance * 100, 1)} %/mois</span>`), txt: (r) => `${fmtN(r.tendance * 100, 1)} %` },
      { k: 'f1', l: `Prévision ${moisLabel(horizon[1])}`, num: 1, f: (r) => f0(r.f1) }, { k: 'f2', l: `Prévision ${moisLabel(horizon[2])}`, num: 1, f: (r) => f0(r.f2) }, { k: 'f3', l: `Prévision ${moisLabel(horizon[3])}`, num: 1, f: (r) => f0(r.f3) }],
    empty: 'Aucune donnée : enregistrez des ventes ou des objectifs, ou cochez « Afficher aussi les entités sans vente ni objectif ».' }).mount($('#pv-t', root));

  $('#pv-obj', root)?.addEventListener('click', async (e) => {
    const btn = e.currentTarget, m1 = horizon[1], arr = (x) => (f.mesure === 'cartons' ? Math.ceil(x / 5) * 5 : Math.ceil(x / 50000) * 50000);
    const lignes = vis.filter((r) => r.f1 > 0).map((r) => {
      const ex = (App.D.objectifs || []).find((o) => o.actif !== false && !o.produit_id && o.axe === f.axe && o.cible_id === r.id && o.mois === m1);
      return { cible_id: r.id, objectif_cartons: f.mesure === 'cartons' ? arr(r.f1) : ex?.objectif_cartons ?? null, objectif_ca: f.mesure === 'montant' ? arr(r.f1) : ex?.objectif_ca ?? null };
    });
    if (!lignes.length) return showErr(new Error('Aucune prévision positive à reprendre.'));
    const deja = (App.D.objectifs || []).some((o) => o.actif !== false && !o.produit_id && o.axe === f.axe && o.mois === m1);
    const motif = await confirmBox({ title: `Objectifs de ${libM(m1)}`, message: `${lignes.length} objectif(s) ${f.axe === 'agent' ? 'd’agents' : f.axe === 'marche' ? 'de marchés' : 'de zones'} seront fixés à la valeur prévue (arrondie ${f.mesure === 'cartons' ? 'aux 5 cartons' : 'aux 50 000 F'} supérieurs).${deja ? ' <b>Des objectifs existent déjà pour ce mois : ils seront remplacés pour ces lignes.</b>' : ''}`, motif: true, okLabel: 'Fixer les objectifs' });
    if (!motif) return;
    try { await busy(btn, () => App.act('objectif.bulk', { mois: m1, axe: f.axe, produit_id: null, lignes, motif }, 'Objectifs enregistrés.')); } catch (x) { showErr(x); }
  });
}

function detail(r, C, fmt) {
  if (!r) return;
  const f = F(), mois = listeMois(C.debut && C.debut < f.mois ? C.debut : moisSuivant(f.mois, -2), moisSuivant(f.mois, 5));
  const lignes = mois.map((m) => { const p = r.pv(m); const real = m <= C.mc ? num(r.serie.get(m)) : null; const obj = r.objMois.has(m) ? r.objMois.get(m) : null;
    return { m, real, obj, prev: p.source === 'aucune' ? null : p.valeur, coef: p.coef, evt: [...new Set(evenementsDuMois(m).map((e) => LIB_EVT[e.cle]))].join(', ') }; });
  modal({ title: `${r.nom} — prévisions`, wide: true, size: 'xl',
    body: `<p class="lead">${r.info ? esc(r.info) + ' · ' : ''}${r.source === 'historique' ? `prévision fondée sur l’historique des ventes, tendance ${fmtN(r.tendance * 100, 1)} % par mois` : r.source === 'objectif' ? 'pas encore d’historique de ventes : l’objectif sert de base' : 'ni vente ni objectif enregistrés'}</p>
      <div class="cv h300"><canvas id="pvd-g"></canvas></div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Mois</th><th>Période de pic</th><th class="n">Coef.</th><th class="n">Objectif</th><th class="n">Prévision</th><th class="n">Réalisé</th><th class="n">Écart réalisé − objectif</th><th class="n">Écart réalisé − prévision</th></tr></thead>
      <tbody>${lignes.map((l) => `<tr${l.m === f.mois ? ' class="sel"' : ''}><td><b>${libM(l.m)}</b></td><td>${esc(l.evt || '—')}</td><td class="n">${fmtN(l.coef, 2)}</td><td class="n">${l.obj === null ? '—' : fmt(l.obj)}</td><td class="n">${l.prev === null ? '—' : fmt(l.prev)}</td><td class="n">${l.real === null ? '—' : fmt(l.real)}</td>
        <td class="n">${l.real !== null && l.obj !== null && l.m !== C.mc ? signe(l.real - l.obj, fmt) : '—'}</td><td class="n">${l.real !== null && l.prev !== null && l.m !== C.mc ? signe(l.real - l.prev, fmt) : l.m === C.mc && r.rev ? signe(r.real - r.rev.attendu, fmt) + '<br><span class="muted small">à ce jour</span>' : '—'}</td></tr>`).join('')}</tbody></table></div>`,
    footer: '<button class="btn ghost" data-close>Fermer</button>',
    onMount: (m) => {
      chart($('#pvd-g', m), { type: 'bar', money: f.mesure !== 'cartons', data: { labels: lignes.map((l) => moisLabel(l.m)), datasets: [
        { label: 'Réalisé', data: lignes.map((l) => l.real), backgroundColor: COL.real, borderRadius: 3, order: 3 },
        { type: 'line', label: 'Objectif', data: lignes.map((l) => l.obj), borderColor: COL.obj, backgroundColor: COL.obj, borderDash: [6, 4], order: 2 },
        { type: 'line', label: 'Prévision', data: lignes.map((l) => l.prev), borderColor: COL.prev, backgroundColor: COL.prev, tension: 0.3, borderWidth: 2.5, order: 1 }] }, tip: (c) => `${c.dataset.label} : ${fmt(c.parsed.y)}` });
    } });
}

function calendrier(root) {
  const eff = effets(App.I.p), m0 = today().slice(0, 7), mois = listeMois(moisSuivant(m0, -2), moisSuivant(m0, 15));
  const pal = palette();
  root.innerHTML = `<article class="card"><header><h3>Coefficient saisonnier par mois</h3><span class="muted small">1,00 = mois normal ; au-dessus, la prévision est relevée</span></header><div class="cv h300"><canvas id="pc-g"></canvas></div></article>
    <article class="card"><header><h3>Périodes de pic et de creux retenues</h3><span class="muted small">dates des fêtes religieuses estimées, à confirmer selon l’annonce officielle</span></header><div id="pc-t"></div>
    <p class="muted small">Les pourcentages se règlent dans Administration › Paramètres › Prévisions.</p></article>`;
  const c = mois.map((m) => coefMois(m, eff));
  chart($('#pc-g', root), { type: 'bar', legend: false, money: false, data: { labels: mois.map(moisLabel), datasets: [{ label: 'Coefficient', data: c.map((x) => Math.round(x * 100) / 100), backgroundColor: c.map((x) => (x > 1.03 ? '#C55A11' : x < 0.97 ? '#5B9BD5' : pal[7])), borderRadius: 3 }] },
    yfmt: (v) => fmtN(v, 2), tip: (x) => `Coefficient ${fmtN(x.parsed.y, 2)}${evenementsDuMois(mois[x.dataIndex]).length ? ' — ' + [...new Set(evenementsDuMois(mois[x.dataIndex]).map((e) => LIB_EVT[e.cle]))].join(', ') : ''}` });
  const fin = moisSuivant(m0, 16) + '-01';
  new Table({ rows: EVENEMENTS.filter((e) => e.au >= `${moisSuivant(m0, -2)}-01` && e.du < fin).map((e, i) => ({ id: i, ...e, effet: eff[e.cle] })), sort: { k: 'du', dir: 1 }, pageSize: 30, exportable: true, title: 'Périodes de pic',
    cols: [{ k: 'nom', l: 'Période', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'du', l: 'Du', f: (r) => r.du.split('-').reverse().join('/') }, { k: 'au', l: 'Au', f: (r) => r.au.split('-').reverse().join('/') },
      { k: 'effet', l: 'Effet sur les ventes', num: 1, f: (r) => `<b class="${r.effet >= 0 ? 't-ok' : 't-crit'}">${r.effet > 0 ? '+' : ''}${r.effet} %</b>`, txt: (r) => `${r.effet} %` }] }).mount($('#pc-t', root));
}
