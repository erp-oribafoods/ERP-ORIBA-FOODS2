// Suivi mensuel des agents terrain : présence, ventes, déstockage des grossistes, prospection, PLV, note et prime.
// Reprend les fonctions de l'application « Suivi Terrain Dadi ».
import { App, nm, opts, pageHead } from '../app.js';
import { esc, $, $$, fmtF, fmtN, fmtQ, Table, modal, field, showErr, busy, toast, icon, pill, chart, palette } from '../lib/ui.js';
import { salesFacts, monthsBetween, moisLabel } from '../lib/facts.js';
import { today, num } from '../../shared/logic.js';
import { SUIVI_CHAMPS } from '../../shared/schema.js';

const finMois = (m) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm, 0)).toISOString().slice(0, 10); };
const decale = (m, d) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm - 1 + d, 1)).toISOString().slice(0, 7); };
const pct = (a, b) => (b ? (a / b) * 100 : null);
const nv = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

function agentsDuPerimetre(equipeId) {
  return (App.D.agents || []).filter((a) => a.actif !== false && (!equipeId || a.equipe_id === equipeId))
    .sort((a, b) => nm.equipe(a.equipe_id).localeCompare(nm.equipe(b.equipe_id), 'fr') || a.nom.localeCompare(b.nom, 'fr'));
}

// Lignes calculées d'un mois (une par agent actif)
export function lignesSuivi(mois, equipeId) {
  const du = `${mois}-01`, au = finMois(mois);
  const facts = App.can('ventes') || App.can('dashboard') ? salesFacts(App.I, { preset: 'perso', du, au }) : [];
  const fiches = (App.D.suivi_agents || []).filter((r) => r.mois === mois);
  const objs = (App.D.objectifs || []).filter((o) => o.mois === mois && o.axe === 'agent' && !o.produit_id);
  const p = App.I.p;
  return agentsDuPerimetre(equipeId).map((a) => {
    const f = fiches.find((x) => x.agent_id === a.id) || {};
    const ventesERP = facts.filter((x) => x.agent_id === a.id).reduce((s, x) => s + x.cartons, 0);
    const decl = nv(f.ventes_declarees);
    const ventes = ventesERP > 0 ? ventesERP : decl;
    const objV = nv(objs.find((o) => o.cible_id === a.id)?.objectif_cartons);
    const jp = nv(f.jours_presents), aj = num(f.abs_j), anj = num(f.abs_nj);
    const presence = jp === null ? null : pct(jp, jp + aj + anj);
    const note = nv(f.note);
    const prime = note !== null && note >= num(p.prime_note_min) ? num(p.prime_montant) : 0;
    return {
      id: a.id, agent: a, nom: a.nom, equipe: nm.equipe(a.equipe_id), marche: a.marche_id ? nm.marche(a.marche_id) : '—', saisi: !!f.id,
      jp, retards: nv(f.retards), abs_j: nv(f.abs_j), abs_nj: nv(f.abs_nj), presence,
      objV, ventesERP, decl, ventes, tV: objV && ventes !== null ? pct(ventes, objV) : null,
      objD: nv(f.obj_destock), destock: nv(f.destock), tD: nv(f.obj_destock) && nv(f.destock) !== null ? pct(nv(f.destock), nv(f.obj_destock)) : null,
      visites: nv(f.visites), nc: nv(f.nouveaux_clients), plv: nv(f.plv), note, prime, commentaire: f.commentaire || '',
    };
  });
}

const barre = (v) => (v === null ? '—' : `<div class="mini"><div class="bar ${v >= 100 ? 'ok' : v >= 80 ? '' : v >= 50 ? 'warn' : 'crit'}"><i style="width:${Math.min(100, v)}%"></i></div>${fmtN(v, 0)} %</div>`);
const q = (v) => (v === null ? '—' : fmtQ(v));
const n0 = (v) => (v === null ? '—' : fmtN(v));

