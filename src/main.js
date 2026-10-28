// Démarrage, authentification, navigation.
import { App } from './app.js';
import { serverApi, demoApi } from './api.js';
import { esc, $, $$, toast, icon, field, readForm, showErr, busy, setExportContext, setSaver, destroyCharts } from './lib/ui.js';
import { describeFilters } from './app.js';
import { renderDashboard, renderAnalyses } from './pages/dashboard.js';
import { renderVentes, renderRemboursements } from './pages/ventes.js';
import { renderCreances } from './pages/creances.js';
import { renderStock } from './pages/stock.js';
import { renderDepenses, renderPilotage, renderBudgets, renderCloture } from './pages/depenses.js';
import { renderReferentiels, renderParametres, renderUtilisateurs, renderRoles, renderCompte, passwordForm, bindPasswordForm } from './pages/admin.js';
import { renderAudit } from './pages/audit.js';
import { renderReprise } from './pages/reprise.js';
import { DEMO_USERS, DEMO_PASSWORD } from './demo-seed.js';

const DEMO = !!window.ERP_DEMO;

const NAV = [
  ['Pilotage', [
    ['tableau-de-bord', 'Tableau de bord', () => App.can('dashboard'), renderDashboard],
    ['analyses', 'Cumuls et analyses', () => App.can('ventes') || App.can('dashboard'), renderAnalyses],
  ]],
  ['Ventes et créances', [
    ['ventes-comptant', 'Ventes au comptant', () => App.can('ventes'), (r) => renderVentes(r, 'comptant')],
    ['ventes-credit', 'Ventes à crédit', () => App.can('ventes') || App.can('creances'), (r) => renderVentes(r, 'credit')],
    ['remboursements', 'Remboursements', () => App.can('remboursements'), renderRemboursements],
    ['creances', 'Créances et alertes', () => App.can('creances'), renderCreances],
    ['stock', 'Stock confié', () => App.can('stock'), renderStock],
  ]],
  ['Dépenses force de vente', [
    ['depenses', 'Saisie et validation', () => App.can('depenses'), renderDepenses],
    ['pilotage-depenses', 'Pilotage des dépenses', () => App.can('depenses'), renderPilotage],
    ['budgets', 'Budgets', () => App.can('budgets'), renderBudgets],
    ['cloture', 'Clôture mensuelle', () => App.can('cloture'), renderCloture],
  ]],
  ['Administration', [
    ['referentiels', 'Référentiels', () => App.can('referentiels'), renderReferentiels],
    ['parametres', 'Paramètres', () => App.can('parametres'), renderParametres],
    ['utilisateurs', 'Utilisateurs', () => App.can('utilisateurs'), renderUtilisateurs],
    ['roles', 'Rôles et permissions', () => App.can('utilisateurs'), renderRoles],
    ['reprise', 'Reprise de données', () => App.can('import', 'creer'), renderReprise],
    ['audit', 'Audit et anomalies', () => App.can('audit') || App.can('audit', 'creer'), renderAudit],
  ]],
];
const PAGES = new Map(NAV.flatMap(([, items]) => items.map((i) => [i[0], i])).concat([['mon-compte', ['mon-compte', 'Mon compte', () => true, renderCompte]]]));
const titleOf = (p) => PAGES.get(p)?.[1] || '';

const root = document.getElementById('app');
let current = null;

function firstPage() {
  for (const [, items] of NAV) for (const i of items) if (i[2]()) return i[0];
  return 'mon-compte';
}

App.go = (page) => { if (location.hash !== '#' + page) location.hash = page; else route(); };

function route() {
  if (!App.user) return;
  let p = location.hash.replace(/^#/, '') || firstPage();
  const def = PAGES.get(p);
  if (!def || !def[2]()) p = firstPage();
  current = p;
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.p === p));
  document.body.classList.remove('nav-open');
  destroyCharts();
  const main = $('#main');
  main.innerHTML = '';
  try { PAGES.get(p)[3](main); } catch (e) { console.error(e); main.innerHTML = `<div class="card"><p class="err">Erreur d’affichage : ${esc(e.message)}</p></div>`; }
  document.title = `${titleOf(p)} · ORIBA ERP`;
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
App.rerender = () => {
  // Re-rendu de la page courante sans perdre la position
  const y = window.scrollY;
  destroyCharts();
  const main = $('#main'); main.innerHTML = '';
  PAGES.get(current)?.[3](main);
  window.scrollTo(0, y);
};

