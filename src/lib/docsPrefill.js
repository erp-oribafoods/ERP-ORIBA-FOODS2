// Pré-remplissage des documents administratifs à partir des données saisies dans l'ERP.
import { App, nm } from '../app.js';
import { contexte, situationDepots, creditsCircuit, grossistesSemaine, lundi } from './circuit.js';
import { creditInfo, venteTotals, num, round2, addDays } from '../../shared/logic.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const jj = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const moisTxt = (d) => `${MOIS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const semaineTxt = (d) => { const l = lundi(d); return `${jj(l)} au ${jj(addDays(l, 6))}`; };
const r0 = (x) => Math.round(num(x));

// ---------- Montant en lettres ----------
const U = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize'];
const D10 = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
function sous100(n) {
  if (n <= 16) return U[n];
  if (n < 20) return 'dix-' + U[n - 10];
  if (n < 70) { const d = Math.floor(n / 10), u = n % 10; return D10[d] + (u === 0 ? '' : u === 1 ? ' et un' : '-' + U[u]); }
  if (n < 80) return 'soixante' + (n === 71 ? ' et onze' : '-' + sous100(n - 60));
  const u = n - 80; return u === 0 ? 'quatre-vingts' : 'quatre-vingt-' + sous100(u);
}
function sous1000(n) {
  const c = Math.floor(n / 100), r = n % 100;
  const cs = c === 0 ? '' : c === 1 ? 'cent' : U[c] + (r === 0 ? ' cents' : ' cent');
  return [cs, r ? sous100(r) : ''].filter(Boolean).join(' ');
}
export function enLettres(montant) {
  let n = Math.round(Math.abs(num(montant)));
  if (n === 0) return 'zéro franc CFA';
  const parts = [];
  const md = Math.floor(n / 1e9); n %= 1e9;
  const mi = Math.floor(n / 1e6); n %= 1e6;
  const k = Math.floor(n / 1000); n %= 1000;
  if (md) parts.push(sous1000(md) + (md > 1 ? ' milliards' : ' milliard'));
  if (mi) parts.push(sous1000(mi) + (mi > 1 ? ' millions' : ' million'));
  if (k) parts.push(k === 1 ? 'mille' : sous1000(k).replace(/cents$/, 'cent') + ' mille');
  if (n) parts.push(sous1000(n));
  const t = parts.join(' ');
  return t.charAt(0).toUpperCase() + t.slice(1) + ' francs CFA';
}

// ---------- Dépôts ----------
export const depots = () => (App.D.agents || []).filter((a) => a.role_circuit === 'depot' && a.actif !== false).sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr'));
export const depotDe = (agentId) => { const a = App.I.agents.get(agentId); return !a ? null : a.role_circuit === 'depot' ? a.id : a.depot_id || null; };
export const libDepot = (id) => { const a = App.I.agents.get(id); if (!a) return ''; return [a.code, a.nom].filter(Boolean).join(' — ') + (a.responsable ? ` (${a.responsable})` : ''); };
const reseau = (depotId) => new Set([depotId, ...(App.D.agents || []).filter((a) => a.depot_id === depotId).map((a) => a.id)]);
const nomAgent = (id) => App.I.agents.get(id)?.nom || '';
const produit = (id) => App.I.produits.get(id)?.nom || 'Cartons';

// ---------- Pièces liées : liste des enregistrements à choisir selon le type de document ----------
const SRC_LIEN = {
  vente_credit: 'ventes', credit: 'ventes', remboursement: 'remboursements', versement: 'versements', versement_grossiste: 'versements',
  prise: 'circuit_mvts', appro: 'circuit_mvts', dispatch: 'circuit_mvts', grossiste: 'grossistes', vehicule: 'vehicules',
};
export const lienTable = (def) => SRC_LIEN[def.src] || null;

