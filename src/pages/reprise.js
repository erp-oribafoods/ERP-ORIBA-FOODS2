// Reprise des données historiques : modèles d'import, contrôles, rapport de migration.
// Le contrôle et l'envoi sont communs avec les boutons « Importer Excel » des rubriques (lib/importer.js).
import { App, nm, pageHead } from '../app.js';
import { $, $$, Table, toast, icon } from '../lib/ui.js';
import { TYPES, telechargerModele, lireFichier, rapportControle } from '../lib/importer.js';

const ORDRE = ['produits', 'zones', 'equipes', 'agents', 'marches', 'clients', 'vehicules', 'ventes_comptant', 'ventes_credit', 'remboursements', 'stock_remises', 'depenses_agregees', 'depenses', 'budgets', 'objectifs', 'suivi_agents'];

export function renderReprise(root) {
  App.filters.reprise = App.filters.reprise || { type: 'ventes_comptant' };
  root.innerHTML = pageHead('Reprise des données historiques', 'Ordre conseillé : référentiels (produits, agents, marchés, clients), puis journaux (comptant, crédit, remboursements), stock confié et dépenses. Rien n’est supprimé automatiquement : doublons et anomalies vous sont soumis.') +
    `<article class="card"><div class="filters">
      <label class="ff"><span>Type de données</span><select id="rt">${ORDRE.map((k) => [k, TYPES[k]]).map(([k, t]) => `<option value="${k}" ${App.filters.reprise.type === k ? 'selected' : ''}>${t.l}</option>`).join('')}</select></label>
      <button class="btn sm ghost" id="tpl">${icon('download')} Télécharger le modèle</button>
      <label class="btn sm"><input type="file" id="rf" accept=".xlsx,.xls,.csv" hidden>${icon('upload')} Choisir le fichier Excel ou CSV</label></div>
      <p class="muted" id="cols"></p><div id="res"></div></article>
     <article class="card"><header><h3>Historique des reprises</h3></header><div id="hist"></div></article>`;
  const showCols = () => { const t = TYPES[$('#rt', root).value]; $('#cols', root).innerHTML = `Colonnes attendues (première ligne du fichier) : <code>${t.cols.join(' · ')}</code>. Les agents, marchés, clients et produits sont reconnus par leur code ou leur nom exact ; dates au format JJ/MM/AAAA.${t.aide ? '<br>' + t.aide : ''}<br>Ici, les ventes et dépenses sont marquées « historiques » (le plafond de crédit n’est pas recontrôlé). Pour les saisies du mois en cours, utilisez plutôt le bouton « Importer Excel » de chaque rubrique.`; };
  $('#rt', root).addEventListener('change', (e) => { App.filters.reprise.type = e.target.value; showCols(); $('#res', root).innerHTML = ''; });
  showCols();
  $('#tpl', root).addEventListener('click', () => telechargerModele($('#rt', root).value));
  $('#rf', root).addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const type = $('#rt', root).value;
    try {
      const { nomOnglet, multi, res } = await lireFichier(type, file);
      if (multi) toast(`Onglet lu : « ${nomOnglet} »`);
      rapportControle($('#res', root), type, file.name, res, { mode: 'historique' });
    } catch (er) { toast('Lecture du fichier impossible : ' + er.message, 'err'); }
    e.target.value = '';
  });
  new Table({ title: 'Reprises', rows: App.D.imports || [], pageSize: 10, sort: { k: 'created_at', dir: -1 }, empty: 'Aucune reprise effectuée.',
    cols: [{ k: 'created_at', l: 'Date', f: (r) => new Date(r.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' }) }, { k: 'type', l: 'Type', v: (r) => TYPES[r.type]?.l || r.type }, { k: 'fichier', l: 'Fichier' },
      { k: 'mode', l: 'Origine', v: (r) => (r.stats?.mode === 'courant' ? 'Rubrique' : 'Reprise') }, { k: 'integ', l: 'Intégrées', num: 1, v: (r) => r.stats?.integrees ?? 0 }, { k: 'rej', l: 'Rejetées', num: 1, v: (r) => (r.stats?.rejets_controle ?? 0) + (r.stats?.rejetees_serveur ?? 0) },
      { k: 'dbl', l: 'Doublons signalés', num: 1, v: (r) => r.stats?.doublons ?? 0 }, { k: 'par', l: 'Par', v: (r) => nm.user(r.created_by) }] }).mount($('#hist', root));
  void $$;
}
