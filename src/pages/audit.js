// Journal d'audit (lecture seule) et suivi des anomalies signalées.
import { App, nm, pageHead } from '../app.js';
import { esc, $, $$, fmtD, Table, modal, field, readForm, showErr, busy, toast, icon, pill } from '../lib/ui.js';
import { today, addDays } from '../../shared/logic.js';

const TABLES_LBL = { ventes: 'Ventes', remboursements: 'Remboursements', relances: 'Relances', stock_mouvements: 'Stock confié', depenses: 'Dépenses', budgets: 'Budgets', clotures: 'Clôtures', parametres: 'Paramètres', utilisateurs: 'Utilisateurs', roles: 'Rôles', anomalies: 'Anomalies', imports: 'Reprises de données', produits: 'Produits', agents: 'Agents', clients: 'Clients', marches: 'Marchés', zones: 'Zones', equipes: 'Équipes', vehicules: 'Véhicules', categories_depense: 'Catégories de dépenses', objectifs: 'Objectifs', suivi_agents: 'Suivi des agents terrain' };

export function signalAnomalie(type, id, label) {
  modal({ title: `Signaler une anomalie — ${label}`,
    body: `<form class="form" id="af">${field({ k: 'description', l: 'Description de l’anomalie', t: 'textarea', rows: 4, req: 1 }, '')}<p class="err" hidden></p></form>`,
    footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="save">Signaler</button>',
    onMount: (m, close) => $('#save', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      try { await App.act('anomalie.create', { objet_type: type, objet_id: id, description: readForm($('#af', m)).description }, 'Anomalie signalée.'); close(); } catch (e) { showErr(m, e.message); }
    })) });
}

function diff(a, b) {
  const keys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])].filter((k) => !['updated_at', 'created_at'].includes(k));
  const s = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const rows = keys.filter((k) => s(a?.[k]) !== s(b?.[k]) || !a || !b);
  return `<div class="tbl-wrap"><table class="tbl diff"><thead><tr><th>Champ</th><th>Avant</th><th>Après</th></tr></thead><tbody>${rows.map((k) => `<tr><td>${esc(k)}</td><td><code>${esc(s(a?.[k]))}</code></td><td><code>${esc(s(b?.[k]))}</code></td></tr>`).join('') || '<tr><td colspan="3" class="empty">Aucune différence.</td></tr>'}</tbody></table></div>`;
}