export function piecesLiees(def, depotId) {
  const D = App.D, I = App.I, net = depotId ? reseau(depotId) : null;
  const okAgent = (id) => !net || net.has(id);
  const tri = (l) => l.sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 300);
  switch (def.src) {
    case 'vente_credit': case 'credit': {
      const asOf = App.serverDate;
      return tri((D.ventes || []).filter((v) => v.mode === 'credit' && v.statut === 'validee' && okAgent(v.agent_id)).map((v) => {
        const ci = creditInfo(v, I, asOf);
        if (def.src === 'credit' && ci.solde <= 0) return null;
        return { id: v.id, date: v.date, l: `${v.numero || ''} · ${jj(v.date)} · ${nm.client(v.client_id)} · ${ci.montant.toLocaleString('fr-FR')} F${def.src === 'credit' ? ` · reste ${ci.solde.toLocaleString('fr-FR')} F${ci.joursRetard ? ` · ${ci.joursRetard} j de retard` : ''}` : ''}` };
      }).filter(Boolean));
    }
    case 'remboursement':
      return tri((D.remboursements || []).filter((r) => r.statut === 'valide' && okAgent(I.ventes.get(r.vente_id)?.agent_id)).map((r) => ({ id: r.id, date: r.date, l: `${r.numero || ''} · ${jj(r.date)} · ${nm.client(I.ventes.get(r.vente_id)?.client_id)} · ${num(r.montant).toLocaleString('fr-FR')} F` })));
    case 'versement': case 'versement_grossiste': {
      const obj = def.src === 'versement' ? 'ventes_comptant' : 'reglement_grossiste';
      return tri((D.versements || []).filter((v) => v.statut !== 'annule' && v.objet === obj && (obj !== 'ventes_comptant' || okAgent(v.agent_id))).map((v) => ({ id: v.id, date: v.date, l: `${v.numero || ''} · ${jj(v.date)} · ${obj === 'ventes_comptant' ? nomAgent(v.agent_id) : nm.grossiste(v.grossiste_id)} · ${num(v.montant).toLocaleString('fr-FR')} F${v.beneficiaire ? ' · ' + v.beneficiaire : ''}` })));
    }
    case 'prise': case 'appro': case 'dispatch':
      return tri((D.circuit_mvts || []).filter((m) => m.statut !== 'annule' && m.type === def.src && (def.src === 'appro' || okAgent(m.agent_id))).map((m) => ({ id: m.id, date: m.date,
        l: `${m.numero || ''} · ${jj(m.date)} · ${def.src === 'appro' ? nm.grossiste(m.grossiste_id) : def.src === 'dispatch' ? `${nomAgent(m.agent_id)} → ${nomAgent(m.sous_agent_id)}` : `${nomAgent(m.agent_id)} ← ${m.grossiste_id ? nm.grossiste(m.grossiste_id) : m.fournisseur || 'Oriba Food'}`} · ${num(m.cartons)} ctn` })));
    case 'grossiste':
      return (D.grossistes || []).filter((g) => g.actif !== false).map((g) => ({ id: g.id, l: [g.code, g.nom, g.localite].filter(Boolean).join(' · ') }));
    case 'vehicule':
      return (D.vehicules || []).filter((v) => v.actif !== false).map((v) => ({ id: v.id, l: [v.immatriculation, v.modele, v.conducteur].filter(Boolean).join(' · ') }));
    default: return null;
  }
}

