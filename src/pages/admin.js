// Administration : référentiels, paramètres, utilisateurs, rôles et compte personnel.
import { App, nm, opts, pageHead } from '../app.js';
import { esc, $, $$, fmtN, fmtD, Table, modal, confirmBox, field, readForm, showErr, busy, toast, icon, pill } from '../lib/ui.js';
import { REFS, PARAM_DEFS, MODULES, ACTION_LABELS } from '../../shared/schema.js';

// ---------- Référentiels ----------
export function renderReferentiels(root) {
  App.filters.ref = App.filters.ref || { t: 'produits' };
  const can = App.can('referentiels', 'modifier');
  root.innerHTML = pageHead('Référentiels', 'Listes officielles utilisées dans toutes les saisies. Un élément déjà utilisé s’archive au lieu d’être supprimé.') +
    `<div class="tabs" role="tablist">${Object.entries(REFS).map(([k, r]) => `<button role="tab" data-t="${k}" class="${App.filters.ref.t === k ? 'on' : ''}">${esc(r.l)}</button>`).join('')}</div><div class="card" id="tb"></div>`;
  const draw = () => {
    const t = App.filters.ref.t, R = REFS[t];
    $('#tb', root).innerHTML = `<div class="card-h"><h3>${esc(R.l)}</h3>${can ? `<button class="btn primary sm" id="add">${icon('plus')} Ajouter ${esc(R.one === 'équipe' || R.one === 'zone' || R.one === 'catégorie' ? 'une' : 'un')} ${esc(R.one)}</button>` : ''}</div><div id="tt"></div>`;
    const cols = R.f.map((f) => ({ k: f.k, l: f.l.replace(/ \(.*\)$/, ''), num: f.t === 'number', v: (r) => (f.t?.startsWith('ref:') ? nm[{ zones: 'zone', equipes: 'equipe', marches: 'marche' }[f.t.slice(4)]](r[f.k]) : f.t === 'bool' ? (r[f.k] ? 'Oui' : 'Non') : r[f.k] ?? ''), f: f.t === 'date' ? (r) => fmtD(r[f.k]) : f.t === 'number' ? (r) => (r[f.k] === null || r[f.k] === undefined ? '—' : fmtN(r[f.k], 2)) : undefined }));
    cols.push({ k: 'actif', l: 'Statut', v: (r) => (r.actif !== false ? 'Actif' : 'Archivé'), f: (r) => (r.actif !== false ? pill('Actif', 'ok') : pill('Archivé', 'mute')) });
    new Table({ title: R.l, rows: App.D[t] || [], cols, pageSize: 30, sort: { k: R.f[0].k === 'code' ? R.f[1].k : R.f[0].k, dir: 1 }, onRow: can ? (r) => refForm(t, r) : null }).mount($('#tt', root));
    $('#add', root)?.addEventListener('click', () => refForm(t, null));
  };
  $$('[data-t]', root).forEach((b) => b.addEventListener('click', () => { App.filters.ref.t = b.dataset.t; $$('[data-t]', root).forEach((x) => x.classList.toggle('on', x === b)); draw(); }));
  draw();
}

export const refFormPublic = (table) => refForm(table, null);
function refForm(table, row) {
  const R = REFS[table];
  const F = R.f.map((f) => (f.t?.startsWith('ref:') ? { ...f, t: 'options', options: opts(f.t.slice(4), 'nom', { all: true }) } : f));
  modal({ title: row ? `Modifier — ${row[R.f.find((f) => f.req).k]}` : `Nouveau : ${R.one}`,
    body: `<form class="form" id="rf"><div class="grid2">${F.map((f) => field(f, row?.[f.k])).join('')}</div><p class="err" hidden></p></form>`,
    footer: `${row ? `<button class="btn ghost ${row.actif !== false ? 'danger' : ''}" id="arch">${row.actif !== false ? 'Archiver' : 'Réactiver'}</button>` : ''}<span class="grow"></span><button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="save">Enregistrer</button>`,
    onMount: (m, close) => {
      $('#save', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        try { await App.act('ref.save', { table, row: { ...readForm($('#rf', m)), id: row?.id } }, 'Référentiel mis à jour.'); close(); } catch (e) { showErr(m, e.message); }
      }));
      $('#arch', m.parentElement)?.addEventListener('click', async () => {
        try { await App.act('ref.archive', { table, id: row.id, actif: row.actif === false }, row.actif === false ? 'Élément réactivé.' : 'Élément archivé : il reste visible dans l’historique.'); close(); } catch (e) { showErr(m, e.message); }
      });
    } });
}

