// Définitions partagées (serveur + navigateur) : tables, champs, modules, rôles et paramètres par défaut.

export const MODULES = [
  { k: 'dashboard', l: 'Tableau de bord', a: ['lire'] },
  { k: 'ventes', l: 'Ventes (comptant & crédit)', a: ['lire', 'creer', 'modifier', 'annuler', 'exporter'] },
  { k: 'remboursements', l: 'Remboursements', a: ['lire', 'creer', 'annuler', 'exporter'] },
  { k: 'creances', l: 'Créances & relances', a: ['lire', 'creer', 'exporter'] },
  { k: 'stock', l: 'Stock confié', a: ['lire', 'creer', 'annuler', 'exporter'] },
  { k: 'depenses', l: 'Dépenses commerciales', a: ['lire', 'creer', 'modifier', 'controler', 'valider', 'annuler', 'exporter'] },
  { k: 'salaires', l: 'Détail des dépenses sensibles (salaires)', a: ['lire'] },
  { k: 'budgets', l: 'Budgets de dépenses', a: ['lire', 'modifier'] },
  { k: 'cloture', l: 'Clôture mensuelle', a: ['lire', 'modifier'] },
  { k: 'referentiels', l: 'Référentiels', a: ['lire', 'modifier'] },
  { k: 'parametres', l: 'Paramètres', a: ['lire', 'modifier'] },
  { k: 'utilisateurs', l: 'Utilisateurs & rôles', a: ['lire', 'modifier'] },
  { k: 'import', l: 'Reprise de données', a: ['creer'] },
  { k: 'audit', l: "Journal d'audit & anomalies", a: ['lire', 'creer'] },
];

export const ACTION_LABELS = {
  lire: 'Consulter', creer: 'Créer', modifier: 'Modifier', annuler: 'Annuler',
  exporter: 'Exporter', controler: 'Contrôler', valider: 'Valider',
};

const all = (m) => MODULES.find((x) => x.k === m).a;

export const DEFAULT_ROLES = [
  {
    nom: 'Direction Générale (DG)',
    description: 'Lecture globale, alertes, rapports. Validation exceptionnelle des dépenses.',
    permissions: {
      dashboard: ['lire'], ventes: ['lire', 'exporter'], remboursements: ['lire', 'exporter'],
      creances: ['lire', 'exporter'], stock: ['lire', 'exporter'], depenses: ['lire', 'valider', 'exporter'],
      salaires: ['lire'], budgets: ['lire', 'modifier'], cloture: ['lire'], referentiels: ['lire'],
      parametres: ['lire'], audit: ['lire', 'creer'],
    },
  },
  {
    nom: 'Responsable Commercial & Force de Vente',
    description: 'Seul profil autorisé à créer, corriger et annuler les ventes et remboursements.',
    permissions: {
      dashboard: ['lire'], ventes: all('ventes'), remboursements: all('remboursements'),
      creances: all('creances'), stock: all('stock'),
      depenses: ['lire', 'creer', 'modifier', 'controler', 'exporter'], budgets: ['lire'],
      cloture: ['lire'], referentiels: ['lire', 'modifier'], parametres: ['lire'], import: ['creer'],
    },
  },
  {
    nom: 'Contrôleur de Gestion',
    description: 'Analyse, rapprochements, exports, audit et signalement des anomalies.',
    permissions: {
      dashboard: ['lire'], ventes: ['lire', 'exporter'], remboursements: ['lire', 'exporter'],
      creances: ['lire', 'exporter'], stock: ['lire', 'exporter'], depenses: ['lire', 'exporter'],
      budgets: ['lire'], cloture: ['lire'], referentiels: ['lire'], parametres: ['lire'], audit: ['lire', 'creer'],
    },
  },
  {
    nom: 'DAF',
    description: 'Contrôle financier, validation des dépenses, clôture mensuelle, paramètres financiers.',
    permissions: {
      dashboard: ['lire'], ventes: ['lire', 'exporter'], remboursements: ['lire', 'exporter'],
      creances: ['lire', 'exporter'], stock: ['lire', 'exporter'],
      depenses: ['lire', 'valider', 'annuler', 'exporter'], salaires: ['lire'], budgets: ['lire', 'modifier'],
      cloture: ['lire', 'modifier'], referentiels: ['lire'], parametres: ['lire', 'modifier'], audit: ['lire', 'creer'],
    },
  },
  {
    nom: 'Administrateur ERP',
    description: 'Comptes, rôles, référentiels et paramètres. Aucune validation financière.',
    permissions: {
      dashboard: ['lire'], referentiels: ['lire', 'modifier'], parametres: ['lire', 'modifier'],
      utilisateurs: ['lire', 'modifier'], import: ['creer'], audit: ['lire'],
    },
  },
  {
    nom: "Superviseur / Responsable d'équipe",
    description: "Saisie et contrôle des dépenses de son équipe (périmètre à définir sur le compte).",
    permissions: {
      dashboard: ['lire'], depenses: ['lire', 'creer', 'modifier', 'controler'], referentiels: ['lire'], cloture: ['lire'],
    },
  },
];