// ---------- Contenu pré-rempli ----------
// Renvoie { champs, lignes, depot } ; « depot » sert quand la pièce liée détermine l'équipe.
export function preremplir(def, { depotId, date, lienId }) {
  const D = App.D, I = App.I, champs = {}, lignes = [];
  let depot = depotId || null;
  if (date) {
    champs['Mois'] = champs['Mois inventorié'] = champs['Mois évalué'] = moisTxt(date);
    champs['Semaine du … au …'] = semaineTxt(date); champs['Semaine du'] = jj(lundi(date)); champs['Mise à jour du'] = jj(date); champs['Période'] = moisTxt(date);
  }
  const ctx = () => contexte(D, I);
  const lien = lienId && lienTable(def) ? (D[lienTable(def)] || []).find((r) => r.id === lienId) : null;

  switch (def.src) {
    case 'vente_credit': case 'credit': {
      if (!lien) break;
      const v = lien, c = I.clients.get(v.client_id), ci = creditInfo(v, I, date || App.serverDate), t = venteTotals(v, I);
      depot = depotDe(v.agent_id) || depot;
      Object.assign(champs, {
        Agent: nomAgent(v.agent_id), 'Client (nom)': c?.nom, Client: c?.nom, 'Téléphone du client': c?.telephone, 'Marché': nm.marche(v.marche_id || c?.marche_id).replace('—', ''),
        'Montant en chiffres (FCFA)': ci.montant, 'Montant en lettres': enLettres(ci.montant), 'Date promise de paiement (30 jours au plus)': jj(v.echeance),
        'N° du bon de crédit': v.numero, 'Échéance initiale': jj(v.echeance), 'Échéance': jj(v.echeance), 'Montant restant dû (FCFA)': ci.solde, 'Montant dû (FCFA)': ci.solde,
        'Jours de retard': ci.joursRetard || '', 'Montant initial (FCFA)': ci.montant, 'Montant remboursé (FCFA)': ci.rembourse, 'Reste dû (FCFA)': ci.solde,
      });
      if (c?.plafond_cartons) {
        const pris = (D.ventes || []).filter((x) => x.client_id === c.id && x.mode === 'credit' && x.statut === 'validee').reduce((s, x) => s + num(creditInfo(x, I, date || App.serverDate).cartonsRestants), 0);
        champs['Plafond restant du client (cartons)'] = round2(num(c.plafond_cartons) - pris);
      }
      lignes[0] = t.lignes.map((l) => [produit(l.produit_id), `${num(l.quantite)} ${l.unite === 'pack' ? 'pack(s)' : 'carton(s)'}`, num(l.prix), num(l.montant)]);
      const rel = (I.relancesByVente.get(v.id) || []).slice().sort((a, b) => String(a.date || a.created_at).localeCompare(String(b.date || b.created_at)));
      if (def.code === 'DCL') lignes[0] = rel.map((r) => [jj(r.date || r.created_at), r.canal || r.moyen || '', nm.user(r.created_by), r.commentaire || r.resultat || '']);
      break;
    }
    case 'remboursement': {
      if (!lien) break;
      const r = lien, v = I.ventes.get(r.vente_id); if (!v) break;
      depot = depotDe(v.agent_id) || depot;
      const ci = creditInfo(v, I, r.date);
      Object.assign(champs, { Client: nm.client(v.client_id), 'N° du bon de crédit / de la vente': v.numero, 'Montant en chiffres (FCFA)': num(r.montant), 'Montant en lettres': enLettres(r.montant), 'Mode de paiement': r.mode || 'Espèces', 'Reste dû après ce paiement (FCFA)': ci.solde });
      break;
    }
    case 'versement': {
      if (!lien) break;
      const v = lien; depot = depotDe(v.agent_id) || depot;
      Object.assign(champs, { Caisse: v.beneficiaire || '', 'Période couverte': jj(v.date), 'Montant des ventes au comptant (FCFA)': num(v.montant), 'Total en chiffres (FCFA)': num(v.montant), 'Total en lettres': enLettres(v.montant) });
      break;
    }
    case 'versement_grossiste': {
      if (!lien) break;
      const v = lien;
      Object.assign(champs, { Grossiste: nm.grossiste(v.grossiste_id), Caisse: v.beneficiaire || '', 'Montant en chiffres (FCFA)': num(v.montant), 'Montant en lettres': enLettres(v.montant), 'Référence': v.reference || v.numero || '' });
      break;
    }
    case 'prise': {
      if (!lien) break;
      const m = lien; depot = m.agent_id || depot;
      Object.assign(champs, { 'Cédant': m.grossiste_id ? 'Grossiste' : m.fournisseur || 'Oriba Food', 'Nom du grossiste (si grossiste)': m.grossiste_id ? nm.grossiste(m.grossiste_id) : '' });
      lignes[0] = [[produit(m.produit_id), 'Carton', '', num(m.cartons), m.observation || '']];
      break;
    }
    case 'appro': {
      if (!lien) break;
      const m = lien;
      Object.assign(champs, { Grossiste: nm.grossiste(m.grossiste_id), 'Source des cartons': m.fournisseur || 'Oriba Food', 'Mode de paiement': m.mode === 'credit' ? 'Crédit' : 'Comptant' });
      lignes[0] = [[produit(m.produit_id), num(m.cartons), num(m.prix) || '', num(m.montant) || '']];
      break;
    }
    case 'dispatch': {
      if (!lien) break;
      const m = lien, sa = I.agents.get(m.sous_agent_id); depot = m.agent_id || depot;
      Object.assign(champs, { Agent: sa?.nom, 'Marché / point de vente': sa?.marche_id ? nm.marche(sa.marche_id) : '' });
      lignes[0] = [[produit(m.produit_id), 'Carton', num(m.cartons), '', '', '']];
      break;
    }
    case 'journee': case 'semaine': {
      if (!depot || !date) break;
      const C = ctx();
      const du = def.src === 'semaine' ? lundi(date) : date;
      const s = situationDepots(C, du, date).find((x) => x.id === depot); if (!s) break;
      if (def.code === 'FJD') {
        lignes[0] = [['Stock de début (cartons)', r0(s.siTotal ?? s.si)], ['Cartons pris chez Oriba Food', s.recuFoods], ['Cartons pris chez Oriba Rice', s.recuRice], ['Cartons pris chez un grossiste', s.recuGross], ['Cartons remis aux agents', s.disp],
          ['Cartons vendus au comptant', s.vcReseau], ['Cartons vendus à crédit', s.vkReseau], ['Stock de fin (cartons)', r0(s.stockTotal ?? s.sf)], ['Argent à verser à Oriba Food (FCFA)', r0(s.aVerserFood)], ['Argent à verser à Oriba Rice (FCFA)', r0(s.aVerserRice)],
          ['Argent versé (FCFA)', r0(s.verse)], ['Remboursements encaissés (FCFA)', r0(s.remb)]];
        const net = reseau(depot);
        champs['Numéros des pièces du jour'] = [...(D.circuit_mvts || []).filter((m) => m.statut !== 'annule' && m.date === date && (net.has(m.agent_id))).map((m) => m.numero), ...(D.versements || []).filter((v) => v.statut !== 'annule' && v.date === date && net.has(v.agent_id)).map((v) => v.numero)].filter(Boolean).join(', ');
      } else {
        const credits = creditsCircuit(C, date, { tous: true }).filter((c) => reseau(depot).has(c.agent_id) && c.date >= du && c.date <= date);
        lignes[0] = [['Stock de début (cartons)', r0(s.siTotal ?? s.si)], ['Cartons reçus', round2(s.recu)], ['Cartons remis aux agents', s.disp], ['Cartons vendus', s.venduReseau], ['Stock de fin (cartons)', r0(s.stockTotal ?? s.sf)],
          ['Argent à verser (FCFA)', r0(s.aVerser)], ['Argent versé (FCFA)', r0(s.verse)], ['Crédits accordés (FCFA)', r0(credits.reduce((a, c) => a + c.montant, 0))], ['Remboursements (FCFA)', r0(s.remb)]];
      }
      break;
    }
    case 'creances': {
      const C = ctx(), d = date || App.serverDate;
      const l = creditsCircuit(C, d, { tous: true }).filter((c) => !depot || reseau(depot).has(c.agent_id)).sort((a, b) => b.joursRetard - a.joursRetard || b.solde - a.solde);
      lignes[0] = l.map((c) => [nm.client(c.client_id), nomAgent(c.agent_id), c.montant, c.rembourse, c.solde, jj(c.echeance), c.joursRetard || '', c.statut]);
      champs['Total encours (FCFA)'] = round2(l.reduce((a, c) => a + c.solde, 0));
      champs['Total en retard (FCFA)'] = round2(l.filter((c) => c.statut === 'En retard').reduce((a, c) => a + c.solde, 0));
      break;
    }
    case 'objectifs': {
      const mois = (date || App.serverDate).slice(0, 7);
      lignes[0] = (D.objectifs || []).filter((o) => o.actif !== false && o.mois === mois && !o.produit_id && ['agent', 'equipe'].includes(o.axe))
        .map((o) => [o.axe === 'agent' ? nomAgent(o.cible_id) : nm.equipe(o.cible_id), o.axe === 'agent' ? (I.agents.get(o.cible_id)?.role_circuit === 'depot' ? 'Chef d’équipe (dépôt)' : 'Agent') : 'Équipe', num(o.objectif_cartons), ''])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'fr'));
      break;
    }
    case 'agents': case 'agents_stock': {
      if (!depot) break;
      const ag = [I.agents.get(depot), ...(D.agents || []).filter((a) => a.depot_id === depot && a.actif !== false)].filter(Boolean);
      if (def.src === 'agents') lignes[0] = ag.map((a) => [a.nom, a.marche_id ? nm.marche(a.marche_id) : '']);
      else {
        const s = date ? situationDepots(ctx(), date).find((x) => x.id === depot) : null;
        lignes[0] = [[`Dépôt — ${I.agents.get(depot)?.nom || ''}`, 'Tous produits', s ? r0(s.sf) : '', '', '', ''], ...(s?.sousAgents || []).map((x) => [x.nom, 'Tous produits', r0(x.sf), '', '', ''])];
      }
      break;
    }
    case 'clients': {
      const asOf = date || App.serverDate, delai = num(I.p.delai_paiement_jours) || 30;
      lignes[0] = (D.clients || []).filter((c) => c.actif !== false && num(c.plafond_cartons) > 0).sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr')).map((c) => {
        const retard = (D.ventes || []).some((v) => v.client_id === c.id && v.mode === 'credit' && v.statut === 'validee' && creditInfo(v, I, asOf).joursRetard > 7);
        return [c.nom, c.telephone || '', c.marche_id ? nm.marche(c.marche_id) : '', num(c.plafond_cartons), delai, retard ? 'Bloqué' : 'Autorisé', ''];
      });
      break;
    }
    case 'grossiste': {
      if (!lien || !date) break;
      const g = grossistesSemaine(ctx(), lundi(date)).find((x) => x.id === lien.id); champs.Grossiste = lien.nom;
      if (g) {
        lignes[0] = [['Tous produits (cartons)', g.si, g.usine, g.rice, g.pc, g.pk, g.sf]];
        Object.assign(champs, { 'Montant payé sur la semaine (FCFA)': g.regleSemaine, 'Solde dû à Oriba Food (FCFA)': g.soldeFood, 'Solde dû à Oriba Rice (FCFA)': g.soldeRice });
      }
      break;
    }
    case 'vehicule': {
      if (!lien) break;
      Object.assign(champs, { 'Véhicule (immatriculation)': [lien.immatriculation, lien.modele].filter(Boolean).join(' — '), Chauffeur: lien.conducteur || '' });
      break;
    }
    default: break;
  }
  for (const k of Object.keys(champs)) if (champs[k] === undefined || champs[k] === null) delete champs[k];
  return { champs, lignes, depot };
}
