// Identifiant stable d'une ligne du classeur du circuit (même contenu = même identifiant, d'un jour à l'autre).
// Partagé par l'import et par la démonstration.
import { cleNom } from './noms.js';

export const K = (s) => cleNom(s).replace(/ /g, '_');
export function generateurCles() {
  const occ = new Map();
  return (parts) => { const b = ['CIRC', ...parts].join('|'); const n = (occ.get(b) || 0) + 1; occ.set(b, n); return `${b}#${n}`; };
}