function shell() {
  const u = App.user;
  const initials = [u.prenom, u.nom].filter(Boolean).map((s) => s[0]).join('').toUpperCase();
  root.innerHTML = `
  ${DEMO ? `<div class="demo-band">Démonstration — données fictives enregistrées dans ce navigateur uniquement. <button class="link" id="demo-reset">Réinitialiser la démo</button></div>` : ''}
  <div class="layout">
    <aside class="side" aria-label="Navigation">
      <div class="brand"><span class="mark" aria-hidden="true">OF</span><div><b>ORIBA FOODS</b><small>Gestion commerciale & force de vente</small></div></div>
      <nav class="nav">${NAV.map(([g, items]) => { const vis = items.filter((i) => i[2]()); return vis.length ? `<div class="nav-g"><span>${g}</span>${vis.map((i) => `<a href="#${i[0]}" data-p="${i[0]}">${i[1]}</a>`).join('')}</div>` : ''; }).join('')}</nav>
      <a class="me" href="#mon-compte" data-p="mon-compte"><span class="av">${esc(initials)}</span><span><b>${esc([u.prenom, u.nom].filter(Boolean).join(' '))}</b><small>${esc(u.role_nom || '')}</small></span></a>
    </aside>
    <div class="body">
      <header class="top"><button class="btn-icon menu" aria-label="Menu">${icon('menu')}</button><span class="crumb" id="crumb"></span><span class="grow"></span>
        <button class="btn sm ghost" id="refresh" title="Actualiser les données">${icon('refresh')}<span class="hide-sm">Actualiser</span></button>
        <button class="btn sm ghost" id="logout">${icon('logout')}<span class="hide-sm">Déconnexion</span></button></header>
      <main id="main" tabindex="-1"></main>
    </div>
  </div>`;
  $('.menu').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#logout').addEventListener('click', () => logout());
  $('#refresh').addEventListener('click', (e) => busy(e.currentTarget, async () => { try { await App.refresh(); App.rerender(); toast('Données actualisées.'); } catch (er) { handleErr(er); } }));
  $('#demo-reset')?.addEventListener('click', () => { App.api.reset(); location.reload(); });
  setExportContext(() => ({ user: [u.prenom, u.nom].filter(Boolean).join(' ') + ` (${u.role_nom || ''})`, filtres: ['tableau-de-bord', 'analyses', 'ventes-comptant', 'ventes-credit', 'remboursements', 'creances'].includes(current) ? describeFilters('ventes') : ['depenses', 'pilotage-depenses'].includes(current) ? describeFilters('depenses') : '' }));
  window.addEventListener('hashchange', route);
  route();
}

function handleErr(e) {
  if (e.status === 401) { toast(e.message, 'err'); logout(true); }
  else if (e.status === 428) { App.user.must_change_password = true; forcePassword(); }
  else toast(e.message, 'err');
}
window.addEventListener('unhandledrejection', (ev) => { if (ev.reason?.status) { ev.preventDefault(); handleErr(ev.reason); } });

function logout(silent) {
  App.api.logout(); App.user = null; App.D = null;
  window.removeEventListener('hashchange', route);
  if (!silent) toast('Vous êtes déconnecté.');
  loginScreen();
}

// Déconnexion automatique après inactivité
let lastAct = Date.now();
['click', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, () => (lastAct = Date.now()), { passive: true }));
setInterval(() => {
  if (!App.user) return;
  const lim = (Number(App.I?.p?.delai_session_min) || 30) * 60000;
  if (Date.now() - lastAct > lim) { logout(true); toast('Session fermée après inactivité. Reconnectez-vous.', 'warn'); }
}, 30000);

function authFrame(inner) {
  root.innerHTML = `<div class="auth"><div class="auth-card">
    <div class="brand big"><span class="mark" aria-hidden="true">OF</span><div><b>ORIBA FOODS</b><small>ERP Gestion commerciale & force de vente</small></div></div>${inner}</div>
    <p class="auth-foot">Accès réservé au personnel autorisé. Toutes les actions sont journalisées.</p></div>`;
}