// ---------- Paramètres ----------
export function renderParametres(root) {
  const can = App.can('parametres', 'modifier');
  const p = App.I.p;
  const groups = [...new Set(PARAM_DEFS.map((d) => d.g))];
  const show = (d) => (d.t === 'bool' ? (p[d.k] ? 'Activé' : 'Désactivé') : d.t === 'list' ? (p[d.k] || []).join(' %, ') + ' %' : fmtN(p[d.k], 2));
  root.innerHTML = pageHead('Paramètres', 'Valeurs officielles utilisées par les calculs et les alertes. Chaque modification exige un motif et reste historisée dans le journal d’audit. Devise : FCFA. Fuseau : Afrique/Niamey.') +
    groups.map((g) => `<article class="card"><header><h3>${esc(g)}</h3></header><ul class="params">${PARAM_DEFS.filter((d) => d.g === g).map((d) => `<li><span>${esc(d.l)}</span><b>${esc(show(d))}</b>${can ? `<button class="btn sm ghost" data-p="${d.k}">Modifier</button>` : ''}</li>`).join('')}</ul></article>`).join('');
  $$('[data-p]', root).forEach((b) => b.addEventListener('click', () => {
    const d = PARAM_DEFS.find((x) => x.k === b.dataset.p);
    const v = p[d.k];
    modal({ title: d.l,
      body: `<form class="form" id="pf">${d.t === 'bool' ? field({ k: 'valeur', l: d.l, t: 'bool' }, v) : field({ k: 'valeur', l: d.t === 'list' ? 'Trois seuils en %, séparés par des virgules' : 'Nouvelle valeur', t: d.t === 'list' ? 'text' : 'number' }, d.t === 'list' ? (v || []).join(', ') : v)}
        ${field({ k: 'motif', l: 'Motif de la modification', t: 'textarea', rows: 2, req: 1 }, '')}<p class="err" hidden></p></form>`,
      footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="save">Enregistrer</button>',
      onMount: (m, close) => $('#save', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const f = readForm($('#pf', m));
        try { await App.act('param.save', { cle: d.k, valeur: f.valeur, motif: f.motif }, 'Paramètre enregistré et historisé.'); close(); } catch (e) { showErr(m, e.message); }
      })) });
  }));
}

