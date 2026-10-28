# ORIBA FOODS — ERP Gestion Commerciale & Force de Vente (V1)

Application web sécurisée, multi-utilisateurs et traçable : ventes au comptant et à crédit, remboursements, créances et plafond, stock confié, dépenses de la force de vente (circuit de validation, budgets, clôture), tableaux de bord, exports Excel / CSV / PDF, reprise des données historiques, journal d'audit.

## Architecture

| Élément | Technologie | Emplacement |
|---|---|---|
| Interface (navigateur, ordinateur / tablette / téléphone) | HTML + JavaScript, graphiques Chart.js | `src/` → construit dans `public/` |
| Serveur (contrôle des droits, règles de gestion, audit) | Netlify Functions (Node.js) | `netlify/functions/api.mts`, `shared/core.js` |
| Base de données relationnelle | Netlify Database (PostgreSQL) | `netlify/database/migrations/` |
| Justificatifs (photos, PDF) | Netlify Blobs, magasin privé `justificatifs` | — |

Toutes les opérations passent par une seule route `POST /api` ; chaque appel vérifie le jeton de session, le statut du compte, le rôle et le périmètre **côté serveur**. Les montants, soldes, statuts et alertes sont calculés par `shared/logic.js` (même code côté serveur et côté écran).

Sécurité : mots de passe hachés (bcrypt), jetons signés (HS256, 10 h), verrouillage 15 min après 5 échecs, déconnexion après inactivité (paramétrable), révocation immédiate des sessions à la désactivation d'un compte ou au changement de rôle, journal d'audit non modifiable (déclencheur en base), suppression physique des opérations interdite (déclencheurs en base), HTTPS fourni par Netlify.

## Mise en service

1. Projet Netlify relié à ce dépôt (branche `erp-gestion-commerciale`). Paramètres de build : dossier de base vide, commande `echo 'Site pré-construit'`, dossier publié `public` (lus dans `netlify.toml`).
2. Variable d'environnement obligatoire (portée *Functions*) : `JWT_SECRET` = chaîne aléatoire d'au moins 48 caractères. Ne jamais la publier.
3. Au premier déploiement, Netlify crée la base PostgreSQL et applique la migration `20261028100000_schema_initial.sql` (tables, déclencheurs, rôles, paramètres, équipes, marchés de Niamey, catégories de dépenses).
4. Ouvrir le site : l'écran « Première mise en service » crée le compte **Administrateur ERP**. Celui-ci crée ensuite les comptes DG, Responsable Commercial, Contrôleur de Gestion, DAF (mot de passe initial à changer à la première connexion).

## Mises à jour

- Modifier les fichiers dans `src/` ou `shared/`, puis `npm install && npm run build` (régénère `public/`) et pousser sur la branche : Netlify redéploie automatiquement.
- Toute évolution de la base se fait par une **nouvelle** migration datée dans `netlify/database/migrations/` (ne jamais modifier une migration déjà appliquée).

## Sauvegarde et restauration

- Netlify Database : instantanés (*snapshots*) depuis l'interface Netlify, *Data & Storage > Database*. Planifier un instantané au moins hebdomadaire et avant chaque clôture mensuelle ; tester une restauration sur un environnement de test.
- Exports métier : chaque liste s'exporte en Excel/CSV/PDF ; le journal d'audit est consultable et exportable.
- Justificatifs : stockés dans Netlify Blobs (magasin `justificatifs`), inclus dans le compte Netlify.

## Recette automatisée

```bash
npm install && npm install --no-save @netlify/database-dev
node tests/recette.mjs pg      # sur PostgreSQL local (REC-01 à REC-12, DEP-REC)
node tests/recette.mjs memory  # sur base mémoire
```

## Démonstration

`node scripts/build.mjs` produit aussi `dist/demo.html` : la même application avec des données fictives stockées dans le navigateur (comptes `admin`, `dg`, `commercial`, `cdg`, `daf`, `superviseur`, mot de passe `Demo2026`).
