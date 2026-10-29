// Objectifs commerciaux et suivi des réalisations par agent, zone, équipe, marché, produit et période.
import { App, nm, opts, pageHead } from '../app.js';
import { esc, $, $$, fmtF, fmtN, fmtQ, Table, modal, field, showErr, busy, toast, icon, pill, chart, palette } from '../lib/ui.js';
import { boutonImport, lierImport } from '../lib/importer.js';
import { salesFacts, monthsBetween, moisLabel } from '../lib/facts.js';
import { today, daysBetween, num } from '../../shared/logic.js';
import { AXES_OBJECTIF } from '../../shared/schema.js';

const AXE_SRC = { agent: ['agents', 'nom', (x) => x.agent_id], zone: ['zones', 'nom', (x) => x.zone_id], equipe: ['equipes', 'nom', (x) => x.equipe_id], marche: ['marches', 'nom', (x) => x.marche_id], produit: ['produits', 'nom', (x) => x.produit_id] };
const finMois = (m) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10); };
const moisPrec = (m) => { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 2, 1)); return d.toISOString().slice(0, 7); };

function cibles(axe) {
  if (axe === 'global') return [{ id: null, nom: 'Service commercial (tous)' }];
  const [table, label] = AXE_SRC[axe];
  return (App.D[table] || []).filter((r) => r.actif !== false).map((r) => ({ id: r.id, nom: r[label], equipe: axe === 'agent' ? nm.equipe(r.equipe_id) : '', fonction: axe === 'agent' ? r.fonction || '' : '' })).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

export function suivi(axe, moisDu, moisAu, produitId) {
  const du = `${moisDu}-01`, auFin = finMois(moisAu), t = today();
  const au = auFin > t ? t : auFin;
  const facts = salesFacts(App.I, { preset: 'perso', du, au, produit_id: produitId || '' });
  const key = axe === 'global' ? () => null : AXE_SRC[axe][2];
  const mois = monthsBetween(du, auFin);
  const objs = (App.D.objectifs || []).filter((o) => o.axe === axe && mois.includes(o.mois) && (o.produit_id || '') === (produitId || ''));
  // Part de la période écoulée (pour juger du rythme) et projection
  const totalJours = daysBetween(du, auFin) + 1;
  const ecoules = Math.max(0, Math.min(totalJours, daysBetween(du, t) + 1));
  const fraction = totalJours ? ecoules / totalJours : 1;
  const enCours = t >= du && t <= auFin;
  const rows = cibles(axe).map((c) => {
    const fx = facts.filter((x) => (key(x) || null) === c.id);
    const os = objs.filter((o) => (o.cible_id || null) === c.id);
    const oQ = os.some((o) => o.objectif_cartons !== null && o.objectif_cartons !== undefined) ? os.reduce((s, o) => s + num(o.objectif_cartons), 0) : null;
    const oCA = os.some((o) => o.objectif_ca !== null && o.objectif_ca !== undefined) ? os.reduce((s, o) => s + num(o.objectif_ca), 0) : null;
    const rQ = fx.reduce((s, x) => s + x.cartons, 0), rCA = fx.reduce((s, x) => s + x.montant, 0);
    const tQ = oQ ? (rQ / oQ) * 100 : null, tCA = oCA ? (rCA / oCA) * 100 : null;
    const ref = tCA ?? tQ;
    const proj = enCours && fraction > 0 ? (oCA ? rCA / fraction : rQ / fraction) : null;
    let statut = 'Sans objectif', sev = 'mute';
    if (ref !== null) {
      const attendu = fraction * 100;
      if (ref >= 100) { statut = 'Objectif atteint'; sev = 'ok'; }
      else if (ref >= attendu * 0.9) { statut = 'En bonne voie'; sev = 'info'; }
      else if (ref >= attendu * 0.6) { statut = 'En retard'; sev = 'warn'; }
      else { statut = 'Critique'; sev = 'crit'; }
    }
    return { id: c.id || 'global', nom: c.nom, equipe: c.equipe, fonction: c.fonction, oQ, rQ, tQ, oCA, rCA, tCA, ecart: oCA !== null ? rCA - oCA : null, proj, projT: proj !== null && (oCA || oQ) ? (proj / (oCA || oQ)) * 100 : null, statut, sev, nb: new Set(fx.map((x) => x.v.id)).size };
  });
  return { rows, enCours, fraction, mois };
}

export function renderObjectifs(root) {
  const m = today().slice(0, 7);
  App.filters.objectifs = App.filters.objectifs || { axe: 'agent', du: m, au: m, produit_id: '', mesure: 'ca' };
  const F = App.filters.objectifs;
  const canEdit = App.can('objectifs', 'modifier');
  root.innerHTML = pageHead('Objectifs et réalisations', 'Objectifs fixés en cartons et/ou en FCFA, comparés aux ventes validées de la période. Le statut tient compte de la part de la période déjà écoulée.',
    `${boutonImport('objectifs')}${canEdit ? `<button class="btn primary" id="saisie">${icon('edit')} Saisir les objectifs</button>` : ''}`) +
    `<div class="filters">
      <label class="ff"><span>Suivi par</span><select id="o-axe">${Object.entries(AXES_OBJECTIF).map(([k, l]) => `<option value="${k}" ${F.axe === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="ff"><span>Du mois</span><input type="month" id="o-du" value="${F.du}"></label><label class="ff"><span>Au mois</span><input type="month" id="o-au" value="${F.au}"></label>
      <label class="ff"><span>Produit</span><select id="o-prod"><option value="">Tous produits</option>${opts('produits', 'nom', { all: true }).map((o) => `<option value="${o.v}" ${F.produit_id === o.v ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select></label>
    </div><section class="kpis" id="ok"></section>
    <article class="card"><header><h3>Objectif et réalisé</h3><div class="seg" role="group"><button data-mes="ca" class="${F.mesure === 'ca' ? 'on' : ''}">En FCFA</button><button data-mes="q" class="${F.mesure === 'q' ? 'on' : ''}">En cartons</button></div></header><div class="cv h260"><canvas id="o-ch"></canvas></div></article>
    <article class="card" id="ot"></article>`;
  const draw = () => {
    if (F.au < F.du) F.au = F.du;
    const { rows, enCours, fraction } = suivi(F.axe, F.du, F.au, F.produit_id);
    const avec = rows.filter((r) => r.oCA !== null || r.oQ !== null);
    const sum = (k) => avec.reduce((s, r) => s + (r[k] || 0), 0);
    const oCA = sum('oCA'), rCA = avec.reduce((s, r) => s + (r.oCA !== null ? r.rCA : 0), 0), oQ = sum('oQ'), rQ = avec.reduce((s, r) => s + (r.oQ !== null ? r.rQ : 0), 0);
    $('#ok', root).innerHTML = [
      ['Objectif CA', fmtF(oCA), `${avec.filter((r) => r.oCA !== null).length} objectifs`, ''], ['CA réalisé', fmtF(rCA), oCA ? `${fmtN((rCA / oCA) * 100, 0)} % de l’objectif` : '', oCA && rCA >= oCA ? 'ok' : ''],
      ['Objectif cartons', `${fmtQ(oQ)} ctn`, '', ''], ['Cartons réalisés', `${fmtQ(rQ)} ctn`, oQ ? `${fmtN((rQ / oQ) * 100, 0)} % de l’objectif` : '', oQ && rQ >= oQ ? 'ok' : ''],
      ['Objectifs atteints', fmtN(avec.filter((r) => r.statut === 'Objectif atteint').length), `sur ${avec.length}`, ''], ['En retard ou critiques', fmtN(avec.filter((r) => ['En retard', 'Critique'].includes(r.statut)).length), enCours ? `${fmtN(fraction * 100, 0)} % de la période écoulée` : 'période terminée', avec.some((r) => r.statut === 'Critique') ? 'crit' : ''],
    ].map(([l, v, s, c]) => `<div class="kpi static ${c}"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span>${s ? `<span class="kpi-s">${s}</span>` : ''}</div>`).join('');
    const pal = palette();
    const top = rows.filter((r) => r.oCA !== null || r.oQ !== null || r.rCA).sort((a, b) => (F.mesure === 'ca' ? (b.oCA || b.rCA) - (a.oCA || a.rCA) : (b.oQ || b.rQ) - (a.oQ || a.rQ))).slice(0, 16);
    chart($('#o-ch', root), { type: 'bar', money: F.mesure === 'ca', data: { labels: top.map((r) => r.nom.replace(' (démo)', '')), datasets: [
      { label: 'Objectif', data: top.map((r) => (F.mesure === 'ca' ? r.oCA || 0 : r.oQ || 0)), backgroundColor: pal[7], borderRadius: 3 },
      { label: 'Réalisé', data: top.map((r) => (F.mesure === 'ca' ? r.rCA : r.rQ)), backgroundColor: pal[0], borderRadius: 3 }] },
      tip: (c) => `${c.dataset.label} : ${F.mesure === 'ca' ? fmtF(c.parsed.y) : fmtQ(c.parsed.y) + ' ctn'}` });
    const tx = (v) => (v === null ? '—' : `<div class="mini"><div class="bar ${v >= 100 ? 'ok' : v >= fraction * 90 ? '' : v >= fraction * 60 ? 'warn' : 'crit'}"><i style="width:${Math.min(100, v)}%"></i></div>${fmtN(v, 0)} %</div>`);
    new Table({ title: `Objectifs et réalisations par ${AXES_OBJECTIF[F.axe].toLowerCase()}`, rows, sort: { k: 'rCA', dir: -1 }, pageSize: 40,
      meta: () => `Période : ${moisLabel(F.du)} à ${moisLabel(F.au)}${F.produit_id ? ' · produit ' + nm.produit(F.produit_id) : ''}`,
      foot: (c, rs) => (c.k === 'nom' ? '<b>Total</b>' : ['oQ', 'rQ'].includes(c.k) ? `<b>${fmtQ(rs.reduce((s, r) => s + (r[c.k] || 0), 0))}</b>` : ['oCA', 'rCA'].includes(c.k) ? `<b>${fmtN(rs.reduce((s, r) => s + (r[c.k] || 0), 0))}</b>` : ''),
      cols: [{ k: 'nom', l: AXES_OBJECTIF[F.axe] }, ...(F.axe === 'agent' ? [{ k: 'equipe', l: 'Équipe' }, { k: 'fonction', l: 'Fonction' }] : []), { k: 'nb', l: 'Ventes', num: 1 },
        { k: 'oQ', l: 'Objectif ctn', num: 1, f: (r) => (r.oQ === null ? '—' : fmtQ(r.oQ)) }, { k: 'rQ', l: 'Réalisé ctn', num: 1, f: (r) => fmtQ(r.rQ) }, { k: 'tQ', l: 'Atteinte ctn', num: 1, v: (r) => r.tQ ?? -1, f: (r) => tx(r.tQ), x: (r) => (r.tQ === null ? '' : Math.round(r.tQ)) },
        { k: 'oCA', l: 'Objectif FCFA', num: 1, f: (r) => (r.oCA === null ? '—' : fmtN(r.oCA)) }, { k: 'rCA', l: 'Réalisé FCFA', num: 1, f: (r) => `<b>${fmtN(r.rCA)}</b>` }, { k: 'tCA', l: 'Atteinte FCFA', num: 1, v: (r) => r.tCA ?? -1, f: (r) => tx(r.tCA), x: (r) => (r.tCA === null ? '' : Math.round(r.tCA)) },
        { k: 'ecart', l: 'Écart FCFA', num: 1, v: (r) => r.ecart ?? 0, f: (r) => (r.ecart === null ? '—' : `<span class="${r.ecart < 0 ? 't-crit' : 't-ok'}">${r.ecart > 0 ? '+' : ''}${fmtN(r.ecart)}</span>`) },
        ...(enCours ? [{ k: 'projT', l: 'Projection fin de période', num: 1, v: (r) => r.projT ?? -1, f: (r) => (r.projT === null ? '—' : `${fmtN(r.projT, 0)} %`), x: (r) => (r.projT === null ? '' : Math.round(r.projT)) }] : []),
        { k: 'statut', l: 'Statut', f: (r) => pill(r.statut, r.sev) }] }).mount($('#ot', root));
  };
  lierImport(root, () => ({ mois: F.au, axe: F.axe }));
  const bind = (id, k) => $(id, root).addEventListener('change', (e) => { F[k] = e.target.value; if (k === 'du' && F.au < F.du) { F.au = F.du; $('#o-au', root).value = F.au; } draw(); });
  bind('#o-axe', 'axe'); bind('#o-du', 'du'); bind('#o-au', 'au'); bind('#o-prod', 'produit_id');
  $$('[data-mes]', root).forEach((b) => b.addEventListener('click', () => { F.mesure = b.dataset.mes; $$('[data-mes]', root).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  $('#saisie', root)?.addEventListener('click', () => saisieObjectifs(F.axe === 'global' ? 'agent' : F.axe, F.au, F.produit_id));
  draw();
}

// Saisie simple sous forme de grille : une ligne par cible, deux montants
function saisieObjectifs(axe0, mois0, produit0) {
  let axe = axe0, mois = mois0, produit = produit0 || '';
  modal({ title: 'Saisir les objectifs du mois', wide: true,
    body: `<div class="filters">
      <label class="ff"><span>Mois</span><input type="month" id="s-mois" value="${mois}"></label>
      <label class="ff"><span>Objectifs par</span><select id="s-axe">${Object.entries(AXES_OBJECTIF).map(([k, l]) => `<option value="${k}" ${axe === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="ff"><span>Produit</span><select id="s-prod"><option value="">Tous produits</option>${opts('produits').map((o) => `<option value="${o.v}" ${produit === o.v ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select></label>
      <button class="btn sm ghost" id="s-prev" type="button">Reprendre le mois précédent</button></div>
      <p class="muted small">Laissez une case vide pour ne pas fixer d’objectif. Videz les deux cases pour retirer un objectif existant.</p>
      <div class="tbl-wrap"><table class="tbl" id="s-grid"></table></div>${field({ k: 'motif', l: 'Commentaire (facultatif)', t: 'text' }, '')}<p class="err" hidden></p>`,
    footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="s-save">Enregistrer les objectifs</button>',
    onMount: (m, close) => {
      const grid = () => {
        const ex = (App.D.objectifs || []).filter((o) => o.mois === mois && o.axe === axe && (o.produit_id || '') === produit);
        $('#s-grid', m).innerHTML = `<thead><tr><th>${esc(AXES_OBJECTIF[axe])}</th><th class="n">Objectif cartons</th><th class="n">Objectif FCFA</th></tr></thead><tbody>${cibles(axe).map((c) => {
          const o = ex.find((x) => (x.cible_id || null) === c.id);
          return `<tr data-c="${c.id || ''}"><td>${esc(c.nom)}</td><td class="n"><input type="number" min="0" step="any" data-k="objectif_cartons" value="${o?.objectif_cartons ?? ''}" aria-label="Objectif cartons ${esc(c.nom)}"></td><td class="n"><input type="number" min="0" step="1000" data-k="objectif_ca" value="${o?.objectif_ca ?? ''}" aria-label="Objectif FCFA ${esc(c.nom)}"></td></tr>`;
        }).join('')}</tbody>`;
      };
      grid();
      $('#s-mois', m).addEventListener('change', (e) => { mois = e.target.value; grid(); });
      $('#s-axe', m).addEventListener('change', (e) => { axe = e.target.value; grid(); });
      $('#s-prod', m).addEventListener('change', (e) => { produit = e.target.value; grid(); });
      $('#s-prev', m).addEventListener('click', () => {
        const prev = (App.D.objectifs || []).filter((o) => o.mois === moisPrec(mois) && o.axe === axe && (o.produit_id || '') === produit);
        if (!prev.length) return toast('Aucun objectif le mois précédent pour cet axe.', 'warn');
        $$('tr[data-c]', m).forEach((tr) => { const o = prev.find((x) => (x.cible_id || '') === tr.dataset.c); if (o) { $('[data-k=objectif_cartons]', tr).value = o.objectif_cartons ?? ''; $('[data-k=objectif_ca]', tr).value = o.objectif_ca ?? ''; } });
      });
      $('#s-save', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const lignes = $$('tr[data-c]', m).map((tr) => ({ cible_id: tr.dataset.c || null, objectif_cartons: $('[data-k=objectif_cartons]', tr).value, objectif_ca: $('[data-k=objectif_ca]', tr).value }));
        try {
          const r = await App.act('objectif.bulk', { mois, axe, produit_id: produit || null, lignes, motif: $('[name=motif]', m).value }, null);
          toast(r.modifies ? `${r.modifies} objectif(s) enregistré(s).` : 'Aucun changement.');
          Object.assign(App.filters.objectifs, { axe, du: mois, au: mois, produit_id: produit });
          close(); App.rerender();
        } catch (e) { showErr(m, e.message); }
      }));
    } });
}
