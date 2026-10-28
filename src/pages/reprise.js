// Reprise des données historiques : modèles d'import, contrôles, rapport de migration.
import { App, nm, pageHead } from '../app.js';
import { esc, $, $$, fmtN, fmtD, Table, toast, busy, pill, exportRows, saveBlob, icon } from '../lib/ui.js';
import { venteTotals, isDate, num, round2, lineCalc } from '../../shared/logic.js';

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const TYPES = {
  produits: { l: 'Produits', cols: ['code', 'nom', 'gamme', 'packs_par_carton', 'prix_ref'], ex: ['P-001', 'Exemple produit', 'DADI', 12, 13000] },
  agents: { l: 'Agents', cols: ['code', 'nom', 'telephone', 'equipe', 'zone', 'date_affectation'], ex: ['A01', 'Nom de l’agent', '', 'Niamey 1', 'Niamey', '01/04/2026'] },
  marches: { l: 'Marchés / villages', cols: ['nom', 'commune', 'zone', 'equipe'], ex: ['Nom du marché', 'Niamey', 'Niamey', 'Niamey 1'] },
  clients: { l: 'Clients / débiteurs', cols: ['code', 'nom', 'type', 'marche', 'telephone', 'plafond_cartons', 'depositaire'], ex: ['C001', 'Nom du client', 'Grossiste', 'Katako', '', '', 'non'] },
  ventes_comptant: { l: 'Journal des ventes au comptant', cols: ['reference', 'date', 'agent', 'marche', 'client', 'produit', 'unite', 'quantite', 'prix_unitaire', 'observation'], ex: ['', '03/05/2026', 'Nom de l’agent', 'Katako', '', 'P-001', 'carton', 2, 13000, ''] },
  ventes_credit: { l: 'Journal des ventes à crédit', cols: ['reference', 'date', 'agent', 'marche', 'client', 'produit', 'unite', 'quantite', 'prix_unitaire', 'echeance', 'observation'], ex: ['CR-001', '03/05/2026', 'Nom de l’agent', 'Katako', 'C001', 'P-001', 'carton', 10, 13000, '31/05/2026', ''] },
  remboursements: { l: 'Remboursements connus', cols: ['reference_vente', 'date', 'montant', 'mode', 'reference'], ex: ['CR-001', '20/05/2026', 50000, 'Espèces', 'Reçu 123'] },
  stock_remises: { l: 'Remises de stock confié', cols: ['date', 'depositaire', 'produit', 'quantite', 'valeur_unitaire', 'document'], ex: ['03/06/2026', 'C900', 'P-001', 500, 12500, 'BL-0141'] },
  depenses_agregees: { l: 'Dépenses mensuelles agrégées', cols: ['mois', 'equipe', 'vehicule', 'categorie', 'montant', 'commentaire'], ex: ['2026-05', 'Zinder', '', 'Carburant', 250000, 'Total mai'] },
};

function toISO(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return new Date(Date.UTC(v.getFullYear(), v.getMonth(), v.getDate())).toISOString().slice(0, 10);
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return s;
}
function toMonth(v) {
  if (v instanceof Date || typeof v === 'number') return toISO(v)?.slice(0, 7);
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/.\-](\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  const MO = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
  const n = norm(s).split('_'); const i = MO.findIndex((x) => n[0]?.startsWith(x.slice(0, 4))); if (i >= 0 && /^\d{4}$/.test(n[1] || '')) return `${n[1]}-${String(i + 1).padStart(2, '0')}`;
  return s;
}
const toNum = (v) => { if (v === '' || v === null || v === undefined) return null; if (typeof v === 'number') return v; const n = Number(String(v).replace(/\s| | /g, '').replace(',', '.')); return isNaN(n) ? NaN : n; };

function resolver(table, label = 'nom') {
  const m = new Map();
  for (const r of App.D[table] || []) { if (r.code) m.set(norm(r.code), r.id); m.set(norm(r[label]), r.id); if (table === 'clients' || table === 'produits') m.set(norm(String(r[label]).replace(/\s*\(demo\)$/i, '').replace(/\s*\(démo\)$/i, '')), r.id); }
  return (v) => (v === null || v === undefined || v === '' ? null : m.get(norm(v)) ?? undefined);
}

