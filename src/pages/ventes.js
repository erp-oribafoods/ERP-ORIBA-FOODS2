// Journaux des ventes au comptant et à crédit, remboursements, relances.
import { ouvrirMiseAJour, peutMettreAJour } from '../lib/majTB.js';
import { App, nm, opts, filterBar, describeFilters, pageHead } from '../app.js';
import { esc, $, $$, fmtF, fmtN, fmtQ, fmtD, Table, modal, confirmBox, field, readForm, showErr, busy, toast, icon, pill, statutCreditPill } from '../lib/ui.js';
import { boutonImport, lierImport } from '../lib/importer.js';
import { venteMatches, periodRange } from '../lib/facts.js';
import { creditInfo, venteTotals, encoursClient, plafondClient, niveauPlafond, lineCalc, today, addDays, num } from '../../shared/logic.js';
import { MODES_PAIEMENT_REMB, CANAUX_RELANCE } from '../../shared/schema.js';
import { signalAnomalie } from './audit.js';

const ventesOf = (mode) => (App.D.ventes || []).filter((v) => v.mode === mode);

function lignesResume(v) {
  const t = venteTotals(v, App.I);
  return t.lignes.map((l) => `${nm.produit(l.produit_id)} × ${fmtN(l.quantite, 2)} ${l.unite}${l.quantite > 1 ? 's' : ''}`).join(', ');
}

// ---------- Listes ----------
export function renderVentes(root, mode) {
  const credit = mode === 'credit';
  const canCreate = App.can('ventes', 'creer');
  root.innerHTML = pageHead(credit ? 'Ventes à crédit' : 'Ventes au comptant',
    credit ? 'Échéances, remboursements, soldes et statuts calculés automatiquement.' : 'Montant = quantité × prix unitaire, calculé automatiquement.',
    `${peutMettreAJour() ? `<button class="btn" id="maj">${icon('refresh')} Mise à jour quotidienne</button>` : ''}${boutonImport(credit ? 'ventes_credit' : 'ventes_comptant')}${canCreate ? `<button class="btn primary" id="new">${icon('plus')} Nouvelle vente ${credit ? 'à crédit' : 'au comptant'}</button>` : ''}`) +
    `<div id="flt"></div><div class="card" id="tb"></div>`;
  lierImport(root);
  $('#maj', root)?.addEventListener('click', ouvrirMiseAJour);
  const draw = () => {
    const f = App.filters.ventes;
    const show = f.statut_v === 'annulee' ? 'annulee' : 'validee';
    const rows = ventesOf(mode).filter((v) => (show === 'annulee' ? v.statut === 'annulee' && venteMatches({ ...v, statut: 'validee' }, { ...f, mode: '' }, App.I) : venteMatches(v, { ...f, mode: '' }, App.I)))
      .filter((v) => !f.produit_id || venteTotals(v, App.I).lignes.some((l) => l.produit_id === f.produit_id))
      .map((v) => { const t = credit ? creditInfo(v, App.I) : venteTotals(v, App.I); return { ...v, t }; })
      .filter((r) => !credit || !f.statut_credit || r.t.statut === f.statut_credit);
    const cols = [
      { k: 'numero', l: 'N°' }, { k: 'date', l: 'Date', f: (r) => fmtD(r.date) },
      { k: 'agent', l: 'Agent', v: (r) => nm.agent(r.agent_id) }, { k: 'marche', l: 'Marché', v: (r) => nm.marche(r.marche_id) },
      { k: 'client', l: credit ? 'Client / débiteur' : 'Client / acheteur', v: (r) => (r.client_id ? nm.client(r.client_id) : '—') },
      { k: 'articles', l: 'Articles', v: (r) => lignesResume(r), cls: 'wrap' },
      { k: 'cartons', l: 'Qté (ctn éq.)', num: 1, v: (r) => r.t.cartons, f: (r) => fmtQ(r.t.cartons) },
      { k: 'montant', l: credit ? 'Montant initial' : 'Montant FCFA', num: 1, v: (r) => r.t.montant, f: (r) => fmtN(r.t.montant) },
    ];
    if (credit) cols.push(
      { k: 'rembourse', l: 'Remboursé', num: 1, v: (r) => r.t.rembourse, f: (r) => fmtN(r.t.rembourse) },
      { k: 'solde', l: 'Solde', num: 1, v: (r) => r.t.solde, f: (r) => `<b>${fmtN(r.t.solde)}</b>` },
      { k: 'echeance', l: 'Échéance', f: (r) => fmtD(r.echeance) },
      { k: 'retard', l: 'Retard (j)', num: 1, v: (r) => r.t.joursRetard || 0, f: (r) => (r.t.joursRetard ? `<span class="t-crit">${r.t.joursRetard}</span>` : '—') },
      { k: 'statut', l: 'Statut', v: (r) => r.t.statut, f: (r) => statutCreditPill(r.statut === 'annulee' ? 'Annulée' : r.t.statut) },
    );
    else cols.push({ k: 'statut', l: 'Statut', v: (r) => (r.statut === 'annulee' ? 'Annulée' : 'Validée'), f: (r) => (r.statut === 'annulee' ? pill('Annulée', 'mute') : pill('Validée', 'ok')) });
    cols.push({ k: 'saisi', l: 'Saisi par', v: (r) => nm.user(r.created_by) });
    const sumk = (k) => (c, rs) => (c.k === k ? `<b>${k === 'cartons' ? fmtQ(rs.reduce((s, r) => s + r.t.cartons, 0)) : fmtN(rs.reduce((s, r) => s + r.t[k], 0))}</b>` : c.k === 'numero' ? '<b>Total</b>' : '');
    new Table({
      title: credit ? 'Journal des ventes à crédit' : 'Journal des ventes au comptant', rows, cols, sort: { k: 'date', dir: -1 },
      foot: (c, rs) => (['cartons', 'montant', 'rembourse', 'solde'].includes(c.k) ? sumk(c.k)(c, rs) : c.k === 'numero' ? '<b>Total</b>' : ''),
      onRow: (r) => openVente(r.id), meta: () => `Filtres : ${describeFilters('ventes')}`,
    }).mount($('#tb', root));
  };
  filterBar($('#flt', root), 'ventes', ['periode', 'zone_id', 'agent_id', 'marche_id', 'client_id', 'produit_id', ...(credit ? ['statut_credit'] : []), 'statut_v'], draw,
    { statut_v: { l: 'Affichage', o: () => [{ v: 'annulee', l: 'Ventes annulées' }] } });
  $('#new', root)?.addEventListener('click', () => venteForm({ mode }));
  draw();
}

