// Suppression définitive de données — réservée au Responsable Commercial & Force de Vente.
import { App, nm, opts, pageHead } from '../app.js';
import { esc, $, $$, fmtN, fmtD, toast, busy, icon, modal, field, showErr } from '../lib/ui.js';

const CIBLES = [
  ['ventes_comptant', 'Ventes au comptant', true, true], ['ventes_credit', 'Ventes à crédit (avec leurs remboursements et relances)', true, true], ['remboursements', 'Remboursements', true, true],
  ['stock', 'Stock confié (lots et mouvements)', true, false], ['depenses', 'Dépenses (avec validations et répartitions)', true, true], ['demandes', 'Demandes de carburant et de vidange', true, true],
  ['objectifs', 'Objectifs commerciaux', true, false], ['suivi_agents', 'Fiches des agents terrain', true, true], ['budgets', 'Budgets', true, true],
  ['import', 'Défaire un import Excel (tout ce qu’il a créé)', false, false], ['tout', 'TOUTES les données (opérations, agents, clients, marchés, véhicules)', false, false],
];
const LIB = { ventes: 'Ventes', vente_lignes: 'Lignes de vente', remboursements: 'Remboursements', relances: 'Relances', stock_mouvements: 'Mouvements de stock', depenses: 'Dépenses', depense_validations: 'Validations de dépenses', depense_repartitions: 'Répartitions de dépenses', demandes: 'Demandes carburant / vidange', objectifs: 'Objectifs', suivi_agents: 'Fiches agents', budgets: 'Budgets', clotures: 'Clôtures', anomalies: 'Anomalies', imports: 'Imports', agents: 'Agents', clients: 'Clients', marches: 'Marchés', vehicules: 'Véhicules' };
const TYPES_IMP = { ventes_comptant: 'Ventes au comptant', ventes_credit: 'Ventes à crédit', remboursements: 'Remboursements', stock_remises: 'Remises de stock', depenses: 'Dépenses', depenses_agregees: 'Dépenses mensuelles', objectifs: 'Objectifs', suivi_agents: 'Fiches agents', budgets: 'Budgets' };