export const DEFAULT_PARAMS = {
  plafond_cartons_client: 1000,
  seuils_plafond: [75, 90, 100],
  blocage_credit_depassement: false,
  delai_paiement_jours: 30,
  tolerance_solde_fcfa: 0,
  jours_alerte_echeance: 3,
  jours_creance_ancienne: 90,
  jours_stock_dormant: 30,
  seuils_budget: [75, 90, 100],
  seuil_depense_elevee: 500000,
  jours_saisie_tardive: 15,
  delai_session_min: 30,
};

export const PARAM_DEFS = [
  { k: 'plafond_cartons_client', l: 'Plafond de créances par client (cartons)', t: 'number', g: 'Créances' },
  { k: 'seuils_plafond', l: "Seuils d'alerte du plafond (%)", t: 'list', g: 'Créances' },
  { k: 'blocage_credit_depassement', l: 'Bloquer les nouveaux crédits au-delà du plafond', t: 'bool', g: 'Créances' },
  { k: 'delai_paiement_jours', l: 'Délai de paiement par défaut (jours)', t: 'number', g: 'Créances' },
  { k: 'tolerance_solde_fcfa', l: 'Tolérance de solde pour solder un crédit (FCFA)', t: 'number', g: 'Créances' },
  { k: 'jours_alerte_echeance', l: 'Alerte échéance proche (jours avant)', t: 'number', g: 'Créances' },
  { k: 'jours_creance_ancienne', l: 'Créance ancienne au-delà de (jours)', t: 'number', g: 'Créances' },
  { k: 'jours_stock_dormant', l: 'Stock confié dormant après (jours sans vente)', t: 'number', g: 'Stock confié' },
  { k: 'seuils_budget', l: "Seuils d'alerte budgets (%)", t: 'list', g: 'Dépenses' },
  { k: 'seuil_depense_elevee', l: 'Montant de dépense à signaler (FCFA)', t: 'number', g: 'Dépenses' },
  { k: 'jours_saisie_tardive', l: 'Saisie tardive au-delà de (jours)', t: 'number', g: 'Dépenses' },
  { k: 'delai_session_min', l: "Déconnexion automatique après inactivité (minutes)", t: 'number', g: 'Sécurité' },
];

