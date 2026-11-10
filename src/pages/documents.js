// Documents administratifs de la Force de Vente : établissement sur papier à en-tête (Word), archives et catalogue.
import { App, nm, pageHead } from '../app.js';
import { esc, $, $$, Table, modal, busy, toast, icon, pill, saveBlob, confirmBox, showErr } from '../lib/ui.js';
import { DOCS, DOC_BY_CODE, FAMILLES_DOC } from '../../shared/documents.js';
import { genererDocx, nomFichier, avecCarnet, DOCX_MIME } from '../lib/docx.js';
import { depots, libDepot, piecesLiees, preremplir, lienTable, jj } from '../lib/docsPrefill.js';
import { today } from '../../shared/logic.js';

const peutEmettre = () => App.can('circuit', 'creer');
const STATUTS = { emis: ['Émis, à classer', 'warn'], archive: ['Archivé', 'ok'], annule: ['Annulé', 'err'] };
const optFam = (sel) => Object.entries(FAMILLES_DOC).map(([k, l]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${k} · ${esc(l)}</option>`).join('');
const optDocs = (fam, sel) => DOCS.filter((d) => !fam || d.fam === fam).map((d) => `<option value="${d.code}" ${sel === d.code ? 'selected' : ''}>${d.code} — ${esc(d.titre)}</option>`).join('');
const optDepots = (sel, vide = 'Direction / service (sans dépôt)') => `<option value="">${vide}</option>${depots().map((a) => `<option value="${a.id}" ${sel === a.id ? 'selected' : ''}>${esc(libDepot(a.id))}</option>`).join('')}`;

function telecharger(def, d) {
  const u8 = genererDocx(def, d);
  saveBlob(nomFichier(def, d), new Blob([u8], { type: DOCX_MIME }));
}

async function fichierB64(file) {
  let blob = file;
  if (/^image\/(jpeg|png|webp)$/.test(file.type) && file.size > 900 * 1024) {
    const img = await createImageBitmap(file);
    const k = Math.min(1, 2000 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
  }
  const b64 = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });
  return { base64: b64, type: blob.type || file.type || DOCX_MIME, nom: blob === file ? file.name : file.name.replace(/\.\w+$/, '') + '.jpg' };
}

// ---------- Établir un document ----------
export function renderDocuments(root) {
  const f = (App.filters.docs = App.filters.docs || { fam: 'C', code: 'BLD', depot: '', date: today(), lien: '', carnet: true });
  const def = DOC_BY_CODE.get(f.code) || DOCS[0];
  const liees = piecesLiees(def, f.depot);
  root.innerHTML = pageHead('Établir un document', 'Chaque pièce sort sur le papier à en-tête Foods Oriba, au format Word, pré-remplie avec les données de l’ERP quand elles existent. Numérotée, elle est inscrite aux archives.') +
    `<div class="docs-grid">
      <article class="card"><header><h3>1. Choisir le document</h3></header>
        <div class="form docs-form">
          <label class="ff"><span>Famille</span><select id="d-fam"><option value="">Toutes les familles</option>${optFam(f.fam)}</select></label>
          <label class="ff"><span>Document</span><select id="d-code">${optDocs(f.fam, def.code)}</select></label>
          <label class="ff"><span>${def.dep ? 'Équipe / dépôt' : 'Équipe / dépôt (facultatif)'}</span><select id="d-dep">${optDepots(f.depot, def.dep ? 'Choisir le dépôt…' : 'Direction / service (sans dépôt)')}</select></label>
          <label class="ff"><span>Date du document</span><input type="date" id="d-date" value="${f.date}"></label>
          ${liees ? `<label class="ff wide"><span>Pièce de l’ERP à reprendre (${liees.length})</span><select id="d-lien"><option value="">— Aucune : document à remplir à la main —</option>${liees.map((p) => `<option value="${p.id}" ${f.lien === p.id ? 'selected' : ''}>${esc(p.l)}</option>`).join('')}</select></label>` : ''}
          ${avecCarnet(def) ? `<label class="chk wide"><input type="checkbox" id="d-carnet" ${f.carnet ? 'checked' : ''}> Imprimer les trois exemplaires du carnet (blanc — original, jaune — copie, rose — souche)</label>` : ''}
          <label class="ff wide"><span>Observation (imprimée sur le document)</span><input id="d-obs" maxlength="300" placeholder="Facultatif"></label>
        </div>
        <footer class="docs-actions">
          ${peutEmettre() ? `<button class="btn primary" id="d-emit">${icon('download')} Émettre le n° et télécharger (Word)</button>` : ''}
          <button class="btn" id="d-blank">${icon('download')} Modèle vierge (Word)</button>
          <p class="err" hidden></p>
        </footer>
      </article>
      <article class="card docs-fiche"><header><h3>${esc(def.code)} — ${esc(def.titre)}</h3>${pill(FAMILLES_DOC[def.fam])}</header>
        <dl class="dl"><dt>Procédure</dt><dd>${esc(def.proc)}</dd><dt>Établi par</dt><dd>${esc(def.etabli)}</dd><dt>Signé par</dt><dd>${esc(def.signe)}</dd><dt>Circulation</dt><dd>${esc(def.circ)}</dd>
        <dt>Numérotation</dt><dd><code>${esc(def.code)}-${def.dep ? 'ÉQUIPE' : 'DIR'}-${f.date.slice(0, 4)}-0001</code> — attribuée par l’ERP, jamais réutilisée</dd>
        <dt>Pré-remplissage</dt><dd>${def.src ? 'Oui, à partir des données saisies' + (liees ? ' (choisir la pièce à reprendre)' : '') : 'Non : formulaire à remplir à la main'}</dd></dl>
        <div id="d-apercu"></div>
      </article>
    </div>
    <article class="card"><header><h3>Derniers documents émis</h3><a class="btn sm ghost" href="#archives">${icon('box')} Toutes les archives</a></header><div id="d-last"></div></article>`;

  const lire = () => { f.fam = $('#d-fam', root).value; f.depot = $('#d-dep', root).value; f.date = $('#d-date', root).value || today(); f.lien = $('#d-lien', root)?.value || ''; f.carnet = $('#d-carnet', root)?.checked ?? f.carnet; };
  $('#d-fam', root).addEventListener('change', () => { lire(); const first = DOCS.find((d) => !f.fam || d.fam === f.fam); f.code = first.code; f.lien = ''; renderDocuments(root); });
  $('#d-code', root).addEventListener('change', (e) => { lire(); f.code = e.target.value; f.lien = ''; renderDocuments(root); });
  $('#d-dep', root).addEventListener('change', () => { lire(); f.lien = ''; renderDocuments(root); });
  $('#d-date', root).addEventListener('change', () => { lire(); apercu(); });
  // La date du document reprend celle de la pièce choisie (livraison, vente, versement…)
  $('#d-lien', root)?.addEventListener('change', () => { lire(); const pl = liees.find((x) => x.id === f.lien); if (pl?.date) { f.date = pl.date; $('#d-date', root).value = pl.date; } apercu(); });
  $('#d-carnet', root)?.addEventListener('change', lire);

  function contenuCourant() {
    const p = preremplir(def, { depotId: f.depot, date: f.date, lienId: f.lien });
    const obs = $('#d-obs', root).value.trim();
    return { p, contenu: { champs: p.champs, lignes: p.lignes, observation: obs || undefined } };
  }
  function apercu() {
    const { p } = contenuCourant();
    const ch = Object.entries(p.champs).filter(([k]) => ![ 'Mois', 'Mois inventorié', 'Mois évalué', 'Semaine du … au …', 'Semaine du', 'Mise à jour du', 'Période'].includes(k) || (def.f || []).concat(def.f2 || []).some((x) => (x.l || x) === k));
    const nl = (p.lignes || []).reduce((s, l) => s + (l?.length || 0), 0);
    $('#d-apercu', root).innerHTML = ch.length || nl ? `<p class="muted small">Données reprises de l’ERP :</p><ul class="docs-pre">${ch.slice(0, 10).map(([k, v]) => `<li><span>${esc(k)}</span><b>${esc(typeof v === 'number' ? v.toLocaleString('fr-FR') : v)}</b></li>`).join('')}${nl ? `<li><span>Lignes de tableau</span><b>${nl}</b></li>` : ''}</ul>` : `<p class="muted small">${def.src && (liees || def.dep) ? 'Choisissez le dépôt' + (liees ? ' et la pièce' : '') + ' pour reprendre les données.' : 'Le document sort vierge, prêt à être rempli à la main.'}</p>`;
  }
  apercu();

  $('#d-blank', root).addEventListener('click', () => { lire(); const { contenu } = contenuCourant(); telecharger(def, { date: f.date, equipe: f.depot ? libDepot(f.depot) : '', contenu, copies: f.carnet && avecCarnet(def) ? 3 : 1 }); });
  $('#d-emit', root)?.addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    lire();
    const { p, contenu } = contenuCourant();
    const depot = p.depot || f.depot || null;
    if (def.dep && !depot) return showErr($('.docs-actions', root), 'Choisissez l’équipe / le dépôt concerné : il entre dans le numéro du document.');
    try {
      const r = await App.api.call('doc.emettre', { code: def.code, titre: def.titre, agent_id: depot, date: f.date, lien_table: f.lien ? lienTable(def) : null, lien_id: f.lien || null, contenu, observation: contenu.observation });
      telecharger(def, { numero: r.document.numero, date: f.date, equipe: depot ? libDepot(depot) : '', contenu, copies: f.carnet && avecCarnet(def) ? 3 : 1 });
      toast(`Document ${r.document.numero} émis et inscrit aux archives.`);
      await App.refresh(); App.rerender();
    } catch (e) { showErr($('.docs-actions', root), e.message); }
  }));
  tableArchives($('#d-last', root), (App.D.documents || []).slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8), { compact: true });
}

// ---------- Archives ----------
function tableArchives(host, rows, { compact = false } = {}) {
  new Table({ title: 'Archives des documents', rows, pageSize: compact ? 8 : 25, sort: { k: 'date_doc', dir: -1 }, exportable: !compact, empty: 'Aucun document pour ces critères.', onRow: ouvrir,
    cols: [
      { k: 'numero', l: 'N°', f: (r) => `<code>${esc(r.numero || '(sans n°)')}</code>`, x: (r) => r.numero || '' },
      { k: 'date_doc', l: 'Date', f: (r) => jj(r.date_doc), x: (r) => jj(r.date_doc) },
      { k: 'code', l: 'Document', v: (r) => `${r.code} — ${DOC_BY_CODE.get(r.code)?.titre || r.titre || ''}`, cls: 'wrap' },
      { k: 'agent_id', l: 'Équipe / dépôt', v: (r) => (r.agent_id ? App.I.agents.get(r.agent_id)?.nom || '' : 'Direction') },
      { k: 'source', l: 'Origine', v: (r) => (r.source === 'televerse' ? 'Pièce numérisée' : 'Généré par l’ERP') },
      { k: 'fichier_nom', l: 'Pièce signée', f: (r) => (r.fichier_cle ? `${icon('check')} ${esc(r.fichier_nom || 'jointe')}` : '<span class="muted">—</span>'), x: (r) => r.fichier_nom || '' },
      { k: 'statut', l: 'Statut', f: (r) => pill(...(STATUTS[r.statut] || [r.statut])), x: (r) => STATUTS[r.statut]?.[0] || r.statut },
    ] }).mount(host);
}

function ouvrir(doc) {
  const def = DOC_BY_CODE.get(doc.code);
  modal({ title: `${doc.numero || 'Pièce sans numéro'} — ${def?.titre || doc.titre || doc.code}`, wide: true,
    body: `<dl class="dl"><dt>Date</dt><dd>${jj(doc.date_doc)}</dd><dt>Équipe / dépôt</dt><dd>${esc(doc.agent_id ? libDepot(doc.agent_id) : 'Direction / service')}</dd>
      <dt>Origine</dt><dd>${doc.source === 'televerse' ? 'Pièce numérisée' : 'Généré par l’ERP'}${doc.lien_table ? ' · repris d’une pièce de l’ERP' : ''}</dd><dt>Statut</dt><dd>${pill(...(STATUTS[doc.statut] || [doc.statut]))}${doc.motif ? ` — ${esc(doc.motif)}` : ''}</dd>
      <dt>Émis par</dt><dd>${esc(nm.user(doc.created_by))} le ${new Date(doc.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' })}</dd>
      <dt>Pièce signée</dt><dd>${doc.fichier_cle ? esc(doc.fichier_nom) : 'Pas encore jointe : scannez ou photographiez la pièce signée et joignez-la.'}</dd>${doc.observation ? `<dt>Observation</dt><dd>${esc(doc.observation)}</dd>` : ''}</dl>
      <p class="err" hidden></p>`,
    footer: `${def && doc.source === 'genere' ? `<button class="btn" data-a="word">${icon('download')} Réimprimer (Word)</button>` : ''}
      ${doc.fichier_cle ? `<button class="btn" data-a="voir">${icon('download')} Pièce signée</button>` : ''}
      ${peutEmettre() && doc.statut !== 'annule' ? `<label class="btn" tabindex="0">${icon('upload')} ${doc.fichier_cle ? 'Remplacer la pièce' : 'Joindre la pièce signée'}<input type="file" data-a="joindre" accept="application/pdf,image/*,.docx" hidden></label>` : ''}
      ${App.can('circuit', 'annuler') && doc.statut !== 'annule' ? `<button class="btn danger ghost" data-a="annuler">Annuler</button>` : ''}`,
    onMount: (m, close) => {
      const foot = m.parentElement;
      $('[data-a="word"]', foot)?.addEventListener('click', () => telecharger(def, { numero: doc.numero, date: doc.date_doc, equipe: doc.agent_id ? libDepot(doc.agent_id) : '', contenu: doc.contenu || {}, copies: avecCarnet(def) ? 3 : 1 }));
      $('[data-a="voir"]', foot)?.addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        try { const f = await App.api.call('doc.fichier', { id: doc.id }); saveBlob(f.nom, new Blob([Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0))], { type: f.type })); } catch (e) { showErr(m, e.message); }
      }));
      $('[data-a="joindre"]', foot)?.addEventListener('change', async (ev) => {
        const file = ev.target.files[0]; if (!file) return;
        try { const fb = await fichierB64(file); await App.act('doc.archiver', { id: doc.id, ...fb }, 'Pièce signée archivée.'); close(); } catch (e) { showErr(m, e.message); }
      });
      $('[data-a="annuler"]', foot)?.addEventListener('click', async () => {
        const motif = await confirmBox({ title: `Annuler ${doc.numero || 'la pièce'}`, message: 'Le document reste dans les archives avec la mention « Annulé » : son numéro n’est jamais réutilisé. Barrez aussi les trois exemplaires papier.', motif: true, danger: true, okLabel: 'Annuler le document' });
        if (!motif) return;
        try { await App.act('doc.annuler', { id: doc.id, motif }, 'Document annulé.'); close(); } catch (e) { toast(e.message, 'err'); }
      });
    } });
}

function archiverPiece() {
  const f = App.filters.docs || {};
  modal({ title: 'Archiver une pièce numérisée', body: `<form class="form" id="ap">
      <label class="ff"><span>Type de document</span><select name="code">${optDocs('', f.code || 'BLD')}</select></label>
      <label class="ff"><span>Équipe / dépôt</span><select name="agent_id">${optDepots(f.depot || '')}</select></label>
      <label class="ff"><span>Date de la pièce</span><input type="date" name="date" value="${today()}"></label>
      <label class="ff"><span>N° porté sur la pièce</span><input name="numero" placeholder="ex. BLD-NIA1-2026-0012 (facultatif)"></label>
      <label class="ff wide"><span>Observation</span><input name="observation" maxlength="300"></label>
      <label class="ff wide"><span>Fichier (PDF, photo ou Word — 4 Mo au plus)</span><input type="file" name="fichier" accept="application/pdf,image/*,.docx" required></label>
      <p class="err" hidden></p></form>`,
    footer: '<button class="btn ghost" data-close>Fermer</button><button class="btn primary" id="ap-ok">Archiver</button>',
    onMount: (m, close) => $('#ap-ok', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      const fm = $('#ap', m), file = fm.fichier.files[0];
      if (!file) return showErr(m, 'Choisissez le fichier à archiver.');
      try {
        const fb = await fichierB64(file);
        await App.act('doc.archiver', { code: fm.code.value, agent_id: fm.agent_id.value || null, date: fm.date.value, numero: fm.numero.value.trim() || null, observation: fm.observation.value, titre: DOC_BY_CODE.get(fm.code.value)?.titre, ...fb }, 'Pièce archivée.');
        close();
      } catch (e) { showErr(m, e.message); }
    })) });
}

export function renderArchives(root) {
  const f = (App.filters.archives = App.filters.archives || { fam: '', code: '', depot: '', statut: '', du: '', au: '' });
  const all = App.D.documents || [];
  const rows = all.filter((d) => (!f.fam || DOC_BY_CODE.get(d.code)?.fam === f.fam) && (!f.code || d.code === f.code) && (!f.depot || d.agent_id === f.depot) && (!f.statut || d.statut === f.statut) && (!f.du || d.date_doc >= f.du) && (!f.au || d.date_doc <= f.au));
  const n = (s) => all.filter((d) => d.statut === s).length;
  const parFam = Object.keys(FAMILLES_DOC).map((k) => [k, all.filter((d) => DOC_BY_CODE.get(d.code)?.fam === k && d.statut !== 'annule').length]);
  root.innerHTML = pageHead('Archives et classement', 'Registre de tous les documents émis par l’ERP et des pièces signées numérisées, classés par équipe, mois et numéro. Rien n’est effacé : une pièce erronée est annulée avec motif.') +
    `<div class="kpis">
      <div class="kpi"><span>Documents archivés</span><b>${all.length}</b></div>
      <div class="kpi warn"><span>Émis, pièce signée à joindre</span><b>${n('emis')}</b></div>
      <div class="kpi ok"><span>Classés avec pièce signée</span><b>${n('archive')}</b></div>
      <div class="kpi"><span>Annulés</span><b>${n('annule')}</b></div>
    </div>
    <article class="card"><header><h3>Classement par famille</h3>${peutEmettre() ? `<button class="btn sm" id="ar-up">${icon('upload')} Archiver une pièce numérisée</button>` : ''}</header>
      <div class="docs-fams">${parFam.map(([k, c]) => `<button class="docs-fam ${f.fam === k ? 'on' : ''}" data-fam="${k}"><b>${k}</b><span>${esc(FAMILLES_DOC[k])}</span><em>${c}</em></button>`).join('')}</div></article>
    <article class="card"><header><h3>Registre des documents</h3></header>
      <div class="filters">
        <label class="ff"><span>Document</span><select id="ar-code"><option value="">Tous</option>${optDocs(f.fam, f.code)}</select></label>
        <label class="ff"><span>Équipe / dépôt</span><select id="ar-dep">${optDepots(f.depot, 'Toutes')}</select></label>
        <label class="ff"><span>Statut</span><select id="ar-st"><option value="">Tous</option>${Object.entries(STATUTS).map(([k, [l]]) => `<option value="${k}" ${f.statut === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="ff"><span>Du</span><input type="date" id="ar-du" value="${f.du}"></label><label class="ff"><span>Au</span><input type="date" id="ar-au" value="${f.au}"></label>
        ${f.fam || f.code || f.depot || f.statut || f.du || f.au ? '<button class="btn sm ghost" id="ar-raz">Tout afficher</button>' : ''}
      </div><div id="ar-t"></div></article>`;
  tableArchives($('#ar-t', root), rows);
  $$('[data-fam]', root).forEach((b) => b.addEventListener('click', () => { f.fam = f.fam === b.dataset.fam ? '' : b.dataset.fam; f.code = ''; renderArchives(root); }));
  const maj = () => { f.code = $('#ar-code', root).value; f.depot = $('#ar-dep', root).value; f.statut = $('#ar-st', root).value; f.du = $('#ar-du', root).value; f.au = $('#ar-au', root).value; renderArchives(root); };
  ['#ar-code', '#ar-dep', '#ar-st', '#ar-du', '#ar-au'].forEach((s) => $(s, root).addEventListener('change', maj));
  $('#ar-raz', root)?.addEventListener('click', () => { Object.assign(f, { fam: '', code: '', depot: '', statut: '', du: '', au: '' }); renderArchives(root); });
  $('#ar-up', root)?.addEventListener('click', archiverPiece);
}

// ---------- Catalogue ----------
export function renderCatalogue(root) {
  root.innerHTML = pageHead('Catalogue des documents', `${DOCS.length} documents en ${Object.keys(FAMILLES_DOC).length} familles, du début à la fin de chaque opération. Numérotation : CODE-ÉQUIPE-ANNÉE-0001 ; les carnets sont en trois exemplaires (blanc, jaune, rose).`) +
    Object.entries(FAMILLES_DOC).map(([k, l]) => `<article class="card"><header><h3>${k} · ${esc(l)}</h3></header><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Code</th><th>Document</th><th>Procédure</th><th>Établi par</th><th>Signé par</th><th>Circulation</th><th></th></tr></thead><tbody>
      ${DOCS.filter((d) => d.fam === k).map((d) => `<tr><td><code>${d.code}</code></td><td class="wrap"><b>${esc(d.titre)}</b></td><td>${esc(d.proc)}</td><td class="wrap">${esc(d.etabli)}</td><td class="wrap">${esc(d.signe)}</td><td class="wrap small">${esc(d.circ)}</td>
        <td class="n"><button class="btn sm ghost" data-blank="${d.code}" title="Télécharger le modèle vierge">${icon('download')} Word</button>${peutEmettre() ? ` <button class="btn sm" data-go="${d.code}">Établir</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div></article>`).join('');
  $$('[data-blank]', root).forEach((b) => b.addEventListener('click', () => { const def = DOC_BY_CODE.get(b.dataset.blank); telecharger(def, { date: '', contenu: {}, copies: avecCarnet(def) ? 3 : 1 }); }));
  $$('[data-go]', root).forEach((b) => b.addEventListener('click', () => { const def = DOC_BY_CODE.get(b.dataset.go); App.filters.docs = { ...(App.filters.docs || { date: today(), carnet: true }), fam: def.fam, code: def.code, lien: '' }; App.go('documents'); }));
}