export function renderSuppression(root) {
  const F = App.filters.purge = App.filters.purge || { cible: 'ventes_comptant', du: '', au: '', equipe_id: '', import_id: '' };
  const imports = (App.D.imports || []).filter((i) => (i.stats?.integrees || 0) > 0).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  root.innerHTML = pageHead('Suppression de données', 'Réservée au Responsable Commercial & Force de Vente. La suppression est définitive : préférez l’annulation avec motif pour corriger une opération. Exportez d’abord ce que vous voulez garder (rapports, exports Excel).') +
    `<article class="card"><div class="note warn">${icon('alert')} <b>Action irréversible.</b> Les données supprimées disparaissent de la plateforme ; seule une ligne du journal d’audit garde la trace de l’opération (qui, quand, quoi, combien, motif).</div>
    <div class="filters" style="margin-top:12px">
      <label class="ff" style="min-width:320px"><span>Que faut-il supprimer ?</span><select id="pg-c">${CIBLES.map(([k, l]) => `<option value="${k}" ${F.cible === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <label class="ff" data-per><span>Du</span><input type="date" id="pg-du" value="${F.du}"></label><label class="ff" data-per><span>Au</span><input type="date" id="pg-au" value="${F.au}"></label>
      <label class="ff" data-eq><span>Équipe</span><select id="pg-eq"><option value="">Toutes les équipes</option>${opts('equipes').map((o) => `<option value="${o.v}" ${F.equipe_id === o.v ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select></label>
      <label class="ff" data-imp style="min-width:340px"><span>Import à défaire</span><select id="pg-imp"><option value="">— choisir —</option>${imports.map((i) => `<option value="${i.id}" ${F.import_id === i.id ? 'selected' : ''}>${esc(new Date(i.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' }))} · ${esc(TYPES_IMP[i.type] || i.type)} · ${esc(i.fichier || '')} (${fmtN(i.stats?.integrees || 0)} lignes)</option>`).join('')}</select></label>
    </div>
    <p class="muted small" id="pg-aide"></p>
    <div class="row-act"><button class="btn" id="pg-calc">${icon('search')} Voir ce qui sera supprimé</button></div>
    <div id="pg-res"></div></article>`;
  const maj = () => {
    const c = CIBLES.find((x) => x[0] === F.cible);
    $$('[data-per]', root).forEach((e) => { e.hidden = !c[2]; }); $('[data-eq]', root).hidden = !c[3]; $('[data-imp]', root).hidden = F.cible !== 'import';
    $('#pg-aide', root).textContent = F.cible === 'tout' ? 'Supprime toutes les opérations et les référentiels agents, clients, marchés et véhicules. Sont conservés : comptes, rôles, paramètres, zones, équipes, produits, catégories de dépenses et journal d’audit.'
      : F.cible === 'import' ? 'Retire tout ce qu’un import Excel a créé (ventes, remboursements, stock, dépenses), par exemple après l’import d’un mauvais fichier.'
      : c[2] ? 'Laissez les dates vides pour toute la période.' : '';
    $('#pg-res', root).innerHTML = '';
  };
  const bind = (id, k) => $(id, root).addEventListener('change', (e) => { F[k] = e.target.value; maj(); });
  bind('#pg-c', 'cible'); bind('#pg-du', 'du'); bind('#pg-au', 'au'); bind('#pg-eq', 'equipe_id'); bind('#pg-imp', 'import_id');
  maj();
  const payload = () => { const c = CIBLES.find((x) => x[0] === F.cible); return { cible: F.cible, du: c[2] ? F.du || null : null, au: c[2] ? F.au || null : null, equipe_id: c[3] ? F.equipe_id || null : null, import_id: F.cible === 'import' ? F.import_id || null : null }; };
  $('#pg-calc', root).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
    try {
      const { compte } = await App.api.call('purge.preview', payload());
      const lignes = Object.entries(compte);
      const total = lignes.reduce((s, [, n]) => s + n, 0);
      const c = CIBLES.find((x) => x[0] === F.cible);
      const portee = [c[1], F.du || F.au ? `du ${F.du ? fmtD(F.du) : 'début'} au ${F.au ? fmtD(F.au) : 'aujourd’hui'}` : '', F.equipe_id && c[3] ? `équipe ${nm.equipe(F.equipe_id)}` : ''].filter(Boolean).join(' · ');
      if (!total) { $('#pg-res', root).innerHTML = '<div class="note">Rien à supprimer avec ces critères.</div>'; return; }
      $('#pg-res', root).innerHTML = `<h4 class="form-t">Seront supprimés — ${esc(portee)}</h4><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Données</th><th class="n">Nombre</th></tr></thead><tbody>${lignes.map(([k, n]) => `<tr><td>${esc(LIB[k] || k)}</td><td class="n">${fmtN(n)}</td></tr>`).join('')}</tbody></table></div>
        <div class="row-act"><button class="btn danger" id="pg-go">${icon('x')} Supprimer définitivement (${fmtN(total)} enregistrements)</button></div>`;
      $('#pg-go', root).addEventListener('click', () => confirmer(portee, total));
    } catch (e) { toast(e.message, 'err'); }
  }));
  const confirmer = (portee, total) => modal({ title: 'Confirmer la suppression définitive', body: `<form class="form" id="pgf"><p class="lead"><b>${fmtN(total)}</b> enregistrements seront supprimés : ${esc(portee)}.</p><p>Cette action ne peut pas être annulée.</p>
      ${field({ k: 'motif', l: 'Motif (obligatoire, conservé dans le journal d’audit)', t: 'textarea', rows: 2 })}${field({ k: 'confirmation', l: 'Tapez SUPPRIMER en majuscules pour confirmer', t: 'text' })}<p class="err" hidden></p></form>`,
    footer: `<button class="btn ghost" data-close>Retour</button><button class="btn danger" id="pg-ok">Supprimer définitivement</button>`,
    onMount: (m, close) => $('#pg-ok', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      const motif = $('[name=motif]', m).value.trim(), confirmation = $('[name=confirmation]', m).value.trim();
      try {
        const r = await App.act('purge.run', { ...payload(), motif, confirmation }, null);
        close(); toast(`Suppression effectuée : ${fmtN(Object.values(r.compte).reduce((s, n) => s + n, 0))} enregistrements supprimés.`);
      } catch (e) { showErr(m, e.message); }
    })) });
}
