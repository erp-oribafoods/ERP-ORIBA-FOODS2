// Objectifs de vente au format « Liste des agents et Objectif de vente » : Agent | Équipe | Fonction | Objectif (cartons par mois).
// L'import crée les agents absents dans leur équipe, met à jour leur fonction, renseigne les chefs d'équipe
// et enregistre l'objectif mensuel de chaque agent sur les mois choisis.
import { App, nm } from '../app.js';
import { esc, $, fmtN, fmtQ, toast, busy, saveBlob, Table, pill, exportRows } from './ui.js';
import { cleNom, trouverAgent } from './noms.js';
import { num, today } from '../../shared/logic.js';

const TITRE = 'Liste des agents et Objectif de vente';
const ENTETE = ['Agent', 'Equipe', 'Fonction', 'Objectif (cartons / mois)'];
const vide = (v) => v === '' || v === null || v === undefined;
const t = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const estChef = (f) => /chef\s*d.?\s*[ée]quipe/i.test(f || '');

const lireTable = (ws) => window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true });
function enTete(rows) {
  const h = rows.findIndex((r, i) => i < 10 && r.some((c) => cleNom(c) === 'agent') && r.some((c) => /^obj?e?c?t?if/.test(cleNom(c))));
  if (h < 0) return null;
  const k = rows[h].map(cleNom);
  return { h, agent: k.indexOf('agent'), equipe: k.findIndex((c) => c.startsWith('equipe')), fonction: k.findIndex((c) => c.startsWith('fonction')), objectif: k.findIndex((c) => /^obj?e?c?t?if/.test(c)) };
}
export function estListeObjectifs(wb) { return wb.SheetNames.some((n) => enTete(lireTable(wb.Sheets[n]))); }

export function moisEntre(du, au) {
  const out = []; let [y, m] = du.split('-').map(Number); const [Y, M] = au.split('-').map(Number);
  while (y < Y || (y === Y && m <= M)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } if (out.length > 24) break; }
  return out;
}

// Équipe : « Axe Balleyara » = Balleyara, « konni » = Konni
function trouverEquipe(nom) {
  const k = cleNom(nom).replace(/^axe /, '');
  return (App.D.equipes || []).find((e) => e.actif !== false && (cleNom(e.nom) === k || cleNom(e.code) === k)) || null;
}

