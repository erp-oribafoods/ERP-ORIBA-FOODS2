// Demandes de carburant et de vidange : saisie, décision de la Direction, fiche PDF imprimable
// (mise en page reprise des fiches papier « FICHE DE DEMANDE DE CARBURANT / DE VIDANGE »).
import { App, nm, opts } from '../app.js';
import { esc, $, $$, fmtN, fmtD, Table, modal, confirmBox, field, readForm, showErr, busy, toast, icon, pill, saveBlob } from '../lib/ui.js';
import { today, num } from '../../shared/logic.js';
import { LOGO } from '../assets/logo.js';

const TYPE_L = { carburant: 'Carburant', vidange: 'Vidange' };
const STATUT = { soumise: ['En attente de décision', 'warn'], accordee: ['Accordée', 'ok'], refusee: ['Refusée', 'crit'], annulee: ['Annulée', 'mute'] };
const nb = (v) => (v === null || v === undefined || v === '' ? '' : fmtN(v).replace(/[  ]/g, ' '));

function dernierKmVidange(vehiculeId, sauf) {
  const a = (App.D.demandes || []).filter((d) => d.type === 'vidange' && d.vehicule_id === vehiculeId && d.statut === 'accordee' && d.id !== sauf).map((d) => num(d.km_actuel));
  const cat = App.D.categories_depense?.find((c) => c.code === 'VIDA');
  const b = (App.D.depenses || []).filter((d) => cat && d.categorie_id === cat.id && d.vehicule_id === vehiculeId && d.statut !== 'annulee' && d.kilometrage).map((d) => num(d.kilometrage));
  const m = Math.max(0, ...a, ...b);
  return m || null;
}
function dernierKm(vehiculeId) {
  const a = (App.D.demandes || []).filter((d) => d.vehicule_id === vehiculeId && d.statut !== 'annulee').map((d) => num(d.km_actuel));
  const b = (App.D.depenses || []).filter((d) => d.vehicule_id === vehiculeId && d.statut !== 'annulee' && d.kilometrage).map((d) => num(d.kilometrage));
  return Math.max(0, ...a, ...b) || null;
}
// Reste du budget carburant du mois pour l'équipe (budget Carburant, sinon rien)
function plafondRestant(d) {
  const cat = App.D.categories_depense?.find((c) => c.code === 'CARB');
  if (!cat) return null;
  const mois = (d.date || today()).slice(0, 7);
  const b = (App.D.budgets || []).find((x) => x.actif !== false && x.mois === mois && x.equipe_id === d.equipe_id && x.categorie_id === cat.id && !x.vehicule_id);
  if (!b) return null;
  const eng = (App.D.depenses || []).filter((x) => x.mois === mois && x.equipe_id === d.equipe_id && x.categorie_id === cat.id && !['annulee', 'rejetee'].includes(x.statut)).reduce((s, x) => s + num(x.montant), 0);
  return num(b.montant) - eng;
}

