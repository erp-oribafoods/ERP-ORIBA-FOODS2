// Mise à jour quotidienne : on importe chaque jour les mêmes tableaux de bord « TB … ORIBA FOODS » (fichiers cumulés).
// La plateforme n'ajoute que ce qui est nouveau : ventes au comptant, ventes à crédit, remboursements (différence de cumul),
// agents / marchés / clients absents. Les lignes déjà enregistrées sont reconnues et ignorées, côté écran et côté serveur.
import { App, nm } from '../app.js';
import { esc, $, $$, fmtN, fmtD, toast, busy, icon, modal, exportRows } from './ui.js';
import { estTB, analyseTB, detecterEquipe, creerManquants, payloadPropre } from './importTB.js';
import { venteTotals } from '../../shared/logic.js';

const PAQUET = 300; // lignes envoyées par appel
const nrm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const peutMettreAJour = () => App.can('ventes', 'creer');

function bilan(f) {
  const opt = { equipe_id: f.equipe_id, creer: true };
  const C = analyseTB('ventes_comptant', f.wb, opt), K = analyseTB('ventes_credit', f.wb, opt), R = analyseTB('remboursements', f.wb, opt);
  const compte = (res, st) => res.filter((r) => r.statut === st).length;
  const manq = { agents: [], marches: [], clients: [], eq: (App.D.equipes || []).find((e) => e.id === f.equipe_id) };
  for (const m of [C.manquants, K.manquants].filter(Boolean)) for (const k of ['agents', 'marches', 'clients']) for (const x of m[k]) if (!manq[k].some((y) => nrm(y) === nrm(x))) manq[k].push(x);
  const rembAttente = R.res.filter((r) => r.statut === 'rejet' && /introuvable/.test(r.msg)).length;
  return {
    C, K, R, manq,
    nb: {
      comptant: compte(C.res, 'ok'), credit: compte(K.res, 'ok'), remb: compte(R.res, 'ok'), rembAttente,
      deja: compte(C.res, 'identique') + compte(K.res, 'identique') + compte(R.res, 'identique'),
      rejets: [...C.res, ...K.res].filter((r) => r.statut === 'rejet').length + R.res.filter((r) => r.statut === 'rejet' && !/introuvable/.test(r.msg)).length,
      absentes: (C.absentes?.length || 0) + (K.absentes?.length || 0),
      creer: manq.agents.length + manq.marches.length + manq.clients.length,
    },
  };
}

async function envoyer(type, fichier, rows) {
  const tot = { integrees: 0, deja: 0, refuses: [] };
  for (let i = 0; i < rows.length; i += PAQUET) {
    const out = await App.api.call('import.run', { type, mode: 'courant', fichier, rows: rows.slice(i, i + PAQUET).map(payloadPropre), stats: { mise_a_jour_quotidienne: true } });
    tot.integrees += out.integrees.length; tot.deja += out.deja?.length || 0; tot.refuses.push(...out.refuses);
  }
  return tot;
}

// Met à jour la plateforme à partir d'un fichier : référentiels, comptant, crédit, puis remboursements
async function appliquer(f, etape) {
  const res = { comptant: null, credit: null, remb: null, crees: 0 };
  const b0 = bilan(f);
  if (b0.nb.creer) { etape('Création des agents, marchés et clients nouveaux'); await creerManquants(b0.manq); res.crees = b0.nb.creer; }
  else await App.refresh();
  for (const [type, cle, lib] of [['ventes_comptant', 'comptant', 'Journal Comptant'], ['ventes_credit', 'credit', 'Journal Crédit']]) {
    const rows = analyseTB(type, f.wb, { equipe_id: f.equipe_id, creer: false }).res.filter((r) => r.statut === 'ok').map((r) => r.payload);
    if (rows.length) { etape(`${lib} : ${rows.length} nouvelle(s) ligne(s)`); res[cle] = await envoyer(type, `${f.name} — ${lib} (mise à jour quotidienne)`, rows); await App.refresh(); }
  }
  const rb = analyseTB('remboursements', f.wb, { equipe_id: f.equipe_id }).res.filter((r) => r.statut === 'ok').map((r) => r.payload);
  if (rb.length) { etape(`Remboursements : ${rb.length} mise(s) à jour`); res.remb = await envoyer('remboursements', `${f.name} — Journal Crédit (remboursements, mise à jour quotidienne)`, rb); await App.refresh(); }
  return res;
}

