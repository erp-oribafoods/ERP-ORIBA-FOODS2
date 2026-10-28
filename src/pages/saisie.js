// Point d'entrée unique : pour chaque rubrique, saisir à l'écran ou importer un fichier Excel.
import { App, pageHead } from '../app.js';
import { esc, $$, icon } from '../lib/ui.js';
import { TYPES, peutImporter, ouvrirImport, telechargerModele } from '../lib/importer.js';
import { today } from '../../shared/logic.js';

// [type d'import, page, bouton de saisie, droit de saisie, libellé de la saisie, préparation]
const RUBRIQUES = [
  ['Ventes et créances', [
    ['ventes_comptant', 'ventes-comptant', '#new', ['ventes', 'creer'], 'Nouvelle vente au comptant'],
    ['ventes_credit', 'ventes-credit', '#new', ['ventes', 'creer'], 'Nouvelle vente à crédit'],
    ['remboursements', 'remboursements', '#new', ['remboursements', 'creer'], 'Nouveau remboursement'],
    ['stock_remises', 'stock', '#new', ['stock', 'creer'], 'Nouvelle remise de stock'],
  ]],
  ['Terrain', [
    ['objectifs', 'objectifs', '#saisie', ['objectifs', 'modifier'], 'Saisir les objectifs du mois'],
    ['suivi_agents', 'suivi-agents', '#saisie', ['suivi', 'modifier'], 'Saisir les fiches du mois'],
    ['agents', 'agents', '#add', ['referentiels', 'modifier'], 'Nouvel agent'],
    ['clients', 'clients', '#add', ['referentiels', 'modifier'], 'Nouveau client'],
  ]],
  ['Dépenses et logistique', [
    ['depenses', 'depenses', '#new', ['depenses', 'creer'], 'Nouvelle dépense'],
    ['budgets', 'budgets', '#new', ['budgets', 'modifier'], 'Nouveau budget'],
    ['vehicules', 'referentiels', '#add', ['referentiels', 'modifier'], 'Nouveau véhicule', () => { App.filters.ref = { t: 'vehicules' }; }],
  ]],
  ['Référentiels', [
    ['produits', 'referentiels', '#add', ['referentiels', 'modifier'], 'Nouveau produit', () => { App.filters.ref = { t: 'produits' }; }],
    ['marches', 'referentiels', '#add', ['referentiels', 'modifier'], 'Nouveau marché', () => { App.filters.ref = { t: 'marches' }; }],
    ['equipes', 'referentiels', '#add', ['referentiels', 'modifier'], 'Nouvelle équipe', () => { App.filters.ref = { t: 'equipes' }; }],
    ['zones', 'referentiels', '#add', ['referentiels', 'modifier'], 'Nouvelle zone', () => { App.filters.ref = { t: 'zones' }; }],
  ]],
];
const DESCR = {
  ventes_comptant: 'Une ligne par produit vendu.', ventes_credit: 'Plafond de créances contrôlé.', remboursements: 'Sur une vente à crédit (n° VR-…).', stock_remises: 'Lots confiés aux dépositaires.',
  objectifs: 'Par agent, zone, équipe, marché ou produit.', suivi_agents: 'Présence, déstockage, note, prime.', agents: 'Nom, téléphone, équipe, marché.', clients: 'Type, marché, plafond, dépositaire.',
  depenses: 'Carburant, entretien, salaires, gadgets…', budgets: 'Par équipe et par catégorie.', vehicules: 'Immatriculation, équipe, conducteur.',
  produits: 'Code, libellé, packs par carton, prix.', marches: 'Marchés et villages par zone.', equipes: 'Équipes et centres de coût.', zones: 'Régions de la force de vente.',
};

export const peutSaisirOuImporter = () => RUBRIQUES.some(([, items]) => items.some(([type, , , perm]) => App.can(perm[0], perm[1]) || peutImporter(type)));

// Ouvre la rubrique puis son formulaire de saisie dès que la page est affichée
function saisir(page, sel, prep) {
  prep?.();
  App.go(page);
  let n = 0;
  const t = setInterval(() => { const b = document.querySelector(`#view ${sel}, main ${sel}, ${sel}`); if (b || ++n > 40) { clearInterval(t); b?.click(); } }, 50);
}

export function renderSaisie(root) {
  const mois = today().slice(0, 7);
  root.innerHTML = pageHead('Saisie et import des données', 'Pour chaque rubrique, deux possibilités : saisir directement à l’écran, ou remplir le modèle Excel puis l’importer. Les deux suivent les mêmes règles et le même journal d’audit. Les modèles des objectifs, fiches agents, budgets et référentiels contiennent déjà les données actuelles : il suffit de les corriger pour mettre la plateforme à jour.') +
    RUBRIQUES.map(([titre, items]) => {
      const vis = items.filter(([type, , , perm]) => App.can(perm[0], perm[1]) || peutImporter(type));
      if (!vis.length) return '';
      return `<h2 class="sec-t">${esc(titre)}</h2><section class="saisie-grid">${vis.map(([type, page, sel, perm, lib], i) => {
        const items2 = items.indexOf(vis[i]);
        const s = App.can(perm[0], perm[1]), im = peutImporter(type);
        return `<article class="card saisie-c"><h3>${esc(TYPES[type].l)}</h3><p class="muted small">${esc(DESCR[type] || '')}</p>
          <div class="saisie-a">${s ? `<button class="btn primary sm" data-s="${titre}|${items2}">${icon('edit')} ${esc(lib)}</button>` : ''}
          ${im ? `<button class="btn sm" data-i="${type}">${icon('upload')} Importer Excel</button><button class="btn ghost sm" data-m="${type}" title="Télécharger le modèle Excel">${icon('download')} Modèle</button>` : ''}</div></article>`;
      }).join('')}</section>`;
    }).join('');
  $$('[data-s]', root).forEach((b) => b.addEventListener('click', () => {
    const [titre, k] = b.dataset.s.split('|'); const it = RUBRIQUES.find((r) => r[0] === titre)[1][Number(k)];
    saisir(it[1], it[2], it[5]);
  }));
  $$('[data-i]', root).forEach((b) => b.addEventListener('click', () => ouvrirImport(b.dataset.i, { mois })));
  $$('[data-m]', root).forEach((b) => b.addEventListener('click', () => telechargerModele(b.dataset.m, { mois })));
}