export function analyseListe(wb, { du, au }) {
  const nomF = wb.SheetNames.find((n) => enTete(lireTable(wb.Sheets[n])));
  const rows = lireTable(wb.Sheets[nomF]);
  const H = enTete(rows);
  const agents = (App.D.agents || []).filter((a) => a.actif !== false);
  const mois = moisEntre(du, au);
  const lignes = [], creer = [], fonctions = [], chefs = new Map();
  for (let i = H.h + 1; i < rows.length; i++) {
    const r = rows[i];
    const nom = t(r[H.agent]), eqNom = t(H.equipe >= 0 ? r[H.equipe] : ''), fonction = t(H.fonction >= 0 ? r[H.fonction] : ''), oRaw = r[H.objectif];
    if (!nom || /^total/i.test(nom) || /^total/i.test(fonction)) continue;
    const msgs = [], notes = [];
    const eq = eqNom ? trouverEquipe(eqNom) : null;
    if (!eq) msgs.push(eqNom ? `Équipe « ${eqNom} » inconnue` : 'Équipe manquante');
    const obj = vide(oRaw) ? null : Number(String(oRaw).replace(/[\s ]/g, '').replace(',', '.'));
    if (obj !== null && (Number.isNaN(obj) || obj < 0)) msgs.push('Objectif : nombre positif attendu');
    let ag = eq ? trouverAgent(nom, agents, eq.id) : null;
    if (ag && ag.equipe_id && eq && ag.equipe_id !== eq.id) { msgs.push(`« ${nom} » est enregistré dans l’équipe ${nm.equipe(ag.equipe_id)}`); ag = null; }
    let statut = 'ok';
    if (!msgs.length) {
      if (!ag) { creer.push({ nom, equipe_id: eq.id, zone_id: eq.zone_id, fonction: fonction || null }); notes.push('Nouvel agent : créé dans l’équipe'); }
      else {
        if (cleNom(ag.nom) !== cleNom(nom)) notes.push(`Reconnu comme « ${ag.nom} »`);
        if (fonction && t(ag.fonction) !== fonction) { fonctions.push({ id: ag.id, fonction }); notes.push(ag.fonction ? `Fonction : ${ag.fonction} → ${fonction}` : 'Fonction renseignée'); }
      }
      if (estChef(fonction)) { const l = chefs.get(eq.id) || []; l.push(nom); chefs.set(eq.id, l); }
      if (ag && obj !== null) {
        const ex = mois.map((m) => (App.D.objectifs || []).find((o) => o.actif !== false && o.mois === m && o.axe === 'agent' && o.cible_id === ag.id && !o.produit_id));
        if (ex.every((o) => o && num(o.objectif_cartons) === obj)) statut = notes.length ? 'maj' : 'identique';
        else if (ex.some((o) => o)) { statut = 'maj'; notes.push(`Objectif actuel : ${[...new Set(ex.filter(Boolean).map((o) => fmtQ(o.objectif_cartons)))].join(' / ')} ctn`); }
      } else if (ag) statut = notes.length ? 'maj' : 'identique';
      if (obj === null) notes.push('Pas d’objectif sur cette ligne');
    }
    lignes.push({ ligne: i + 1, nom, equipe: eq?.nom || eqNom, equipe_id: eq?.id || null, fonction, objectif: obj, agent_id: ag?.id || null, statut: msgs.length ? 'rejet' : statut, msg: [...msgs, ...notes].join(' ; ') });
  }
  // Chef(s) d'équipe à reporter sur l'équipe
  const responsables = [];
  for (const [id, noms] of chefs) {
    const e = (App.D.equipes || []).find((x) => x.id === id);
    const val = noms.join(' et ');
    if (cleNom(e.responsable) !== cleNom(val)) responsables.push({ id, nom: e.nom, avant: e.responsable || '', apres: val });
  }
  return { onglet: nomF, mois, lignes, creer, fonctions, responsables };
}

// Enregistrement : agents, fonctions, chefs d'équipe, puis objectifs de chaque mois
export async function appliquerListe(wb, periode, fichier) {
  let A = analyseListe(wb, periode);
  const out = { agents: 0, fonctions: 0, equipes: 0, objectifs: 0, refus: [] };
  if (A.creer.length) {
    const pris = new Set((App.D.agents || []).map((a) => a.code));
    const code = (eqId) => { const e = App.D.equipes.find((x) => x.id === eqId); let n = 0, c; do { n++; c = `${e.code}-${String(n).padStart(2, '0')}`; } while (pris.has(c)); pris.add(c); return c; };
    const r = await App.api.call('import.run', { type: 'agents', mode: 'courant', fichier: `${fichier} — nouveaux agents`, rows: A.creer.map((a, i) => ({ ligne: i + 1, data: { ...a, code: code(a.equipe_id) } })) });
    out.agents = r.integrees.length; out.refus.push(...r.refuses.map((x) => `Agent : ${x.erreur}`));
  }
  if (A.fonctions.length) {
    const r = await App.api.call('import.run', { type: 'agents', mode: 'courant', fichier: `${fichier} — fonctions`, rows: A.fonctions.map((f, i) => ({ ligne: i + 1, data: f })) });
    out.fonctions = r.integrees.length; out.refus.push(...r.refuses.map((x) => `Fonction : ${x.erreur}`));
  }
  for (const e of A.responsables) { await App.api.call('ref.save', { table: 'equipes', row: { id: e.id, responsable: e.apres }, motif: `Chef d’équipe indiqué dans ${fichier}` }); out.equipes++; }
  await App.refresh();
  A = analyseListe(wb, periode);
  const rows = [];
  for (const l of A.lignes) if (l.agent_id && l.objectif !== null && l.statut !== 'rejet') for (const m of A.mois) rows.push({ ligne: l.ligne, data: { mois: m, axe: 'agent', cible_id: l.agent_id, produit_id: null, objectif_cartons: l.objectif, objectif_ca: (App.D.objectifs || []).find((o) => o.actif !== false && o.mois === m && o.axe === 'agent' && o.cible_id === l.agent_id && !o.produit_id)?.objectif_ca ?? null } });
  if (rows.length) {
    const r = await App.api.call('import.run', { type: 'objectifs', mode: 'courant', fichier: `${fichier} — objectifs ${A.mois[0]}${A.mois.length > 1 ? ' à ' + A.mois[A.mois.length - 1] : ''}`, rows });
    out.objectifs = r.integrees.length; out.refus.push(...r.refuses.map((x) => `Ligne ${x.ligne} : ${x.erreur}`));
  }
  await App.refresh(); App.rerender();
  return out;
}