// ---------- Utilisateurs ----------
export function renderUtilisateurs(root) {
  const can = App.can('utilisateurs', 'modifier');
  root.innerHTML = pageHead('Utilisateurs', 'Comptes nominatifs. Les mots de passe sont chiffrés : personne, pas même l’administrateur, ne peut les lire.',
    can ? `<button class="btn primary" id="new">${icon('plus')} Nouveau compte</button>` : '') + '<div class="card" id="tb"></div>';
  new Table({ title: 'Utilisateurs', rows: App.D.utilisateurs, pageSize: 30, sort: { k: 'nom', dir: 1 }, onRow: can ? (r) => userForm(r) : null,
    cols: [{ k: 'nom', l: 'Nom', v: (r) => [r.prenom, r.nom].filter(Boolean).join(' ') }, { k: 'username', l: 'Identifiant' }, { k: 'email', l: 'E-mail' },
      { k: 'role', l: 'Rôle', v: (r) => App.I.roles.get(r.role_id)?.nom || '—' },
      { k: 'perim', l: 'Périmètre', v: (r) => (r.perimetre_type === 'global' ? 'Global' : `${r.perimetre_type === 'zone' ? 'Zone' : 'Équipe'} : ${(r.perimetre_ids || []).map((i) => (r.perimetre_type === 'zone' ? nm.zone(i) : nm.equipe(i))).join(', ')}`) },
      { k: 'statut', l: 'Statut', f: (r) => pill({ actif: 'Actif', suspendu: 'Suspendu', desactive: 'Désactivé' }[r.statut], { actif: 'ok', suspendu: 'warn', desactive: 'mute' }[r.statut]) + (r.must_change_password ? ' ' + pill('Mot de passe initial', 'info') : '') },
      { k: 'last_login', l: 'Dernière connexion', f: (r) => (r.last_login ? new Date(r.last_login).toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' }) : 'Jamais') },
      { k: 'created_at', l: 'Créé le', f: (r) => fmtD(r.created_at) }] }).mount($('#tb', root));
  $('#new', root)?.addEventListener('click', () => userForm(null));
}

function genPassword() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz', d = '23456789';
  const r = (s) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  return Array.from({ length: 7 }, () => r(a)).join('') + r(d) + r(d) + r(d);
}

function userForm(u) {
  const pass = genPassword();
  modal({ title: u ? `Compte — ${[u.prenom, u.nom].filter(Boolean).join(' ')}` : 'Nouveau compte', wide: true,
    body: `<form class="form" id="uf"><div class="grid2">
      ${field({ k: 'prenom', l: 'Prénom', t: 'text' }, u?.prenom)}${field({ k: 'nom', l: 'Nom', t: 'text', req: 1 }, u?.nom)}
      ${field({ k: 'username', l: 'Identifiant de connexion', t: 'text', req: 1, auto: 'off' }, u?.username)}${field({ k: 'email', l: 'E-mail', t: 'email', req: 1, auto: 'off' }, u?.email)}
      ${field({ k: 'telephone', l: 'Téléphone professionnel', t: 'text' }, u?.telephone)}
      ${field({ k: 'role_id', l: 'Rôle', t: 'options', req: 1, options: App.D.roles.filter((r) => r.actif !== false).map((r) => ({ v: r.id, l: r.nom })) }, u?.role_id)}
      ${field({ k: 'perimetre_type', l: 'Périmètre de données', t: 'options', empty: false, options: [{ v: 'global', l: 'Global (toutes zones et équipes)' }, { v: 'zone', l: 'Limité à des zones' }, { v: 'equipe', l: 'Limité à des équipes' }] }, u?.perimetre_type || 'global')}
      ${field({ k: 'statut', l: 'Statut du compte', t: 'options', empty: false, options: [{ v: 'actif', l: 'Actif' }, { v: 'suspendu', l: 'Suspendu' }, { v: 'desactive', l: 'Désactivé' }] }, u?.statut || 'actif')}
      <div class="fld span2" id="perim"></div>
      ${u ? '' : `<label class="fld span2"><span>Mot de passe initial *</span><input name="password" type="text" value="${pass}" autocomplete="off"><small>À communiquer à la personne : elle devra le changer à sa première connexion.</small></label>`}
      </div><p class="err" hidden></p></form>`,
    footer: `${u ? '<button class="btn ghost" id="reset">Réinitialiser le mot de passe</button>' : ''}<span class="grow"></span><button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="save">Enregistrer</button>`,
    onMount: (m, close) => {
      const ids = new Set(u?.perimetre_ids || []);
      const drawP = () => {
        const t = $('[name=perimetre_type]', m).value;
        const list = t === 'zone' ? App.D.zones : t === 'equipe' ? App.D.equipes : [];
        $('#perim', m).innerHTML = list.length ? `<span>${t === 'zone' ? 'Zones autorisées' : 'Équipes autorisées'}</span><div class="chips">${list.map((x) => `<label class="chk"><input type="checkbox" value="${x.id}" ${ids.has(x.id) ? 'checked' : ''}> ${esc(x.nom)}</label>`).join('')}</div>` : '';
        $$('#perim input', m).forEach((c) => c.addEventListener('change', () => (c.checked ? ids.add(c.value) : ids.delete(c.value))));
      };
      $('[name=perimetre_type]', m).addEventListener('change', () => { ids.clear(); drawP(); });
      drawP();
      $('#save', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const f = readForm($('#uf', m));
        const { password, ...user } = f;
        user.perimetre_ids = user.perimetre_type === 'global' ? [] : [...ids];
        if (u) user.id = u.id;
        try {
          await App.act('user.save', { user, password }, null);
          toast(u ? 'Compte mis à jour.' : `Compte créé. Mot de passe initial : ${password}`);
          close();
        } catch (e) { showErr(m, e.message); }
      }));
      $('#reset', m.parentElement)?.addEventListener('click', async () => {
        const np = genPassword();
        const ok = await confirmBox({ title: 'Réinitialiser le mot de passe', message: `Nouveau mot de passe temporaire : <b class="mono">${np}</b><br>Notez-le pour le transmettre. La personne devra le changer à la connexion ; ses sessions ouvertes seront fermées.`, okLabel: 'Réinitialiser' });
        if (!ok) return;
        try { await App.act('user.reset_password', { id: u.id, password: np }, `Mot de passe réinitialisé : ${np}`); close(); } catch (e) { toast(e.message, 'err'); }
      });
    } });
}

// ---------- Rôles ----------
export function renderRoles(root) {
  const can = App.can('utilisateurs', 'modifier');
  root.innerHTML = pageHead('Rôles et permissions', 'Principe du moindre privilège : chaque rôle n’accède qu’aux modules et actions cochés. Les contrôles s’appliquent côté serveur.',
    can ? `<button class="btn primary" id="new">${icon('plus')} Nouveau rôle</button>` : '') + '<div class="card" id="tb"></div>';
  new Table({ title: 'Rôles', rows: App.D.roles, pageSize: 30, sort: { k: 'nom', dir: 1 }, onRow: can ? (r) => roleForm(r) : null, exportable: false,
    cols: [{ k: 'nom', l: 'Rôle' }, { k: 'description', l: 'Description', cls: 'wrap' }, { k: 'n', l: 'Comptes', num: 1, v: (r) => App.D.utilisateurs.filter((u) => u.role_id === r.id).length },
      { k: 'mods', l: 'Modules', v: (r) => Object.keys(r.permissions || {}).length }, { k: 'actif', l: 'Statut', f: (r) => (r.actif !== false ? pill('Actif', 'ok') : pill('Inactif', 'mute')) }] }).mount($('#tb', root));
  $('#new', root)?.addEventListener('click', () => roleForm(null));
}