export function renderSuivi(root) {
  App.filters.suivi = App.filters.suivi || { mois: today().slice(0, 7), equipe_id: '' };
  const F = App.filters.suivi;
  const canEdit = App.can('suivi', 'modifier');
  root.innerHTML = pageHead('Suivi des agents terrain', 'Fiche mensuelle de chaque agent : présence (08h00–16h00), ventes, déstockage des grossistes, prospection, PLV, note sur 10 et prime. Les ventes saisies dans l’ERP sont reprises automatiquement ; à défaut, les ventes déclarées sont retenues.',
    canEdit ? `<button class="btn primary" id="saisie">${icon('edit')} Saisir le mois</button>` : '') +
    `<div class="filters">
      <label class="ff"><span>Mois</span><input type="month" id="f-mois" value="${F.mois}"></label>
      <label class="ff"><span>Équipe</span><select id="f-eq"><option value="">Toutes les équipes</option>${opts('equipes').map((o) => `<option value="${o.v}" ${F.equipe_id === o.v ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select></label>
    </div><section class="kpis" id="sk"></section>
    <div class="grid2"><article class="card"><header><h3>Ventes et déstockage par agent</h3></header><div class="cv h260"><canvas id="s-ch"></canvas></div></article>
    <article class="card"><header><h3>Évolution sur 6 mois</h3></header><div class="cv h260"><canvas id="s-ev"></canvas></div></article></div>
    <article class="card" id="st"></article>`;
  const draw = () => {
    const rows = lignesSuivi(F.mois, F.equipe_id);
    const s = rows.filter((r) => r.saisi);
    const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
    const jp = sum('jp'), absT = sum('abs_j') + sum('abs_nj');
    const objD = sum('objD'), dest = sum('destock'), objV = rows.reduce((a, r) => a + (r.objV && r.ventes !== null ? r.objV : 0), 0), vent = rows.reduce((a, r) => a + (r.objV ? r.ventes || 0 : 0), 0);
    const notes = rows.filter((r) => r.note !== null);
    const primes = rows.filter((r) => r.prime > 0);
    $('#sk', root).innerHTML = [
      ['Agents suivis', `${fmtN(s.length)} / ${fmtN(rows.length)}`, 'fiches saisies ce mois', ''],
      ['Taux de présence', jp + absT ? `${fmtN(pct(jp, jp + absT), 0)} %` : '—', `${fmtN(jp)} jours présents`, ''],
      ['Retards et absences', `${fmtN(sum('retards'))} / ${fmtN(sum('abs_nj'))}`, 'retards / absences non justifiées', sum('abs_nj') ? 'warn' : ''],
      ['Ventes réalisées', `${fmtQ(sum('ventes'))} ctn`, objV ? `${fmtN(pct(vent, objV), 0)} % de l’objectif` : 'sans objectif', ''],
      ['Déstockage grossistes', `${fmtQ(dest)} ctn`, objD ? `${fmtN(pct(dest, objD), 0)} % de l’objectif` : 'sans objectif', objD && dest >= objD ? 'ok' : ''],
      ['Nouveaux clients', fmtN(sum('nc')), `${fmtN(sum('visites'))} visites · ${fmtN(sum('plv'))} PLV`, ''],
      ['Note moyenne', notes.length ? `${fmtN(notes.reduce((a, r) => a + r.note, 0) / notes.length, 1)} / 10` : '—', `${notes.length} agents notés`, ''],
      ['Primes du mois', fmtF(primes.reduce((a, r) => a + r.prime, 0)), `${primes.length} agent(s) avec une note ≥ ${fmtN(App.I.p.prime_note_min)}`, primes.length ? 'ok' : ''],
    ].map(([l, v, sb, c]) => `<div class="kpi static ${c}"><span class="kpi-l">${l}</span><span class="kpi-v">${v}</span>${sb ? `<span class="kpi-s">${sb}</span>` : ''}</div>`).join('');
    const pal = palette();
    const top = rows.filter((r) => r.saisi || r.ventes || r.objV).sort((a, b) => (b.ventes || 0) + (b.destock || 0) - (a.ventes || 0) - (a.destock || 0)).slice(0, 18);
    chart($('#s-ch', root), { type: 'bar', data: { labels: top.map((r) => r.nom), datasets: [
      { label: 'Objectif ventes', data: top.map((r) => r.objV || 0), backgroundColor: pal[7], borderRadius: 3 },
      { label: 'Ventes', data: top.map((r) => r.ventes || 0), backgroundColor: pal[0], borderRadius: 3 },
      { label: 'Objectif déstockage', data: top.map((r) => r.objD || 0), backgroundColor: pal[5], borderRadius: 3 },
      { label: 'Déstockage', data: top.map((r) => r.destock || 0), backgroundColor: pal[1], borderRadius: 3 }] },
      tip: (c) => `${c.dataset.label} : ${fmtQ(c.parsed.y)} ctn` });
    const ms = monthsBetween(`${decale(F.mois, -5)}-01`, finMois(F.mois));
    const ev = ms.map((m) => { const rs = lignesSuivi(m, F.equipe_id); const t = (k) => rs.reduce((a, r) => a + (r[k] || 0), 0); const j = t('jp'), ab = t('abs_j') + t('abs_nj'); return { m, v: t('ventes'), d: t('destock'), p: j + ab ? pct(j, j + ab) : null }; });
    chart($('#s-ev', root), { type: 'bar', data: { labels: ev.map((e) => moisLabel(e.m)), datasets: [
      { label: 'Ventes (ctn)', data: ev.map((e) => e.v), backgroundColor: pal[0], borderRadius: 3 },
      { label: 'Déstockage (ctn)', data: ev.map((e) => e.d), backgroundColor: pal[1], borderRadius: 3 }] },
      tip: (c) => `${c.dataset.label} : ${fmtQ(c.parsed.y)}` });
    new Table({ title: `Fiches des agents — ${moisLabel(F.mois)}`, rows, sort: { k: 'equipe', dir: 1 }, pageSize: 40,
      meta: () => `Mois : ${moisLabel(F.mois)}${F.equipe_id ? ' · équipe ' + nm.equipe(F.equipe_id) : ''} · prime de ${fmtF(App.I.p.prime_montant)} à partir de ${fmtN(App.I.p.prime_note_min)}/10`,
      onRow: (r) => ficheAgent(r.agent, F.mois),
      cols: [{ k: 'nom', l: 'Agent', f: (r) => `<b>${esc(r.nom)}</b>${r.saisi ? '' : ' <span class="muted small">(pas de fiche)</span>'}` }, { k: 'equipe', l: 'Équipe' }, { k: 'marche', l: 'Marché' },
        { k: 'jp', l: 'Jours présents', num: 1, f: (r) => n0(r.jp) }, { k: 'retards', l: 'Retards', num: 1, f: (r) => n0(r.retards) },
        { k: 'abs_j', l: 'Abs. just.', num: 1, f: (r) => n0(r.abs_j) }, { k: 'abs_nj', l: 'Abs. non just.', num: 1, f: (r) => (r.abs_nj ? `<span class="t-crit">${fmtN(r.abs_nj)}</span>` : n0(r.abs_nj)) },
        { k: 'presence', l: 'Présence', num: 1, v: (r) => r.presence ?? -1, f: (r) => barre(r.presence), x: (r) => (r.presence === null ? '' : Math.round(r.presence)) },
        { k: 'objV', l: 'Objectif ventes', num: 1, f: (r) => q(r.objV) }, { k: 'ventes', l: 'Ventes ctn', num: 1, v: (r) => r.ventes ?? -1, f: (r) => (r.ventes === null ? '—' : `${fmtQ(r.ventes)}${r.ventesERP > 0 ? '' : ' <span class="muted small">décl.</span>'}`), x: (r) => r.ventes ?? '' },
        { k: 'tV', l: 'Atteinte ventes', num: 1, v: (r) => r.tV ?? -1, f: (r) => barre(r.tV), x: (r) => (r.tV === null ? '' : Math.round(r.tV)) },
        { k: 'objD', l: 'Objectif déstock.', num: 1, f: (r) => q(r.objD) }, { k: 'destock', l: 'Déstockage', num: 1, f: (r) => q(r.destock) },
        { k: 'tD', l: 'Atteinte déstock.', num: 1, v: (r) => r.tD ?? -1, f: (r) => barre(r.tD), x: (r) => (r.tD === null ? '' : Math.round(r.tD)) },
        { k: 'visites', l: 'Visites', num: 1, f: (r) => n0(r.visites) }, { k: 'nc', l: 'Nouv. clients', num: 1, f: (r) => n0(r.nc) }, { k: 'plv', l: 'PLV', num: 1, f: (r) => n0(r.plv) },
        { k: 'note', l: 'Note /10', num: 1, v: (r) => r.note ?? -1, f: (r) => (r.note === null ? '—' : `<b class="${r.note >= num(App.I.p.prime_note_min) ? 't-ok' : r.note < 5 ? 't-crit' : ''}">${fmtN(r.note, 1)}</b>`), x: (r) => r.note ?? '' },
        { k: 'prime', l: 'Prime FCFA', num: 1, f: (r) => (r.prime ? pill(fmtN(r.prime), 'ok') : '—'), x: (r) => r.prime || '' },
        { k: 'commentaire', l: 'Commentaire', cls: 'wrap' }],
      foot: (c, rs) => (c.k === 'nom' ? '<b>Total</b>' : ['jp', 'retards', 'abs_j', 'abs_nj', 'visites', 'nc', 'plv', 'prime'].includes(c.k) ? `<b>${fmtN(rs.reduce((a, r) => a + (r[c.k] || 0), 0))}</b>` : ['objV', 'ventes', 'objD', 'destock'].includes(c.k) ? `<b>${fmtQ(rs.reduce((a, r) => a + (r[c.k] || 0), 0))}</b>` : '') }).mount($('#st', root));
  };
  $('#f-mois', root).addEventListener('change', (e) => { F.mois = e.target.value || today().slice(0, 7); draw(); });
  $('#f-eq', root).addEventListener('change', (e) => { F.equipe_id = e.target.value; draw(); });
  $('#saisie', root)?.addEventListener('click', () => saisieMois(F.mois, F.equipe_id));
  draw();
}

// Historique d'un agent sur 12 mois
function ficheAgent(a, mois) {
  const ms = monthsBetween(`${decale(mois, -11)}-01`, finMois(mois)).reverse();
  const rs = ms.map((m) => ({ m, ...lignesSuivi(m, a.equipe_id).find((r) => r.id === a.id) })).filter((r) => r.saisi || r.ventes || r.objV);
  modal({ title: `${a.nom} — ${nm.equipe(a.equipe_id)}${a.marche_id ? ' · ' + nm.marche(a.marche_id) : ''}`, wide: true,
    body: `<p class="muted small">Téléphone : ${esc(a.telephone || '—')} · 12 derniers mois.</p><div id="fa"></div>`,
    onMount: (m) => new Table({ title: `Historique de ${a.nom}`, rows: rs, sort: { k: 'm', dir: -1 }, pageSize: 12, empty: 'Aucune fiche sur les 12 derniers mois.',
      cols: [{ k: 'm', l: 'Mois', f: (r) => moisLabel(r.m) }, { k: 'jp', l: 'Présent', num: 1, f: (r) => n0(r.jp) }, { k: 'retards', l: 'Retards', num: 1, f: (r) => n0(r.retards) }, { k: 'abs_nj', l: 'Abs. NJ', num: 1, f: (r) => n0(r.abs_nj) },
        { k: 'ventes', l: 'Ventes', num: 1, f: (r) => q(r.ventes) }, { k: 'tV', l: 'Atteinte', num: 1, f: (r) => barre(r.tV) }, { k: 'destock', l: 'Déstock.', num: 1, f: (r) => q(r.destock) }, { k: 'tD', l: 'Atteinte', num: 1, f: (r) => barre(r.tD) },
        { k: 'nc', l: 'Nouv. clients', num: 1, f: (r) => n0(r.nc) }, { k: 'note', l: 'Note', num: 1, f: (r) => (r.note === null ? '—' : fmtN(r.note, 1)) }, { k: 'prime', l: 'Prime', num: 1, f: (r) => (r.prime ? fmtN(r.prime) : '—') }] }).mount($('#fa', m)) });
}

// Saisie groupée : une ligne par agent, toutes les colonnes de la fiche
function saisieMois(mois0, equipe0) {
  let mois = mois0, equipe = equipe0 || '';
  const cols = [...SUIVI_CHAMPS, ['commentaire', 'Commentaire', 'text']];
  modal({ title: 'Fiches mensuelles des agents terrain', size: 'xl', wide: true,
    body: `<div class="filters">
      <label class="ff"><span>Mois</span><input type="month" id="s-mois" value="${mois}"></label>
      <label class="ff"><span>Équipe</span><select id="s-eq"><option value="">Toutes les équipes</option>${opts('equipes').map((o) => `<option value="${o.v}" ${equipe === o.v ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select></label>
      <button class="btn sm ghost" id="s-prev" type="button">Reprendre les objectifs de déstockage du mois précédent</button></div>
      <p class="muted small">Laissez vide ce qui n’est pas connu. Les ventes enregistrées dans l’ERP sont comptées automatiquement : « Ventes déclarées » sert pour les agents dont les ventes ne sont pas saisies. L’objectif de ventes se fixe dans « Objectifs et réalisations ».</p>
      <div class="tbl-wrap"><table class="tbl grid-in" id="s-grid"></table></div>${field({ k: 'motif', l: 'Commentaire de la saisie (facultatif)', t: 'text' }, '')}<p class="err" hidden></p>`,
    footer: '<button class="btn ghost" data-close>Annuler</button><button class="btn primary" id="s-save">Enregistrer les fiches</button>',
    onMount: (m, close) => {
      const grid = () => {
        const fiches = (App.D.suivi_agents || []).filter((r) => r.mois === mois);
        $('#s-grid', m).innerHTML = `<thead><tr><th>Agent</th>${cols.map(([, l]) => `<th class="n">${esc(l)}</th>`).join('')}</tr></thead><tbody>${agentsDuPerimetre(equipe).map((a) => {
          const f = fiches.find((x) => x.agent_id === a.id) || {};
          return `<tr data-a="${a.id}"><td><b>${esc(a.nom)}</b><br><span class="muted small">${esc(nm.equipe(a.equipe_id))}</span></td>${cols.map(([k, l, ty]) => `<td class="n"><input ${ty === 'text' ? 'type="text" class="w-txt"' : `type="number" min="0" ${ty === 'note' ? 'max="10" step="0.5"' : ty === 'int' ? 'step="1"' : 'step="any"'}`} data-k="${k}" value="${esc(f[k] ?? '')}" aria-label="${esc(l)} ${esc(a.nom)}"></td>`).join('')}</tr>`;
        }).join('') || `<tr><td colspan="${cols.length + 1}">Aucun agent actif dans cette équipe (voir Référentiels > Agents commerciaux).</td></tr>`}</tbody>`;
      };
      grid();
      $('#s-mois', m).addEventListener('change', (e) => { mois = e.target.value; grid(); });
      $('#s-eq', m).addEventListener('change', (e) => { equipe = e.target.value; grid(); });
      $('#s-prev', m).addEventListener('click', () => {
        const prev = (App.D.suivi_agents || []).filter((r) => r.mois === decale(mois, -1) && r.obj_destock !== null && r.obj_destock !== undefined);
        if (!prev.length) return toast('Aucun objectif de déstockage le mois précédent.', 'warn');
        $$('tr[data-a]', m).forEach((tr) => { const r = prev.find((x) => x.agent_id === tr.dataset.a); const i = $('[data-k=obj_destock]', tr); if (r && !i.value) i.value = r.obj_destock; });
      });
      $('#s-save', m.parentElement).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
        const lignes = $$('tr[data-a]', m).map((tr) => Object.fromEntries([['agent_id', tr.dataset.a], ...cols.map(([k]) => [k, $(`[data-k=${k}]`, tr).value])]));
        try {
          const r = await App.act('suivi.bulk', { mois, lignes, motif: $('[name=motif]', m).value }, null);
          toast(r.modifies ? `${r.modifies} fiche(s) enregistrée(s).` : 'Aucun changement.');
          Object.assign(App.filters.suivi, { mois, equipe_id: equipe });
          close(); App.rerender();
        } catch (e) { showErr(m, e.message); }
      }));
    } });
}
