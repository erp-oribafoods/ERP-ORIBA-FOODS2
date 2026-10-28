// Suivi des créances, plafond par client, centre d'alertes et fiche client.
import { App, nm, filterBar, describeFilters, pageHead } from '../app.js';
import { esc, $, $$, fmtF, fmtN, fmtQ, fmtD, Table, modal, pill, statutCreditPill, icon } from '../lib/ui.js';
import { openCredits } from '../lib/facts.js';
import { plafondsClients, alertes, creditInfo, venteTotals, encoursClient, plafondClient, niveauPlafond, today } from '../../shared/logic.js';
import { openVente, rembForm } from './ventes.js';

const tranche = (j) => (j <= 0 ? '0' : j <= 30 ? '1-30' : j <= 60 ? '31-60' : j <= 90 ? '61-90' : '90+');

export function renderCreances(root) {
  root.innerHTML = pageHead('Créances et alertes', `État au ${fmtD(today())}. Plafond de référence : ${fmtQ(App.I.p.plafond_cartons_client)} cartons par client, seuils ${(App.I.p.seuils_plafond || []).join(' % · ')} %.`,
    App.can('remboursements', 'creer') ? `<button class="btn primary" id="new">${icon('plus')} Enregistrer un remboursement</button>` : '') +
    `<div id="flt"></div><section class="kpis" id="k"></section>
     <section class="grid g2"><article class="card"><header><h3>Plafond par client</h3></header><div id="pl"></div></article>
     <article class="card"><header><h3>Centre d’alertes</h3></header><div id="al"></div></article></section>
     <article class="card"><header><h3>Créances</h3><div class="seg" role="group"><button data-show="open" class="on">Ouvertes</button><button data-show="all">Toutes</button></div></header><div id="tb"></div></article>`;
  let show = 'open';
  const draw = () => {
    const f = App.filters.ventes;
    let oc = openCredits(App.I, f).filter((x) => x.v.statut === 'validee');
    if (f.statut_credit) oc = oc.filter((x) => x.ci.statut === f.statut_credit);
    if (f.tranche) oc = oc.filter((x) => x.ci.solde > 0 && tranche(x.ci.joursRetard) === f.tranche);
    const open = oc.filter((x) => x.ci.solde > 0), late = open.filter((x) => x.ci.statut === 'En retard');
    $('#k', root).innerHTML = [
      ['Total des créances', fmtF(open.reduce((s, x) => s + x.ci.solde, 0)), ''],
      ['Cartons équivalents dus', `${fmtQ(open.reduce((s, x) => s + x.ci.cartonsRestants, 0))} ctn`, ''],
      ['Créances ouvertes', fmtN(open.length), ''],
      ['Créances en retard', fmtN(late.length), late.length ? 'crit' : ''],
      ['Montant en retard', fmtF(late.reduce((s, x) => s + x.ci.solde, 0)), late.length ? 'crit' : ''],
    ].map(([l, v, s]) => `<div class="kpi static ${s}"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span></div>`).join('');
    const P = plafondsClients(App.I).filter((p) => !f.client_id || p.client.id === f.client_id);
    $('#pl', root).innerHTML = `<ul class="plaflist">${P.map((p) => `<li data-client="${p.client.id}" tabindex="0"><div class="pl-top"><b>${esc(p.client.nom)}</b>${pill(p.label, p.sev)}</div>
      <div class="bar ${p.sev}"><i style="width:${Math.min(100, p.pct)}%"></i>${(App.I.p.seuils_plafond || []).slice(0, 2).map((s) => `<s style="left:${s}%"></s>`).join('')}</div>
      <div class="pl-sub">${fmtQ(p.encours)} / ${fmtQ(p.plafond)} ctn · ${fmtN(p.pct, 0)} % · marge ${fmtQ(p.marge)} ctn · ${fmtF(p.fcfa)}</div></li>`).join('') || '<li class="muted">Aucun client avec créance ouverte.</li>'}</ul>`;
    $$('[data-client]', $('#pl', root)).forEach((li) => { li.addEventListener('click', () => openClient(li.dataset.client)); li.addEventListener('keydown', (e) => e.key === 'Enter' && openClient(li.dataset.client)); });
    const A = alertes(App.I, today(), App.user.permissions).filter((a) => a.page !== 'stock' && a.page !== 'logistique');
    $('#al', root).innerHTML = `<ul class="alerts">${A.map((a) => `<li class="al ${a.sev}" data-id="${a.id}" data-page="${a.page}" tabindex="0"><b>${esc(a.type)}</b><span>${esc(a.msg)}</span></li>`).join('') || '<li class="muted">Aucune alerte.</li>'}</ul>`;
    $$('.al[data-id]', $('#al', root)).forEach((li) => li.addEventListener('click', () => (li.dataset.page === 'credit' ? openVente(li.dataset.id) : openClient(li.dataset.id))));
    const rows = (show === 'open' ? open : oc).map((x) => ({ ...x, id: x.v.id }));
    new Table({ title: 'Suivi des créances', rows, sort: { k: 'retard', dir: -1 }, onRow: (r) => openVente(r.id), meta: () => `Filtres : ${describeFilters('ventes')}`,
      foot: (c, rs) => (['montant', 'rembourse', 'solde'].includes(c.k) ? `<b>${fmtN(rs.reduce((s, r) => s + r.ci[c.k], 0))}</b>` : c.k === 'numero' ? '<b>Total</b>' : ''),
      cols: [
        { k: 'numero', l: 'N°', v: (r) => r.v.numero }, { k: 'date', l: 'Date vente', v: (r) => r.v.date, f: (r) => fmtD(r.v.date) },
        { k: 'agent', l: 'Agent', v: (r) => nm.agent(r.v.agent_id) }, { k: 'client', l: 'Client', v: (r) => nm.client(r.v.client_id) },
        { k: 'produits', l: 'Produits', v: (r) => [...new Set(r.ci.lignes.map((l) => nm.produit(l.produit_id)))].join(', '), cls: 'wrap' },
        { k: 'qte', l: 'Qté (ctn)', num: 1, v: (r) => r.ci.cartons, f: (r) => fmtQ(r.ci.cartons) },
        { k: 'montant', l: 'Montant initial', num: 1, v: (r) => r.ci.montant, f: (r) => fmtN(r.ci.montant) },
        { k: 'rembourse', l: 'Remboursé', num: 1, v: (r) => r.ci.rembourse, f: (r) => fmtN(r.ci.rembourse) },
        { k: 'solde', l: 'Solde', num: 1, v: (r) => r.ci.solde, f: (r) => `<b>${fmtN(r.ci.solde)}</b>` },
        { k: 'echeance', l: 'Échéance', v: (r) => r.v.echeance, f: (r) => fmtD(r.v.echeance) },
        { k: 'retard', l: 'Retard (j)', num: 1, v: (r) => r.ci.joursRetard, f: (r) => (r.ci.joursRetard ? `<span class="t-crit">${r.ci.joursRetard}</span>` : '—') },
        { k: 'statut', l: 'Statut', v: (r) => r.ci.statut, f: (r) => statutCreditPill(r.ci.statut) },
      ] }).mount($('#tb', root));
  };
  filterBar($('#flt', root), 'ventes', ['agent_id', 'marche_id', 'zone_id', 'client_id', 'produit_id', 'statut_credit', 'tranche'], draw);
  $$('[data-show]', root).forEach((b) => b.addEventListener('click', () => { show = b.dataset.show; $$('[data-show]', root).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  $('#new', root)?.addEventListener('click', () => rembForm(null));
  draw();
}

export function openClient(id) {
  const c = App.I.clients.get(id);
  if (!c) return;
  const ventes = (App.D.ventes || []).filter((v) => v.client_id === id).sort((a, b) => b.date.localeCompare(a.date));
  const e = encoursClient(id, App.I);
  const pl = plafondClient(c, App.I);
  const pct = pl ? (e.cartons / pl) * 100 : 0;
  const n = niveauPlafond(pct, App.I.p.seuils_plafond);
  const tot = ventes.filter((v) => v.statut === 'validee').reduce((s, v) => s + venteTotals(v, App.I).montant, 0);
  const rel = (App.D.relances || []).filter((r) => ventes.some((v) => v.id === r.vente_id)).sort((a, b) => b.date.localeCompare(a.date));
  modal({
    title: `Fiche client — ${c.nom}`, wide: true,
    body: `<dl class="dl"><dt>Code</dt><dd>${esc(c.code || '—')}</dd><dt>Type</dt><dd>${esc(c.type || '—')}</dd><dt>Marché principal</dt><dd>${esc(nm.marche(c.marche_id))}</dd>
      <dt>Téléphone</dt><dd>${esc(c.telephone || '—')}</dd><dt>Plafond</dt><dd>${fmtQ(pl)} ctn ${c.plafond_cartons ? '(individuel)' : '(général)'}</dd><dt>Dépositaire</dt><dd>${c.depositaire ? 'Oui (stock confié)' : 'Non'}</dd></dl>
      <section class="kpis sm"><div class="kpi static"><span class="kpi-l">Total acheté</span><span class="kpi-v">${fmtF(tot)}</span></div>
      <div class="kpi static ${n.sev}"><span class="kpi-l">Créance en cours</span><span class="kpi-v">${fmtF(e.fcfa)}</span><span class="kpi-s">${fmtQ(e.cartons)} ctn · ${fmtN(pct, 0)} % du plafond</span></div></section>
      <div id="cv"></div>
      <h4 class="sec">Relances</h4><ul class="timeline">${rel.slice(0, 10).map((r) => `<li><b>${fmtD(r.date)} · ${esc(r.canal || '')}</b> — ${esc(r.resultat || '')}${r.promesse_date ? ` · promesse le ${fmtD(r.promesse_date)}` : ''}</li>`).join('') || '<li class="muted">Aucune relance.</li>'}</ul>`,
    onMount: (m) => new Table({ title: `Historique ${c.nom}`, rows: ventes.map((v) => ({ ...v, t: v.mode === 'credit' ? creditInfo(v, App.I) : venteTotals(v, App.I) })), pageSize: 10, sort: { k: 'date', dir: -1 }, onRow: (r) => openVente(r.id),
      cols: [{ k: 'numero', l: 'N°' }, { k: 'date', l: 'Date', f: (r) => fmtD(r.date) }, { k: 'mode', l: 'Mode', v: (r) => (r.mode === 'credit' ? 'Crédit' : 'Comptant') },
        { k: 'montant', l: 'Montant', num: 1, v: (r) => r.t.montant, f: (r) => fmtN(r.t.montant) }, { k: 'solde', l: 'Solde', num: 1, v: (r) => r.t.solde ?? 0, f: (r) => (r.mode === 'credit' ? fmtN(r.t.solde) : '—') },
        { k: 'statut', l: 'Statut', v: (r) => (r.statut === 'annulee' ? 'Annulée' : r.t.statut || 'Validée'), f: (r) => (r.statut === 'annulee' ? pill('Annulée', 'mute') : r.mode === 'credit' ? statutCreditPill(r.t.statut) : pill('Comptant', 'ok')) }] }).mount($('#cv', m)),
  });
}
