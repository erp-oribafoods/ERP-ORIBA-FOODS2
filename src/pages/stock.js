// Stock confié chez un gros client : lots, ventes imputées facturées, inventaires et écarts.
import { App, nm, opts, pageHead } from '../app.js';
import { esc, $, $$, fmtF, fmtN, fmtQ, fmtD, Table, modal, confirmBox, field, readForm, showErr, busy, toast, icon, pill } from '../lib/ui.js';
import { boutonImport, lierImport } from '../lib/importer.js';
import { lots, today, num } from '../../shared/logic.js';
import { STOCK_TYPES } from '../../shared/schema.js';
import { openVente } from './ventes.js';

export function renderStock(root) {
  const can = App.can('stock', 'creer');
  root.innerHTML = pageHead('Stock confié', 'Un lot par remise : chaque lot garde son propre solde. Le stock confié reste distinct du stock général d’Oriba Foods.',
    `${boutonImport('stock_remises')}${can ? `<button class="btn primary" id="new">${icon('plus')} Nouvelle remise de stock</button>` : ''}`) + '<section class="kpis" id="k"></section><div class="card" id="tb"></div>';
  lierImport(root);
  const L = lots(App.I);
  const actifs = L.filter((l) => l.restant > 0);
  $('#k', root).innerHTML = [
    ['Stock confié restant', `${fmtQ(L.reduce((s, l) => s + l.restant, 0))} ctn`, ''],
    ['Valeur théorique restante', fmtF(L.reduce((s, l) => s + l.valeurRestante, 0)), ''],
    ['Vendu depuis les remises', `${fmtQ(L.reduce((s, l) => s + l.vendu, 0))} ctn`, ''],
    ['Lots actifs', fmtN(actifs.length), ''],
    ['Lots à surveiller', fmtN(L.filter((l) => l.negatif || l.dormant || l.ecartInventaire).length), L.some((l) => l.negatif || l.ecartInventaire) ? 'warn' : ''],
  ].map(([l, v, s]) => `<div class="kpi static ${s}"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span></div>`).join('');
  new Table({ title: 'Stock confié par lot', rows: L, sort: { k: 'date', dir: -1 }, onRow: (r) => openLot(r.id),
    cols: [
      { k: 'numero', l: 'Lot', v: (r) => r.lot.numero }, { k: 'date', l: 'Remise le', f: (r) => fmtD(r.date) },
      { k: 'client', l: 'Dépositaire', v: (r) => nm.client(r.client_id) }, { k: 'produit', l: 'Produit', v: (r) => nm.produit(r.produit_id) },
      { k: 'initial', l: 'Remis', num: 1, f: (r) => fmtQ(r.initial) }, { k: 'vendu', l: 'Vendu', num: 1, f: (r) => fmtQ(r.vendu) },
      { k: 'sorties', l: 'Retours / pertes', num: 1, v: (r) => r.retour + r.perte, f: (r) => fmtQ(r.retour + r.perte) },
      { k: 'ajust', l: 'Ajustements', num: 1, v: (r) => r.ajustPlus - r.ajustMoins, f: (r) => fmtQ(r.ajustPlus - r.ajustMoins) },
      { k: 'restant', l: 'Restant estimé', num: 1, f: (r) => `<b>${fmtQ(r.restant)}</b>` },
      { k: 'valeur', l: 'Valeur restante', num: 1, v: (r) => r.valeurRestante, f: (r) => fmtN(r.valeurRestante) },
      { k: 'inv', l: 'Dernier inventaire', v: (r) => r.dernierInv?.date || '', f: (r) => (r.dernierInv ? `${fmtD(r.dernierInv.date)} : ${fmtQ(r.dernierInv.physique)} (écart ${fmtQ(r.dernierInv.ecart)})` : '—') },
      { k: 'etat', l: 'Signal', v: (r) => (r.negatif ? 'Négatif' : r.ecartInventaire ? 'Écart' : r.dormant ? 'Dormant' : r.restant <= 0 ? 'Épuisé' : 'OK'),
        f: (r) => (r.negatif ? pill('Stock négatif', 'crit') : r.ecartInventaire ? pill('Écart inventaire', 'warn') : r.dormant ? pill('Dormant', 'info') : r.restant <= 0 ? pill('Épuisé', 'mute') : pill('OK', 'ok')) },
    ] }).mount($('#tb', root));
  $('#new', root)?.addEventListener('click', () => mouvementForm(null, 'remise'));
}