// ---------- Formulaire de vente ----------
export function venteForm({ mode, vente = null }) {
  const corr = !!vente;
  const I = App.I;
  const credit = mode === 'credit';
  const lignes0 = vente ? venteTotals(vente, I).lignes.map((l) => ({ ...l })) : [{ produit_id: '', unite: 'carton', quantite: '', prix_unitaire: '' }];
  const h = vente || { date: today(), echeance: '' };
  const prodOpts = opts('produits');
  const body = `<form class="form" id="vf" autocomplete="off">
    <div class="grid2">
      ${field({ k: 'date', l: 'Date de vente', t: 'date', req: 1 }, h.date)}
      ${field({ k: 'agent_id', l: 'Agent', t: 'options', req: 1, options: opts('agents', 'nom', { all: corr }) }, h.agent_id)}
      ${field({ k: 'marche_id', l: 'Marché / village', t: 'options', req: 1, options: opts('marches', 'nom', { all: corr }) }, h.marche_id)}
      ${field({ k: 'client_id', l: credit ? 'Client / débiteur' : 'Client / acheteur (facultatif)', t: 'options', req: credit ? 1 : 0, options: opts('clients', 'nom', { all: corr }) }, h.client_id)}
      ${credit ? field({ k: 'echeance', l: 'Date de promesse / échéance', t: 'date', help: `Par défaut : date + ${num(I.p.delai_paiement_jours)} jours` }, h.echeance) : ''}
      ${field({ k: 'observation', l: 'Observation', t: 'text' }, h.observation)}
    </div>
    <h4 class="sec">Articles <small class="muted">1 carton = 12 packs (selon le produit)</small></h4>
    <div class="lines-wrap"><table class="lines"><thead><tr><th>Produit</th><th>Unité</th><th class="n">Quantité</th><th class="n">Prix unitaire FCFA</th><th class="n">Montant</th><th></th></tr></thead><tbody></tbody></table></div>
    <button type="button" class="btn sm ghost" id="addl">${icon('plus')} Ajouter un article</button>
    <div class="totbar"><span>Total : <b id="tot">0 FCFA</b></span><span id="totq"></span></div>
    <div id="plaf"></div>
    ${corr ? field({ k: 'motif', l: 'Motif de la correction', t: 'textarea', req: 1, wide: 1, rows: 2, help: 'Obligatoire : l’ancienne et la nouvelle valeur seront conservées dans le journal d’audit.' }, '') : ''}
    <p class="err" hidden></p></form>`;
  modal({
    title: corr ? `Corriger la vente ${vente.numero}` : credit ? 'Nouvelle vente à crédit' : 'Nouvelle vente au comptant', wide: true, body,
    footer: `<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="save">${corr ? 'Enregistrer la correction' : 'Enregistrer la vente'}</button>`,
    onMount: (m, close) => {
      const tb = $('tbody', m);
      const L = lignes0;
      const row = (l, i) => `<tr data-i="${i}">
        <td><select data-k="produit_id" aria-label="Produit"><option value="">Choisir…</option>${prodOpts.map((o) => `<option value="${o.v}" ${o.v === l.produit_id ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select></td>
        <td><select data-k="unite" aria-label="Unité"><option value="carton" ${l.unite === 'carton' ? 'selected' : ''}>Carton</option><option value="pack" ${l.unite === 'pack' ? 'selected' : ''}>Pack</option></select></td>
        <td class="n"><input data-k="quantite" type="number" min="0" step="any" value="${esc(l.quantite)}" aria-label="Quantité"></td>
        <td class="n"><input data-k="prix_unitaire" type="number" min="0" step="any" value="${esc(l.prix_unitaire)}" aria-label="Prix unitaire" placeholder="Saisie manuelle"></td>
        <td class="n mt">—</td><td><button type="button" class="btn-icon" data-del aria-label="Retirer la ligne">${icon('x')}</button></td></tr>`;
      const recalc = () => {
        let tot = 0, ctn = 0;
        $$('tr[data-i]', tb).forEach((tr) => {
          const l = L[+tr.dataset.i];
          const c = lineCalc(I.produits.get(l.produit_id), l.unite, l.quantite, l.prix_unitaire);
          $('.mt', tr).textContent = l.produit_id && num(l.quantite) > 0 ? fmtN(c.montant) : '—';
          tot += c.montant; ctn += l.produit_id ? c.cartons : 0;
        });
        $('#tot', m).textContent = fmtF(tot);
        $('#totq', m).textContent = `${fmtQ(ctn)} cartons équivalents`;
        if (credit) {
          const cid = $('[name=client_id]', m).value;
          if (!cid) { $('#plaf', m).innerHTML = ''; return; }
          const e = encoursClient(cid, I, vente?.id);
          const pl = plafondClient(I.clients.get(cid), I);
          const t = e.cartons + ctn; const pct = pl ? (t / pl) * 100 : 0;
          const n = niveauPlafond(pct, I.p.seuils_plafond);
          $('#plaf', m).innerHTML = `<div class="plafbox ${n.sev}"><div><b>Plafond du client</b> : ${fmtQ(e.cartons)} ctn déjà dus + ${fmtQ(ctn)} = <b>${fmtQ(t)} / ${fmtQ(pl)} ctn</b> (${fmtN(pct, 0)} %) · marge ${fmtQ(pl - t)} ctn</div>
            <div class="bar"><i style="width:${Math.min(100, pct)}%"></i></div>${n.niv !== 'ok' ? `<div>${pill(n.label, n.sev)} ${I.p.blocage_credit_depassement && pct > 100 ? '<b>Le blocage automatique refusera ce crédit.</b>' : 'La DG, le Responsable Commercial et la DAF verront l’alerte.'}</div>` : ''}</div>`;
        }
      };
      const redraw = () => { tb.innerHTML = L.map(row).join(''); bind(); recalc(); };
      const bind = () => {
        $$('tr[data-i]', tb).forEach((tr) => {
          const l = L[+tr.dataset.i];
          $$('[data-k]', tr).forEach((e) => e.addEventListener('input', () => {
            l[e.dataset.k] = e.value;
            if (e.dataset.k === 'produit_id' && !l.prix_unitaire && I.produits.get(e.value)?.prix_ref) { /* le prix reste saisi manuellement (arbitrage) */ }
            recalc();
          }));
          $('[data-del]', tr).addEventListener('click', () => { if (L.length > 1) { L.splice(+tr.dataset.i, 1); redraw(); } });
        });
      };
      $('#addl', m).addEventListener('click', () => { L.push({ produit_id: '', unite: 'carton', quantite: '', prix_unitaire: '' }); redraw(); });
      $('[name=client_id]', m)?.addEventListener('change', recalc);
      $('[name=date]', m).addEventListener('change', (e) => { const ech = $('[name=echeance]', m); if (ech && !ech.value && e.target.value) ech.placeholder = addDays(e.target.value, num(I.p.delai_paiement_jours)); });
      redraw();
      $('#save', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const f = readForm($('#vf', m));
        const lignes = L.filter((l) => l.produit_id || l.quantite).map((l) => ({ id: l.id, produit_id: l.produit_id, unite: l.unite, quantite: num(l.quantite), prix_unitaire: l.prix_unitaire === '' ? null : num(l.prix_unitaire) }));
        try {
          if (corr) {
            await App.act('vente.correct', { id: vente.id, vente: f, lignes, motif: f.motif }, 'Vente corrigée. L’historique est conservé dans l’audit.');
          } else {
            const r = await App.act('vente.create', { vente: { ...f, mode }, lignes }, null);
            toast(`Vente ${r.vente.numero} enregistrée : ${fmtF(r.lignes.reduce((s, l) => s + Number(l.montant), 0))}`);
            if (r.plafond && r.plafond.niv !== 'ok') toast(`Alerte plafond — ${r.plafond.client} : ${r.plafond.label} (${fmtN(r.plafond.pct, 0)} %)`, 'warn');
          }
          close(true);
        } catch (e) { showErr(m, e.message); }
      }));
    },
  });
}

// ---------- Détail d'une vente ----------
export function openVente(id) {
  const v = App.I.ventes.get(id);
  if (!v) return toast('Vente introuvable ou hors de votre périmètre.', 'err');
  const credit = v.mode === 'credit';
  const ci = credit ? creditInfo(v, App.I) : null;
  const t = venteTotals(v, App.I);
  const rembs = (App.D.remboursements || []).filter((r) => r.vente_id === id).sort((a, b) => a.date.localeCompare(b.date));
  const rel = (App.D.relances || []).filter((r) => r.vente_id === id).sort((a, b) => b.date.localeCompare(a.date));
  const actif = v.statut === 'validee';
  const lignesAll = (App.D.vente_lignes || []).filter((l) => l.vente_id === id);
  const body = `
    <div class="det-head">
      <div><span class="eyebrow">${credit ? 'Vente à crédit' : 'Vente au comptant'}</span><h3>${esc(v.numero)} ${v.statut === 'annulee' ? pill('Annulée', 'mute') : credit ? statutCreditPill(ci.statut) : pill('Validée', 'ok')} ${v.historique ? pill('Reprise historique', 'info') : ''}</h3></div>
      <div class="det-amt">${fmtF(t.montant)}${credit ? `<small>Solde : <b>${fmtF(ci.solde)}</b></small>` : ''}</div>
    </div>
    <dl class="dl">
      <dt>Date</dt><dd>${fmtD(v.date)}</dd><dt>Agent</dt><dd>${esc(nm.agent(v.agent_id))}</dd>
      <dt>Marché / village</dt><dd>${esc(nm.marche(v.marche_id))}</dd><dt>Client</dt><dd>${v.client_id ? `<a href="#" data-client="${v.client_id}">${esc(nm.client(v.client_id))}</a>` : '—'}</dd>
      ${credit ? `<dt>Échéance</dt><dd>${fmtD(v.echeance)}${ci.joursRetard ? ` · <span class="t-crit">${ci.joursRetard} j de retard</span>` : ''}</dd><dt>Quantité restant due</dt><dd>${fmtQ(ci.cartonsRestants)} ctn éq.</dd>` : ''}
      <dt>Observation</dt><dd>${esc(v.observation || '—')}</dd><dt>Saisie</dt><dd>${esc(nm.user(v.created_by))}, ${new Date(v.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' })}</dd>
      ${v.motif ? `<dt>${v.statut === 'annulee' ? 'Motif d’annulation' : 'Dernière correction'}</dt><dd>${esc(v.motif)}</dd>` : ''}
    </dl>
    <h4 class="sec">Articles</h4>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Produit</th><th>Unité</th><th class="n">Quantité</th><th class="n">Ctn éq.</th><th class="n">Prix unitaire</th><th class="n">Montant</th></tr></thead><tbody>
    ${lignesAll.map((l) => `<tr class="${l.annulee ? 'strike' : ''}"><td>${esc(nm.produit(l.produit_id))}${l.annulee ? ' <small>(ligne retirée)</small>' : ''}</td><td>${l.unite}</td><td class="n">${fmtN(l.quantite, 3)}</td><td class="n">${fmtQ(l.cartons)}</td><td class="n">${fmtN(l.prix_unitaire)}</td><td class="n">${fmtN(l.montant)}</td></tr>`).join('')}
    </tbody></table></div>
    ${credit ? `<h4 class="sec">Remboursements <small class="muted">${fmtF(ci.rembourse)} encaissés</small></h4>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>N°</th><th>Date</th><th>Mode</th><th>Référence</th><th class="n">Montant</th><th>Enregistré par</th><th></th></tr></thead><tbody>
    ${rembs.map((r) => `<tr class="${r.statut === 'annule' ? 'strike' : ''}"><td>${esc(r.numero)}</td><td>${fmtD(r.date)}</td><td>${esc(r.mode || '')}</td><td>${esc(r.reference || '')}</td><td class="n">${fmtN(r.montant)}</td><td>${esc(nm.user(r.created_by))}</td><td>${r.statut === 'valide' && App.can('remboursements', 'annuler') ? `<button class="btn sm ghost" data-rcancel="${r.id}">Annuler</button>` : r.statut === 'annule' ? `<small>Annulé : ${esc(r.motif || '')}</small>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Aucun remboursement.</td></tr>'}
    </tbody></table></div>
    <h4 class="sec">Relances</h4>
    <ul class="timeline">${rel.map((r) => `<li><b>${fmtD(r.date)} · ${esc(r.canal || '')}</b> — ${esc(r.resultat || '')}${r.promesse_date ? ` · promesse ${fmtF(r.promesse_montant)} le ${fmtD(r.promesse_date)}` : ''}${r.prochaine_action ? `<br><small>Prochaine action : ${esc(r.prochaine_action)} ${r.date_prochaine ? 'le ' + fmtD(r.date_prochaine) : ''}</small>` : ''}<br><small>${esc(nm.user(r.created_by))}</small></li>`).join('') || '<li class="muted">Aucune relance.</li>'}</ul>` : ''}`;
  const btns = [];
  if (actif && credit && ci.solde > 0 && App.can('remboursements', 'creer')) btns.push(`<button class="btn primary" id="b-remb">Enregistrer un remboursement</button>`);
  if (actif && credit && ci.solde > 0 && App.can('creances', 'creer')) btns.push(`<button class="btn" id="b-rel">Noter une relance</button>`);
  if (actif && App.can('ventes', 'modifier') && v.source !== 'stock') btns.push(`<button class="btn" id="b-cor">${icon('edit')} Corriger</button>`);
  if (actif && App.can('ventes', 'annuler')) btns.push(`<button class="btn danger ghost" id="b-ann">Annuler la vente</button>`);
  if (App.can('audit', 'creer')) btns.push(`<button class="btn ghost" id="b-ano">${icon('flag')} Signaler une anomalie</button>`);
  modal({
    title: `Vente ${v.numero}`, wide: true, body, footer: btns.join('') || '<button class="btn ghost" data-close>Fermer</button>',
    onMount: (m, close) => {
      const F = m.parentElement;
      $('#b-remb', F)?.addEventListener('click', () => { close(); rembForm(v.id); });
      $('#b-rel', F)?.addEventListener('click', () => { close(); relanceForm(v.id); });
      $('#b-cor', F)?.addEventListener('click', () => { close(); venteForm({ mode: v.mode, vente: v }); });
      $('#b-ano', F)?.addEventListener('click', () => signalAnomalie('ventes', v.id, v.numero));
      $('#b-ann', F)?.addEventListener('click', async () => {
        const motif = await confirmBox({ title: `Annuler la vente ${v.numero}`, message: 'La vente restera visible avec le statut « Annulée » et sortira des cumuls. Cette action est tracée.', okLabel: 'Annuler la vente', danger: true, motif: true, motifLabel: 'Motif d’annulation' });
        if (!motif) return;
        try { await App.act('vente.cancel', { id: v.id, motif }, 'Vente annulée.'); close(); } catch (e) { toast(e.message, 'err'); }
      });
      $$('[data-rcancel]', m).forEach((b) => b.addEventListener('click', async () => {
        const motif = await confirmBox({ title: 'Annuler le remboursement', message: 'Le remboursement restera dans l’historique avec le statut « annulé » et le solde sera recalculé.', okLabel: 'Annuler le remboursement', danger: true, motif: true });
        if (!motif) return;
        try { await App.act('remb.cancel', { id: b.dataset.rcancel, motif }, 'Remboursement annulé.'); close(); openVente(id); } catch (e) { toast(e.message, 'err'); }
      }));
      $$('[data-client]', m).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); close(); import('./creances.js').then((x) => x.openClient(a.dataset.client)); }));
    },
  });
}

// ---------- Remboursement ----------
export function rembForm(venteId) {
  const ouverts = (App.D.ventes || []).filter((v) => v.mode === 'credit' && v.statut === 'validee').map((v) => ({ v, ci: creditInfo(v, App.I) })).filter((x) => x.ci.solde > 0)
    .sort((a, b) => nm.client(a.v.client_id).localeCompare(nm.client(b.v.client_id)));
  const body = `<form class="form" id="rf">
    ${field({ k: 'vente_id', l: 'Vente à crédit', t: 'options', req: 1, wide: 1, options: ouverts.map((x) => ({ v: x.v.id, l: `${x.v.numero} — ${nm.client(x.v.client_id)} — solde ${fmtF(x.ci.solde)}` })) }, venteId)}
    <div id="solde" class="note"></div>
    <div class="grid2">
      ${field({ k: 'date', l: 'Date', t: 'date', req: 1 }, today())}
      ${field({ k: 'montant', l: 'Montant FCFA', t: 'number', req: 1, min: 0 }, '')}
      ${field({ k: 'mode', l: 'Mode de règlement', t: 'options', options: MODES_PAIEMENT_REMB.map((x) => ({ v: x, l: x })) }, 'Espèces')}
      ${field({ k: 'reference', l: 'Référence / n° de reçu', t: 'text' }, '')}
    </div>
    ${field({ k: 'commentaire', l: 'Commentaire', t: 'textarea', rows: 2, wide: 1 }, '')}
    <p class="err" hidden></p></form>`;
  modal({ title: 'Enregistrer un remboursement', body, footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="save">Enregistrer</button>',
    onMount: (m, close) => {
      const upd = () => { const x = ouverts.find((o) => o.v.id === $('[name=vente_id]', m).value); $('#solde', m).innerHTML = x ? `Solde restant : <b>${fmtF(x.ci.solde)}</b> · déjà remboursé ${fmtF(x.ci.rembourse)} sur ${fmtF(x.ci.montant)}` : ''; if (x) $('[name=montant]', m).max = x.ci.solde; };
      $('[name=vente_id]', m).addEventListener('change', upd); upd();
      $('#save', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        try {
          const r = await App.act('remb.create', readForm($('#rf', m)), null);
          toast(`Remboursement ${r.remboursement.numero} enregistré. Nouveau solde : ${fmtF(r.solde)}`);
          close(true);
        } catch (e) { showErr(m, e.message); }
      }));
    } });
}

export function relanceForm(venteId) {
  const v = App.I.ventes.get(venteId);
  const body = `<form class="form" id="lf"><p class="note">${esc(v.numero)} — ${esc(nm.client(v.client_id))} — solde ${fmtF(creditInfo(v, App.I).solde)}</p><div class="grid2">
    ${field({ k: 'date', l: 'Date de la relance', t: 'date', req: 1 }, today())}
    ${field({ k: 'canal', l: 'Canal', t: 'options', options: CANAUX_RELANCE.map((x) => ({ v: x, l: x })) }, 'Visite')}
    ${field({ k: 'resultat', l: 'Résultat', t: 'text', wide: 1, placeholder: 'Ex. promesse de paiement, client absent…' }, '')}
    ${field({ k: 'promesse_date', l: 'Date de promesse de paiement', t: 'date' }, '')}
    ${field({ k: 'promesse_montant', l: 'Montant promis FCFA', t: 'number' }, '')}
    ${field({ k: 'prochaine_action', l: 'Prochaine action prévue', t: 'text' }, '')}
    ${field({ k: 'date_prochaine', l: 'Date de la prochaine action', t: 'date' }, '')}
  </div><p class="err" hidden></p></form>`;
  modal({ title: 'Noter une relance', body, footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="save">Enregistrer</button>',
    onMount: (m, close) => $('#save', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      try { await App.act('relance.create', { ...readForm($('#lf', m)), vente_id: venteId }, 'Relance enregistrée.'); close(true); } catch (e) { showErr(m, e.message); }
    })) });
}

export function renderRemboursements(root) {
  root.innerHTML = pageHead('Remboursements', 'Chaque encaissement est une transaction distincte ; les remboursements partiels restent visibles.',
    `${boutonImport('remboursements')}${App.can('remboursements', 'creer') ? `<button class="btn primary" id="new">${icon('plus')} Nouveau remboursement</button>` : ''}`) + '<div id="flt"></div><div class="card" id="tb"></div>';
  lierImport(root);
  const draw = () => {
    const f = App.filters.ventes;
    const [du, au] = periodRange(f);
    const rows = (App.D.remboursements || []).filter((r) => r.date >= du && r.date <= au).map((r) => ({ ...r, v: App.I.ventes.get(r.vente_id) }))
      .filter((r) => r.v && venteMatches({ ...r.v, statut: 'validee' }, { ...f, mode: '' }, App.I, { ignorePeriod: true }))
      .filter((r) => !f.mode_paiement || r.mode === f.mode_paiement);
    new Table({ title: 'Remboursements', rows, sort: { k: 'date', dir: -1 }, onRow: (r) => openVente(r.vente_id), meta: () => `Filtres : ${describeFilters('ventes')}`,
      foot: (c, rs) => (c.k === 'montant' ? `<b>${fmtN(rs.filter((r) => r.statut === 'valide').reduce((s, r) => s + r.montant, 0))}</b>` : c.k === 'numero' ? '<b>Total valide</b>' : ''),
      cols: [
        { k: 'numero', l: 'N°' }, { k: 'date', l: 'Date', f: (r) => fmtD(r.date) }, { k: 'vente', l: 'Vente', v: (r) => r.v.numero },
        { k: 'client', l: 'Client', v: (r) => nm.client(r.v.client_id) }, { k: 'agent', l: 'Agent', v: (r) => nm.agent(r.v.agent_id) },
        { k: 'mode', l: 'Mode' }, { k: 'reference', l: 'Référence' }, { k: 'montant', l: 'Montant FCFA', num: 1, f: (r) => fmtN(r.montant) },
        { k: 'statut', l: 'Statut', v: (r) => (r.statut === 'valide' ? 'Valide' : 'Annulé'), f: (r) => (r.statut === 'valide' ? pill('Valide', 'ok') : pill('Annulé', 'mute')) },
        { k: 'par', l: 'Enregistré par', v: (r) => nm.user(r.created_by) },
      ] }).mount($('#tb', root));
  };
  filterBar($('#flt', root), 'ventes', ['periode', 'agent_id', 'marche_id', 'client_id', 'mode_paiement'], draw, { mode_paiement: { o: () => MODES_PAIEMENT_REMB.map((x) => ({ v: x, l: x })) } });
  $('#new', root)?.addEventListener('click', () => rembForm(null));
  draw();
}
