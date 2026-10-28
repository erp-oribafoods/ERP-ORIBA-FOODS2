// Dépenses commerciales et force de vente : saisie, circuit de validation, pilotage, budgets, clôture.
import { App, nm, opts, filterBar, describeFilters, pageHead } from '../app.js';
import { esc, $, $$, fmtF, fmtN, fmtQ, fmtD, Table, modal, confirmBox, field, readForm, showErr, busy, toast, icon, pill, chart, palette, alpha, saveBlob, exportRows } from '../lib/ui.js';
import { periodRange, monthsBetween, moisLabel, salesFacts } from '../lib/facts.js';
import { depenseAllocations, doublonsDepenses, today, num, round2, daysBetween, moisDe } from '../../shared/logic.js';
import { STATUTS_DEPENSE, MODES_PAIEMENT_DEP } from '../../shared/schema.js';
import { signalAnomalie } from './audit.js';

const SEV = { brouillon: 'mute', soumise: 'info', controlee: 'info', a_completer: 'warn', validee: 'ok', rejetee: 'crit', annulee: 'mute' };
const statutPill = (s) => pill(STATUTS_DEPENSE[s] || s, SEV[s]);
const EN_ATTENTE = ['soumise', 'controlee', 'a_completer'];

function allDeps() {
  // Dépenses visibles + agrégats des dépenses sensibles (sans détail) pour les profils non habilités
  const ag = (App.D.depenses_agregats || []).map((a, i) => ({ id: `agg-${i}`, agrege: true, numero: 'Agrégat', date: `${a.mois}-01`, mois: a.mois, categorie_id: a.categorie_id, equipe_id: a.equipe_id, montant: a.montant, statut: 'validee', historique: false, description: 'Montant agrégé (détail réservé aux profils habilités)' }));
  return [...(App.D.depenses || []), ...ag];
}

function depMatches(d, f, dbl) {
  const [du, au] = periodRange(f);
  if (d.date < du || d.date > au) return false;
  if (f.mois && d.mois !== f.mois) return false;
  if (f.equipe_id && d.equipe_id !== f.equipe_id && !depenseAllocations(d, App.I).some((a) => a.equipe_id === f.equipe_id)) return false;
  if (f.zone_id && (d.zone_id || App.I.equipes.get(d.equipe_id)?.zone_id) !== f.zone_id) return false;
  if (f.categorie_id && d.categorie_id !== f.categorie_id) return false;
  if (f.vehicule_id && d.vehicule_id !== f.vehicule_id) return false;
  if (f.statut && d.statut !== f.statut) return false;
  if (f.mode_paiement && d.mode_paiement !== f.mode_paiement) return false;
  if (f.justif === 'avec' && !d.justificatif_cle) return false;
  if (f.justif === 'sans' && (d.justificatif_cle || d.agrege)) return false;
  if (f.responsable && d.created_by !== f.responsable) return false;
  if (f.doublon && !dbl.has(d.id)) return false;
  return true;
}

// Montant imputé à une équipe donnée (répartition des dépenses partagées)
function montantPour(d, equipeId) {
  if (!equipeId) return num(d.montant);
  return depenseAllocations(d, App.I).filter((a) => a.equipe_id === equipeId).reduce((s, a) => s + a.montant, 0);
}

const FKEYS = ['periode', 'equipe_id', 'zone_id', 'categorie_id', 'vehicule_id', 'statut', 'mode_paiement', 'justif', 'responsable', 'doublon'];
const FEXTRA = {
  statut: { o: () => Object.entries(STATUTS_DEPENSE).map(([v, l]) => ({ v, l })) },
  doublon: { l: 'Doublons', o: () => [{ v: '1', l: 'Doublons potentiels' }] },
};