function openLot(id) {
  const l = lots(App.I).find((x) => x.id === id);
  const all = (App.D.stock_mouvements || []).filter((m) => m.lot_id === id).sort((a, b) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at));
  const can = App.can('stock', 'creer');
  modal({ title: `Lot ${l.lot.numero} — ${nm.produit(l.produit_id)}`, wide: true,
    body: `<dl class="dl"><dt>Dépositaire</dt><dd>${esc(nm.client(l.client_id))}</dd><dt>Remise</dt><dd>${fmtD(l.date)} · ${fmtQ(l.initial)} ctn${l.valeurUnitaire ? ` à ${fmtF(l.valeurUnitaire)}` : ''} · ${esc(l.lot.document || 'sans document')}</dd>
      <dt>Valeur théorique initiale</dt><dd>${fmtF(l.valeurInitiale)}</dd><dt>Restant estimé</dt><dd><b>${fmtQ(l.restant)} ctn</b> · ${fmtF(l.valeurRestante)}</dd>
      <dt>Dernière vente</dt><dd>${fmtD(l.derniereVente)}</dd></dl>
      <h4 class="sec">Mouvements</h4><div class="tbl-wrap"><table class="tbl"><thead><tr><th>N°</th><th>Date</th><th>Type</th><th class="n">Quantité</th><th>Document / motif</th><th>Vente</th><th>Par</th><th></th></tr></thead><tbody>
      ${all.map((m) => `<tr class="${m.statut === 'annule' ? 'strike' : ''}"><td>${esc(m.numero)}</td><td>${fmtD(m.date)}</td><td>${esc(STOCK_TYPES[m.type])}</td><td class="n">${fmtQ(m.quantite)}</td><td>${esc([m.document, m.motif].filter(Boolean).join(' — '))}</td>
        <td>${m.vente_id ? `<a href="#" data-v="${m.vente_id}">${esc(App.I.ventes.get(m.vente_id)?.numero || 'voir')}</a>` : ''}</td><td>${esc(nm.user(m.created_by))}</td>
        <td>${m.statut === 'valide' && App.can('stock', 'annuler') ? `<button class="btn sm ghost" data-c="${m.id}">Annuler</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`,
    footer: can ? `<button class="btn primary" data-t="vente">Imputer une vente</button><button class="btn" data-t="inventaire">Inventaire physique</button><button class="btn ghost" data-t="retour">Retour</button><button class="btn ghost" data-t="perte">Perte</button><button class="btn ghost" data-t="ajustement_plus">Ajustement +</button><button class="btn ghost" data-t="ajustement_moins">Ajustement −</button>` : '<button class="btn ghost" data-close>Fermer</button>',
    onMount: (m, close) => {
      $$('[data-t]', m.parentElement).forEach((b) => b.addEventListener('click', () => { close(); mouvementForm(id, b.dataset.t); }));
      $$('[data-v]', m).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); close(); openVente(a.dataset.v); }));
      $$('[data-c]', m).forEach((b) => b.addEventListener('click', async () => {
        const motif = await confirmBox({ title: 'Annuler le mouvement', message: 'Le mouvement restera visible avec le statut annulé. Une vente imputée liée sera aussi annulée.', danger: true, okLabel: 'Annuler le mouvement', motif: true });
        if (!motif) return;
        try { await App.act('stock.cancel', { id: b.dataset.c, motif }, 'Mouvement annulé.'); close(); openLot(id); } catch (e) { toast(e.message, 'err'); }
      }));
    } });
}