// ---------- Liste (dans Pilotage des dépenses) ----------
export function carteDemandes(host) {
  const canDec = App.can('depenses', 'valider');
  App.filters.dem = App.filters.dem || { statut: '' };
  const F = App.filters.dem;
  const rows = (App.D.demandes || []).filter((d) => !F.statut || d.statut === F.statut).map((d) => ({ ...d, _cls: d.statut === 'soumise' ? 'row-warn' : '' }));
  const att = (App.D.demandes || []).filter((d) => d.statut === 'soumise').length;
  host.innerHTML = `<article class="card" id="dem-card"><header><h3>${icon('truck')} Demandes de carburant et de vidange</h3>
      <div class="page-act"><button class="btn ghost sm" data-vierge="carburant" title="Fiche à remplir à la main">${icon('download')} Fiche vierge carburant</button><button class="btn ghost sm" data-vierge="vidange">${icon('download')} Fiche vierge vidange</button></div></header>
      <p class="muted small">La demande est saisie ici, décidée par le profil habilité, puis imprimée en PDF pour les visas. ${att ? `<b>${att} demande(s) en attente de décision.</b>` : ''}</p>
      <div class="filters"><label class="ff"><span>Statut</span><select id="dem-st"><option value="">Toutes</option>${Object.entries(STATUT).map(([k, [l]]) => `<option value="${k}" ${F.statut === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
      <div id="dem-t"></div></article>`;
  new Table({ title: 'Demandes de carburant et de vidange', rows, sort: { k: 'created_at', dir: -1 }, pageSize: 10, empty: 'Aucune demande pour le moment.', onRow: (r) => ouvrirDemande(r.id),
    cols: [{ k: 'numero', l: 'N° de demande', f: (r) => `<b>${esc(r.numero)}</b>` }, { k: 'type', l: 'Type', v: (r) => TYPE_L[r.type] }, { k: 'date', l: 'Date', f: (r) => fmtD(r.date) },
      { k: 'equipe', l: 'Équipe', v: (r) => nm.equipe(r.equipe_id) }, { k: 'veh', l: 'Véhicule', v: (r) => nm.vehicule(r.vehicule_id) }, { k: 'km_actuel', l: 'Km', num: 1, f: (r) => fmtN(r.km_actuel) },
      { k: 'montant_demande', l: 'Demandé FCFA', num: 1, f: (r) => (r.type === 'carburant' ? fmtN(r.montant_demande) : '—') },
      { k: 'accorde', l: 'Accordé FCFA', num: 1, v: (r) => (r.type === 'carburant' ? num(r.montant_accorde) : num(r.cout_pris_en_charge)), f: (r) => (r.statut === 'accordee' ? fmtN(r.type === 'carburant' ? r.montant_accorde : r.cout_pris_en_charge) : '—') },
      { k: 'demandeur_nom', l: 'Demandeur' }, { k: 'statut', l: 'Statut', v: (r) => STATUT[r.statut][0], f: (r) => pill(...STATUT[r.statut]) },
      { k: 'pdf', l: 'Fiche', nosort: 1, noexp: 1, f: (r) => `<button class="btn ghost sm" data-pdf="${r.id}" title="Télécharger la fiche PDF">${icon('download')} PDF</button>` }] }).mount($('#dem-t', host));
  $('#dem-st', host).addEventListener('change', (e) => { F.statut = e.target.value; carteDemandes(host); });
  $$('[data-new]', host).forEach((b) => b.addEventListener('click', () => demandeForm(b.dataset.new)));
  $$('[data-vierge]', host).forEach((b) => b.addEventListener('click', () => fichePDF({ type: b.dataset.vierge }, { vierge: true })));
  host.addEventListener('click', (e) => { const b = e.target.closest('[data-pdf]'); if (b) { e.stopPropagation(); fichePDF((App.D.demandes || []).find((d) => d.id === b.dataset.pdf)); } });
  void canDec;
}

// ---------- Formulaire de demande ----------
export function demandeForm(type, d = null) {
  const v = d || { type, date: today() };
  const veh = (App.D.vehicules || []).filter((x) => x.actif !== false);
  modal({ title: `${d ? 'Modifier la demande ' + d.numero : 'Nouvelle demande de ' + (type === 'carburant' ? 'carburant' : 'vidange')}`, wide: true,
    body: `<form class="form" id="dmf"><p class="muted small">${type === 'carburant' ? 'Transfert de solde depuis la carte principale ORIBA FOODS — à transmettre à la Direction commerciale.' : 'Demande d’entretien — vidange du véhicule — à transmettre à la Direction Générale.'}</p>
      <h4 class="form-t">Identification de l’équipe / véhicule</h4>
      <div class="grid2">${field({ k: 'date', l: 'Date', t: 'date', req: 1 }, v.date)}
      ${field({ k: 'equipe_id', l: 'Équipe', t: 'options', options: opts('equipes'), req: 1 }, v.equipe_id)}
      <label class="fld"><span>Région</span><input id="dm-region" type="text" disabled value="${esc(v.zone_id ? nm.zone(v.zone_id) : '')}"></label>
      ${field({ k: 'vehicule_id', l: 'Immatriculation', t: 'options', options: veh.map((x) => ({ v: x.id, l: `${x.immatriculation}${x.modele ? ' — ' + x.modele : ''}` })), req: 1, help: veh.length ? '' : 'Aucun véhicule : ajoutez-le dans Référentiels > Véhicules.' }, v.vehicule_id)}
      ${field({ k: 'chef_equipe', l: 'Chef d’équipe / Coordinateur', t: 'text' }, v.chef_equipe)}</div>
      <h4 class="form-t">Détail de la demande ${type === 'carburant' ? 'carburant' : 'vidange'}</h4>
      <div class="grid2">${field({ k: 'km_actuel', l: 'Kilométrage actuel (obligatoire, km)', t: 'number', req: 1, min: 0 }, v.km_actuel)}
      ${type === 'carburant' ? field({ k: 'montant_demande', l: 'Montant demandé (FCFA)', t: 'number', req: 1, min: 0, step: 500 }, v.montant_demande) : field({ k: 'km_derniere_vidange', l: 'Km de la dernière vidange', t: 'number', min: 0 }, v.km_derniere_vidange)}
      ${field({ k: 'motif', l: type === 'carburant' ? 'Motif / Trajet prévu' : 'Motif / observations', t: 'textarea', wide: true, req: type === 'carburant' ? 1 : 0, rows: 2 }, v.motif)}</div>
      <p class="muted small" id="dm-info"></p><p class="note warn" id="dm-warn" hidden></p>
      <p class="small"><i>${type === 'carburant' ? 'Je certifie l’exactitude du kilométrage déclaré et m’engage à utiliser le carburant uniquement pour les activités commerciales ORIBA FOODS.' : 'Je certifie l’exactitude du kilométrage déclaré et confirme la nécessité de la vidange.'}</i></p>
      <p class="err" hidden></p></form>`,
    footer: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="dm-save">${icon('check')} Enregistrer et transmettre</button>`,
    onMount: (m, close) => {
      const eqSel = $('[name=equipe_id]', m), vSel = $('[name=vehicule_id]', m);
      const majEq = () => {
        const e = (App.D.equipes || []).find((x) => x.id === eqSel.value);
        $('#dm-region', m).value = e?.zone_id ? nm.zone(e.zone_id) : '';
        if (e?.responsable && !$('[name=chef_equipe]', m).value) $('[name=chef_equipe]', m).value = e.responsable;
        if (e && !vSel.value) { const vv = veh.find((x) => x.equipe_id === e.id); if (vv) { vSel.value = vv.id; majVeh(); } }
      };
      const majVeh = () => {
        const id = vSel.value; if (!id) { $('#dm-info', m).textContent = ''; return; }
        const k = dernierKm(id), kv = dernierKmVidange(id, d?.id);
        if (type === 'vidange' && kv && !$('[name=km_derniere_vidange]', m).value) $('[name=km_derniere_vidange]', m).value = kv;
        const x = veh.find((y) => y.id === id);
        if (x?.equipe_id && !eqSel.value) { eqSel.value = x.equipe_id; majEq(); }
        $('#dm-info', m).textContent = [k ? `Dernier kilométrage connu pour ce véhicule : ${fmtN(k)} km.` : '', kv ? `Dernière vidange enregistrée à ${fmtN(kv)} km.` : ''].filter(Boolean).join(' ');
        verifKm();
      };
      const verifKm = () => {
        const k = vSel.value ? dernierKm(vSel.value) : null, val = Number($('[name=km_actuel]', m).value || 0);
        const w = $('#dm-warn', m);
        w.hidden = !(k && val && val < k);
        if (!w.hidden) w.textContent = `Attention : ${fmtN(val)} km est inférieur au dernier kilométrage connu (${fmtN(k)} km). Vérifiez le compteur.`;
      };
      $('[name=km_actuel]', m).addEventListener('input', verifKm);
      eqSel.addEventListener('change', majEq); vSel.addEventListener('change', majVeh);
      if (v.vehicule_id) majVeh();
      $('#dm-save', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const f = readForm($('#dmf', m));
        try {
          const r = await App.act('demande.save', { demande: { ...f, type, id: d?.id } }, null);
          close();
          toast(`Demande ${r.demande.numero} enregistrée et transmise à la Direction.`);
          ouvrirDemande(r.demande.id);
        } catch (e) { showErr(m, e.message); }
      }));
    } });
}