// Référentiels : champs éditables (k = colonne, l = libellé, t = type)
export const REFS = {
  zones: { l: 'Zones / régions', one: 'zone', f: [{ k: 'nom', l: 'Nom', t: 'text', req: 1 }] },
  equipes: {
    l: 'Équipes / centres de coût', one: 'équipe',
    f: [
      { k: 'code', l: 'Code', t: 'text' }, { k: 'nom', l: 'Nom', t: 'text', req: 1 },
      { k: 'zone_id', l: 'Zone', t: 'ref:zones' }, { k: 'responsable', l: 'Responsable', t: 'text' },
    ],
  },
  agents: {
    l: 'Agents commerciaux', one: 'agent',
    f: [
      { k: 'code', l: 'Code', t: 'text' }, { k: 'nom', l: 'Nom complet', t: 'text', req: 1 },
      { k: 'telephone', l: 'Téléphone pro.', t: 'text' }, { k: 'equipe_id', l: 'Équipe', t: 'ref:equipes' },
      { k: 'zone_id', l: 'Zone', t: 'ref:zones' }, { k: 'date_affectation', l: "Date d'affectation", t: 'date' },
    ],
  },
  marches: {
    l: 'Marchés / villages', one: 'marché',
    f: [
      { k: 'nom', l: 'Nom', t: 'text', req: 1 }, { k: 'commune', l: 'Commune', t: 'text' },
      { k: 'zone_id', l: 'Zone / région', t: 'ref:zones' }, { k: 'equipe_id', l: 'Équipe / secteur', t: 'ref:equipes' },
    ],
  },
  clients: {
    l: 'Clients / débiteurs', one: 'client',
    f: [
      { k: 'code', l: 'Code', t: 'text' }, { k: 'nom', l: 'Nom', t: 'text', req: 1 },
      { k: 'type', l: 'Type', t: 'select:Grossiste|Demi-grossiste|Détaillant|Boutique|Supermarché|Autre' },
      { k: 'marche_id', l: 'Marché principal', t: 'ref:marches' }, { k: 'telephone', l: 'Téléphone', t: 'text' },
      { k: 'plafond_cartons', l: 'Plafond individuel (cartons, vide = plafond général)', t: 'number' },
      { k: 'depositaire', l: 'Gros client dépositaire (stock confié)', t: 'bool' },
    ],
  },
  produits: {
    l: 'Produits', one: 'produit',
    f: [
      { k: 'code', l: 'Code', t: 'text' }, { k: 'nom', l: 'Libellé', t: 'text', req: 1 },
      { k: 'gamme', l: 'Marque / gamme', t: 'text' },
      { k: 'packs_par_carton', l: 'Packs par carton', t: 'number', req: 1, def: 12 },
      { k: 'prix_ref', l: 'Prix de référence du carton (FCFA, indicatif)', t: 'number' },
    ],
  },
  vehicules: {
    l: 'Véhicules', one: 'véhicule',
    f: [
      { k: 'immatriculation', l: 'Immatriculation', t: 'text', req: 1 }, { k: 'modele', l: 'Marque / modèle', t: 'text' },
      { k: 'equipe_id', l: 'Équipe utilisatrice', t: 'ref:equipes' }, { k: 'conducteur', l: 'Conducteur habituel', t: 'text' },
    ],
  },
  categories_depense: {
    l: 'Catégories de dépenses', one: 'catégorie',
    f: [
      { k: 'code', l: 'Code', t: 'text' }, { k: 'libelle', l: 'Libellé', t: 'text', req: 1 },
      { k: 'famille', l: 'Famille', t: 'select:Véhicule|Personnel|Administratif|Marketing|Autre' },
      { k: 'justif_obligatoire', l: 'Justificatif obligatoire', t: 'bool' },
      { k: 'vehicule_obligatoire', l: 'Véhicule obligatoire', t: 'bool' },
      { k: 'description_obligatoire', l: 'Description obligatoire', t: 'bool' },
      { k: 'sensible', l: 'Donnée sensible (ex. salaires) — détail réservé', t: 'bool' },
    ],
  },
};

export const STATUTS_CREDIT = ['En attente', 'Partiellement remboursé', 'En retard', 'Soldé'];

export const STATUTS_DEPENSE = {
  brouillon: 'Brouillon', soumise: 'Soumise', controlee: 'Contrôlée (superviseur)', a_completer: 'À compléter',
  validee: 'Validée', rejetee: 'Rejetée', annulee: 'Annulée',
};

export const MODES_PAIEMENT_REMB = ['Espèces', 'Mobile money', 'Virement', 'Chèque', 'Autre'];
export const MODES_PAIEMENT_DEP = ['Espèces', 'Virement', 'Mobile money', 'Avance', 'Autre'];
export const CANAUX_RELANCE = ['Visite', 'Appel', 'SMS / WhatsApp', 'Courrier', 'Autre'];

export const STOCK_TYPES = {
  remise: 'Remise de stock (nouveau lot)',
  vente: 'Vente imputée (facturée)',
  retour: 'Retour vers Oriba Foods',
  perte: 'Perte / avarie',
  ajustement_plus: 'Ajustement (+)',
  ajustement_moins: 'Ajustement (−)',
  inventaire: 'Inventaire physique (constat)',
};