// Contrôle affiché dans la fenêtre d'import
export function controleListe(host, wb, fname, onDone) {
  const m0 = today().slice(0, 7);
  const P = { du: m0, au: `${m0.slice(0, 4)}-12` };
  const LIB = { ok: ['Nouveau', 'ok'], maj: ['Mise à jour', 'info'], identique: ['Inchangé', 'mute'], rejet: ['Rejeté', 'crit'] };
  const draw = () => {
    const A = analyseListe(wb, P);
    const c = (s) => A.lignes.filter((l) => l.statut === s).length;
    const total = A.lignes.filter((l) => l.statut !== 'rejet').reduce((s, l) => s + (l.objectif || 0), 0);
    const aFaire = c('ok') + c('maj') + A.responsables.length;
    host.innerHTML = `<div class="filters"><label class="ff"><span>Objectifs à appliquer du mois</span><input type="month" data-du value="${P.du}"></label><label class="ff"><span>au mois</span><input type="month" data-au value="${P.au}"></label></div>
      <div class="note"><b>${esc(fname)}</b> : ${A.lignes.length} agent(s), objectif total ${fmtQ(total)} cartons par mois, appliqué sur ${A.mois.length} mois. ${c('ok')} nouveau(x), ${c('maj')} mise(s) à jour, ${c('identique')} inchangé(s), ${c('rejet')} rejeté(s).
      ${A.creer.length ? `<br>${A.creer.length} agent(s) seront créés dans leur équipe.` : ''}${A.responsables.length ? `<br>Chef(s) d’équipe renseigné(s) : ${A.responsables.map((e) => `${esc(e.nom)} → ${esc(e.apres)}`).join(' ; ')}.` : ''}</div><div data-t></div>
      <div class="row-act"><button class="btn ghost" data-rep>Exporter le contrôle</button><button class="btn primary" data-go ${aFaire ? '' : 'disabled'}>Enregistrer les objectifs</button></div>`;
    new Table({ title: 'Contrôle des objectifs', rows: A.lignes.map((l, i) => ({ ...l, id: String(i) })), pageSize: 15,
      cols: [{ k: 'ligne', l: 'Ligne' }, { k: 'nom', l: 'Agent' }, { k: 'equipe', l: 'Équipe' }, { k: 'fonction', l: 'Fonction' }, { k: 'objectif', l: 'Objectif ctn / mois', num: 1, f: (l) => (l.objectif === null ? '—' : fmtQ(l.objectif)) },
        { k: 'statut', l: 'Contrôle', v: (l) => LIB[l.statut][0], f: (l) => pill(LIB[l.statut][0], LIB[l.statut][1]) }, { k: 'msg', l: 'Détail', cls: 'wrap' }] }).mount($('[data-t]', host));
    $('[data-du]', host).addEventListener('change', (e) => { P.du = e.target.value; if (P.au < P.du) P.au = P.du; draw(); });
    $('[data-au]', host).addEventListener('change', (e) => { P.au = e.target.value < P.du ? P.du : e.target.value; draw(); });
    $('[data-rep]', host).addEventListener('click', () => exportRows('xlsx', 'Contrôle objectifs', [{ k: 'ligne', l: 'Ligne' }, { k: 'nom', l: 'Agent' }, { k: 'equipe', l: 'Équipe' }, { k: 'fonction', l: 'Fonction' }, { k: 'objectif', l: 'Objectif' }, { k: 'statut', l: 'Contrôle', v: (l) => LIB[l.statut][0] }, { k: 'msg', l: 'Détail' }], A.lignes, `Fichier : ${fname}`));
    $('[data-go]', host).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      try {
        const r = await appliquerListe(wb, P, fname);
        toast(`Objectifs enregistrés : ${r.objectifs} objectif(s) mensuel(s)${r.agents ? `, ${r.agents} agent(s) créé(s)` : ''}.`, r.refus.length ? 'warn' : 'ok');
        host.innerHTML = `<div class="note ok"><b>Enregistré.</b> ${r.agents} agent(s) créé(s), ${r.fonctions} fonction(s) mise(s) à jour, ${r.equipes} chef(s) d’équipe renseigné(s), ${r.objectifs} objectif(s) mensuel(s) enregistré(s) (${A.mois.length} mois).${r.refus.length ? `<br><span class="t-crit">${r.refus.slice(0, 10).map(esc).join('<br>')}</span>` : ''}</div>`;
        onDone?.();
      } catch (e) { toast(e.message, 'err'); }
    }));
  };
  draw();
}