export function renderDepenses(root) {
  const canNew = App.can('depenses', 'creer');
  const canVal = App.can('depenses', 'valider');
  root.innerHTML = pageHead('Dépenses commerciales', 'Chaque dépense est une transaction distincte : saisie, pièce jointe, contrôle superviseur, validation DAF.',
    `${canVal ? `<button class="btn" id="bulk" disabled>${icon('check')} Valider la sélection</button>` : ''}${canNew ? `<button class="btn primary" id="new">${icon('plus')} Nouvelle dépense</button>` : ''}`) +
    '<div id="flt"></div><div class="card" id="tb"></div>';
  let table;
  const draw = () => {
    const f = App.filters.depenses;
    const deps = allDeps();
    const dbl = doublonsDepenses(deps);
    const rows = deps.filter((d) => depMatches(d, f, dbl)).map((d) => ({ ...d, _dbl: dbl.has(d.id), _cls: d.agrege ? 'agg' : '' }));
    table = new Table({ title: 'Journal des dépenses', rows, sort: { k: 'date', dir: -1 }, onRow: (r) => !r.agrege && openDepense(r.id), meta: () => `Filtres : ${describeFilters('depenses')}`,
      select: canVal ? (r) => !r.agrege && ['soumise', 'controlee'].includes(r.statut) && r.created_by !== App.user.id : false,
      foot: (c, rs) => (c.k === 'montant' ? `<b>${fmtN(rs.filter((r) => r.statut === 'validee').reduce((s, r) => s + montantPour(r, f.equipe_id), 0))}</b>` : c.k === 'numero' ? '<b>Total validé</b>' : ''),
      cols: [
        { k: 'numero', l: 'N°' }, { k: 'date', l: 'Date', f: (r) => (r.historique || r.agrege ? `${moisLabel(r.mois)} <small>(agrégé)</small>` : fmtD(r.date)) },
        { k: 'equipe', l: 'Équipe', v: (r) => (r.partagee ? 'Partagée : ' + depenseAllocations(r, App.I).map((a) => nm.equipe(a.equipe_id)).join(', ') : nm.equipe(r.equipe_id)), cls: 'wrap' },
        { k: 'categorie', l: 'Catégorie', v: (r) => nm.categorie(r.categorie_id) }, { k: 'vehicule', l: 'Véhicule', v: (r) => (r.vehicule_id ? nm.vehicule(r.vehicule_id) : '') },
        { k: 'beneficiaire', l: 'Bénéficiaire' }, { k: 'mode_paiement', l: 'Paiement' },
        { k: 'montant', l: 'Montant FCFA', num: 1, v: (r) => montantPour(r, f.equipe_id), f: (r) => fmtN(montantPour(r, f.equipe_id)) },
        { k: 'piece', l: 'Pièce', v: (r) => (r.justificatif_cle ? 'Jointe' : r.reference_piece ? 'Réf. ' + r.reference_piece : r.sans_piece ? 'Sans pièce' : ''), f: (r) => (r.agrege ? '' : r.justificatif_cle ? pill('Jointe', 'ok') : r.sans_piece ? pill('Sans pièce', 'warn') : r.reference_piece ? `<small>${esc(r.reference_piece)}</small>` : pill('Manquante', 'crit')) },
        { k: 'statut', l: 'Statut', v: (r) => STATUTS_DEPENSE[r.statut], f: (r) => statutPill(r.statut) + (r._dbl ? ' ' + pill('Doublon ?', 'warn') : '') },
        { k: 'saisi', l: 'Saisi par', v: (r) => (r.agrege ? '' : nm.user(r.created_by)) },
      ] });
    table.onSel = (s) => { const b = $('#bulk', root); if (b) { b.disabled = !s.size; b.textContent = s.size ? `Valider la sélection (${s.size})` : 'Valider la sélection'; } };
    table.mount($('#tb', root));
  };
  filterBar($('#flt', root), 'depenses', FKEYS, draw, FEXTRA);
  $('#new', root)?.addEventListener('click', () => depenseForm(null));
  $('#bulk', root)?.addEventListener('click', async (ev) => {
    const ids = [...table.sel];
    const ok = await confirmBox({ title: `Valider ${ids.length} dépense(s)`, message: 'Chaque dépense est contrôlée (pièce, véhicule, description) avant validation. Les dépenses incomplètes seront refusées.', okLabel: 'Valider' });
    if (!ok) return;
    busy(ev.currentTarget, async () => {
      try { const r = await App.act('dep.bulk_validate', { ids }); toast(`${r.valides.length} validée(s)${r.refuses.length ? `, ${r.refuses.length} refusée(s) : ${r.refuses[0].erreur}` : ''}`, r.refuses.length ? 'warn' : 'ok'); } catch (e) { toast(e.message, 'err'); }
    });
  });
  draw();
}

async function fileToBase64(file) {
  let blob = file;
  if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size > 900 * 1024) {
    // Réduction des photos de reçus prises au téléphone
    const img = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
  }
  const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  return { base64: b64, type: blob.type || file.type, nom: blob === file ? file.name : file.name.replace(/\.\w+$/, '') + '.jpg' };
}

