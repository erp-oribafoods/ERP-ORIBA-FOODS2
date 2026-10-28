// État global de l'application et utilitaires communs aux écrans.
import { buildIndex, fmtD } from '../shared/logic.js';
import { esc, $, $$, toast } from './lib/ui.js';
import { PRESETS, periodRange } from './lib/facts.js';

export const App = {
  api: null, user: null, D: null, I: null, serverDate: null,
  filters: { ventes: { preset: 'tout' }, depenses: { preset: 'tout' } },
  rerender: () => {},
  can(m, a = 'lire') { return (this.user?.permissions?.[m] || []).includes(a); },
  async refresh() {
    const r = await this.api.call('data.bootstrap');
    this.D = r.data; this.user = r.user; this.serverDate = r.serverDate; this.I = buildIndex(this.D);
  },
  async act(action, payload, okMsg) {
    const r = await this.api.call(action, payload);
    await this.refresh();
    if (okMsg) toast(okMsg);
    this.rerender();
    return r;
  },
};

// Libellés
export const nm = {
  agent: (id) => App.I.agents.get(id)?.nom || '—',
  marche: (id) => App.I.marches.get(id)?.nom || '—',
  client: (id) => App.I.clients.get(id)?.nom || '—',
  produit: (id) => App.I.produits.get(id)?.nom || '—',
  zone: (id) => App.I.zones.get(id)?.nom || '—',
  equipe: (id) => App.I.equipes.get(id)?.nom || '—',
  vehicule: (id) => App.I.vehicules.get(id)?.immatriculation || '—',
  categorie: (id) => App.I.categories.get(id)?.libelle || '—',
  user: (id) => { const u = App.I.users.get(id); return u ? [u.prenom, u.nom].filter(Boolean).join(' ') : '—'; },
};

export const opts = (table, label = 'nom', { all = false, filter } = {}) =>
  (App.D[table] || []).filter((r) => (all || r.actif !== false) && (!filter || filter(r))).slice().sort((a, b) => String(a[label]).localeCompare(String(b[label]), 'fr')).map((r) => ({ v: r.id, l: r[label] + (r.actif === false ? ' (archivé)' : '') }));

// Barre de filtres réutilisable
const FILTER_DEFS = {
  periode: null,
  agent_id: { l: 'Agent', o: () => opts('agents', 'nom', { all: true }) },
  marche_id: { l: 'Marché / village', o: () => opts('marches', 'nom', { all: true }) },
  zone_id: { l: 'Région / zone', o: () => opts('zones', 'nom', { all: true }) },
  equipe_id: { l: 'Équipe', o: () => opts('equipes', 'nom', { all: true }) },
  client_id: { l: 'Client', o: () => opts('clients', 'nom', { all: true }) },
  produit_id: { l: 'Produit', o: () => opts('produits', 'nom', { all: true }) },
  unite: { l: 'Unité', o: () => [{ v: 'carton', l: 'Carton' }, { v: 'pack', l: 'Pack' }] },
  mode: { l: 'Mode de vente', o: () => [{ v: 'comptant', l: 'Comptant' }, { v: 'credit', l: 'Crédit' }] },
  categorie_id: { l: 'Catégorie', o: () => opts('categories_depense', 'libelle', { all: true }) },
  vehicule_id: { l: 'Véhicule', o: () => opts('vehicules', 'immatriculation', { all: true }) },
  statut: { l: 'Statut', o: () => [] },
  mode_paiement: { l: 'Mode de paiement', o: () => ['Espèces', 'Virement', 'Mobile money', 'Avance', 'Autre'].map((x) => ({ v: x, l: x })) },
  justif: { l: 'Justificatif', o: () => [{ v: 'avec', l: 'Avec pièce jointe' }, { v: 'sans', l: 'Sans pièce jointe' }] },
  responsable: { l: 'Saisi par', o: () => (App.D.utilisateurs || []).map((u) => ({ v: u.id, l: [u.prenom, u.nom].filter(Boolean).join(' ') })) },
  tranche: { l: 'Tranche de retard', o: () => [{ v: '0', l: 'Pas de retard' }, { v: '1-30', l: '1 à 30 j' }, { v: '31-60', l: '31 à 60 j' }, { v: '61-90', l: '61 à 90 j' }, { v: '90+', l: 'Plus de 90 j' }] },
  statut_credit: { l: 'Statut', o: () => ['En attente', 'Partiellement remboursé', 'En retard', 'Soldé', 'Annulée'].map((x) => ({ v: x, l: x })) },
};

export function filterBar(host, ns, keys, onChange, extra = {}) {
  const f = App.filters[ns] = App.filters[ns] || { preset: 'tout' };
  const sel = (k) => {
    const d = { ...FILTER_DEFS[k], ...(extra[k] || {}) };
    const o = d.o();
    return `<label class="ff"><span>${esc(d.l)}</span><select data-f="${k}"><option value="">Tous</option>${o.map((x) => `<option value="${esc(x.v)}" ${f[k] === x.v ? 'selected' : ''}>${esc(x.l)}</option>`).join('')}</select></label>`;
  };
  const period = keys.includes('periode') ? `<label class="ff"><span>Période</span><select data-f="preset">${PRESETS.map(([v, l]) => `<option value="${v}" ${f.preset === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
     <label class="ff perso" ${f.preset === 'perso' ? '' : 'hidden'}><span>Du</span><input type="date" data-f="du" value="${esc(f.du || '')}"></label>
     <label class="ff perso" ${f.preset === 'perso' ? '' : 'hidden'}><span>Au</span><input type="date" data-f="au" value="${esc(f.au || '')}"></label>` : '';
  const active = Object.entries(f).filter(([k, v]) => v && k !== 'preset' && k !== 'du' && k !== 'au').length + (f.preset && f.preset !== 'tout' ? 1 : 0);
  host.innerHTML = `<div class="filters">${period}${keys.filter((k) => k !== 'periode').map(sel).join('')}
    <button class="btn sm ghost reset" ${active ? '' : 'disabled'}>Réinitialiser</button></div>`;
  $$('[data-f]', host).forEach((e) => e.addEventListener('change', () => {
    f[e.dataset.f] = e.value || '';
    if (e.dataset.f === 'preset') $$('.perso', host).forEach((p) => (p.hidden = e.value !== 'perso'));
    onChange(); filterBar(host, ns, keys, onChange, extra);
  }));
  $('.reset', host).addEventListener('click', () => { App.filters[ns] = { preset: 'tout' }; onChange(); filterBar(host, ns, keys, onChange, extra); });
}

export function describeFilters(ns) {
  const f = App.filters[ns] || {};
  const parts = [];
  if (f.preset && f.preset !== 'tout') { const [du, au] = periodRange(f); parts.push(`du ${fmtD(du)} au ${fmtD(au)}`); }
  const map = { agent_id: nm.agent, marche_id: nm.marche, zone_id: nm.zone, equipe_id: nm.equipe, client_id: nm.client, produit_id: nm.produit, categorie_id: nm.categorie, vehicule_id: nm.vehicule, responsable: nm.user };
  for (const [k, v] of Object.entries(f)) {
    if (!v || ['preset', 'du', 'au'].includes(k)) continue;
    parts.push(map[k] ? map[k](v) : v);
  }
  return parts.join(' · ') || 'aucun';
}

export function pageHead(title, sub, actions = '') {
  return `<div class="page-h"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div><div class="page-act">${actions}</div></div>`;
}
