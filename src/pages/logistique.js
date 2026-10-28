// Logistique : parc de véhicules, documents (assurance, vignette, visite technique), entretien, réparations, carburant.
import { App, nm, filterBar, describeFilters, pageHead } from '../app.js';
import { esc, $, $$, fmtF, fmtN, fmtD, Table, pill, icon, chart, palette } from '../lib/ui.js';
import { boutonImport, lierImport } from '../lib/importer.js';
import { periodRange, monthsBetween, moisLabel, salesFacts } from '../lib/facts.js';
import { documentsVehicule, depenseAllocations, today, num } from '../../shared/logic.js';
import { CATS_LOGISTIQUE, STATUTS_DEPENSE } from '../../shared/schema.js';
import { depenseForm, openDepense, ficheVehicule } from './depenses.js';

const catCode = (id) => App.I.categories.get(id)?.code;

export function renderLogistique(root) {
  const canNew = App.can('depenses', 'creer');
  App.filters.logTab = App.filters.logTab || 'charges';
  root.innerHTML = pageHead('Logistique et charges', 'Charges de la force de vente par nature et coût par carton vendu ; parc roulant, documents des véhicules, entretien et réparations.',
    `${boutonImport('depenses')}${App.can('referentiels', 'modifier') ? `<button class="btn" id="newveh">${icon('plus')} Ajouter un véhicule</button>` : ''}${canNew ? `<button class="btn primary" id="newdep">${icon('plus')} Nouvelle dépense logistique</button>` : ''}`) +
    `<div class="tabs" role="tablist"><button role="tab" data-lt="charges" class="${App.filters.logTab === 'charges' ? 'on' : ''}">Charges du mois et coût par carton</button><button role="tab" data-lt="parc" class="${App.filters.logTab === 'parc' ? 'on' : ''}">Parc de véhicules et entretien</button></div>
    <div id="flt"></div><div id="lg"></div>`;
  lierImport(root);
  $$('[data-lt]', root).forEach((b) => b.addEventListener('click', () => { App.filters.logTab = b.dataset.lt; App.rerender(); }));
  if (App.filters.logTab === 'charges') {
    $('#newdep', root)?.addEventListener('click', () => depenseForm(null));
    $('#newveh', root)?.addEventListener('click', () => import('./admin.js').then((x) => x.refFormPublic('vehicules')));
    return drawCharges(root);
  }
  const draw = () => {
    const f = App.filters.depenses;
    const [du, au] = periodRange(f);
    const deps = (App.D.depenses || []).filter((d) => CATS_LOGISTIQUE.includes(catCode(d.categorie_id)) && d.date >= du && d.date <= au && (!f.equipe_id || d.equipe_id === f.equipe_id) && (!f.vehicule_id || d.vehicule_id === f.vehicule_id));
    const val = deps.filter((d) => d.statut === 'validee');
    const sum = (codes) => val.filter((d) => codes.includes(catCode(d.categorie_id))).reduce((s, d) => s + num(d.montant), 0);
    const vehs = App.D.vehicules.filter((v) => (!f.equipe_id || v.equipe_id === f.equipe_id) && (!f.vehicule_id || v.id === f.vehicule_id));
    const fleet = vehs.map((v) => {
      const ds = val.filter((d) => d.vehicule_id === v.id);
      const vid = (App.D.depenses || []).filter((d) => d.vehicule_id === v.id && catCode(d.categorie_id) === 'VIDA' && d.statut !== 'annulee').sort((a, b) => b.date.localeCompare(a.date))[0];
      return { id: v.id, v, docs: documentsVehicule(v.id, App.I), tot: ds.reduce((s, d) => s + num(d.montant), 0), carb: ds.filter((d) => catCode(d.categorie_id) === 'CARB').reduce((s, d) => s + num(d.montant), 0),
        repa: ds.filter((d) => ['REPA', 'VIDA', 'FILT'].includes(catCode(d.categorie_id))).reduce((s, d) => s + num(d.montant), 0), vidange: vid, actif: v.actif !== false };
    });
    const docs = fleet.flatMap((x) => x.docs.map((d) => ({ ...d, v: x.v })));
    const expired = docs.filter((d) => d.etat === 'expire'), soon = docs.filter((d) => d.etat === 'bientot'), missing = docs.filter((d) => d.etat === 'absent');
    const host = $('#lg', root);
    host.innerHTML = `<section class="kpis">
      ${[['Coût logistique validé', fmtF(val.reduce((s, d) => s + num(d.montant), 0)), `${val.length} opérations`, ''], ['Carburant', fmtF(sum(['CARB'])), '', ''], ['Entretien et réparations', fmtF(sum(['REPA', 'VIDA', 'FILT'])), 'vidanges, filtres, réparations', ''],
        ['Assurance, vignette, visite', fmtF(sum(['ASSU', 'VIGN', 'VTEC'])), '', ''], ['Autres frais (insalubrité, autorisations)', fmtF(sum(['INSA', 'AUTO'])), '', ''],
        ['Documents expirés', fmtN(expired.length), expired.map((d) => d.label).slice(0, 2).join(', '), expired.length ? 'crit' : ''], ['À renouveler sous 30 jours', fmtN(soon.length), '', soon.length ? 'warn' : ''], ['Véhicules', fmtN(fleet.filter((x) => x.actif).length), `${missing.length} document(s) non renseigné(s)`, '']]
        .map(([l, v, s, c]) => `<div class="kpi static ${c}"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span>${s ? `<span class="kpi-s">${esc(s)}</span>` : ''}</div>`).join('')}</section>
      ${expired.length || soon.length ? `<article class="card"><header><h3>Documents à régulariser</h3></header><ul class="alerts">${[...expired, ...soon].map((d) => `<li class="al ${d.etat === 'expire' ? 'crit' : 'warn'}" data-veh="${d.v.id}" tabindex="0"><b>${esc(d.label)} ${d.etat === 'expire' ? 'expirée' : 'à renouveler'}</b><span>${esc(d.v.immatriculation)} — ${d.etat === 'expire' ? `expirée depuis le ${fmtD(d.fin)}` : `valable jusqu’au ${fmtD(d.fin)} (${d.jours} j)`}</span></li>`).join('')}</ul></article>` : ''}
      <article class="card"><header><h3>Parc de véhicules</h3></header><div id="fleet"></div></article>
      <section class="grid g2"><article class="card"><header><h3>Coûts logistiques par mois</h3></header><div class="cv h260"><canvas id="l-mois"></canvas></div></article>
        <article class="card"><header><h3>Coût par véhicule</h3></header><div class="cv h260"><canvas id="l-veh"></canvas></div></article></section>
      <article class="card"><header><h3>Opérations logistiques</h3></header><div id="ops"></div></article>`;
    $$('[data-veh]', host).forEach((li) => li.addEventListener('click', () => ficheVehicule(li.dataset.veh)));
    const docCol = (code, label) => ({ k: code, l: label, v: (r) => r.docs.find((d) => d.code === code)?.fin || '', f: (r) => { const d = r.docs.find((x) => x.code === code); return d.fin ? `${fmtD(d.fin)}<br>${d.etat === 'expire' ? pill('Expirée', 'crit') : d.etat === 'bientot' ? pill(`Dans ${d.jours} j`, 'warn') : pill('À jour', 'ok')}` : pill('Non renseignée', 'mute'); } });
    new Table({ title: 'Parc de véhicules', rows: fleet, sort: { k: 'tot', dir: -1 }, onRow: (r) => ficheVehicule(r.id), meta: () => `Filtres : ${describeFilters('depenses')}`,
      cols: [{ k: 'immat', l: 'Véhicule', v: (r) => r.v.immatriculation, cls: 'wrap' }, { k: 'modele', l: 'Modèle', v: (r) => r.v.modele || '' }, { k: 'equipe', l: 'Équipe', v: (r) => nm.equipe(r.v.equipe_id) }, { k: 'cond', l: 'Conducteur', v: (r) => r.v.conducteur || '' },
        docCol('ASSU', 'Assurance'), docCol('VIGN', 'Vignette'), docCol('VTEC', 'Visite technique'),
        { k: 'vid', l: 'Dernière vidange', v: (r) => r.vidange?.date || '', f: (r) => (r.vidange ? `${fmtD(r.vidange.date)}${r.vidange.kilometrage ? `<br><small>${fmtN(r.vidange.kilometrage)} km</small>` : ''}` : '—') },
        { k: 'carb', l: 'Carburant', num: 1, f: (r) => fmtN(r.carb) }, { k: 'repa', l: 'Entretien / réparations', num: 1, f: (r) => fmtN(r.repa) }, { k: 'tot', l: 'Coût total', num: 1, f: (r) => `<b>${fmtN(r.tot)}</b>` }] }).mount($('#fleet', host));
    const pal = palette();
    const months = monthsBetween(val.map((d) => d.date).sort()[0] || today(), au > today() ? today() : au);
    const groups = [['Carburant', ['CARB']], ['Entretien et réparations', ['REPA', 'VIDA', 'FILT']], ['Assurance, vignette, visite', ['ASSU', 'VIGN', 'VTEC']], ['Autres frais', ['INSA', 'AUTO']]];
    chart($('#l-mois', host), { type: 'bar', stacked: true, data: { labels: months.map(moisLabel), datasets: groups.map(([l, codes], i) => ({ label: l, data: months.map((m) => val.filter((d) => d.mois === m && codes.includes(catCode(d.categorie_id))).reduce((s, d) => s + num(d.montant), 0)), backgroundColor: pal[i] })) } });
    const fv = fleet.filter((x) => x.tot).sort((a, b) => b.tot - a.tot).slice(0, 12);
    chart($('#l-veh', host), { type: 'bar', horizontal: true, stacked: true, data: { labels: fv.map((x) => x.v.immatriculation.slice(0, 28)), datasets: [{ label: 'Carburant', data: fv.map((x) => x.carb), backgroundColor: pal[0] }, { label: 'Entretien / réparations', data: fv.map((x) => x.repa), backgroundColor: pal[1] }, { label: 'Documents et autres', data: fv.map((x) => x.tot - x.carb - x.repa), backgroundColor: pal[2] }] } });
    new Table({ title: 'Opérations logistiques', rows: deps, sort: { k: 'date', dir: -1 }, onRow: (r) => openDepense(r.id), meta: () => `Filtres : ${describeFilters('depenses')}`,
      foot: (c, rs) => (c.k === 'montant' ? `<b>${fmtN(rs.filter((r) => r.statut === 'validee').reduce((s, r) => s + num(r.montant), 0))}</b>` : c.k === 'numero' ? '<b>Total validé</b>' : ''),
      cols: [{ k: 'numero', l: 'N°' }, { k: 'date', l: 'Date', f: (r) => fmtD(r.date) }, { k: 'cat', l: 'Nature', v: (r) => nm.categorie(r.categorie_id) }, { k: 'veh', l: 'Véhicule', v: (r) => (r.vehicule_id ? nm.vehicule(r.vehicule_id) : '—'), cls: 'wrap' },
        { k: 'equipe', l: 'Équipe', v: (r) => nm.equipe(r.equipe_id) }, { k: 'benef', l: 'Prestataire', v: (r) => r.beneficiaire || '' }, { k: 'km', l: 'Km', num: 1, v: (r) => r.kilometrage || '' },
        { k: 'validite', l: 'Valable jusqu’au', v: (r) => r.validite_fin || '', f: (r) => fmtD(r.validite_fin) }, { k: 'montant', l: 'Montant', num: 1, f: (r) => fmtN(r.montant) },
        { k: 'statut', l: 'Statut', v: (r) => STATUTS_DEPENSE[r.statut] }] }).mount($('#ops', host));
  };
  filterBar($('#flt', root), 'depenses', ['periode', 'equipe_id', 'vehicule_id'], draw);
  $('#newdep', root)?.addEventListener('click', () => depenseForm(null, { categorie_id: App.D.categories_depense.find((c) => c.code === 'REPA')?.id }));
  $('#newveh', root)?.addEventListener('click', () => import('./admin.js').then((x) => x.refFormPublic('vehicules')));
  draw();
}

