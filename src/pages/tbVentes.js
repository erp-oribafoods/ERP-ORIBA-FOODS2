// Tableau de bord des ventes (présentation des TB des équipes) : comptant, crédit, encaissements, créances,
// ventes par équipe (dépôt = chef d'équipe), par marché, par produit, par vendeur, évolution mensuelle, créances par client.
import { App, nm } from '../app.js';
import { esc, $, fmtF, fmtN, fmtQ, fmtD, Table, chart, palette } from '../lib/ui.js';
import { contexte, creditsCircuit } from '../lib/circuit.js';
import { today, num } from '../../shared/logic.js';

const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const libMois = (m) => `${MOIS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}`;
const sum = (l, f) => l.reduce((s, x) => s + num(typeof f === 'function' ? f(x) : x[f]), 0);
const carte = (lib, val, cls, sous = '') => `<div class="tbc ${cls}"><span class="tbc-l">${lib}</span><span class="tbc-v">${val}</span>${sous ? `<span class="tbc-s">${sous}</span>` : ''}</div>`;
const F = () => (App.filters.tbVentes = App.filters.tbVentes || { du: '', au: today(), depot: '' });

export function renderTbVentes(root) {
  const f = F();
  const premiere = (App.D.ventes || []).reduce((m, v) => (v.statut === 'validee' && v.date < m ? v.date : m), today());
  if (!f.du) f.du = premiere;
  const depots = (App.D.agents || []).filter((a) => a.role_circuit === 'depot' && a.actif !== false).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  root.innerHTML = `<section class="tb-band"><h2>Tableau de bord des ventes</h2><p>Ventes au comptant et à crédit, encaissements et créances — par équipe (dépôt = chef d’équipe), par marché, par produit et par vendeur.</p></section>
    <div class="filters per-bar">
      <label class="ff"><span>Période du</span><input type="date" id="t-du" value="${f.du}" max="${today()}"></label>
      <label class="ff"><span>au</span><input type="date" id="t-au" value="${f.au}" max="${today()}"></label>
      <label class="ff"><span>Équipe</span><select id="t-dep"><option value="">Toutes les équipes</option>${depots.map((d) => `<option value="${d.id}" ${d.id === f.depot ? 'selected' : ''}>${esc(d.nom)}${d.responsable ? ` · ${esc(d.responsable)}` : ''}</option>`).join('')}</select></label>
      <button class="btn ghost" id="t-tout" type="button">Toute la période</button><span class="muted small" id="t-lib"></span></div>
    <section class="tbc-grid" id="t-k1"></section>
    <section class="tbc-grid ctrl" id="t-k2"></section>
    <div class="grid2"><article class="card"><header><h3>Chiffre d’affaires par équipe</h3><span class="muted small">comptant et crédit</span></header><div class="cv h300"><canvas id="t-g1"></canvas></div></article>
      <article class="card"><header><h3>Répartition du CA par marché</h3><span class="muted small">les 8 premiers marchés</span></header><div class="cv h300"><canvas id="t-g2"></canvas></div></article></div>
    <article class="card tb-sec bleu"><header><h3>Ventes par équipe · dépôt = chef d’équipe</h3></header><div id="t-eq"></div></article>
    <div class="grid2"><article class="card"><header><h3>Évolution mensuelle du chiffre d’affaires</h3></header><div class="cv h300"><canvas id="t-g3"></canvas></div></article>
      <article class="card tb-sec violet"><header><h3>Ventes par produit</h3></header><div id="t-pr"></div></article></div>
    <article class="card tb-sec marine"><header><h3>Évolution mensuelle</h3></header><div id="t-mo"></div></article>
    <article class="card tb-sec vert"><header><h3>Ventes par marché / village</h3></header><div id="t-mk"></div></article>
    <article class="card tb-sec bleu"><header><h3>Ventes par vendeur · chefs d’équipe et agents</h3></header><div id="t-vd"></div></article>
    <article class="card"><header><h3>Top 10 des clients débiteurs</h3><span class="muted small">montant restant dû</span></header><div class="cv h300"><canvas id="t-g4"></canvas></div></article>
    <article class="card tb-sec rouge"><header><h3>Créances par client</h3><span class="muted small">toutes dates</span></header><div id="t-cl"></div></article>`;
  const draw = () => {
    const du = f.du <= f.au ? f.du : f.au, au = f.du <= f.au ? f.au : f.du;
    $('#t-lib', root).textContent = `du ${fmtD(du)} au ${fmtD(au)}`;
    const C = contexte(App.D, App.I);
    const ag = new Map((App.D.agents || []).map((a) => [a.id, a]));
    const depotDe = (id) => { const a = ag.get(id); return a ? (a.role_circuit === 'depot' ? a.id : a.depot_id || '') : ''; };
    const dansEquipe = (id) => !f.depot || depotDe(id) === f.depot;
    const vp = C.ventes.filter((x) => x.v.date >= du && x.v.date <= au && dansEquipe(x.v.agent_id));
    const vC = vp.filter((x) => x.v.mode === 'comptant'), vK = vp.filter((x) => x.v.mode === 'credit');
    const versP = C.vers.filter((v) => v.objet === 'ventes_comptant' && v.date >= du && v.date <= au && dansEquipe(v.agent_id));
    const rembP = C.rembs.filter((r) => r.date >= du && r.date <= au && dansEquipe(C.venteById.get(r.vente_id)?.v.agent_id));
    const cr = creditsCircuit(C, today(), { tous: true }).filter((c) => dansEquipe(c.agent_id));
    const retard = cr.filter((c) => c.statut === 'En retard');
    const plafond = num(App.I.p.plafond_creances_cartons), seuil = num(App.I.p.seuil_alerte_creance_jours) || 7;
    const qteCr = sum(cr, 'cartonsRestants'), util = plafond > 0 ? (qteCr / plafond) * 100 : null;
    const ca = sum(vp, 'montant');
    $('#t-k1', root).innerHTML = [
      carte('CA total (FCFA)', fmtN(ca), 'marine', `${fmtQ(sum(vp, 'cartons'))} cartons · ${fmtN(vp.length)} ventes`),
      carte('Ventes au comptant (FCFA)', fmtN(sum(vC, 'montant')), 'vert', `${fmtQ(sum(vC, 'cartons'))} cartons`),
      carte('Ventes à crédit (FCFA)', fmtN(sum(vK, 'montant')), 'rouge', `${fmtQ(sum(vK, 'cartons'))} cartons`),
      carte('Montant encaissé (FCFA)', fmtN(sum(versP, 'montant') + sum(rembP, 'montant')), 'bleu', `versements ${fmtN(sum(versP, 'montant'))} · remboursements ${fmtN(sum(rembP, 'montant'))}`),
      carte('Solde des créances (FCFA)', fmtN(sum(cr, 'solde')), 'ambre', `${cr.length} crédit(s) non soldé(s)`),
      carte('Qté en créance (cartons)', fmtQ(qteCr), 'violet'),
    ].join('');
    $('#t-k2', root).innerHTML = [
      carte('Plafond des créances', plafond ? `${fmtQ(plafond)} ctn` : 'Non défini', 'clair', plafond ? '' : 'Paramètres > Créances'),
      carte('% utilisation du plafond', util === null ? '—' : `${fmtN(util, 1)} %`, `clair ${util >= 100 ? 't-crit' : util >= 80 ? 't-warn' : ''}`),
      carte('Statut du plafond', util === null ? '—' : util >= 100 ? '🚨 Dépassé' : util >= 80 ? '⚠️ Proche' : '✅ Normal', 'clair'),
      carte('Créances en retard', fmtN(retard.length), 'clair t-crit', fmtF(sum(retard, 'solde'))),
      carte(`Retard de plus de ${seuil} jours`, fmtN(retard.filter((c) => c.joursRetard > seuil).length), 'clair t-crit'),
      carte('Clients débiteurs actifs', fmtN(new Set(cr.map((c) => c.client_id).filter(Boolean)).size), 'clair'),
    ].join('');
    const pal = palette();
    // Par équipe
    const eq = depots.filter((d) => !f.depot || d.id === f.depot).map((d) => {
      const l = vp.filter((x) => depotDe(x.v.agent_id) === d.id), c = cr.filter((x) => depotDe(x.agent_id) === d.id);
      const k = l.filter((x) => x.v.mode === 'credit'), p = l.filter((x) => x.v.mode !== 'credit');
      return { id: d.id, nom: d.nom, chef: d.responsable || '', qc: sum(p, 'cartons'), qk: sum(k, 'cartons'), cac: sum(p, 'montant'), cak: sum(k, 'montant'), total: sum(l, 'montant'), part: ca ? (sum(l, 'montant') / ca) * 100 : 0, creances: sum(c, 'solde'), retard: c.filter((x) => x.statut === 'En retard').length };
    });
    if (!f.depot) { const l = vp.filter((x) => !depotDe(x.v.agent_id)), c = cr.filter((x) => !depotDe(x.agent_id));
      if (l.length || c.length) { const k = l.filter((x) => x.v.mode === 'credit'), p = l.filter((x) => x.v.mode !== 'credit');
        eq.push({ id: '_hors', nom: 'Hors circuit (non rattaché à un dépôt)', chef: '', qc: sum(p, 'cartons'), qk: sum(k, 'cartons'), cac: sum(p, 'montant'), cak: sum(k, 'montant'), total: sum(l, 'montant'), part: ca ? (sum(l, 'montant') / ca) * 100 : 0, creances: sum(c, 'solde'), retard: c.filter((x) => x.statut === 'En retard').length }); } }
    const totalFoot = (keys) => (c, rs) => (c.k === 'nom' ? '<b>Total</b>' : keys.includes(c.k) ? `<b>${fmtN(rs.reduce((s, r) => s + num(r[c.k]), 0))}</b>` : '');
    new Table({ rows: eq, sort: { k: 'total', dir: -1 }, pageSize: 20, exportable: true, title: 'Ventes par équipe', foot: totalFoot(['qc', 'qk', 'cac', 'cak', 'total', 'creances', 'retard']),
      cols: [{ k: 'nom', l: 'Dépôt', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'chef', l: 'Chef d’équipe' }, { k: 'qc', l: 'Qté comptant (ctn)', num: 1, f: (r) => fmtQ(r.qc) }, { k: 'qk', l: 'Qté crédit (ctn)', num: 1, f: (r) => fmtQ(r.qk) },
        { k: 'cac', l: 'CA comptant', num: 1, f: (r) => fmtN(r.cac) }, { k: 'cak', l: 'CA crédit', num: 1, f: (r) => fmtN(r.cak) }, { k: 'total', l: 'CA total', num: 1, f: (r) => `<b>${fmtN(r.total)}</b>` },
        { k: 'part', l: 'Part', num: 1, f: (r) => `<div class="mini"><div class="bar"><i style="width:${Math.min(100, r.part)}%"></i></div>${fmtN(r.part, 1)} %</div>` },
        { k: 'creances', l: 'Créances en cours', num: 1, f: (r) => (r.creances ? `<b class="t-crit">${fmtN(r.creances)}</b>` : '0') }, { k: 'retard', l: 'Crédits en retard', num: 1, f: (r) => (r.retard ? `<b class="t-crit">${r.retard}</b>` : '0') }] }).mount($('#t-eq', root));
    const eqG = eq.filter((r) => r.total > 0 && r.id !== '_hors');
    chart($('#t-g1', root), { type: 'bar', stacked: true, data: { labels: eqG.map((r) => r.nom.replace(/^Dépôt /, '')), datasets: [
      { label: 'CA comptant', data: eqG.map((r) => r.cac), backgroundColor: '#548235', borderRadius: 3 }, { label: 'CA crédit', data: eqG.map((r) => r.cak), backgroundColor: '#C00000', borderRadius: 3 }] } });
    // Par marché
    const mk = new Map();
    for (const x of vp) { const id = x.v.marche_id || ag.get(x.v.agent_id)?.marche_id || ''; const o = mk.get(id) || { id, qc: 0, qk: 0, cac: 0, cak: 0, nb: 0 }; if (x.v.mode === 'credit') { o.qk += num(x.cartons); o.cak += num(x.montant); } else { o.qc += num(x.cartons); o.cac += num(x.montant); } o.nb++; mk.set(id, o); }
    const mkr = [...mk.values()].map((o) => ({ ...o, nom: o.id ? nm.marche(o.id) : 'Marché non renseigné', total: o.cac + o.cak, part: ca ? ((o.cac + o.cak) / ca) * 100 : 0 })).sort((a, b) => b.total - a.total);
    new Table({ rows: mkr, sort: { k: 'total', dir: -1 }, pageSize: 40, exportable: true, title: 'Ventes par marché', foot: totalFoot(['nb', 'qc', 'qk', 'cac', 'cak', 'total']),
      cols: [{ k: 'nom', l: 'Marché', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'nb', l: 'Ventes', num: 1, f: (r) => fmtN(r.nb) }, { k: 'qc', l: 'Qté comptant', num: 1, f: (r) => fmtQ(r.qc) }, { k: 'qk', l: 'Qté crédit', num: 1, f: (r) => fmtQ(r.qk) },
        { k: 'cac', l: 'CA comptant', num: 1, f: (r) => fmtN(r.cac) }, { k: 'cak', l: 'CA crédit', num: 1, f: (r) => fmtN(r.cak) }, { k: 'total', l: 'CA total', num: 1, f: (r) => `<b>${fmtN(r.total)}</b>` },
        { k: 'part', l: 'Part', num: 1, f: (r) => `<div class="mini"><div class="bar ok"><i style="width:${Math.min(100, r.part)}%"></i></div>${fmtN(r.part, 1)} %</div>` }] }).mount($('#t-mk', root));
    const top = mkr.slice(0, 8), autres = Math.max(0, ca - sum(top, 'total'));
    chart($('#t-g2', root), { type: 'doughnut', cutout: '55%', legendPos: 'right', data: { labels: [...top.map((r) => r.nom), ...(autres > 0 ? ['Autres marchés'] : [])],
      datasets: [{ data: [...top.map((r) => r.total), ...(autres > 0 ? [autres] : [])], backgroundColor: [...pal, '#9B59B6', '#BFBFBF'], borderWidth: 1 }] },
      tip: (c) => `${c.label} : ${fmtF(c.parsed)} (${fmtN(ca ? (c.parsed / ca) * 100 : 0, 1)} %)` });
    // Par produit
    const pr = new Map();
    for (const x of vp) for (const l of x.lignes || []) { const o = pr.get(l.produit_id) || { id: l.produit_id, q: 0, m: 0 }; o.q += num(l.cartons); o.m += num(l.montant); pr.set(l.produit_id, o); }
    new Table({ rows: [...pr.values()].map((o) => ({ ...o, nom: nm.produit(o.id), part: ca ? (o.m / ca) * 100 : 0 })), sort: { k: 'm', dir: -1 }, pageSize: 20, title: 'Ventes par produit', foot: totalFoot(['q', 'm']),
      cols: [{ k: 'nom', l: 'Produit', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'q', l: 'Quantité (ctn)', num: 1, f: (r) => fmtQ(r.q) }, { k: 'm', l: 'CA (FCFA)', num: 1, f: (r) => `<b>${fmtN(r.m)}</b>` }, { k: 'part', l: 'Part', num: 1, f: (r) => `${fmtN(r.part, 1)} %` }] }).mount($('#t-pr', root));
    // Évolution mensuelle
    const mois = []; for (let m = du.slice(0, 7); m <= au.slice(0, 7); m = `${+m.slice(5) === 12 ? +m.slice(0, 4) + 1 : m.slice(0, 4)}-${String((+m.slice(5) % 12) + 1).padStart(2, '0')}`) mois.push(m);
    const mo = mois.map((m) => { const l = vp.filter((x) => x.v.date.startsWith(m)); const p = l.filter((x) => x.v.mode !== 'credit'), k = l.filter((x) => x.v.mode === 'credit');
      return { m, nom: libMois(m), cac: sum(p, 'montant'), cak: sum(k, 'montant'), total: sum(l, 'montant'), q: sum(l, 'cartons'), enc: sum(versP.filter((v) => v.date.startsWith(m)), 'montant') + sum(rembP.filter((r) => r.date.startsWith(m)), 'montant') }; });
    new Table({ rows: mo, sort: { k: 'm', dir: 1 }, pageSize: 24, exportable: true, title: 'Évolution mensuelle', foot: totalFoot(['cac', 'cak', 'total', 'q', 'enc']),
      cols: [{ k: 'nom', l: 'Mois', v: (r) => r.m, f: (r) => `<b>${r.nom}</b>` }, { k: 'cac', l: 'CA comptant', num: 1, f: (r) => fmtN(r.cac) }, { k: 'cak', l: 'CA crédit', num: 1, f: (r) => fmtN(r.cak) },
        { k: 'total', l: 'CA total', num: 1, f: (r) => `<b>${fmtN(r.total)}</b>` }, { k: 'q', l: 'Quantité (ctn)', num: 1, f: (r) => fmtQ(r.q) }, { k: 'enc', l: 'Encaissé', num: 1, f: (r) => fmtN(r.enc) }] }).mount($('#t-mo', root));
    chart($('#t-g3', root), { type: 'line', data: { labels: mo.map((r) => r.nom), datasets: [
      { label: 'CA comptant', data: mo.map((r) => r.cac), borderColor: '#548235', backgroundColor: '#548235', tension: 0.3, borderWidth: 2 },
      { label: 'CA crédit', data: mo.map((r) => r.cak), borderColor: '#C00000', backgroundColor: '#C00000', tension: 0.3, borderWidth: 2 },
      { label: 'CA total', data: mo.map((r) => r.total), borderColor: '#1F4E79', backgroundColor: '#1F4E79', tension: 0.3, borderWidth: 3 }] } });
    // Par vendeur
    const vd = new Map();
    for (const x of vp) { const o = vd.get(x.v.agent_id) || { id: x.v.agent_id, qc: 0, qk: 0, cac: 0, cak: 0 }; if (x.v.mode === 'credit') { o.qk += num(x.cartons); o.cak += num(x.montant); } else { o.qc += num(x.cartons); o.cac += num(x.montant); } vd.set(x.v.agent_id, o); }
    new Table({ rows: [...vd.values()].map((o) => { const a = ag.get(o.id); return { ...o, nom: a ? (a.responsable ? `${a.responsable} (chef d’équipe)` : a.nom) : '—', equipe: nm.agent(depotDe(o.id)), marche: a?.marche_id ? nm.marche(a.marche_id) : '', total: o.cac + o.cak }; }),
      sort: { k: 'total', dir: -1 }, pageSize: 60, exportable: true, title: 'Ventes par vendeur', foot: totalFoot(['qc', 'qk', 'cac', 'cak', 'total']),
      cols: [{ k: 'nom', l: 'Vendeur', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'equipe', l: 'Dépôt / équipe' }, { k: 'marche', l: 'Marché' }, { k: 'qc', l: 'Qté comptant', num: 1, f: (r) => fmtQ(r.qc) }, { k: 'qk', l: 'Qté crédit', num: 1, f: (r) => fmtQ(r.qk) },
        { k: 'cac', l: 'CA comptant', num: 1, f: (r) => fmtN(r.cac) }, { k: 'cak', l: 'CA crédit', num: 1, f: (r) => fmtN(r.cak) }, { k: 'total', l: 'CA total', num: 1, f: (r) => `<b>${fmtN(r.total)}</b>` }] }).mount($('#t-vd', root));
    // Créances par client (toutes dates)
    const cl = new Map();
    for (const x of C.ventes) { if (x.v.mode !== 'credit' || !dansEquipe(x.v.agent_id)) continue; const o = cl.get(x.v.client_id) || { id: x.v.client_id, accorde: 0, rembourse: 0, du: 0, q: 0, retard: 0 }; o.accorde += num(x.montant); cl.set(x.v.client_id, o); }
    for (const r of C.rembs) { const v = C.venteById.get(r.vente_id); if (v && cl.has(v.v.client_id)) cl.get(v.v.client_id).rembourse += num(r.montant); }
    for (const c of cr) { const o = cl.get(c.client_id); if (o) { o.du += num(c.solde); o.q += num(c.cartonsRestants); if (c.statut === 'En retard') o.retard++; } }
    const clr = [...cl.values()].map((o) => ({ ...o, nom: o.id ? nm.client(o.id) : '—', taux: o.accorde ? (o.rembourse / o.accorde) * 100 : null }));
    new Table({ rows: clr, sort: { k: 'du', dir: -1 }, pageSize: 25, exportable: true, title: 'Créances par client', foot: totalFoot(['accorde', 'rembourse', 'du', 'q', 'retard']),
      cols: [{ k: 'nom', l: 'Client', f: (r) => `<b>${esc(r.nom)}</b>` }, { k: 'accorde', l: 'Crédits accordés', num: 1, f: (r) => fmtN(r.accorde) }, { k: 'rembourse', l: 'Remboursé', num: 1, f: (r) => fmtN(r.rembourse) },
        { k: 'du', l: 'Montant dû', num: 1, f: (r) => (r.du ? `<b class="${r.retard ? 't-crit' : ''}">${fmtN(r.du)}</b>` : '0') }, { k: 'q', l: 'Qté en créance', num: 1, f: (r) => fmtQ(r.q) },
        { k: 'taux', l: 'Taux de remboursement', num: 1, v: (r) => r.taux ?? -1, f: (r) => (r.taux === null ? '—' : `<div class="mini"><div class="bar ${r.taux >= 100 ? 'ok' : r.taux >= 60 ? '' : 'warn'}"><i style="width:${Math.min(100, r.taux)}%"></i></div>${fmtN(r.taux, 0)} %</div>`) },
        { k: 'retard', l: 'En retard', num: 1, f: (r) => (r.retard ? `<b class="t-crit">${r.retard}</b>` : '0') }] }).mount($('#t-cl', root));
    const t10 = clr.filter((r) => r.du > 0).sort((a, b) => b.du - a.du).slice(0, 10);
    chart($('#t-g4', root), { type: 'bar', horizontal: true, legend: false, data: { labels: t10.map((r) => r.nom), datasets: [{ label: 'Montant dû', data: t10.map((r) => r.du), backgroundColor: '#C00000', borderRadius: 3 }] } });
  };
  $('#t-du', root).addEventListener('change', (e) => { f.du = e.target.value || premiere; draw(); });
  $('#t-au', root).addEventListener('change', (e) => { f.au = e.target.value || today(); draw(); });
  $('#t-dep', root).addEventListener('change', (e) => { f.depot = e.target.value; draw(); });
  $('#t-tout', root).addEventListener('click', () => { f.du = premiere; f.au = today(); $('#t-du', root).value = f.du; $('#t-au', root).value = f.au; draw(); });
  draw();
}