export function depenseForm(dep) {
  const d = dep || { date: today(), mode_paiement: 'Espèces' };
  const reps = dep ? (App.D.depense_repartitions || []).filter((r) => r.depense_id === dep.id && r.actif !== false) : [];
  const catOpts = opts('categories_depense', 'libelle', { all: !!dep }).filter((o) => App.can('salaires') || !App.I.categories.get(o.v)?.sensible);
  const eqOpts = opts('equipes', 'nom', { all: !!dep, filter: (e) => App.user.perimetre_type !== 'equipe' || App.user.perimetre_ids.includes(e.id) });
  const body = `<form class="form" id="df" autocomplete="off"><div class="grid2">
    ${field({ k: 'date', l: 'Date de la dépense', t: 'date', req: 1 }, d.date)}
    ${field({ k: 'categorie_id', l: 'Catégorie', t: 'options', req: 1, options: catOpts }, d.categorie_id)}
    ${field({ k: 'montant', l: 'Montant FCFA', t: 'number', req: 1, min: 0 }, d.montant)}
    ${field({ k: 'equipe_id', l: 'Équipe / centre de coût', t: 'options', req: 1, options: eqOpts }, d.equipe_id)}
    ${field({ k: 'zone_id', l: 'Zone / marché (facultatif)', t: 'options', options: opts('zones') }, d.zone_id)}
    ${field({ k: 'vehicule_id', l: 'Véhicule / équipement', t: 'options', options: opts('vehicules', 'immatriculation') }, d.vehicule_id)}
    ${field({ k: 'beneficiaire', l: 'Bénéficiaire / fournisseur', t: 'text' }, d.beneficiaire)}
    ${field({ k: 'mode_paiement', l: 'Mode de paiement', t: 'options', options: MODES_PAIEMENT_DEP.map((x) => ({ v: x, l: x })) }, d.mode_paiement)}
    ${field({ k: 'reference_piece', l: 'Référence de pièce (reçu, facture, bon…)', t: 'text' }, d.reference_piece)}
    <div class="fld"><span>Justificatif (photo ou PDF, 4 Mo max)</span><input type="file" id="file" accept="image/*,application/pdf">${d.justificatif_nom ? `<small>Pièce actuelle : ${esc(d.justificatif_nom)}</small>` : ''}</div>
    <div class="veh-extra span2 grid3" hidden>${field({ k: 'kilometrage', l: 'Kilométrage', t: 'number' }, d.kilometrage)}${field({ k: 'litres', l: 'Litres', t: 'number' }, d.litres)}${field({ k: 'station', l: 'Station', t: 'text' }, d.station)}</div>
    ${field({ k: 'sans_piece', l: 'Dépense sans pièce justificative (à justifier dans la description)', t: 'bool', wide: 1 }, d.sans_piece)}
    ${field({ k: 'description', l: 'Description / motif', t: 'textarea', rows: 2, wide: 1 }, d.description)}
    ${field({ k: 'partagee', l: 'Dépense partagée entre plusieurs équipes', t: 'bool', wide: 1 }, d.partagee)}
    </div>
    <div id="rep" hidden><h4 class="sec">Répartition</h4><div id="replines"></div><button type="button" class="btn sm ghost" id="addrep">${icon('plus')} Ajouter une équipe</button><p class="muted" id="repsum"></p></div>
    <p class="note" id="rules"></p>
    ${dep && App.can('cloture', 'modifier') ? `<details><summary>Correction du mois de rattachement (DAF)</summary>${field({ k: 'mois', l: 'Mois de rattachement', t: 'month' }, d.mois)}${field({ k: 'motif', l: 'Motif de la correction', t: 'text' }, '')}</details>` : ''}
    <p class="err" hidden></p></form>`;
  modal({ title: dep ? `Modifier la dépense ${dep.numero}` : 'Nouvelle dépense', wide: true, body,
    footer: `<button class="btn ghost" data-close>Annuler</button><button class="btn" id="draft">Enregistrer le brouillon</button><button class="btn primary" id="submit">Soumettre à validation</button>`,
    onMount: (m, close) => {
      const R = reps.length ? reps.map((r) => ({ equipe_id: r.equipe_id, montant: r.montant })) : [{ equipe_id: '', montant: '' }, { equipe_id: '', montant: '' }];
      const drawRep = () => {
        $('#replines', m).innerHTML = R.map((r, i) => `<div class="repl" data-i="${i}"><select aria-label="Équipe"><option value="">Équipe…</option>${eqOpts.map((o) => `<option value="${o.v}" ${o.v === r.equipe_id ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select><input type="number" min="0" placeholder="Montant" value="${esc(r.montant)}" aria-label="Montant"><button type="button" class="btn-icon" aria-label="Retirer">${icon('x')}</button></div>`).join('');
        $$('.repl', m).forEach((el) => {
          const r = R[+el.dataset.i];
          $('select', el).addEventListener('change', (e) => { r.equipe_id = e.target.value; });
          $('input', el).addEventListener('input', (e) => { r.montant = e.target.value; sumRep(); });
          $('button', el).addEventListener('click', () => { if (R.length > 2) { R.splice(+el.dataset.i, 1); drawRep(); } });
        });
        sumRep();
      };
      const sumRep = () => { const s = R.reduce((a, r) => a + num(r.montant), 0); const t = num($('[name=montant]', m).value); $('#repsum', m).innerHTML = `Réparti : <b>${fmtF(s)}</b> sur ${fmtF(t)}${Math.abs(s - t) > 0.5 ? ' — <span class="t-crit">la somme doit égaler le montant</span>' : ' ✓'}`; };
      const upd = () => {
        const c = App.I.categories.get($('[name=categorie_id]', m).value);
        const part = $('[name=partagee]', m).checked;
        $('#rep', m).hidden = !part;
        $('[name=equipe_id]', m).closest('.fld').hidden = part;
        $('.veh-extra', m).hidden = !(c && (c.famille === 'Véhicule' || c.code === 'CARB'));
        const r = [];
        if (c?.justif_obligatoire) r.push('justificatif obligatoire');
        if (c?.vehicule_obligatoire) r.push('véhicule obligatoire');
        if (c?.description_obligatoire) r.push('description obligatoire');
        if (c?.sensible) r.push('donnée sensible : détail visible des seuls profils habilités');
        $('#rules', m).textContent = c ? `${c.libelle} : ${r.join(', ') || 'pièce ou référence recommandée'}.` : '';
        $('#rules', m).hidden = !c;
      };
      $('[name=categorie_id]', m).addEventListener('change', upd);
      $('[name=partagee]', m).addEventListener('change', () => { upd(); drawRep(); });
      $('[name=montant]', m).addEventListener('input', sumRep);
      $('#addrep', m).addEventListener('click', () => { R.push({ equipe_id: '', montant: '' }); drawRep(); });
      upd(); drawRep();
      const go = (soumettre) => async (ev) => busy(ev.currentTarget, async () => {
        const f = readForm($('#df', m));
        const file = $('#file', m).files[0];
        try {
          const { motif, ...depense } = f;
          if (!(dep && App.can('cloture', 'modifier'))) delete depense.mois;
          if (dep) depense.id = dep.id;
          let r = await App.api.call('dep.save', { depense, repartitions: f.partagee ? R : [], soumettre: soumettre && !file, motif });
          if (file) {
            const fb = await fileToBase64(file);
            await App.api.call('dep.upload', { depense_id: r.depense.id, ...fb });
            if (soumettre) r = await App.api.call('dep.save', { depense: { id: r.depense.id }, soumettre: true });
          }
          await App.refresh(); App.rerender();
          toast(soumettre ? `Dépense ${r.depense.numero} soumise à validation.` : `Brouillon ${r.depense.numero} enregistré.`);
          close(true);
        } catch (e) { showErr(m, e.message); await App.refresh(); App.rerender(); }
      });
      $('#draft', m.parentElement).addEventListener('click', go(false));
      $('#submit', m.parentElement).addEventListener('click', go(true));
    } });
}

export function openDepense(id) {
  const d = App.D.depenses.find((x) => x.id === id);
  if (!d) return;
  const vals = (App.D.depense_validations || []).filter((v) => v.depense_id === id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const own = d.created_by === App.user.id;
  const editable = ['brouillon', 'a_completer', 'soumise'].includes(d.statut) && (App.can('depenses', 'modifier') || (own && App.can('depenses', 'creer')));
  const btn = [];
  if (editable) btn.push(`<button class="btn" data-a="edit">${icon('edit')} Modifier / compléter</button>`);
  if (['brouillon', 'a_completer'].includes(d.statut) && editable) btn.push('<button class="btn primary" data-a="submit">Soumettre</button>');
  if (d.statut === 'soumise' && App.can('depenses', 'controler')) btn.push('<button class="btn primary" data-a="controler">Contrôle superviseur : conforme</button>');
  if (['soumise', 'controlee'].includes(d.statut) && App.can('depenses', 'valider')) btn.push('<button class="btn primary" data-a="valider">Valider</button>', '<button class="btn danger ghost" data-a="rejeter">Rejeter</button>');
  if (['soumise', 'controlee'].includes(d.statut) && (App.can('depenses', 'valider') || App.can('depenses', 'controler'))) btn.push('<button class="btn ghost" data-a="a_completer">À compléter</button>');
  if (d.statut !== 'annulee' && ((['validee', 'controlee', 'rejetee'].includes(d.statut) && App.can('depenses', 'annuler')) || (!['validee', 'controlee', 'rejetee'].includes(d.statut) && (own || App.can('depenses', 'modifier'))))) btn.push(`<button class="btn danger ghost" data-a="annuler">${d.statut === 'validee' ? 'Contrepasser' : 'Annuler'}</button>`);
  if (App.can('audit', 'creer')) btn.push(`<button class="btn ghost" data-a="ano">${icon('flag')} Anomalie</button>`);
  const reps = (App.D.depense_repartitions || []).filter((r) => r.depense_id === id && r.actif !== false);
  modal({ title: `Dépense ${d.numero}`, wide: true,
    body: `<div class="det-head"><div><span class="eyebrow">${esc(nm.categorie(d.categorie_id))}</span><h3>${esc(d.numero)} ${statutPill(d.statut)} ${d.historique ? pill('Reprise historique (agrégé)', 'info') : ''}</h3></div><div class="det-amt">${fmtF(d.montant)}</div></div>
    <dl class="dl"><dt>Date</dt><dd>${fmtD(d.date)} · mois ${esc(d.mois)}</dd><dt>Équipe</dt><dd>${d.partagee ? reps.map((r) => `${esc(nm.equipe(r.equipe_id))} : ${fmtF(r.montant)}`).join('<br>') : esc(nm.equipe(d.equipe_id))}</dd>
      <dt>Zone</dt><dd>${esc(d.zone_id ? nm.zone(d.zone_id) : '—')}</dd><dt>Véhicule</dt><dd>${esc(d.vehicule_id ? nm.vehicule(d.vehicule_id) : '—')}${d.kilometrage ? ` · ${fmtN(d.kilometrage)} km` : ''}${d.litres ? ` · ${fmtN(d.litres, 2)} L` : ''}${d.station ? ` · ${esc(d.station)}` : ''}</dd>
      <dt>Bénéficiaire</dt><dd>${esc(d.beneficiaire || '—')}</dd><dt>Paiement</dt><dd>${esc(d.mode_paiement || '—')}</dd>
      <dt>Pièce</dt><dd>${esc(d.reference_piece || '')} ${d.justificatif_cle ? `<button class="btn sm ghost" data-a="file">${icon('eye')} ${esc(d.justificatif_nom)}</button>` : d.sans_piece ? pill('Sans pièce', 'warn') : ''}</dd>
      <dt>Description</dt><dd>${esc(d.description || '—')}</dd><dt>Saisie</dt><dd>${esc(nm.user(d.created_by))}, ${new Date(d.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' })}</dd>
      ${d.motif ? `<dt>Dernier commentaire</dt><dd>${esc(d.motif)}</dd>` : ''}</dl>
    <h4 class="sec">Circuit de validation</h4><ol class="timeline">${vals.map((v) => `<li><b>${esc(STATUTS_DEPENSE[v.decision] || v.decision)}</b> — ${esc(nm.user(v.user_id))}, ${new Date(v.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' })}${v.commentaire ? `<br><small>${esc(v.commentaire)}</small>` : ''}</li>`).join('') || '<li class="muted">Brouillon non soumis.</li>'}</ol>`,
    footer: btn.join('') || '<button class="btn ghost" data-close>Fermer</button>',
    onMount: (m, close) => {
      $$('[data-a]', m.parentElement).forEach((b) => b.addEventListener('click', async () => {
        const a = b.dataset.a;
        try {
          if (a === 'edit') { close(); depenseForm(d); }
          else if (a === 'submit') { await App.act('dep.save', { depense: { id: d.id }, soumettre: true }, 'Dépense soumise.'); close(); }
          else if (a === 'controler' || a === 'valider') { await App.act('dep.decision', { id: d.id, decision: a }, a === 'valider' ? 'Dépense validée : elle entre dans les totaux officiels.' : 'Contrôle enregistré.'); close(); }
          else if (a === 'rejeter' || a === 'a_completer') {
            const c = await confirmBox({ title: a === 'rejeter' ? 'Rejeter la dépense' : 'Demander un complément', message: a === 'rejeter' ? 'La dépense sera exclue des totaux. Le motif est conservé.' : 'La dépense repart vers le demandeur pour être complétée.', motif: true, motifLabel: a === 'rejeter' ? 'Motif du rejet' : 'Ce qui doit être complété', danger: a === 'rejeter', okLabel: a === 'rejeter' ? 'Rejeter' : 'Envoyer' });
            if (!c) return;
            await App.act('dep.decision', { id: d.id, decision: a, commentaire: c }, 'Décision enregistrée.'); close();
          } else if (a === 'annuler') {
            const c = await confirmBox({ title: d.statut === 'validee' ? 'Contrepasser la dépense' : 'Annuler la dépense', message: 'La dépense ne sera pas effacée : elle passe au statut « Annulée » avec motif, et sort des totaux. Ressaisissez ensuite la dépense correcte si besoin.', motif: true, danger: true, okLabel: 'Confirmer' });
            if (!c) return;
            await App.act('dep.cancel', { id: d.id, motif: c }, 'Dépense annulée.'); close();
          } else if (a === 'file') {
            const f = await App.api.call('dep.file', { id: d.id });
            const bin = Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0));
            const blob = new Blob([bin], { type: f.type });
            if (f.type.startsWith('image/')) modal({ title: f.nom, body: `<img class="piece" src="${URL.createObjectURL(blob)}" alt="Justificatif ${esc(f.nom)}">`, footer: '<button class="btn" id="dl">Télécharger</button>', onMount: (mm) => $('#dl', mm.parentElement).addEventListener('click', () => saveBlob(f.nom, blob)) });
            else saveBlob(f.nom, blob);
          } else if (a === 'ano') signalAnomalie('depenses', d.id, d.numero);
        } catch (e) { toast(e.message, 'err'); }
      }));
    } });
}

// ---------- Pilotage des dépenses ----------
export function budgetsAvecRealise(mois) {
  const deps = allDeps().filter((d) => d.mois === mois);
  return (App.D.budgets || []).filter((b) => b.mois === mois && b.actif !== false).map((b) => {
    let real = 0, eng = 0;
    for (const d of deps) {
      if (b.categorie_id && d.categorie_id !== b.categorie_id) continue;
      if (b.vehicule_id && d.vehicule_id !== b.vehicule_id) continue;
      const m = b.equipe_id ? montantPour(d, b.equipe_id) : num(d.montant);
      if (d.statut === 'validee') real += m; else if (EN_ATTENTE.includes(d.statut)) eng += m;
    }
    const s = App.I.p.seuils_budget || [75, 90, 100];
    const pct = b.montant ? (real / b.montant) * 100 : 0;
    const sev = pct >= s[2] ? 'crit' : pct >= s[1] ? 'crit' : pct >= s[0] ? 'warn' : 'ok';
    const lab = pct > s[2] ? 'Budget dépassé' : pct >= s[2] ? 'Budget atteint' : pct >= s[1] ? `Seuil ${s[1]} %` : pct >= s[0] ? `Seuil ${s[0]} %` : 'Sous les seuils';
    return { ...b, real, eng, pct, sev, lab, solde: b.montant - real, perimetre: [b.equipe_id && nm.equipe(b.equipe_id), b.categorie_id && nm.categorie(b.categorie_id), b.vehicule_id && nm.vehicule(b.vehicule_id)].filter(Boolean).join(' · ') || 'Service commercial (global)' };
  });
}

export function renderPilotage(root) {
  root.innerHTML = pageHead('Pilotage des dépenses', 'Totaux officiels = dépenses validées uniquement. Les dépenses partagées sont imputées selon leur répartition.') +
    '<div id="flt"></div><div id="dash"></div>';
  const draw = () => {
    const f = App.filters.depenses;
    const deps = allDeps();
    const dbl = doublonsDepenses(deps);
    const sel = deps.filter((d) => depMatches(d, { ...f, statut: '' }, dbl));
    const val = sel.filter((d) => d.statut === 'validee');
    const mt = (d) => montantPour(d, f.equipe_id);
    const tot = val.reduce((s, d) => s + mt(d), 0);
    const att = sel.filter((d) => EN_ATTENTE.includes(d.statut));
    const rej = sel.filter((d) => d.statut === 'rejetee'), ann = sel.filter((d) => d.statut === 'annulee');
    const sansJ = sel.filter((d) => !d.agrege && !d.historique && !d.justificatif_cle && (d.sans_piece || !d.reference_piece) && d.statut !== 'annulee');
    const dblSel = sel.filter((d) => dbl.has(d.id));
    const [du, au] = periodRange(f);
    const sf = salesFacts(App.I, { preset: f.preset, du: f.du, au: f.au, equipe_id: f.equipe_id, zone_id: f.zone_id });
    const ctn = sf.reduce((s, x) => s + x.cartons, 0);
    const months = monthsBetween(sel.map((d) => d.date).sort()[0] || today(), au > today() ? today() : au);
    const pal = palette();
    const host = $('#dash', root);
    host.innerHTML = `<section class="kpis">
      ${[['Dépenses validées', fmtF(tot), `${fmtN(val.length)} opérations`, ''], ['En attente de validation', fmtF(att.reduce((s, d) => s + mt(d), 0)), `${fmtN(att.length)} dépenses`, att.length ? 'warn' : ''],
        ['Rejetées', fmtN(rej.length), fmtF(rej.reduce((s, d) => s + mt(d), 0)), ''], ['Sans justificatif', fmtN(sansJ.length), fmtF(sansJ.reduce((s, d) => s + mt(d), 0)), sansJ.length ? 'warn' : ''],
        ['Annulées / contrepassées', fmtN(ann.length), '', ''], ['Doublons potentiels', fmtN(dblSel.length), '', dblSel.length ? 'warn' : ''],
        ['Coût commercial par carton', ctn ? fmtF(tot / ctn) : '—', `${fmtQ(ctn)} ctn vendus sur le même périmètre`, '']]
        .map(([l, v, s, c]) => `<div class="kpi static ${c}"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span>${s ? `<span class="kpi-s">${s}</span>` : ''}</div>`).join('')}</section>
      <section class="grid g-dash">
        <article class="card"><header><h3>Répartition par catégorie</h3></header><div class="cv h260"><canvas id="d-cat"></canvas></div></article>
        <article class="card span2"><header><h3>Évolution mensuelle par catégorie</h3></header><div class="cv h260"><canvas id="d-mois"></canvas></div></article>
        <article class="card span2"><header><h3>Dépenses par équipe</h3></header><div class="cv h260"><canvas id="d-eq"></canvas></div></article>
        <article class="card"><header><h3>Véhicules</h3></header><div id="veh"></div></article>
        <article class="card span3"><header><h3>État mensuel : équipes × catégories</h3><select id="em" aria-label="Mois">${months.slice().reverse().map((m) => `<option value="${m}">${moisLabel(m)}</option>`).join('')}</select></header><div id="etat"></div></article>
        <article class="card span3"><header><h3>Variation par rapport au mois précédent</h3></header><div id="var"></div></article>
      </section>`;
    // Catégories
    const byCat = new Map(); for (const d of val) byCat.set(d.categorie_id, (byCat.get(d.categorie_id) || 0) + mt(d));
    const cats = [...byCat].sort((a, b) => b[1] - a[1]);
    chart($('#d-cat', host), { type: 'doughnut', cutout: '58%', legendPos: 'right', data: { labels: cats.map(([k]) => nm.categorie(k)), datasets: [{ data: cats.map(([, v]) => v), backgroundColor: cats.map((_, i) => pal[i % pal.length]), borderWidth: 0 }] },
      tip: (c) => `${c.label} : ${fmtF(c.parsed)} (${tot ? fmtN((c.parsed / tot) * 100, 1) : 0} %)` });
    const topCats = cats.slice(0, 6).map(([k]) => k);
    chart($('#d-mois', host), { type: 'bar', stacked: true, data: { labels: months.map(moisLabel), datasets: [...topCats.map((k, i) => ({ label: nm.categorie(k), data: months.map((m) => val.filter((d) => d.mois === m && d.categorie_id === k).reduce((s, d) => s + mt(d), 0)), backgroundColor: pal[i % pal.length] })),
      { label: 'Autres', data: months.map((m) => val.filter((d) => d.mois === m && !topCats.includes(d.categorie_id)).reduce((s, d) => s + mt(d), 0)), backgroundColor: alpha(pal[7], 0.6) }] } });
    const byEq = new Map(); for (const d of val) for (const a of depenseAllocations(d, App.I)) if (!f.equipe_id || a.equipe_id === f.equipe_id) byEq.set(a.equipe_id, (byEq.get(a.equipe_id) || 0) + a.montant);
    const eqs = [...byEq].sort((a, b) => b[1] - a[1]);
    chart($('#d-eq', host), { type: 'bar', legend: false, data: { labels: eqs.map(([k]) => nm.equipe(k)), datasets: [{ label: 'Validé', data: eqs.map(([, v]) => v), backgroundColor: pal[0], borderRadius: 3 }] } });
    // Véhicules
    const vehs = (App.D.vehicules || []).map((v) => { const ds = val.filter((d) => d.vehicule_id === v.id); return { v, tot: ds.reduce((s, d) => s + num(d.montant), 0), n: ds.length, carb: ds.filter((d) => App.I.categories.get(d.categorie_id)?.code === 'CARB').reduce((s, d) => s + num(d.montant), 0) }; });
    $('#veh', host).innerHTML = `<ul class="vlist">${vehs.map((x) => `<li data-veh="${x.v.id}" tabindex="0"><b>${esc(x.v.immatriculation)}</b><span>${esc(nm.equipe(x.v.equipe_id))}</span><span>${fmtF(x.tot)} · ${x.n} opérations · carburant ${fmtF(x.carb)}</span></li>`).join('') || '<li class="muted">Aucun véhicule.</li>'}</ul>`;
    $$('[data-veh]', host).forEach((li) => li.addEventListener('click', () => ficheVehicule(li.dataset.veh)));
    // État mensuel
    const drawEtat = (mois) => {
      const ds = val.filter((d) => d.mois === mois);
      const catIds = [...new Set(ds.map((d) => d.categorie_id))].sort((a, b) => nm.categorie(a).localeCompare(nm.categorie(b)));
      const rows = new Map();
      for (const d of ds) for (const a of depenseAllocations(d, App.I)) { if (f.equipe_id && a.equipe_id !== f.equipe_id) continue; const r = rows.get(a.equipe_id) || { id: a.equipe_id, nom: nm.equipe(a.equipe_id), tot: 0 }; r[d.categorie_id] = (r[d.categorie_id] || 0) + a.montant; r.tot += a.montant; rows.set(a.equipe_id, r); }
      const all = [...rows.values()];
      const grand = all.reduce((s, r) => s + r.tot, 0);
      const cols = [{ k: 'nom', l: 'Équipe' }, ...catIds.map((c) => ({ k: c, l: nm.categorie(c), num: 1, v: (r) => r[c] || 0, f: (r) => (r[c] ? fmtN(r[c]) : '—') })), { k: 'tot', l: 'Total', num: 1, f: (r) => `<b>${fmtN(r.tot)}</b>` }, { k: 'part', l: 'Part', num: 1, v: (r) => (grand ? round2((r.tot / grand) * 100) : 0), f: (r) => `${fmtN(grand ? (r.tot / grand) * 100 : 0, 1)} %` }];
      new Table({ title: `État mensuel des dépenses ${mois}`, rows: all, cols, pageSize: 50, sort: { k: 'tot', dir: -1 }, meta: () => `Mois : ${moisLabel(mois)} · dépenses validées`,
        foot: (c, rs) => (c.k === 'nom' ? '<b>Total</b>' : c.k === 'part' ? '<b>100 %</b>' : `<b>${fmtN(rs.reduce((s, r) => s + (c.k === 'tot' ? r.tot : r[c.k] || 0), 0))}</b>`) }).mount($('#etat', host));
    };
    drawEtat(months[months.length - 1]);
    $('#em', host).addEventListener('change', (e) => drawEtat(e.target.value));
    // Variation
    const last = months[months.length - 1], prev = months[months.length - 2];
    const vr = new Map();
    for (const d of val) { if (d.mois !== last && d.mois !== prev) continue; const k = d.categorie_id; const o = vr.get(k) || { id: k, nom: nm.categorie(k), a: 0, b: 0 }; if (d.mois === last) o.a += mt(d); else o.b += mt(d); vr.set(k, o); }
    new Table({ title: 'Variation mensuelle', rows: [...vr.values()].map((o) => ({ ...o, d: o.a - o.b, p: o.b ? ((o.a - o.b) / o.b) * 100 : null })), pageSize: 20, sort: { k: 'd', dir: -1 },
      cols: [{ k: 'nom', l: 'Catégorie' }, { k: 'b', l: prev ? moisLabel(prev) : 'Mois précédent', num: 1, f: (r) => fmtN(r.b) }, { k: 'a', l: last ? moisLabel(last) : 'Mois', num: 1, f: (r) => fmtN(r.a) },
        { k: 'd', l: 'Écart FCFA', num: 1, f: (r) => `<span class="${r.d > 0 ? 't-crit' : 't-ok'}">${r.d > 0 ? '+' : ''}${fmtN(r.d)}</span>` }, { k: 'p', l: 'Écart %', num: 1, v: (r) => r.p ?? 0, f: (r) => (r.p === null ? 'nouveau' : `${r.p > 0 ? '+' : ''}${fmtN(r.p, 1)} %`) }] }).mount($('#var', host));
  };
  filterBar($('#flt', root), 'depenses', ['periode', 'equipe_id', 'zone_id', 'categorie_id', 'vehicule_id', 'mode_paiement', 'justif'], draw, FEXTRA);
  draw();
}

function ficheVehicule(id) {
  const v = App.I.vehicules.get(id);
  const ds = (App.D.depenses || []).filter((d) => d.vehicule_id === id && d.statut !== 'annulee').sort((a, b) => b.date.localeCompare(a.date));
  modal({ title: `Fiche véhicule — ${v.immatriculation}`, wide: true,
    body: `<dl class="dl"><dt>Modèle</dt><dd>${esc(v.modele || '—')}</dd><dt>Équipe</dt><dd>${esc(nm.equipe(v.equipe_id))}</dd><dt>Conducteur habituel</dt><dd>${esc(v.conducteur || '—')}</dd>
      <dt>Coût cumulé validé</dt><dd><b>${fmtF(ds.filter((d) => d.statut === 'validee').reduce((s, d) => s + num(d.montant), 0))}</b></dd></dl><div id="vt"></div>`,
    onMount: (m) => new Table({ title: `Frais véhicule ${v.immatriculation}`, rows: ds, pageSize: 12, sort: { k: 'date', dir: -1 }, onRow: (r) => openDepense(r.id),
      cols: [{ k: 'numero', l: 'N°' }, { k: 'date', l: 'Date', f: (r) => fmtD(r.date) }, { k: 'cat', l: 'Catégorie', v: (r) => nm.categorie(r.categorie_id) }, { k: 'montant', l: 'Montant', num: 1, f: (r) => fmtN(r.montant) },
        { k: 'km', l: 'Km', num: 1, v: (r) => r.kilometrage || '' }, { k: 'piece', l: 'Pièce', v: (r) => (r.justificatif_cle ? 'Jointe' : r.reference_piece || '') }, { k: 'statut', l: 'Statut', v: (r) => STATUTS_DEPENSE[r.statut], f: (r) => statutPill(r.statut) }] }).mount($('#vt', m)) });
}

// ---------- Budgets ----------
export function renderBudgets(root) {
  App.filters.budget = App.filters.budget || { mois: today().slice(0, 7) };
  const can = App.can('budgets', 'modifier');
  root.innerHTML = pageHead('Budgets des dépenses', 'Budgets définis et approuvés par Oriba Foods. Aucun budget n’est déduit automatiquement de l’historique.',
    can ? `<button class="btn primary" id="new">${icon('plus')} Nouveau budget</button>` : '') +
    `<div class="filters"><label class="ff"><span>Mois</span><input type="month" id="bm" value="${App.filters.budget.mois}"></label></div><div class="card" id="tb"></div>`;
  const draw = () => {
    const rows = budgetsAvecRealise(App.filters.budget.mois);
    new Table({ title: `Budgets ${App.filters.budget.mois}`, rows, sort: { k: 'pct', dir: -1 }, onRow: can ? (r) => budgetForm(r) : null, empty: 'Aucun budget défini pour ce mois.',
      cols: [{ k: 'perimetre', l: 'Périmètre' }, { k: 'montant', l: 'Budget approuvé', num: 1, f: (r) => fmtN(r.montant) }, { k: 'real', l: 'Réalisé (validé)', num: 1, f: (r) => fmtN(r.real) },
        { k: 'eng', l: 'Engagé (en attente)', num: 1, f: (r) => fmtN(r.eng) }, { k: 'solde', l: 'Solde disponible', num: 1, f: (r) => `<span class="${r.solde < 0 ? 't-crit' : ''}">${fmtN(r.solde)}</span>` },
        { k: 'pct', l: 'Consommation', num: 1, f: (r) => `<div class="mini"><div class="bar ${r.sev}"><i style="width:${Math.min(100, r.pct)}%"></i></div>${fmtN(r.pct, 0)} %</div>` },
        { k: 'lab', l: 'Alerte', f: (r) => pill(r.lab, r.sev) }, { k: 'par', l: 'Approuvé par', v: (r) => nm.user(r.approuve_par) }] }).mount($('#tb', root));
  };
  $('#bm', root).addEventListener('change', (e) => { App.filters.budget.mois = e.target.value; draw(); });
  $('#new', root)?.addEventListener('click', () => budgetForm(null));
  draw();
}

function budgetForm(b) {
  modal({ title: b ? 'Modifier le budget' : 'Nouveau budget',
    body: `<form class="form" id="bf"><div class="grid2">${field({ k: 'mois', l: 'Mois', t: 'month', req: 1 }, b?.mois || App.filters.budget.mois)}${field({ k: 'montant', l: 'Montant autorisé FCFA', t: 'number', req: 1 }, b?.montant)}
      ${field({ k: 'equipe_id', l: 'Équipe (vide = tout le service)', t: 'options', options: opts('equipes') }, b?.equipe_id)}${field({ k: 'categorie_id', l: 'Catégorie (facultatif)', t: 'options', options: opts('categories_depense', 'libelle') }, b?.categorie_id)}
      ${field({ k: 'vehicule_id', l: 'Véhicule (facultatif)', t: 'options', options: opts('vehicules', 'immatriculation') }, b?.vehicule_id)}${field({ k: 'commentaire', l: 'Commentaire / référence de décision', t: 'text' }, b?.commentaire)}
      ${b ? field({ k: 'actif', l: 'Budget actif', t: 'bool' }, b.actif !== false) : ''}</div><p class="err" hidden></p></form>`,
    footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="save">Enregistrer</button>',
    onMount: (m, close) => $('#save', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      try { await App.act('budget.save', { budget: { ...readForm($('#bf', m)), id: b?.id } }, 'Budget enregistré.'); close(); } catch (e) { showErr(m, e.message); }
    })) });
}

// ---------- Clôture mensuelle ----------
export function renderCloture(root) {
  const can = App.can('cloture', 'modifier');
  const deps = App.D.depenses || [];
  const dbl = doublonsDepenses(deps);
  const first = deps.map((d) => d.mois).sort()[0] || today().slice(0, 7);
  const months = monthsBetween(first + '-01', today()).reverse();
  root.innerHTML = pageHead('Clôture mensuelle', 'Vérifier les pièces manquantes et les anomalies, valider les totaux, puis verrouiller la période. Après clôture, seule la DAF peut corriger, avec motif.') + '<div class="card" id="tb"></div>';
  const rows = months.map((m) => {
    const ds = deps.filter((d) => d.mois === m);
    const c = (App.D.clotures || []).find((x) => x.mois === m);
    return { id: m, mois: m, tot: ds.filter((d) => d.statut === 'validee').reduce((s, d) => s + num(d.montant), 0), att: ds.filter((d) => ['brouillon', ...EN_ATTENTE].includes(d.statut)).length,
      sans: ds.filter((d) => !d.historique && !d.justificatif_cle && !d.reference_piece && d.statut !== 'annulee').length, dbl: ds.filter((d) => dbl.has(d.id)).length,
      ano: (App.D.anomalies || []).filter((a) => a.statut === 'ouverte' && a.objet_type === 'depenses' && ds.some((d) => d.id === a.objet_id)).length, c };
  });
  new Table({ title: 'Clôtures mensuelles', rows, pageSize: 24, sort: { k: 'mois', dir: -1 }, exportable: true,
    cols: [{ k: 'mois', l: 'Mois', f: (r) => `<b>${moisLabel(r.mois)}</b>` }, { k: 'tot', l: 'Total validé', num: 1, f: (r) => fmtN(r.tot) },
      { k: 'att', l: 'Non finalisées', num: 1, f: (r) => (r.att ? `<span class="t-warn">${r.att}</span>` : '0') }, { k: 'sans', l: 'Pièces manquantes', num: 1, f: (r) => (r.sans ? `<span class="t-warn">${r.sans}</span>` : '0') },
      { k: 'dbl', l: 'Doublons ?', num: 1 }, { k: 'ano', l: 'Anomalies ouvertes', num: 1 },
      { k: 'statut', l: 'État', v: (r) => (r.c?.statut === 'cloture' ? 'Clôturé' : 'Ouvert'), f: (r) => (r.c?.statut === 'cloture' ? pill('Clôturé', 'ok') + `<br><small>${esc(nm.user(r.c.user_id))}</small>` : pill(r.c?.statut === 'rouvert' ? 'Rouvert' : 'Ouvert', r.c?.statut === 'rouvert' ? 'warn' : 'info')) },
      { k: 'act', l: '', nosort: 1, noexp: 1, f: (r) => (can ? (r.c?.statut === 'cloture' ? `<button class="btn sm ghost" data-ro="${r.mois}">Rouvrir</button>` : `<button class="btn sm" data-cl="${r.mois}">Clôturer</button>`) : '') }] }).mount($('#tb', root));
  $$('[data-cl]', root).forEach((b) => b.addEventListener('click', async () => {
    const r = rows.find((x) => x.mois === b.dataset.cl);
    const warn = r.att || r.sans || r.dbl || r.ano ? `<br><br><b class="t-warn">Points ouverts : ${r.att} non finalisée(s), ${r.sans} pièce(s) manquante(s), ${r.dbl} doublon(s) potentiel(s), ${r.ano} anomalie(s).</b>` : '<br><br>Aucun point ouvert.';
    const c = await confirmBox({ title: `Clôturer ${moisLabel(r.mois)}`, message: `Total validé : <b>${fmtF(r.tot)}</b>.${warn}<br>Après clôture, les profils ordinaires ne pourront plus saisir ni modifier de dépense sur ce mois.`, okLabel: 'Clôturer la période', motif: true, motifLabel: 'Commentaire de clôture', motifRequired: false });
    if (c === null) return;
    try { await App.act('cloture.set', { mois: r.mois, statut: 'cloture', commentaire: c }, 'Période clôturée.'); } catch (e) { toast(e.message, 'err'); }
  }));
  $$('[data-ro]', root).forEach((b) => b.addEventListener('click', async () => {
    const c = await confirmBox({ title: `Rouvrir ${moisLabel(b.dataset.ro)}`, message: 'La réouverture est tracée. Les rapports déjà produits restent reproductibles grâce au journal d’audit.', okLabel: 'Rouvrir', motif: true, motifLabel: 'Motif de réouverture', danger: true });
    if (!c) return;
    try { await App.act('cloture.set', { mois: b.dataset.ro, statut: 'rouvert', commentaire: c }, 'Période rouverte.'); } catch (e) { toast(e.message, 'err'); }
  }));
  void exportRows; void daysBetween; void moisDe;
}