function mouvementForm(lotId, type) {
  const l = lotId ? lots(App.I).find((x) => x.id === lotId) : null;
  const F = [];
  if (type === 'remise') {
    F.push({ k: 'client_id', l: 'Gros client dépositaire', t: 'options', req: 1, options: App.D.clients.filter((c) => c.depositaire && c.actif !== false).map((c) => ({ v: c.id, l: c.nom })), help: 'Seuls les clients marqués « dépositaire » dans les référentiels apparaissent.' },
      { k: 'produit_id', l: 'Produit', t: 'options', req: 1, options: opts('produits') }, { k: 'date', l: 'Date de remise', t: 'date', req: 1, def: today() },
      { k: 'quantite', l: 'Quantité remise (cartons)', t: 'number', req: 1 }, { k: 'valeur_unitaire', l: 'Valeur de référence par carton (FCFA)', t: 'number' },
      { k: 'document', l: 'Document de référence (BL, bon…)', t: 'text' }, { k: 'motif', l: 'Observation', t: 'text' });
  } else {
    F.push({ k: 'date', l: 'Date', t: 'date', req: 1, def: today() },
      { k: 'quantite', l: type === 'inventaire' ? 'Quantité physique comptée (cartons)' : 'Quantité (cartons)', t: 'number', req: 1, help: type === 'inventaire' ? `Stock théorique actuel : ${fmtQ(l.restant)} ctn` : `Restant du lot : ${fmtQ(l.restant)} ctn` });
    if (type === 'vente') F.push({ k: 'mode', l: 'Facturation', t: 'options', empty: false, options: [{ v: 'comptant', l: 'Vente au comptant' }, { v: 'credit', l: 'Vente à crédit' }] },
      { k: 'prix_unitaire', l: 'Prix facturé par carton (FCFA)', t: 'number', req: 1 }, { k: 'agent_id', l: 'Agent', t: 'options', req: 1, options: opts('agents') },
      { k: 'marche_id', l: 'Marché', t: 'options', req: 1, options: opts('marches') }, { k: 'echeance', l: 'Échéance (si crédit)', t: 'date' });
    F.push({ k: 'document', l: 'Document / relevé', t: 'text' }, { k: 'motif', l: ['perte', 'retour', 'ajustement_plus', 'ajustement_moins'].includes(type) ? 'Motif' : 'Observation', t: 'text', req: ['perte', 'retour', 'ajustement_plus', 'ajustement_moins'].includes(type) ? 1 : 0 });
  }
  modal({ title: type === 'remise' ? 'Nouvelle remise de stock' : `${STOCK_TYPES[type]} — lot ${l.lot.numero}`,
    body: `<form class="form" id="sf">${type === 'vente' ? '<p class="note">La vente imputée est facturée automatiquement : elle crée une vente (comptant ou crédit) liée au lot, au nom du dépositaire.</p>' : ''}<div class="grid2">${F.map((f) => field(f, f.k === 'marche_id' ? App.I.clients.get(l?.client_id)?.marche_id : undefined)).join('')}</div><p class="err" hidden></p></form>`,
    footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="save">Enregistrer</button>',
    onMount: (m, close) => $('#save', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      const f = readForm($('#sf', m));
      const payload = { type, lot_id: lotId, date: f.date, quantite: num(f.quantite), client_id: f.client_id, produit_id: f.produit_id, valeur_unitaire: f.valeur_unitaire, document: f.document, motif: f.motif };
      if (type === 'vente') payload.vente = { mode: f.mode, prix_unitaire: f.prix_unitaire, agent_id: f.agent_id, marche_id: f.marche_id, echeance: f.echeance };
      try {
        const r = await App.act('stock.create', payload, null);
        toast(r.vente ? `Vente imputée ${r.vente.vente.numero} facturée et stock mis à jour.` : `Mouvement ${r.mouvement.numero} enregistré.`);
        close(true);
        openLot(type === 'remise' ? r.mouvement.id : lotId);
      } catch (e) { showErr(m, e.message); }
    })) });
}