function roleForm(r) {
  const P = JSON.parse(JSON.stringify(r?.permissions || {}));
  const actions = Object.keys(ACTION_LABELS);
  modal({ title: r ? `Rôle — ${r.nom}` : 'Nouveau rôle', wide: true,
    body: `<form class="form" id="of"><div class="grid2">${field({ k: 'nom', l: 'Nom du rôle', t: 'text', req: 1 }, r?.nom)}${field({ k: 'description', l: 'Description', t: 'text' }, r?.description)}${r ? field({ k: 'actif', l: 'Rôle actif', t: 'bool' }, r.actif !== false) : ''}</div>
      <div class="tbl-wrap"><table class="tbl matrix"><thead><tr><th>Module</th>${actions.map((a) => `<th>${ACTION_LABELS[a]}</th>`).join('')}</tr></thead><tbody>
      ${MODULES.map((m) => `<tr><td>${esc(m.l)}</td>${actions.map((a) => `<td>${m.a.includes(a) ? `<input type="checkbox" data-m="${m.k}" data-a="${a}" ${(P[m.k] || []).includes(a) ? 'checked' : ''} aria-label="${esc(m.l)} : ${ACTION_LABELS[a]}">` : ''}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div><p class="err" hidden></p></form>`,
    footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="save">Enregistrer</button>',
    onMount: (m, close) => $('#save', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      const perms = {};
      $$('input[data-m]:checked', m).forEach((c) => (perms[c.dataset.m] = [...(perms[c.dataset.m] || []), c.dataset.a]));
      const f = readForm($('#of', m));
      try { await App.act('role.save', { role: { id: r?.id, nom: f.nom, description: f.description, actif: f.actif ?? true, permissions: perms } }, 'Rôle enregistré. Les comptes concernés devront se reconnecter.'); close(); } catch (e) { showErr(m, e.message); }
    })) });
}

// ---------- Mon compte ----------
export function renderCompte(root) {
  const u = App.user;
  root.innerHTML = pageHead('Mon compte', '') + `<div class="grid g2"><article class="card"><header><h3>Profil</h3></header><dl class="dl">
    <dt>Nom</dt><dd>${esc([u.prenom, u.nom].filter(Boolean).join(' '))}</dd><dt>Identifiant</dt><dd>${esc(u.username)}</dd><dt>E-mail</dt><dd>${esc(u.email)}</dd>
    <dt>Rôle</dt><dd>${esc(u.role_nom || '—')}</dd><dt>Périmètre</dt><dd>${u.perimetre_type === 'global' ? 'Global' : esc((u.perimetre_ids || []).map((i) => (u.perimetre_type === 'zone' ? nm.zone(i) : nm.equipe(i))).join(', '))}</dd>
    <dt>Dernière connexion</dt><dd>${u.last_login ? new Date(u.last_login).toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' }) : '—'}</dd></dl>
    <h4 class="sec">Mes droits</h4><ul class="rights">${MODULES.filter((m) => u.permissions[m.k]?.length).map((m) => `<li><b>${esc(m.l)}</b> : ${u.permissions[m.k].map((a) => ACTION_LABELS[a]).join(', ')}</li>`).join('')}</ul></article>
    <article class="card"><header><h3>Changer mon mot de passe</h3></header>${passwordForm()}</article></div>`;
  bindPasswordForm(root, () => toast('Mot de passe modifié.'));
}

export function passwordForm() {
  return `<form class="form" id="pwf">${field({ k: 'ancien', l: 'Mot de passe actuel', t: 'password', req: 1, auto: 'current-password' }, '')}
    ${field({ k: 'nouveau', l: 'Nouveau mot de passe', t: 'password', req: 1, auto: 'new-password', help: '8 caractères minimum, avec au moins une lettre et un chiffre.' }, '')}
    ${field({ k: 'confirm', l: 'Confirmer le nouveau mot de passe', t: 'password', req: 1, auto: 'new-password' }, '')}
    <p class="err" hidden></p><button class="btn primary" type="submit">Changer le mot de passe</button></form>`;
}
export function bindPasswordForm(root, done) {
  $('#pwf', root).addEventListener('submit', (e) => {
    e.preventDefault();
    busy($('#pwf button[type=submit]', root), async () => {
      const f = readForm($('#pwf', root));
      if (f.nouveau !== f.confirm) return showErr($('#pwf', root), 'Les deux nouveaux mots de passe ne sont pas identiques.');
      try { await App.api.call('auth.change_password', { ancien: f.ancien, nouveau: f.nouveau }); done(); } catch (er) { showErr($('#pwf', root), er.message); }
    });
  });
}