function analyse(type, raw) {
  const R = { agent: resolver('agents'), marche: resolver('marches'), client: resolver('clients'), produit: resolver('produits'), equipe: resolver('equipes'), zone: resolver('zones'), vehicule: resolver('vehicules', 'immatriculation'), categorie: resolver('categories_depense', 'libelle') };
  const out = [];
  const need = (row, k, res, label, msgs) => { const id = res(row[k]); if (row[k] && id === undefined) msgs.push(`${label} inconnu : « ${row[k]} »`); return id ?? null; };
  const rows = raw.map((r, i) => { const o = { _ligne: i + 2 }; for (const [k, v] of Object.entries(r)) o[norm(k)] = v; return o; }).filter((r) => Object.keys(r).some((k) => k !== '_ligne' && r[k] !== '' && r[k] !== null));
  if (['produits', 'agents', 'marches', 'clients'].includes(type)) {
    for (const r of rows) {
      const msgs = []; const data = {};
      if (!r.nom) msgs.push('Nom manquant');
      for (const c of TYPES[type].cols) {
        if (['equipe', 'zone', 'marche'].includes(c)) data[c + '_id'] = need(r, c, R[c], c === 'marche' ? 'Marché' : c === 'zone' ? 'Zone' : 'Équipe', msgs);
        else if (['packs_par_carton', 'prix_ref', 'plafond_cartons'].includes(c)) { const n = toNum(r[c]); if (Number.isNaN(n)) msgs.push(`${c} non numérique`); data[c] = n ?? (c === 'packs_par_carton' ? 12 : null); }
        else if (c === 'depositaire') data[c] = ['oui', 'o', 'yes', '1', 'x', 'vrai'].includes(norm(r[c]));
        else if (c === 'date_affectation') { data[c] = toISO(r[c]); if (data[c] && !isDate(data[c])) msgs.push('Date d’affectation invalide'); }
        else data[c] = r[c] === '' || r[c] === undefined ? null : String(r[c]).trim();
      }
      const res = resolver(type)(data.code || data.nom);
      const dup = res !== undefined && res !== null;
      out.push({ ligne: r._ligne, statut: msgs.length ? 'rejet' : dup ? 'doublon' : 'ok', msg: msgs.join(' ; ') || (dup ? 'Existe déjà dans le référentiel' : ''), payload: { ligne: r._ligne, data }, apercu: `${data.code || ''} ${data.nom || ''}` });
    }
    return out;
  }
  if (type === 'ventes_comptant' || type === 'ventes_credit') {
    const groups = new Map();
    for (const r of rows) { const k = r.reference ? 'ref:' + r.reference : 'ligne:' + r._ligne; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const existing = new Set();
    for (const v of App.D.ventes || []) { if (v.statut !== 'validee') continue; for (const l of venteTotals(v, App.I).lignes) existing.add([v.date, v.agent_id, v.client_id || '', l.produit_id, num(l.quantite), round2(l.montant)].join('|')); }
    const seen = new Set();
    for (const [, g] of groups) {
      const h = g[0]; const msgs = [];
      const data = { date: toISO(h.date), agent_id: need(h, 'agent', R.agent, 'Agent', msgs), marche_id: need(h, 'marche', R.marche, 'Marché', msgs), client_id: need(h, 'client', R.client, 'Client', msgs), observation: h.observation ? String(h.observation) : 'Reprise historique', ref_externe: h.reference ? String(h.reference) : null };
      if (!isDate(data.date)) msgs.push('Date manquante ou invalide');
      if (type === 'ventes_credit') { data.echeance = toISO(h.echeance); if (data.echeance && !isDate(data.echeance)) msgs.push('Échéance invalide'); if (!data.client_id) msgs.push('Client obligatoire pour un crédit'); if (data.ref_externe && (App.D.ventes || []).some((v) => v.ref_externe === data.ref_externe)) msgs.push(`Référence ${data.ref_externe} déjà importée`); }
      const lignes = []; let dup = false;
      for (const r of g) {
        const pid = need(r, 'produit', R.produit, 'Produit', msgs);
        if (!pid && !r.produit) msgs.push(`Ligne ${r._ligne} : produit manquant`);
        const u = norm(r.unite || 'carton').startsWith('pack') ? 'pack' : 'carton';
        const q = toNum(r.quantite), p = toNum(r.prix_unitaire);
        if (!(q > 0)) msgs.push(`Ligne ${r._ligne} : quantité vide ou négative`);
        if (p === null || Number.isNaN(p) || p < 0) msgs.push(`Ligne ${r._ligne} : prix unitaire invalide`);
        lignes.push({ produit_id: pid, unite: u, quantite: q, prix_unitaire: p });
        const mt = round2(lineCalc(App.I.produits.get(pid), u, q, p).montant);
        const key = [data.date, data.agent_id, data.client_id || '', pid, num(q), mt].join('|');
        if (existing.has(key) || seen.has(key)) dup = true;
        seen.add(key);
      }
      out.push({ ligne: g.map((r) => r._ligne).join(', '), statut: msgs.length ? 'rejet' : dup ? 'doublon' : 'ok', msg: msgs.join(' ; ') || (dup ? 'Doublon potentiel (date, agent, client, produit, quantité, montant)' : ''), payload: { ligne: g[0]._ligne, data, lignes }, apercu: `${fmtD(data.date)} · ${nm.agent(data.agent_id)} · ${lignes.length} ligne(s)` });
    }
    return out;
  }
  if (type === 'remboursements') {
    const byRef = new Map(); for (const v of App.D.ventes || []) { byRef.set(norm(v.numero), v); if (v.ref_externe) byRef.set(norm(v.ref_externe), v); }
    for (const r of rows) {
      const msgs = []; const v = byRef.get(norm(r.reference_vente));
      if (!v) msgs.push(`Vente « ${r.reference_vente} » introuvable (n° ERP ou référence d’import)`);
      else if (v.mode !== 'credit') msgs.push('La vente référencée n’est pas à crédit');
      const d = toISO(r.date); if (!isDate(d)) msgs.push('Date invalide');
      const m = toNum(r.montant); if (!(m > 0)) msgs.push('Montant invalide');
      if (v && m > venteTotals(v, App.I).montant) msgs.push('Remboursement supérieur au montant de la vente');
      out.push({ ligne: r._ligne, statut: msgs.length ? 'rejet' : 'ok', msg: msgs.join(' ; '), payload: { ligne: r._ligne, data: { vente_id: v?.id, date: d, montant: m, mode: r.mode || null, reference: r.reference ? String(r.reference) : null, commentaire: 'Reprise historique' } }, apercu: `${r.reference_vente} · ${fmtN(m)} FCFA` });
    }
    return out;
  }
  if (type === 'stock_remises') {
    for (const r of rows) {
      const msgs = []; const data = { date: toISO(r.date), client_id: need(r, 'depositaire', R.client, 'Dépositaire', msgs), produit_id: need(r, 'produit', R.produit, 'Produit', msgs), quantite: toNum(r.quantite), valeur_unitaire: toNum(r.valeur_unitaire), document: r.document ? String(r.document) : null };
      if (!isDate(data.date)) msgs.push('Date invalide');
      if (!(data.quantite > 0)) msgs.push('Quantité invalide');
      out.push({ ligne: r._ligne, statut: msgs.length ? 'rejet' : 'ok', msg: msgs.join(' ; '), payload: { ligne: r._ligne, data }, apercu: `${nm.client(data.client_id)} · ${nm.produit(data.produit_id)} · ${data.quantite} ctn` });
    }
    return out;
  }
  if (type === 'depenses_agregees') {
    const ex = new Set((App.D.depenses || []).filter((d) => d.historique && d.statut !== 'annulee').map((d) => [d.mois, d.equipe_id, d.categorie_id, round2(d.montant)].join('|')));
    for (const r of rows) {
      const msgs = []; const data = { mois: toMonth(r.mois), equipe_id: need(r, 'equipe', R.equipe, 'Équipe', msgs), vehicule_id: need(r, 'vehicule', R.vehicule, 'Véhicule', msgs), categorie_id: need(r, 'categorie', R.categorie, 'Catégorie', msgs), montant: toNum(r.montant), description: r.commentaire ? String(r.commentaire) : null };
      if (!/^\d{4}-\d{2}$/.test(data.mois || '')) msgs.push('Mois invalide (AAAA-MM attendu)');
      if (!data.equipe_id) msgs.push('Équipe obligatoire');
      if (!data.categorie_id) msgs.push('Catégorie obligatoire');
      if (!(data.montant > 0)) msgs.push('Montant invalide');
      const dup = ex.has([data.mois, data.equipe_id, data.categorie_id, round2(data.montant)].join('|'));
      out.push({ ligne: r._ligne, statut: msgs.length ? 'rejet' : dup ? 'doublon' : 'ok', msg: msgs.join(' ; ') || (dup ? 'Montant déjà repris pour ce mois, cette équipe et cette catégorie' : ''), payload: { ligne: r._ligne, data }, apercu: `${data.mois} · ${nm.equipe(data.equipe_id)} · ${nm.categorie(data.categorie_id)} · ${fmtN(data.montant)}` });
    }
    return out;
  }
  return out;
}

export function renderReprise(root) {
  App.filters.reprise = App.filters.reprise || { type: 'ventes_comptant' };
  root.innerHTML = pageHead('Reprise des données historiques', 'Ordre conseillé : référentiels (produits, agents, marchés, clients), puis journaux (comptant, crédit, remboursements), stock confié et dépenses. Rien n’est supprimé automatiquement : doublons et anomalies vous sont soumis.') +
    `<article class="card"><div class="filters">
      <label class="ff"><span>Type de données</span><select id="rt">${Object.entries(TYPES).map(([k, t]) => `<option value="${k}" ${App.filters.reprise.type === k ? 'selected' : ''}>${t.l}</option>`).join('')}</select></label>
      <button class="btn sm ghost" id="tpl">${icon('download')} Télécharger le modèle</button>
      <label class="btn sm"><input type="file" id="rf" accept=".xlsx,.xls,.csv" hidden>${icon('upload')} Choisir le fichier Excel ou CSV</label></div>
      <p class="muted" id="cols"></p><div id="res"></div></article>
     <article class="card"><header><h3>Historique des reprises</h3></header><div id="hist"></div></article>`;
  const showCols = () => { const t = TYPES[$('#rt', root).value]; $('#cols', root).innerHTML = `Colonnes attendues (première ligne du fichier) : <code>${t.cols.join(' · ')}</code>. Les agents, marchés, clients et produits sont reconnus par leur code ou leur nom exact ; dates au format JJ/MM/AAAA.`; };
  $('#rt', root).addEventListener('change', (e) => { App.filters.reprise.type = e.target.value; showCols(); $('#res', root).innerHTML = ''; });
  showCols();
  $('#tpl', root).addEventListener('click', () => {
    const t = TYPES[$('#rt', root).value];
    if (!window.XLSX) return toast('Module Excel non chargé.', 'err');
    const ws = window.XLSX.utils.aoa_to_sheet([t.cols, t.ex]);
    ws['!cols'] = t.cols.map(() => ({ wch: 18 }));
    const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'Données');
    saveBlob(`modele_import_${$('#rt', root).value}.xlsx`, new Blob([window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  });
  $('#rf', root).addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    if (!window.XLSX) return toast('Module Excel non chargé.', 'err');
    const type = $('#rt', root).value;
    try {
      const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const ONGLET = { produits: 'produits', agents: 'agents', marches: 'marches', clients: 'clients', ventes_comptant: 'ventes_comptant', ventes_credit: 'ventes_credit', remboursements: 'remboursements', stock_remises: 'remises_stock', depenses_agregees: 'depenses_mensuelles' };
      const nomOnglet = wb.SheetNames.find((n) => norm(n) === ONGLET[type]) || wb.SheetNames.find((n) => !['lisez_moi', 'listes'].includes(norm(n))) || wb.SheetNames[0];
      if (wb.SheetNames.length > 1) toast(`Onglet lu : « ${nomOnglet} »`);
      const raw = window.XLSX.utils.sheet_to_json(wb.Sheets[nomOnglet], { defval: '', raw: true });
      const res = analyse(type, raw);
      drawRes(type, file.name, res);
    } catch (er) { toast('Lecture du fichier impossible : ' + er.message, 'err'); }
    e.target.value = '';
  });
  const drawRes = (type, fname, res) => {
    const c = { ok: res.filter((r) => r.statut === 'ok').length, doublon: res.filter((r) => r.statut === 'doublon').length, rejet: res.filter((r) => r.statut === 'rejet').length };
    const inc = new Set(res.filter((r) => r.statut === 'ok').map((_, i) => i));
    res.forEach((r, i) => { r.id = String(i); });
    const tbl = new Table({ title: `Rapport de contrôle ${fname}`, rows: res, pageSize: 20, sort: { k: 'statut', dir: 1 }, select: (r) => r.statut === 'doublon',
      cols: [{ k: 'ligne', l: 'Ligne(s)' }, { k: 'apercu', l: 'Aperçu', cls: 'wrap' }, { k: 'statut', l: 'Contrôle', v: (r) => ({ ok: 'Prête', doublon: 'Doublon potentiel', rejet: 'Rejetée' }[r.statut]), f: (r) => pill({ ok: 'Prête', doublon: 'Doublon potentiel', rejet: 'Rejetée' }[r.statut], { ok: 'ok', doublon: 'warn', rejet: 'crit' }[r.statut]) }, { k: 'msg', l: 'Détail', cls: 'wrap' }] });
    $('#res', root).innerHTML = `<div class="note"><b>${fname}</b> : ${c.ok} prête(s), ${c.doublon} doublon(s) potentiel(s) à arbitrer (cochez ceux à intégrer quand même), ${c.rejet} rejetée(s).</div><div id="rt2"></div>
      <div class="row-act"><button class="btn ghost" id="rep">Exporter le rapport</button><button class="btn primary" id="go" ${c.ok ? '' : 'disabled'}>Importer les lignes prêtes</button></div>`;
    tbl.onSel = (s) => { $('#go', root).disabled = !(c.ok + s.size); $('#go', root).textContent = `Importer ${c.ok + s.size} ligne(s)`; };
    tbl.mount($('#rt2', root)); tbl.onSel(tbl.sel);
    $('#rep', root).addEventListener('click', () => exportRows('xlsx', 'Rapport de migration', [{ k: 'ligne', l: 'Ligne' }, { k: 'apercu', l: 'Aperçu' }, { k: 'statut', l: 'Contrôle' }, { k: 'msg', l: 'Détail' }], res, `Fichier : ${fname}`));
    $('#go', root).addEventListener('click', (ev) => busy(ev.currentTarget, async () => {
      const chosen = res.filter((r) => r.statut === 'ok' || (r.statut === 'doublon' && tbl.sel.has(r.id)));
      try {
        const out = await App.act('import.run', { type, fichier: fname, rows: chosen.map((r) => r.payload), stats: { prets: c.ok, doublons: c.doublon, doublons_retenus: tbl.sel.size, rejets_controle: c.rejet }, rapport: res.filter((r) => r.statut !== 'ok').map((r) => ({ ligne: r.ligne, statut: r.statut, msg: r.msg })) });
        toast(`${out.integrees.length} ligne(s) intégrée(s)${out.refuses.length ? `, ${out.refuses.length} refusée(s) par le serveur` : ''}.`, out.refuses.length ? 'warn' : 'ok');
        if (out.refuses.length) $('#res', root).insertAdjacentHTML('afterbegin', `<div class="note warn"><b>Refus du serveur :</b><br>${out.refuses.slice(0, 20).map((r) => `Ligne ${r.ligne} : ${esc(r.erreur)}`).join('<br>')}</div>`);
      } catch (er) { toast(er.message, 'err'); }
    }));
    void inc;
  };
  new Table({ title: 'Reprises', rows: App.D.imports || [], pageSize: 10, sort: { k: 'created_at', dir: -1 }, empty: 'Aucune reprise effectuée.',
    cols: [{ k: 'created_at', l: 'Date', f: (r) => new Date(r.created_at).toLocaleString('fr-FR', { timeZone: 'Africa/Niamey' }) }, { k: 'type', l: 'Type', v: (r) => TYPES[r.type]?.l || r.type }, { k: 'fichier', l: 'Fichier' },
      { k: 'integ', l: 'Intégrées', num: 1, v: (r) => r.stats?.integrees ?? 0 }, { k: 'rej', l: 'Rejetées', num: 1, v: (r) => (r.stats?.rejets_controle ?? 0) + (r.stats?.rejetees_serveur ?? 0) },
      { k: 'dbl', l: 'Doublons signalés', num: 1, v: (r) => r.stats?.doublons ?? 0 }, { k: 'par', l: 'Par', v: (r) => nm.user(r.created_by) }] }).mount($('#hist', root));
  void $$;
}