// Catégories initiales (§17.2)
export const DEFAULT_CATEGORIES = [
  ['CARB', 'Carburant', 'Véhicule', 1, 0, 0, 0],
  ['VIDA', 'Vidange', 'Véhicule', 1, 1, 0, 0],
  ['FILT', 'Filtres moteur', 'Véhicule', 1, 1, 0, 0],
  ['VIGN', 'Vignette', 'Véhicule', 1, 1, 0, 0],
  ['PATE', 'Patente', 'Administratif', 1, 0, 1, 0],
  ['ASSU', 'Assurance', 'Véhicule', 1, 1, 0, 0],
  ['REPA', 'Réparations et entretien', 'Véhicule', 1, 0, 1, 0],
  ['CCAN', 'Caisses / cachets annulés', 'Autre', 0, 0, 1, 0],
  ['CCAA', 'Caisse / cachet annuel', 'Autre', 0, 0, 1, 0],
  ['SALA', 'Salaires et rémunérations agents', 'Personnel', 0, 0, 0, 1],
  ['GADG', 'Gadgets et supports promotionnels', 'Marketing', 1, 0, 1, 0],
  ['VTEC', 'Visite technique', 'Véhicule', 1, 1, 0, 0],
  ['INSA', 'Frais d’insalubrité territoriale', 'Administratif', 1, 0, 0, 0],
  ['AUTO', 'Autorisations', 'Administratif', 1, 0, 1, 0],
  ['AUTR', 'Autres frais autorisés', 'Autre', 0, 0, 1, 0],
];

export const DEFAULT_ZONES = ['Niamey', 'Tillabéri', 'Dosso', 'Tahoua', 'Maradi', 'Zinder', 'Agadez'];
export const DEFAULT_EQUIPES = [
  ['NY1', 'Niamey 1', 'Niamey'], ['NY2', 'Niamey 2', 'Niamey'], ['BAL', 'Balleyara', 'Tillabéri'],
  ['DOS', 'Dosso', 'Dosso'], ['ZIN', 'Zinder', 'Zinder'], ['TAH', 'Tahoua', 'Tahoua'], ['KON', 'Konni', 'Tahoua'],
  ['MAR', 'Maradi', 'Maradi'], ['MAY', 'Équipe Mayonnaise', null], ['CTR', 'Équipe Contrôleur', null],
];
export const DEFAULT_MARCHES = [
  ['Nouveau marché', 'NY1'], ['Petit marché', 'NY1'], ['Dar Salam', 'NY1'], ['Wadata', 'NY1'], ['Gamkallé', 'NY1'], ['Aéroport', 'NY1'],
  ['Katako', 'NY2'], ['Yantala', 'NY2'], ['Dolé', 'NY2'], ['Bonkaney', 'NY2'], ['Harobanda', 'NY2'], ['Tondibya', 'NY2'],
];

// Champs modifiables par table (liste blanche serveur)
export const WRITABLE = {
  zones: ['nom', 'actif'],
  equipes: ['code', 'nom', 'zone_id', 'responsable', 'actif'],
  agents: ['code', 'nom', 'telephone', 'equipe_id', 'zone_id', 'date_affectation', 'actif'],
  marches: ['nom', 'commune', 'zone_id', 'equipe_id', 'actif'],
  clients: ['code', 'nom', 'type', 'marche_id', 'telephone', 'plafond_cartons', 'depositaire', 'actif'],
  produits: ['code', 'nom', 'gamme', 'packs_par_carton', 'prix_ref', 'actif'],
  vehicules: ['immatriculation', 'modele', 'equipe_id', 'conducteur', 'actif'],
  categories_depense: ['code', 'libelle', 'famille', 'justif_obligatoire', 'vehicule_obligatoire', 'description_obligatoire', 'sensible', 'actif'],
};

export const TABLES = [
  'zones', 'equipes', 'agents', 'marches', 'clients', 'produits', 'vehicules', 'categories_depense',
  'parametres', 'roles', 'utilisateurs', 'compteurs', 'ventes', 'vente_lignes', 'remboursements', 'relances',
  'stock_mouvements', 'depenses', 'depense_repartitions', 'depense_validations', 'budgets', 'clotures',
  'anomalies', 'imports', 'audit_log',
];

// Catégories dont la pièce a une période de validité (documents du véhicule)
export const CATS_VALIDITE = ['ASSU', 'VIGN', 'VTEC', 'PATE', 'AUTO'];
export const DOCS_VEHICULE = [['ASSU', 'Assurance'], ['VIGN', 'Vignette'], ['VTEC', 'Visite technique']];
export const CATS_LOGISTIQUE = ['CARB', 'VIDA', 'FILT', 'VIGN', 'ASSU', 'REPA', 'VTEC', 'INSA', 'AUTO'];