// ---------- Charges du mois et coût par carton ----------
const ENGAGE = ['soumise', 'controlee', 'a_completer', 'validee'];
function drawCharges(root) {
  const t = today();
  App.filters.charges = App.filters.charges || { mois: t.slice(0, 7), equipe_id: '', zone_id: '' };
  const F = App.filters.charges;
  $('#flt', root).innerHTML = `<div class="filters"><label class="ff"><span>Mois</span><input type="month" id="c-mois" value="${F.mois}"></label>
    <label class="ff"><span>Équipe</span><select id="c-eq"><option value="">Toutes</option>${App.D.equipes.map((e) => `<option value="${e.id}" ${F.equipe_id === e.id ? 'selected' : ''}>${esc(e.nom)}</option>`).join('')}</select></label>
    <label class="ff"><span>Zone</span><select id="c-zone"><option value="">Toutes</option>${App.D.zones.map((z) => `<option value="${z.id}" ${F.zone_id === z.id ? 'selected' : ''}>${esc(z.nom)}</option>`).join('')}</select></label></div>`;
  const I = App.I;
  const zoneOf = (d) => d.zone_id || I.equipes.get(d.equipe_id)?.zone_id;
  // Dépenses visibles + agrégats des dépenses sensibles (validées) pour les profils sans accès au détail
  const ag = (App.D.depenses_agregats || []).map((a) => ({ agrege: true, mois: a.mois, categorie_id: a.categorie_id, equipe_id: a.equipe_id, montant: a.montant, statut: 'validee', partagee: false }));
  const all = [...(App.D.depenses || []), ...ag].filter((d) => (!F.zone_id || zoneOf(d) === F.zone_id));
  const part = (d) => (F.equipe_id ? depenseAllocations(d, I).filter((a) => a.equipe_id === F.equipe_id).reduce((s, a) => s + a.montant, 0) : num(d.montant));
  const cartons = (mois) => salesFacts(I, { preset: 'perso', du: `${mois}-01`, au: `${mois}-31`, equipe_id: F.equipe_id, zone_id: F.zone_id }).reduce((s, x) => s + x.cartons, 0);
  const totaux = (mois) => {
    const ds = all.filter((d) => d.mois === mois);
    const byCat = new Map();
    let eng = 0, val = 0;
    for (const d of ds) {
      const m = part(d); if (!m) continue;
      if (ENGAGE.includes(d.statut)) { eng += m; const o = byCat.get(d.categorie_id) || { eng: 0, val: 0 }; o.eng += m; if (d.statut === 'validee') o.val += m; byCat.set(d.categorie_id, o); }
      if (d.statut === 'validee') val += m;
    }
    return { eng, val, byCat, ctn: cartons(mois) };
  };
  const cur = totaux(F.mois), prev = totaux(moisPrecedent(F.mois));
  const annee = monthsBetween(`${F.mois.slice(0, 4)}-01-01`, `${F.mois}-01`);
  const histoAll = annee.map((m) => ({ id: m, mois: m, ...totaux(m) }));
  const first = histoAll.findIndex((h) => h.eng || h.ctn);
  const histo = first < 0 ? histoAll.slice(-1) : histoAll.slice(first);
  const cumulCat = new Map(); for (const h of histo) for (const [k, o] of h.byCat) cumulCat.set(k, (cumulCat.get(k) || 0) + o.val);
  const cpc = (x, k) => (x.ctn ? x[k] / x.ctn : null);
  const host = $('#lg', root);
  host.innerHTML = `<section class="kpis">
      ${[['Dépenses totales engagées', fmtF(cur.eng), `${moisLabel(F.mois)} · validées et en cours de validation`, ''], ['Dont validées', fmtF(cur.val), `${fmtF(cur.eng - cur.val)} en attente`, ''],
        ['Cartons vendus', `${fmtN(cur.ctn, 2)} ctn`, 'ventes validées du mois, même périmètre', ''],
        ['Coût par carton', cpc(cur, 'eng') !== null ? fmtF(cpc(cur, 'eng')) : '—', 'dépenses totales engagées ÷ cartons vendus', ''],
        ['Coût par carton (validé)', cpc(cur, 'val') !== null ? fmtF(cpc(cur, 'val')) : '—', prev.ctn && cpc(prev, 'val') !== null ? `mois précédent : ${fmtF(cpc(prev, 'val'))}` : '', '']]
        .map(([l, v, s, c]) => `<div class="kpi static ${c}"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span>${s ? `<span class="kpi-s">${s}</span>` : ''}</div>`).join('')}</section>
    <p class="note">Formule du cahier des charges : <b>coût commercial par carton = dépenses totales ÷ nombre de cartons vendus</b> sur le même mois et le même périmètre. Exemple : 1 200 000 FCFA ÷ 4 000 cartons = 300 FCFA par carton.</p>
    <article class="card"><header><h3>Charges de ${moisLabel(F.mois)} par nature</h3></header><div id="c-tab"></div></article>
    <section class="grid g2"><article class="card"><header><h3>Charges et coût par carton, mois par mois</h3></header><div class="cv h260"><canvas id="c-ch"></canvas></div></article>
      <article class="card"><header><h3>Répartition des charges du mois</h3></header><div class="cv h260"><canvas id="c-pie"></canvas></div></article></section>
    <article class="card"><header><h3>Évolution depuis janvier</h3></header><div id="c-hist"></div></article>`;
  const cats = App.D.categories_depense.slice().sort((a, b) => DEFAULT_ORDER(a) - DEFAULT_ORDER(b));
  const rows = cats.map((c) => { const o = cur.byCat.get(c.id) || { eng: 0, val: 0 }; const p = prev.byCat.get(c.id)?.val || 0; return { id: c.id, nature: c.libelle, eng: o.eng, val: o.val, prev: p, var: o.val - p, part: cur.eng ? (o.eng / cur.eng) * 100 : 0, cumul: cumulCat.get(c.id) || 0, parCarton: cur.ctn ? o.eng / cur.ctn : 0 }; });
  new Table({ title: `Charges ${F.mois}`, rows, pageSize: 30, sort: null, meta: () => `Mois : ${moisLabel(F.mois)}${F.equipe_id ? ' · équipe ' + nm.equipe(F.equipe_id) : ''}${F.zone_id ? ' · zone ' + nm.zone(F.zone_id) : ''} · cartons vendus : ${fmtN(cur.ctn, 2)}`,
    foot: (c, rs) => ({ nature: '<b>Dépenses totales</b>', eng: `<b>${fmtN(cur.eng)}</b>`, val: `<b>${fmtN(cur.val)}</b>`, prev: `<b>${fmtN(prev.val)}</b>`, var: `<b>${fmtN(cur.val - prev.val)}</b>`, part: '<b>100 %</b>', cumul: `<b>${fmtN(rs.reduce((s, r) => s + r.cumul, 0))}</b>`, parCarton: `<b>${cur.ctn ? fmtN(cur.eng / cur.ctn) : '—'}</b>` }[c.k] ?? ''),
    cols: [{ k: 'nature', l: 'Nature de la charge' }, { k: 'eng', l: 'Engagé du mois', num: 1, f: (r) => (r.eng ? `<b>${fmtN(r.eng)}</b>` : '—') }, { k: 'val', l: 'dont validé', num: 1, f: (r) => (r.val ? fmtN(r.val) : '—') },
      { k: 'prev', l: 'Mois précédent (validé)', num: 1, f: (r) => (r.prev ? fmtN(r.prev) : '—') }, { k: 'var', l: 'Variation', num: 1, f: (r) => (r.var ? `<span class="${r.var > 0 ? 't-crit' : 't-ok'}">${r.var > 0 ? '+' : ''}${fmtN(r.var)}</span>` : '—') },
      { k: 'part', l: 'Part', num: 1, f: (r) => (r.part ? `${fmtN(r.part, 1)} %` : '—') }, { k: 'parCarton', l: 'FCFA par carton', num: 1, f: (r) => (r.parCarton ? fmtN(r.parCarton, 1) : '—') }, { k: 'cumul', l: `Cumul ${F.mois.slice(0, 4)} (validé)`, num: 1, f: (r) => (r.cumul ? fmtN(r.cumul) : '—') }] }).mount($('#c-tab', host));
  const pal = palette();
  chart($('#c-ch', host), { type: 'bar', y2: true, data: { labels: histo.map((h) => moisLabel(h.mois)), datasets: [
    { type: 'bar', label: 'Dépenses engagées', data: histo.map((h) => h.eng), backgroundColor: pal[0], borderRadius: 3, yAxisID: 'y', order: 2 },
    { type: 'line', label: 'Coût par carton (FCFA)', data: histo.map((h) => (h.ctn ? Math.round(h.eng / h.ctn) : null)), borderColor: pal[1], backgroundColor: pal[1], yAxisID: 'y2', tension: 0.3, pointRadius: 3, order: 1 }] },
    tip: (c) => (c.dataset.yAxisID === 'y2' ? `Coût par carton : ${fmtF(c.parsed.y)}` : `Dépenses engagées : ${fmtF(c.parsed.y)}`) });
  const pie = rows.filter((r) => r.eng).sort((a, b) => b.eng - a.eng);
  chart($('#c-pie', host), { type: 'doughnut', cutout: '58%', legendPos: 'right', data: { labels: pie.map((r) => r.nature), datasets: [{ data: pie.map((r) => r.eng), backgroundColor: pie.map((_, i) => pal[i % pal.length]), borderWidth: 0 }] }, tip: (c) => `${c.label} : ${fmtF(c.parsed)} (${fmtN((c.parsed / (cur.eng || 1)) * 100, 1)} %)` });
  new Table({ title: `Évolution des charges ${F.mois.slice(0, 4)}`, rows: histo.slice().reverse(), pageSize: 12, sort: null,
    cols: [{ k: 'mois', l: 'Mois', f: (r) => moisLabel(r.mois) }, { k: 'eng', l: 'Dépenses engagées', num: 1, f: (r) => fmtN(r.eng) }, { k: 'val', l: 'dont validées', num: 1, f: (r) => fmtN(r.val) },
      { k: 'ctn', l: 'Cartons vendus', num: 1, f: (r) => fmtN(r.ctn, 2) }, { k: 'cpc', l: 'Coût par carton', num: 1, v: (r) => (r.ctn ? Math.round(r.eng / r.ctn) : 0), f: (r) => (r.ctn ? `<b>${fmtN(r.eng / r.ctn)}</b>` : '—') },
      { k: 'cpv', l: 'Coût par carton (validé)', num: 1, v: (r) => (r.ctn ? Math.round(r.val / r.ctn) : 0), f: (r) => (r.ctn ? fmtN(r.val / r.ctn) : '—') }] }).mount($('#c-hist', host));
  const go = (k) => (e) => { F[k] = e.target.value; drawCharges(root); };
  $('#c-mois', root).addEventListener('change', go('mois')); $('#c-eq', root).addEventListener('change', go('equipe_id')); $('#c-zone', root).addEventListener('change', go('zone_id'));
}
const ORDRE = ['CARB', 'VIDA', 'FILT', 'VIGN', 'PATE', 'ASSU', 'REPA', 'VTEC', 'CCAN', 'CCAA', 'SALA', 'GADG', 'INSA', 'AUTO', 'AUTR'];
const DEFAULT_ORDER = (c) => { const i = ORDRE.indexOf(c.code); return i < 0 ? 99 : i; };
const moisPrecedent = (m) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm - 2, 1)).toISOString().slice(0, 7); };