// ---------- Détail, décision, impression ----------
export function ouvrirDemande(id) {
  const d = (App.D.demandes || []).find((x) => x.id === id);
  if (!d) return;
  const canDec = App.can('depenses', 'valider') && d.statut === 'soumise' && (d.created_by !== App.user.id || App.I.p.double_controle === false);
  const own = d.created_by === App.user.id;
  const ligne = (l, v) => `<dt>${l}</dt><dd>${v}</dd>`;
  modal({ title: `Demande ${d.numero} — ${TYPE_L[d.type]}`, wide: true,
    body: `<div class="dl-wrap">${pill(...STATUT[d.statut])}</div><dl class="dl">
      ${ligne('Date', fmtD(d.date))}${ligne('Équipe / Région', `${esc(nm.equipe(d.equipe_id))} · ${esc(d.zone_id ? nm.zone(d.zone_id) : '—')}`)}
      ${ligne('Véhicule', esc(nm.vehicule(d.vehicule_id)))}${ligne('Chef d’équipe / Coordinateur', esc(d.chef_equipe || '—'))}
      ${ligne('Kilométrage actuel', `${fmtN(d.km_actuel)} km`)}
      ${d.type === 'carburant' ? ligne('Montant demandé', `${fmtN(d.montant_demande)} FCFA`) : ligne('Km de la dernière vidange', d.km_derniere_vidange ? `${fmtN(d.km_derniere_vidange)} km (${fmtN(num(d.km_actuel) - num(d.km_derniere_vidange))} km parcourus depuis)` : '—')}
      ${ligne(d.type === 'carburant' ? 'Motif / Trajet prévu' : 'Motif / observations', esc(d.motif || '—'))}${ligne('Demandeur', esc(d.demandeur_nom || nm.user(d.created_by)))}
      ${d.statut === 'accordee' || d.statut === 'refusee' ? `${ligne('Décision', `${STATUT[d.statut][0]} le ${fmtD(d.decide_le)} par ${esc(d.decide_par_nom || '')}`)}
        ${d.type === 'carburant' ? `${ligne('Solde carte avant transfert', d.solde_carte_avant != null ? fmtN(d.solde_carte_avant) + ' FCFA' : '—')}${ligne('Montant transféré accordé', fmtN(d.montant_accorde) + ' FCFA')}${ligne('Plafond mensuel restant équipe', d.plafond_restant != null ? fmtN(d.plafond_restant) + ' FCFA' : '—')}`
          : `${ligne('Coût pris en charge', d.cout_pris_en_charge != null ? fmtN(d.cout_pris_en_charge) + ' FCFA' : '—')}${ligne('Prochaine vidange prévue à', d.prochaine_vidange_km ? fmtN(d.prochaine_vidange_km) + ' km' : '—')}`}
        ${d.decision_commentaire ? ligne('Commentaire', esc(d.decision_commentaire)) : ''}${d.depense_id ? ligne('Dépense liée', esc(App.D.depenses?.find((x) => x.id === d.depense_id)?.numero || 'créée')) : ''}` : ''}
      ${d.statut === 'annulee' ? ligne('Motif d’annulation', esc(d.decision_commentaire || '')) : ''}</dl>`,
    footer: `${(own || App.can('depenses', 'valider')) && d.statut === 'soumise' ? '<button class="btn ghost danger" id="dm-ann">Annuler la demande</button>' : ''}${own && d.statut === 'soumise' ? '<button class="btn ghost" id="dm-mod">Modifier</button>' : ''}<span class="grow"></span>
      <button class="btn" id="dm-pdf">${icon('download')} Télécharger la fiche PDF</button><button class="btn" id="dm-print">${icon('file')} Imprimer</button>${canDec ? `<button class="btn primary" id="dm-dec">${icon('check')} Décider</button>` : ''}`,
    onMount: (m, close) => {
      const f = m.parentElement;
      $('#dm-pdf', f).addEventListener('click', () => fichePDF(d));
      $('#dm-print', f).addEventListener('click', () => fichePDF(d, { imprimer: true }));
      $('#dm-mod', f)?.addEventListener('click', () => { close(); demandeForm(d.type, d); });
      $('#dm-dec', f)?.addEventListener('click', () => { close(); decisionForm(d); });
      $('#dm-ann', f)?.addEventListener('click', async () => {
        const motif = await confirmBox({ title: `Annuler la demande ${d.numero}`, message: 'La demande restera visible avec le statut « Annulée ».', okLabel: 'Annuler la demande', danger: true, motif: true });
        if (!motif) return;
        try { await App.act('demande.cancel', { id: d.id, motif }, 'Demande annulée.'); close(); } catch (e) { toast(e.message, 'err'); }
      });
    } });
}