async function loginScreen() {
  let init = true;
  try { init = (await App.api.call('auth.status')).initialise; } catch (e) { authFrame(`<p class="err">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Réessayer</button>`); return; }
  if (!init) return initScreen();
  authFrame(`<h1>Connexion</h1><form id="lf" class="form">
    ${field({ k: 'identifiant', l: 'Identifiant ou e-mail', t: 'text', auto: 'username' }, '')}
    ${field({ k: 'password', l: 'Mot de passe', t: 'password', auto: 'current-password' }, '')}
    <p class="err" hidden></p><button class="btn primary block" type="submit">Se connecter</button>
    <p class="muted small">Mot de passe oublié : demandez à l’administrateur ERP de le réinitialiser.</p></form>
    ${DEMO ? `<div class="demo-acc"><b>Comptes de démonstration</b> (mot de passe <code>${DEMO_PASSWORD}</code>)<div class="chips">${DEMO_USERS.map(([u, , l]) => `<button class="btn sm ghost" data-u="${u}">${esc(l)}</button>`).join('')}</div></div>` : ''}`);
  const form = $('#lf');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    busy($('button[type=submit]', form), async () => {
      const f = readForm(form);
      try { await App.api.call('auth.login', f); await enter(); } catch (er) { showErr(form, er.message); }
    });
  });
  $$('[data-u]').forEach((b) => b.addEventListener('click', () => { $('[name=identifiant]').value = b.dataset.u; $('[name=password]').value = DEMO_PASSWORD; form.requestSubmit(); }));
}

function initScreen() {
  authFrame(`<h1>Première mise en service</h1><p class="muted">Aucun compte n’existe encore. Créez le compte de l’Administrateur ERP : il créera ensuite les comptes DG, Commercial, Contrôle de gestion et DAF.</p>
    <form id="if" class="form"><div class="grid2">${field({ k: 'prenom', l: 'Prénom', t: 'text' }, '')}${field({ k: 'nom', l: 'Nom', t: 'text', req: 1 }, '')}</div>
    ${field({ k: 'username', l: 'Identifiant', t: 'text', req: 1, auto: 'username' }, 'admin')}${field({ k: 'email', l: 'E-mail', t: 'email', req: 1 }, '')}
    ${field({ k: 'password', l: 'Mot de passe', t: 'password', req: 1, auto: 'new-password', help: '8 caractères minimum, avec lettres et chiffres.' }, '')}
    <p class="err" hidden></p><button class="btn primary block" type="submit">Créer l’administrateur</button></form>`);
  const form = $('#if');
  form.addEventListener('submit', (e) => { e.preventDefault(); busy($('button[type=submit]', form), async () => { try { await App.api.call('auth.init_admin', readForm(form)); await App.api.call('auth.login', { identifiant: readForm(form).username, password: readForm(form).password }); await enter(); } catch (er) { showErr(form, er.message); } }); });
}

function forcePassword() {
  authFrame(`<h1>Choisissez votre mot de passe</h1><p class="muted">Pour sécuriser votre compte, remplacez le mot de passe initial communiqué par l’administrateur.</p>${passwordForm()}`);
  bindPasswordForm(root, async () => { toast('Mot de passe enregistré.'); await enter(); });
}

async function enter() {
  const me = (await App.api.call('auth.me')).user;
  App.user = me;
  if (me.must_change_password) return forcePassword();
  root.innerHTML = '<div class="loading-screen">Chargement des données…</div>';
  try { await App.refresh(); } catch (e) { return handleErr(e); }
  shell();
}

async function boot() {
  root.innerHTML = '<div class="loading-screen">Démarrage…</div>';
  try {
    App.api = DEMO ? await demoApi((m) => { root.innerHTML = `<div class="loading-screen">${esc(m)}</div>`; }) : serverApi();
  } catch (e) { root.innerHTML = `<div class="loading-screen err">Démarrage impossible : ${esc(e.message)}</div>`; return; }
  if (window.claude?.use) {
    window.claude.use('downloads').then((dl) => { if (dl) setSaver(async (filename, blob) => { await dl.save({ filename, data: blob }); return true; }); }).catch(() => {});
  }
  if (App.api.hasSession()) { try { await enter(); return; } catch { App.api.logout(); } }
  loginScreen();
}
boot();