// Modèle Excel au même format que la liste de la Direction commerciale, pré-rempli avec les agents et l'objectif du mois
export function modeleListe(mois = today().slice(0, 7)) {
  const X = window.XLSX;
  const eqs = (App.D.equipes || []).filter((e) => e.actif !== false);
  const ordreEq = new Map(eqs.map((e, i) => [e.id, i]));
  const ag = (App.D.agents || []).filter((a) => a.actif !== false && a.equipe_id).sort((a, b) => (ordreEq.get(a.equipe_id) ?? 99) - (ordreEq.get(b.equipe_id) ?? 99) || (estChef(b.fonction) - estChef(a.fonction)) || a.nom.localeCompare(b.nom, 'fr'));
  const obj = (id) => (App.D.objectifs || []).find((o) => o.actif !== false && o.mois === mois && o.axe === 'agent' && o.cible_id === id && !o.produit_id)?.objectif_cartons;
  const aoa = [[`${TITRE} — ${mois}`], ENTETE, ...ag.map((a) => [a.nom, nm.equipe(a.equipe_id), a.fonction || '', obj(a.id) ?? ''])];
  const fin = aoa.length;
  aoa.push(['Total', '', 'TOTAL', null]);
  const ws = X.utils.aoa_to_sheet(aoa);
  ws[`D${fin + 1}`] = { t: 'n', v: ag.reduce((s, a) => s + num(obj(a.id) || 0), 0), f: `SUM(D3:D${fin})` };
  ws['!cols'] = [{ wch: 34 }, { wch: 16 }, { wch: 34 }, { wch: 22 }];
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Objectifs');
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Comment remplir ce fichier'], [''], ['1. Une ligne par agent : nom, équipe, fonction (Chef d’équipe, Agent Commercial, Agent de Vente…) et objectif en cartons par mois.'], ['2. Pour un nouvel agent, ajoutez simplement une ligne : il sera créé dans son équipe à l’import.'], ['3. Dans la plateforme : Objectifs commerciaux > Importer Excel, choisissez les mois concernés, vérifiez le contrôle puis enregistrez.'], ['4. Le chef d’équipe indiqué est reporté automatiquement sur l’équipe.']]), 'Lisez-moi');
  saveBlob(`Liste_des_agents_et_objectif_de_vente_${mois}.xlsx`, new Blob([X.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