function decisionForm(d) {
  const carb = d.type === 'carburant';
  const pr = carb ? plafondRestant(d) : null;
  modal({ title: `Décision — ${d.numero}`, wide: true,
    body: `<form class="form" id="dcf"><p class="lead">${carb ? `Carburant : <b>${fmtN(d.montant_demande)} FCFA</b> demandés` : `Vidange à <b>${fmtN(d.km_actuel)} km</b>${d.km_derniere_vidange ? ` (dernière à ${fmtN(d.km_derniere_vidange)} km)` : ''}`} — ${esc(nm.equipe(d.equipe_id))} · ${esc(nm.vehicule(d.vehicule_id))}</p>
      <div class="seg" role="group" id="dc-seg"><button type="button" data-d="accordee" class="on">Accorder</button><button type="button" data-d="refusee">Refuser</button></div>
      <h4 class="form-t">Cadre réservé à la Direction</h4>
      <div class="grid2">${carb ? `${field({ k: 'solde_carte_avant', l: 'Solde carte avant transfert (FCFA)', t: 'number', min: 0 })}${field({ k: 'montant_accorde', l: 'Montant transféré accordé (FCFA)', t: 'number', min: 0, req: 1 }, d.montant_demande)}${field({ k: 'plafond_restant', l: 'Plafond mensuel restant équipe (FCFA)', t: 'number', help: pr !== null ? `Calcul : budget carburant du mois moins dépenses engagées = ${fmtN(pr)} FCFA` : 'Aucun budget carburant défini pour cette équipe ce mois-ci.' }, pr !== null ? pr - num(d.montant_demande) : '')}`
        : `${field({ k: 'cout_pris_en_charge', l: 'Coût pris en charge (FCFA)', t: 'number', min: 0 })}${field({ k: 'prochaine_vidange_km', l: 'Prochaine vidange prévue à (km)', t: 'number', min: 0 }, num(d.km_actuel) + 5000)}`}
      ${field({ k: 'commentaire', l: 'Commentaire (obligatoire en cas de refus)', t: 'textarea', wide: true, rows: 2 })}
      ${field({ k: 'creer_depense', l: carb ? 'Créer la dépense carburant correspondante (en brouillon, reçu à joindre)' : 'Créer la dépense de vidange correspondante (en brouillon, facture à joindre)', t: 'bool' }, carb)}</div><p class="err" hidden></p></form>`,
    footer: '<button class="btn ghost" data-close>Retour</button><button class="btn primary" id="dc-ok">Enregistrer la décision</button>',
    onMount: (m, close) => {
      let dec = 'accordee';
      $$('[data-d]', m).forEach((b) => b.addEventListener('click', () => { dec = b.dataset.d; $$('[data-d]', m).forEach((x) => x.classList.toggle('on', x === b)); $('#dc-ok', m.parentElement).textContent = dec === 'accordee' ? 'Enregistrer l’accord' : 'Enregistrer le refus'; }));
      $('#dc-ok', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const f = readForm($('#dcf', m));
        try {
          const r = await App.act('demande.decision', { id: d.id, decision: dec, creer_depense: !!f.creer_depense, direction: f }, null);
          close(); toast(`Demande ${r.demande.numero} ${dec === 'accordee' ? 'accordée' : 'refusée'}.${r.demande.depense_id ? ' Dépense créée en brouillon : joignez le reçu.' : ''}`);
          ouvrirDemande(r.demande.id);
        } catch (e) { showErr(m, e.message); }
      }));
    } });
}