export function ouvrirMiseAJour() {
  modal({ title: 'Mise à jour quotidienne des tableaux de bord', wide: true,
    body: `<ol class="steps-imp"><li><b>Choisissez les fichiers du jour</b> (un ou plusieurs « TB … ORIBA FOODS », tels quels : Journal Comptant, Journal Crédit).</li>
      <li><b>Vérifiez le bilan</b> : la plateforme reconnaît tout ce qu’elle connaît déjà et ne propose que les nouvelles lignes et les remboursements à compléter.</li>
      <li><b>Mettez à jour</b> : rien n’est jamais enregistré deux fois, même si vous importez le même fichier plusieurs fois.</li></ol>
      <div class="filters"><label class="btn primary"><input type="file" accept=".xlsx,.xls" multiple hidden data-files>${icon('upload')} Choisir les fichiers du jour</label></div>
      <div data-bilan></div>`,
    onMount: (m) => {
      let fichiers = [];
      const zone = $('[data-bilan]', m);
      const afficher = () => {
        for (const f of fichiers) f.b = f.equipe_id ? bilan(f) : null;
        const eqOpts = (sel) => `<option value="">— choisir —</option>${(App.D.equipes || []).filter((e) => e.actif !== false).map((e) => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(e.nom)}</option>`).join('')}`;
        const total = fichiers.reduce((s, f) => s + (f.b ? f.b.nb.comptant + f.b.nb.credit + f.b.nb.remb + f.b.nb.rembAttente + f.b.nb.creer : 0), 0);
        zone.innerHTML = `<div class="tbl-wrap"><table class="tbl maj-t"><thead><tr><th>Fichier</th><th>Équipe</th><th class="n">Comptant à ajouter</th><th class="n">Crédit à ajouter</th><th class="n">Rembour&shy;sements à ajouter</th><th class="n">Déjà présentes</th><th class="n">Rejetées</th><th class="n" title="Sur la plateforme mais plus dans le fichier">Absentes du fichier</th></tr></thead><tbody>
          ${fichiers.map((f, i) => `<tr><td class="wrap">${esc(f.name)}</td><td><select data-eq="${i}" style="min-width:150px">${eqOpts(f.equipe_id)}</select></td>
            ${f.b ? `<td class="n">${fmtN(f.b.nb.comptant)}</td><td class="n">${fmtN(f.b.nb.credit)}</td><td class="n">${fmtN(f.b.nb.remb + f.b.nb.rembAttente)}</td><td class="n">${fmtN(f.b.nb.deja)}</td><td class="n">${f.b.nb.rejets ? `<b class="t-crit">${fmtN(f.b.nb.rejets)}</b>` : 0}</td><td class="n">${f.b.nb.absentes ? `<b class="t-warn">${fmtN(f.b.nb.absentes)}</b>` : 0}</td>` : '<td colspan="6" class="muted">Choisissez l’équipe du fichier</td>'}</tr>`).join('')}
          </tbody></table></div>
          ${fichiers.map((f, i) => f.b ? detail(f, i) : '').join('')}
          <div class="row-act"><button class="btn primary" data-go ${total && fichiers.every((f) => f.equipe_id) ? '' : 'disabled'}>${icon('check')} Mettre à jour la plateforme</button></div><div data-prog></div>`;
        $$('[data-eq]', zone).forEach((s) => s.addEventListener('change', () => { fichiers[Number(s.dataset.eq)].equipe_id = s.value; afficher(); }));
        $$('[data-exp]', zone).forEach((b) => b.addEventListener('click', () => exporter(fichiers[Number(b.dataset.exp)])));
        $('[data-go]', zone).addEventListener('click', (ev) => busy(ev.currentTarget, () => lancer()));
        if (!total && fichiers.length && fichiers.every((f) => f.b)) zone.insertAdjacentHTML('afterbegin', `<div class="note ok">Tout est déjà à jour : aucune nouvelle ligne dans ${fichiers.length > 1 ? 'ces fichiers' : 'ce fichier'}.${fichiers.some((f) => f.b.nb.absentes) ? ' Voir cependant les ventes absentes du fichier ci-dessous.' : ''}</div>`);
      };
      const detail = (f, i) => {
        const b = f.b, items = [];
        if (b.nb.creer) items.push(`<p><b>À créer dans l’équipe ${esc(b.manq.eq?.nom || '')} :</b> ${esc([...b.manq.agents.map((x) => 'agent ' + x), ...b.manq.marches.map((x) => 'marché ' + x), ...b.manq.clients.map((x) => 'client ' + x)].join(', '))}.</p>`);
        if (b.nb.rembAttente) items.push(`<p>${b.nb.rembAttente} remboursement(s) portent sur de nouvelles ventes à crédit : ils seront enregistrés juste après elles.</p>`);
        const rej = [...b.C.res.map((r) => ['Comptant', r]), ...b.K.res.map((r) => ['Crédit', r]), ...b.R.res.filter((r) => !/introuvable/.test(r.msg)).map((r) => ['Remboursement', r])].filter(([, r]) => r.statut === 'rejet');
        if (rej.length) items.push(`<p><b>Lignes rejetées (non importées, à corriger dans le fichier) :</b><br>${rej.slice(0, 15).map(([j, r]) => `${j} ligne ${r.ligne} : ${esc(r.msg)}`).join('<br>')}${rej.length > 15 ? '<br>…' : ''}</p>`);
        const abs = [...(b.C.absentes || []), ...(b.K.absentes || [])];
        if (abs.length) items.push(`<p><b>Ventes présentes sur la plateforme mais plus dans le fichier</b> (ligne supprimée ou modifiée dans le fichier) : elles ne sont pas touchées. Vérifiez-les et annulez-les dans la rubrique Ventes si elles sont fausses.<br>${abs.slice(0, 10).map((v) => `${esc(v.numero)} du ${fmtD(v.date)} · ${esc(nm.agent(v.agent_id))} · ${fmtN(venteTotals(v, App.I).montant)} FCFA`).join('<br>')}${abs.length > 10 ? '<br>…' : ''}</p>`);
        if (!items.length) return '';
        return `<details class="card" style="margin-top:10px"><summary><b>${esc(f.name)}</b> — détails</summary>${items.join('')}<button class="btn ghost sm" data-exp="${i}">${icon('download')} Exporter le contrôle complet</button></details>`;
      };
      const exporter = (f) => {
        const lignes = [];
        for (const [j, A] of [['Journal Comptant', f.b.C], ['Journal Crédit', f.b.K], ['Remboursements', f.b.R]]) for (const r of A.res) lignes.push({ feuille: j, ligne: r.ligne, apercu: r.apercu, statut: { ok: 'Nouvelle', identique: 'Déjà présente', rejet: /introuvable/.test(r.msg) ? 'Après la vente à crédit' : 'Rejetée' }[r.statut] || r.statut, msg: r.msg });
        for (const v of [...(f.b.C.absentes || []), ...(f.b.K.absentes || [])]) lignes.push({ feuille: v.mode === 'credit' ? 'Journal Crédit' : 'Journal Comptant', ligne: '', apercu: `${v.numero} · ${fmtD(v.date)} · ${nm.agent(v.agent_id)} · ${fmtN(venteTotals(v, App.I).montant)} FCFA`, statut: 'Absente du fichier', msg: 'Sur la plateforme mais plus dans le fichier' });
        exportRows('xlsx', 'Contrôle mise à jour quotidienne', [{ k: 'feuille', l: 'Feuille' }, { k: 'ligne', l: 'Ligne' }, { k: 'apercu', l: 'Aperçu' }, { k: 'statut', l: 'Contrôle' }, { k: 'msg', l: 'Détail' }], lignes, `Fichier : ${f.name}`);
      };
      const lancer = async () => {
        const prog = $('[data-prog]', zone);
        const lignes = [];
        for (const f of fichiers) {
          const etape = (txt) => { prog.innerHTML = `<div class="note">${esc(f.name)} : ${esc(txt)}…</div>`; };
          try {
            const r = await appliquer(f, etape);
            const fmt = (x) => (x ? `${fmtN(x.integrees)} ajoutée(s)${x.deja ? `, ${fmtN(x.deja)} déjà présente(s)` : ''}${x.refuses.length ? `, <b class="t-crit">${x.refuses.length} refusée(s)</b>` : ''}` : 'rien de nouveau');
            const refus = [...(r.comptant?.refuses || []), ...(r.credit?.refuses || []), ...(r.remb?.refuses || [])];
            lignes.push(`<li><b>${esc(f.name)}</b> (${esc(nm.equipe(f.equipe_id))}) — comptant : ${fmt(r.comptant)} ; crédit : ${fmt(r.credit)} ; remboursements : ${fmt(r.remb)}${r.crees ? ` ; ${r.crees} élément(s) créé(s) dans les référentiels` : ''}.${refus.length ? `<br><span class="small">${refus.slice(0, 10).map((x) => `Ligne ${x.ligne} : ${esc(x.erreur)}`).join('<br>')}</span>` : ''}</li>`);
          } catch (e) { lignes.push(`<li><b>${esc(f.name)}</b> : <span class="t-crit">${esc(e.message)}</span> — relancez la mise à jour, les lignes déjà enregistrées ne seront pas reprises.</li>`); }
        }
        App.rerender();
        zone.innerHTML = `<div class="note ok"><b>Mise à jour terminée.</b><ul>${lignes.join('')}</ul></div><p class="muted small">Vous pouvez réimporter ces fichiers demain avec les nouvelles lignes : seules les nouveautés seront ajoutées.</p>`;
        toast('Mise à jour quotidienne terminée.');
      };
      $('[data-files]', m).addEventListener('change', async (e) => {
        const nouveaux = [];
        for (const file of e.target.files) {
          try {
            const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
            if (!estTB(wb)) { toast(`${file.name} : ce n’est pas un tableau de bord (feuilles « Journal Comptant » / « Journal Crédit » absentes).`, 'warn'); continue; }
            nouveaux.push({ name: file.name, wb, equipe_id: detecterEquipe(wb) });
          } catch (er) { toast(`${file.name} : lecture impossible (${er.message})`, 'err'); }
        }
        fichiers = nouveaux; e.target.value = '';
        if (fichiers.length) afficher(); else zone.innerHTML = '';
      });
    } });
}
