// Démonstration : le circuit de distribution chargé avec la simulation validée (semaine du 26/10 au 01/11/2026).
// Les identifiants de ligne sont calculés comme à l'import : réimporter le classeur de simulation n'ajoute rien.
import { handle } from '../shared/core.js';
import SIM from './demo-circuit.js';
import { K, generateurCles } from './lib/circuitRefs.js';

export async function seedCircuit(db, C, state) {
  const call = (a, p) => handle(db, a, p, C);
  const ref = async (table, row) => (await call('ref.save', { table, row })).row;
  const imp = (type, fichier, rows) => (rows.length ? call('import.run', { type, mode: 'courant', fichier, rows }) : null);
  const F = 'ERP_ORIBA_Simulation_circuit_grossistes_agents.xlsx';
  // Produits du circuit
  const prod = {};
  for (const [nom, prix] of SIM.produits) prod[nom] = (state.produits.find((p) => p.nom === nom)) || await ref('produits', { code: nom.includes('Poulet') ? 'DADI-POULET' : 'DADI-EPICE', nom, gamme: 'DADI', packs_par_carton: 12, prix_ref: prix });
  // Zones / équipes manquantes (Niamey 3, Agadez)
  const zone = (n) => state.zones.find((z) => z.nom === n);
  for (const [code, nom, z] of [['NY3', 'Niamey 3', 'Niamey'], ['AGA', 'Agadez', 'Agadez']]) if (!state.equipes.some((e) => e.nom === nom)) await ref('equipes', { code, nom, zone_id: zone(z)?.id || null });
  const eq = (nom) => state.equipes.find((e) => e.nom === nom);
  await call('circuit.depart', { date: SIM.depart });
  // Référentiels
  const G = {}, A = {}, CL = {};
  for (const [code, nom, localite, fournisseur, telephone, stock, solde] of SIM.grossistes) G[code] = (await ref('grossistes', { code, nom, localite, fournisseur, telephone, stock_initial: stock, solde_initial: solde })).id;
  for (const [code, , z, , telephone, stock] of SIM.depots) { const e = eq(z); A[code] = (await ref('agents', { code, nom: `Dépôt ${z}`, equipe_id: e.id, zone_id: e.zone_id, telephone, role_circuit: 'depot', stock_initial: stock, fonction: 'Dépôt', prix_carton: /Konni/.test(z) ? 14000 : /Tahoua/.test(z) ? 13000 : 13250 })).id; }
  for (const [code, nom, dep, , telephone, stock] of SIM.sous) { const d = state.agents.find((a) => a.id === A[dep]); A[code] = (await ref('agents', { code, nom, equipe_id: d.equipe_id, zone_id: d.zone_id, telephone, role_circuit: 'sous_agent', depot_id: d.id, stock_initial: stock, fonction: 'Agent commercial' })).id; }
  for (const [code, nom, , , telephone, plafond] of SIM.clients) CL[code] = (await ref('clients', { code, nom, type: code === 'CL000' ? 'Détaillant' : 'Boutique', telephone: telephone || null, plafond_cartons: plafond || null })).id;
  // Journaux (mêmes clés que l'import du classeur)
  const cle = generateurCles();
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const ligne = (i) => i + 5;
  await imp('circuit_appro', `${F} — 1-Appro grossistes`, SIM.appro.map(([d, g, f, p, q, prix], i) => ({ ligne: ligne(i), data: { date: d, grossiste_id: G[g], fournisseur: f, produit_id: prod[p].id, cartons: q, prix, ref_externe: cle(['A', d, K(g), K(f), K(p), q, num(prix) ?? '']) } })));
  await imp('circuit_prise', `${F} — 2-Prises agents`, SIM.prise.map(([d, a, g, p, q, prix, mode], i) => ({ ligne: ligne(i), data: { date: d, agent_id: A[a], grossiste_id: G[g], produit_id: prod[p].id, cartons: q, prix, mode, ref_externe: cle(['P', d, K(a), K(g), K(p), q, num(prix) ?? '', K(mode)]) } })));
  await imp('circuit_dispatch', `${F} — 3-Dispatch`, SIM.dispatch.map(([d, a, s, p, q], i) => ({ ligne: ligne(i), data: { date: d, agent_id: A[a], sous_agent_id: A[s], produit_id: prod[p].id, cartons: q, ref_externe: cle(['D', d, K(a), K(s), K(p), q]) } })));
  const venteRef = new Map(), parMode = { comptant: [], credit: [] };
  SIM.ventes.forEach(([d, v, c, p, q, prix, mode, ech, numero], i) => {
    const credit = /cr[ée]d/i.test(mode);
    const r = cle(['V', d, K(v), K(c), K(p), q, num(prix), credit ? 'K' : 'C']);
    venteRef.set(K(numero), r);
    parMode[credit ? 'credit' : 'comptant'].push({ ligne: ligne(i), data: { date: d, agent_id: A[v], marche_id: null, client_id: c ? CL[c] : null, echeance: credit ? ech : null, ref_externe: r }, lignes: [{ produit_id: prod[p].id, unite: 'carton', quantite: q, prix_unitaire: prix }] });
  });
  await imp('ventes_comptant', `${F} — 4-Ventes`, parMode.comptant);
  await imp('ventes_credit', `${F} — 4-Ventes`, parMode.credit);
  const vers = [], rembs = [];
  SIM.versements.forEach(([d, par, objet, numero, lieu, g, m], i) => {
    const lieuG = /grossiste/i.test(lieu || '');
    const ob = K(objet);
    if (ob.startsWith('rembours')) {
      const vref = venteRef.get(K(numero));
      rembs.push({ ligne: ligne(i), vref, data: { date: d, montant: m, mode: 'Espèces', reference: cle(['R', d, K(par), vref || K(numero), m]), commentaire: `Classeur du circuit — vente ${numero}`, lieu: lieuG ? 'grossiste' : 'caisse', lieu_grossiste_id: lieuG ? G[g] : null, verse_par: A[par] || null } });
    } else {
      const regl = ob.startsWith('reglement');
      vers.push({ ligne: ligne(i), data: { date: d, montant: m, objet: regl ? 'reglement_grossiste' : 'ventes_comptant', ...(regl ? { grossiste_id: G[par] } : { agent_id: A[par] }), lieu: lieuG ? 'grossiste' : 'caisse', lieu_grossiste_id: lieuG ? G[g] : null, ref_externe: cle(['S', d, K(par), regl ? 'G' : 'C', lieuG ? K(g) : 'caisse', m]) } });
    }
  });
  await imp('versements', `${F} — 5-Versements`, vers);
  const parRef = new Map(state.ventes.filter((v) => v.ref_externe).map((v) => [v.ref_externe, v.id]));
  await imp('remboursements', `${F} — 5-Versements (remboursements)`, rembs.map(({ ligne: l, vref, data }) => ({ ligne: l, data: { ...data, vente_id: parRef.get(vref) } })));
}
