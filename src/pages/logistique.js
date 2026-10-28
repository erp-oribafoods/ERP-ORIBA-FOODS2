// Logistique : parc de véhicules, documents (assurance, vignette, visite technique), entretien, réparations, carburant.
import { App, nm, filterBar, describeFilters, pageHead } from '../app.js';
import { esc, $, $$, fmtF, fmtN, fmtD, Table, pill, icon, chart, palette } from '../lib/ui.js';
import { periodRange, monthsBetween, moisLabel } from '../lib/facts.js';
import { documentsVehicule, today, num } from '../../shared/logic.js';
import { CATS_LOGISTIQUE, STATUTS_DEPENSE } from '../../shared/schema.js';
import { depenseForm, openDepense, ficheVehicule } from './depenses.js';

const catCode = (id) => App.I.categories.get(id)?.code;

export function renderLogistique(root) {
  const canNew = App.can('depenses', 'creer');
  root.innerHTML = pageHead('Logistique et véhicules', 'Parc roulant du service commercial : documents à jour, entretien, réparations, carburant et coût par véhicule.',
    `${App.can('referentiels', 'modifier') ? `<button class="btn" id="newveh">${icon('plus')} Ajouter un véhicule</button>` : ''}${canNew ? `<button class="btn primary" id="newdep">${icon('plus')} Nouvelle dépense logistique</button>` : ''}`) +
    '<div id="flt"></div><div id="lg"></div>';
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
