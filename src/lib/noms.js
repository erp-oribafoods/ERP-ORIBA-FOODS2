// Rapprochement des noms d'agents entre fichiers : « Mahfouz » (tableau de bord) = « Kamel Alalla Mahfouze » (liste officielle).
export const cleNom = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const mots = (s) => cleNom(s).split(' ').filter((w) => w.length >= 3);

// Vrai si chaque mot du nom le plus court commence un mot du nom le plus long (au moins 4 lettres en commun)
export function nomsProches(a, b) {
  const A = mots(a), B = mots(b);
  if (!A.length || !B.length) return false;
  const [court, long] = A.length <= B.length ? [A, B] : [B, A];
  return court.every((w) => long.some((x) => (x.startsWith(w) || w.startsWith(x)) && Math.min(w.length, x.length) >= 4));
}

// Agent d'une équipe : nom exact d'abord, puis nom proche s'il n'y a qu'un seul candidat dans l'équipe
export function trouverAgent(nom, agents, equipeId) {
  const k = cleNom(nom);
  if (!k) return null;
  const exacts = agents.filter((a) => cleNom(a.nom) === k);
  const ex = exacts.find((a) => a.equipe_id === equipeId) || (exacts.length === 1 ? exacts[0] : null);
  if (ex) return ex;
  if (!equipeId) return null;
  const proches = agents.filter((a) => a.equipe_id === equipeId && nomsProches(a.nom, nom));
  return proches.length === 1 ? proches[0] : null;
}