// ---------- Fiche PDF (A4) ----------
let logoPNG = null;
async function logoEnPNG() {
  if (logoPNG) return logoPNG;
  const img = new Image(); img.src = LOGO;
  await img.decode();
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  logoPNG = { data: c.toDataURL('image/png'), w: img.naturalWidth, h: img.naturalHeight };
  return logoPNG;
}

export async function fichePDF(d, { vierge = false, imprimer = false } = {}) {
  const J = window.jspdf?.jsPDF;
  if (!J) return toast('Module PDF non chargé : vérifiez la connexion puis réessayez.', 'err');
  const carb = d.type === 'carburant';
  const doc = new J({ unit: 'pt', format: 'a4' });
  const VIOLET = [69, 48, 122], VERT = [84, 130, 53], ORANGE = [224, 123, 0], JAUNE = [255, 242, 204], GRIS = [242, 242, 242], BLEU = [24, 52, 196], TXT = [60, 45, 110], LIGNE = [170, 170, 170];
  const X0 = 36, X1 = 559;
  const val = (v) => (vierge ? '' : v ?? '');
  try { const L = await logoEnPNG(); const h = 44, w = (L.w / L.h) * h; doc.addImage(L.data, 'PNG', X0, 22, w, h); } catch { /* logo facultatif */ }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...VIOLET);
  doc.text(carb ? 'FICHE DE DEMANDE DE CARBURANT' : 'FICHE DE DEMANDE DE VIDANGE', X1, 55, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...VERT);
  doc.text(carb ? 'Transfert de solde depuis la carte Principale ORIBA FOODS' : 'Demande d’entretien — vidange véhicule', 440, 86, { align: 'center' });
  doc.text(carb ? 'À transmettre à la Direction commerciale — Niamey' : 'À transmettre à la Direction Générale', 440, 96, { align: 'center' });
  doc.setDrawColor(...VERT); doc.setLineWidth(2); doc.line(X0, 112, X1, 112);

  const lab = (t, x, y) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...TXT); doc.text(t, x, y); };
  const box = (x, y, w, h, v, fill = JAUNE, opts2 = {}) => {
    doc.setFillColor(...fill); doc.rect(x, y, w, h, 'F'); doc.setDrawColor(...LIGNE); doc.setLineWidth(0.6); doc.line(x, y + h, x + w, y + h);
    if (v !== '' && v !== null && v !== undefined) { doc.setFont('helvetica', opts2.bold ? 'bold' : 'normal'); doc.setFontSize(opts2.size || 9); doc.setTextColor(...BLEU); const lines = doc.splitTextToSize(String(v), w - 8); doc.text(lines.slice(0, opts2.maxLines || 1), x + 4, y + 12); }
  };
  const bar = (t, y, col = VIOLET) => { doc.setFillColor(...col); doc.rect(X0, y, X1 - X0, 18, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(255, 255, 255); doc.text(t, X0 + 4, y + 12.5); };
  const unit = (t, x, y) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(110, 110, 110); doc.text(t, x, y); };

  // En-tête de la demande
  lab('N° de demande :', X0 + 2, 128); box(146, 115, 137, 18, val(d.numero), JAUNE, { bold: false });
  lab('Date :', 288, 128); box(379, 115, X1 - 379, 18, vierge ? '' : fmtD(d.date));
  doc.setDrawColor(...LIGNE); doc.line(X0, 133, X1, 133);
  // Identification
  bar('IDENTIFICATION DE L\'ÉQUIPE / VÉHICULE', 148);
  lab('Région :', X0 + 2, 179); box(146, 168, 137, 17, vierge ? '' : (d.zone_id ? nm.zone(d.zone_id) : '') + (d.equipe_id ? ` — ${nm.equipe(d.equipe_id)}` : ''));
  lab('Immatriculation :', X0 + 2, 197); box(146, 186, 137, 18, vierge ? '' : nm.vehicule(d.vehicule_id));
  lab('Chef d\'équipe /', 288, 192); lab('Coordinateur :', 288, 202); box(379, 186, X1 - 379, 18, val(d.chef_equipe));
  // Détail
  bar(carb ? 'DÉTAIL DE LA DEMANDE CARBURANT' : 'DÉTAIL DE LA DEMANDE VIDANGE', 220);
  lab('Kilométrage actuel (OBLIGATOIRE) :', X0 + 2, 251); box(235, 240, 144, 17, vierge ? '' : nb(d.km_actuel)); unit('km', 382, 251);
  if (carb) { lab('Montant demandé :', X0 + 2, 270); box(235, 259, 144, 17, vierge ? '' : nb(d.montant_demande)); unit('FCFA', 382, 270); }
  else { lab('Km de la dernière vidange :', X0 + 2, 270); box(235, 259, 144, 17, vierge ? '' : nb(d.km_derniere_vidange)); unit('km', 382, 270); }
  lab(carb ? 'Motif / Trajet prévu :' : 'Motif / observations :', X0 + 2, 289);
  const motif = vierge ? '' : d.motif || '';
  doc.setFontSize(9);
  const court = !motif || doc.splitTextToSize(motif, 136).length === 1;
  const ml = court ? 1 : Math.min(3, doc.splitTextToSize(motif, X1 - 235 - 8).length);
  box(235, 278, court ? 144 : X1 - 235, court ? 17 : ml * 11 + 7, motif, JAUNE, { maxLines: 3 });
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(90, 90, 90);
  doc.text(carb ? 'Je certifie l\'exactitude du kilométrage déclaré et m\'engage à utiliser le carburant uniquement pour les activités commerciales ORIBA FOODS.' : 'Je certifie l\'exactitude du kilométrage déclaré et confirme la nécessité de la vidange.', X0 + 2, 322);
  // Visas
  bar('VISAS & VALIDATION', 348);
  const cols = [[X0, 235, 'Demandeur'], [235, 379, 'Assistant Achat & Logistique'], [379, X1, 'Directeur Générale']];
  doc.setDrawColor(...LIGNE); doc.setLineWidth(0.6); doc.line(X0, 396, X1, 396);
  for (const [a, b, t] of cols) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...TXT); doc.text(t, (a + b) / 2, 383, { align: 'center' });
    doc.setDrawColor(...LIGNE); doc.line(a, 396, a, 453);
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(160, 160, 160); doc.text('Nom & signature', (a + b) / 2, 449, { align: 'center' });
  }
  if (!vierge && d.demandeur_nom) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...BLEU); doc.text(d.demandeur_nom, (X0 + 235) / 2, 438, { align: 'center' }); }
  // Cadre direction
  bar('CADRE RÉSERVÉ À LA DIRECTION', 467, ORANGE);
  const dec = !vierge && (d.statut === 'accordee' || d.statut === 'refusee');
  if (carb) {
    lab('Solde carte avant transfert :', X0 + 2, 499); box(235, 488, 144, 17, dec ? nb(d.solde_carte_avant) : '', GRIS);
    lab('Montant transféré accordé :', X0 + 2, 518); box(235, 507, 144, 17, dec ? nb(d.montant_accorde) : '', JAUNE);
    lab('Plafond mensuel restant équipe :', X0 + 2, 537); box(235, 526, 144, 17, dec ? nb(d.plafond_restant) : '', GRIS);
    if (dec) { unit('FCFA', 382, 499); unit('FCFA', 382, 518); unit('FCFA', 382, 537); }
  } else {
    lab('Décision :', X0 + 2, 499); box(235, 488, 144, 17, dec ? STATUT[d.statut][0] : '');
    lab('Coût pris en charge :', X0 + 2, 518); box(235, 507, 144, 17, dec ? nb(d.cout_pris_en_charge) : ''); if (dec && d.cout_pris_en_charge != null) unit('FCFA', 382, 518);
    lab('Prochaine vidange prévue à (km) :', X0 + 2, 537); box(235, 526, 144, 17, dec ? nb(d.prochaine_vidange_km) : '');
  }
  if (dec) {
    doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(...TXT);
    doc.text(doc.splitTextToSize(`Décision enregistrée dans ORIBA ERP : ${STATUT[d.statut][0].toLowerCase()} le ${fmtD(d.decide_le)} par ${d.decide_par_nom || ''}${d.decision_commentaire ? ' — ' + d.decision_commentaire : ''}`, X1 - X0 - 4).slice(0, 2), X0 + 2, 556);
  } else if (!vierge && d.statut === 'annulee') {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(200, 40, 40); doc.text('DEMANDE ANNULÉE', 470, 515, { align: 'center' });
  }
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7); doc.setTextColor(...VIOLET);
  doc.text('ORIBA FOODS — Société agro-alimentaire  •  Document interne de gestion de flotte', 297, 580, { align: 'center' });
  if (!vierge) { doc.setFontSize(6); doc.setTextColor(150, 150, 150); doc.text(`Édité depuis ORIBA ERP le ${new Date().toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' })}`, 297, 590, { align: 'center' }); }
  const nom = vierge ? `Fiche_vierge_demande_${d.type}.pdf` : `${d.numero}.pdf`;
  if (imprimer) {
    doc.autoPrint();
    const url = URL.createObjectURL(doc.output('blob'));
    const w = window.open(url, '_blank');
    if (!w) { toast('Le navigateur a bloqué la fenêtre d’impression : la fiche est téléchargée, ouvrez-la puis imprimez.', 'warn'); await saveBlob(nom, doc.output('blob')); }
    return;
  }
  await saveBlob(nom, doc.output('blob'));
}