export function renderAudit(root) {
  const canRead = App.can('audit', 'lire');
  App.filters.audit = App.filters.audit || { du: addDays(today(), -30), au: today(), table: '', user_id: '' };
  const f = App.filters.audit;
  root.innerHTML = pageHead('Audit et anomalies', 'Journal non modifiable : auteur, date et heure, action, objet, ancienne et nouvelle valeur, motif.') +
    `<article class="card"><header><h3>Anomalies signalées</h3>${App.can('audit', 'creer') ? `<button class="btn sm" id="newano">${icon('flag')} Signaler une anomalie</button>` : ''}</header><div id="ano"></div></article>
     ${canRead ? `<article class="card"><header><h3>Journal d’audit</h3></header><div class="filters">
       <label class="ff"><span>Du</span><input type="date" id="a-du" value="${f.du}"></label><label class="ff"><span>Au</span><input type="date" id="a-au" value="${f.au}"></label>
       <label class="ff"><span>Objet</span><select id="a-t"><option value="">Tous</option>${Object.entries(TABLES_LBL).map(([k, l]) => `<option value="${k}" ${f.table === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
       <label class="ff"><span>Utilisateur</span><select id="a-u"><option value="">Tous</option>${App.D.utilisateurs.map((u) => `<option value="${u.id}" ${f.user_id === u.id ? 'selected' : ''}>${esc(nm.user(u.id))}</option>`).join('')}</select></label>
       <button class="btn sm" id="a-go">Afficher</button></div><div id="log"><p class="muted">Chargement…</p></div></article>` : ''}`;
  const anos = (App.D.anomalies || []).slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  new Table({ title: 'Anomalies', rows: anos, pageSize: 10, sort: { k: 'created_at', dir: -1 }, empty: 'Aucune anomalie signalée.', onRow: App.can('audit', 'creer') ? (r) => traiter(r) : null,
    cols: [{ k: 'created_at', l: 'Date', f: (r) => fmtD(r.created_at) }, { k: 'objet', l: 'Objet', v: (r) => `${TABLES_LBL[r.objet_type] || r.objet_type || 'Général'}${r.objet_id ? ' · ' + (App.I.ventes.get(r.objet_id)?.numero || App.D.depenses?.find((d) => d.id === r.objet_id)?.numero || '') : ''}` },
      { k: 'description', l: 'Description', cls: 'wrap' }, { k: 'par', l: 'Signalé par', v: (r) => nm.user(r.created_by) },
      { k: 'statut', l: 'Statut', f: (r) => (r.statut === 'ouverte' ? pill('Ouverte', 'warn') : pill('Traitée', 'ok')) }, { k: 'reponse', l: 'Réponse', cls: 'wrap' }] }).mount($('#ano', root));
  $('#newano', root)?.addEventListener('click', () => signalAnomalie('general', null, 'général'));
  if (!canRead) return;
  const load = async () => {
    f.du = $('#a-du', root).value; f.au = $('#a-au', root).value; f.table = $('#a-t', root).value; f.user_id = $('#a-u', root).value;
    try {
      const { rows } = await App.api.call('audit.list', { du: f.du, au: f.au, table: f.table, user_id: f.user_id, limit: 2000 });
      new Table({ title: 'Journal d’audit', rows, pageSize: 25, sort: { k: 'id', dir: -1 }, onRow: (r) => modal({ title: `${r.action} — ${TABLES_LBL[r.table_name] || r.table_name || ''}`, wide: true,
        body: `<dl class="dl"><dt>Date</dt><dd>${new Date(r.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' })}</dd><dt>Utilisateur</dt><dd>${esc(r.user_nom || '—')}</dd><dt>Objet</dt><dd>${esc(r.objet_id || '—')}</dd><dt>Motif</dt><dd>${esc(r.motif || '—')}</dd><dt>Adresse</dt><dd>${esc(r.ip || '—')}</dd></dl>${diff(r.avant, r.apres)}` }),
        meta: () => `Période du ${fmtD(f.du)} au ${fmtD(f.au)}`,
        cols: [{ k: 'id', l: 'N°', num: 1 }, { k: 'created_at', l: 'Date et heure', v: (r) => r.created_at, f: (r) => new Date(r.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' }), x: (r) => new Date(r.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' }) },
          { k: 'user_nom', l: 'Utilisateur' }, { k: 'action', l: 'Action' }, { k: 'table_name', l: 'Objet', v: (r) => TABLES_LBL[r.table_name] || r.table_name || '' },
          { k: 'ref', l: 'Référence', v: (r) => r.apres?.numero || r.avant?.numero || r.apres?.nom || r.objet_id || '' }, { k: 'motif', l: 'Motif', cls: 'wrap' }] }).mount($('#log', root));
    } catch (e) { $('#log', root).innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  };
  $('#a-go', root).addEventListener('click', load);
  load();
}

function traiter(a) {
  modal({ title: 'Suivi de l’anomalie', body: `<p class="lead">${esc(a.description)}</p><form class="form" id="tf">${field({ k: 'reponse', l: 'Réponse / traitement', t: 'textarea', rows: 3 }, a.reponse)}
    ${field({ k: 'statut', l: 'Statut', t: 'options', empty: false, options: [{ v: 'ouverte', l: 'Ouverte' }, { v: 'traitee', l: 'Traitée' }] }, a.statut)}<p class="err" hidden></p></form>`,
    footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="save">Enregistrer</button>',
    onMount: (m, close) => $('#save', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      try { await App.act('anomalie.update', { id: a.id, ...readForm($('#tf', m)) }, 'Anomalie mise à jour.'); close(); } catch (e) { showErr(m, e.message); }
    })) });
  void toast; void $$;
}
