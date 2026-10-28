create schema if not exists erp;
revoke all on schema erp from anon, authenticated;
set search_path to erp, public;

-- ORIBA FOODS — ERP Gestion Commerciale & Force de Vente — schéma initial

create table zones (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  actif boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz
);
create unique index zones_nom_uq on zones (lower(nom));

create table equipes (
  id uuid primary key default gen_random_uuid(),
  code text, nom text not null, zone_id uuid references zones(id), responsable text,
  actif boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz
);
create unique index equipes_nom_uq on equipes (lower(nom));

create table agents (
  id uuid primary key default gen_random_uuid(),
  code text, nom text not null, telephone text, equipe_id uuid references equipes(id), zone_id uuid references zones(id),
  date_affectation date, actif boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz
);

create table marches (
  id uuid primary key default gen_random_uuid(),
  nom text not null, commune text, zone_id uuid references zones(id), equipe_id uuid references equipes(id),
  actif boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz
);

create table clients (
  id uuid primary key default gen_random_uuid(),
  code text, nom text not null, type text, marche_id uuid references marches(id), telephone text,
  plafond_cartons numeric(14,3), depositaire boolean not null default false,
  actif boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz
);

create table produits (
  id uuid primary key default gen_random_uuid(),
  code text, nom text not null, gamme text, packs_par_carton numeric(10,3) not null default 12 check (packs_par_carton > 0),
  prix_ref numeric(14,2), actif boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz
);

create table vehicules (
  id uuid primary key default gen_random_uuid(),
  immatriculation text not null, modele text, equipe_id uuid references equipes(id), conducteur text,
  actif boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz
);

create table categories_depense (
  id uuid primary key default gen_random_uuid(),
  code text, libelle text not null, famille text,
  justif_obligatoire boolean not null default false, vehicule_obligatoire boolean not null default false,
  description_obligatoire boolean not null default false, sensible boolean not null default false,
  actif boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz
);

create table parametres (
  cle text primary key, valeur jsonb not null, updated_at timestamptz not null default now(), updated_by uuid
);

create table roles (
  id uuid primary key default gen_random_uuid(),
  nom text not null, description text, permissions jsonb not null default '{}'::jsonb,
  systeme boolean not null default false, actif boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz
);
create unique index roles_nom_uq on roles (lower(nom));

create table utilisateurs (
  id uuid primary key default gen_random_uuid(),
  nom text not null, prenom text, username text not null, email text not null, telephone text,
  role_id uuid references roles(id), perimetre_type text not null default 'global' check (perimetre_type in ('global','zone','equipe')),
  perimetre_ids jsonb not null default '[]'::jsonb,
  statut text not null default 'actif' check (statut in ('actif','suspendu','desactive')),
  mot_de_passe_hash text not null, must_change_password boolean not null default true,
  echecs integer not null default 0, verrou_jusqua timestamptz, token_version integer not null default 0,
  last_login timestamptz, created_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz
);
create unique index utilisateurs_username_uq on utilisateurs (lower(username));
create unique index utilisateurs_email_uq on utilisateurs (lower(email));

create table compteurs (cle text primary key, valeur bigint not null default 0);

create table ventes (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique, date date not null, mode text not null check (mode in ('comptant','credit')),
  agent_id uuid references agents(id), marche_id uuid references marches(id), client_id uuid references clients(id),
  echeance date, observation text,
  statut text not null default 'validee' check (statut in ('validee','annulee')),
  motif text, historique boolean not null default false, ref_externe text, source text, lot_id uuid, import_id uuid,
  created_by uuid, created_at timestamptz not null default now(), updated_by uuid, updated_at timestamptz,
  check (mode = 'comptant' or client_id is not null)
);
create index ventes_date_idx on ventes(date);
create index ventes_client_idx on ventes(client_id);

create table vente_lignes (
  id uuid primary key default gen_random_uuid(),
  vente_id uuid not null references ventes(id), produit_id uuid not null references produits(id),
  unite text not null check (unite in ('carton','pack')),
  quantite numeric(14,3) not null check (quantite > 0), prix_unitaire numeric(14,2) not null check (prix_unitaire >= 0),
  montant numeric(16,2) not null, cartons numeric(14,4) not null,
  annulee boolean not null default false, created_at timestamptz not null default now()
);
create index vente_lignes_vente_idx on vente_lignes(vente_id);

create table remboursements (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique, vente_id uuid not null references ventes(id), date date not null,
  montant numeric(16,2) not null check (montant > 0), mode text, reference text, commentaire text,
  statut text not null default 'valide' check (statut in ('valide','annule')), motif text,
  historique boolean not null default false, import_id uuid,
  created_by uuid, created_at timestamptz not null default now(), updated_by uuid, updated_at timestamptz
);
create index remboursements_vente_idx on remboursements(vente_id);

create table relances (
  id uuid primary key default gen_random_uuid(),
  vente_id uuid not null references ventes(id), date date not null, canal text, resultat text,
  prochaine_action text, date_prochaine date, promesse_date date, promesse_montant numeric(16,2),
  created_by uuid, created_at timestamptz not null default now()
);

create table stock_mouvements (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique, lot_id uuid, client_id uuid not null references clients(id), produit_id uuid not null references produits(id),
  date date not null,
  type text not null check (type in ('remise','vente','retour','perte','ajustement_plus','ajustement_moins','inventaire')),
  quantite numeric(14,3) not null check (quantite >= 0), valeur_unitaire numeric(14,2), document text, motif text,
  vente_id uuid references ventes(id),
  statut text not null default 'valide' check (statut in ('valide','annule')),
  historique boolean not null default false, import_id uuid,
  created_by uuid, created_at timestamptz not null default now(), updated_by uuid, updated_at timestamptz
);

create table depenses (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique, date date not null, mois text not null, categorie_id uuid not null references categories_depense(id),
  description text, montant numeric(16,2) not null check (montant > 0),
  equipe_id uuid references equipes(id), zone_id uuid references zones(id), vehicule_id uuid references vehicules(id),
  beneficiaire text, mode_paiement text, reference_piece text, sans_piece boolean not null default false,
  justificatif_cle text, justificatif_nom text, kilometrage numeric(12,1), litres numeric(10,2), station text,
  statut text not null default 'brouillon' check (statut in ('brouillon','soumise','controlee','a_completer','validee','rejetee','annulee')),
  partagee boolean not null default false, historique boolean not null default false, motif text, import_id uuid,
  created_by uuid, created_at timestamptz not null default now(), updated_by uuid, updated_at timestamptz
);
create index depenses_mois_idx on depenses(mois);

create table depense_repartitions (
  id uuid primary key default gen_random_uuid(),
  depense_id uuid not null references depenses(id), equipe_id uuid not null references equipes(id),
  montant numeric(16,2) not null check (montant >= 0), actif boolean not null default true,
  created_by uuid, created_at timestamptz not null default now()
);

create table depense_validations (
  id uuid primary key default gen_random_uuid(),
  depense_id uuid not null references depenses(id), etape text not null, decision text, commentaire text,
  user_id uuid, created_at timestamptz not null default now()
);

create table budgets (
  id uuid primary key default gen_random_uuid(),
  mois text not null, equipe_id uuid references equipes(id), categorie_id uuid references categories_depense(id),
  vehicule_id uuid references vehicules(id), montant numeric(16,2) not null check (montant >= 0), commentaire text,
  approuve_par uuid, date_approbation timestamptz, actif boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz
);

create table clotures (
  id uuid primary key default gen_random_uuid(),
  mois text not null unique, statut text not null check (statut in ('cloture','rouvert')), commentaire text,
  user_id uuid, updated_at timestamptz not null default now()
);

create table anomalies (
  id uuid primary key default gen_random_uuid(),
  objet_type text, objet_id text, description text not null,
  statut text not null default 'ouverte' check (statut in ('ouverte','traitee')), reponse text,
  created_by uuid, created_at timestamptz not null default now(), traite_par uuid, traite_at timestamptz
);

create table imports (
  id uuid primary key default gen_random_uuid(),
  type text not null, fichier text, stats jsonb, rapport jsonb,
  created_by uuid, created_at timestamptz not null default now()
);

create table audit_log (
  id bigserial primary key, created_at timestamptz not null default now(),
  user_id uuid, user_nom text, action text not null, table_name text, objet_id text,
  avant jsonb, apres jsonb, motif text, ip text
);
create index audit_log_date_idx on audit_log(created_at desc);

-- Journal d'audit non modifiable
create or replace function interdire_modif_audit() returns trigger language plpgsql set search_path = erp, public as $$
begin raise exception 'Le journal d''audit ne peut pas être modifié ni supprimé'; end $$;
create trigger audit_log_immuable before update or delete on audit_log for each row execute function interdire_modif_audit();

-- Aucune suppression physique des opérations (RG-08 / DEP-03)
create or replace function interdire_suppression() returns trigger language plpgsql set search_path = erp, public as $$
begin raise exception 'Suppression interdite : utilisez l''annulation avec motif'; end $$;
create trigger ventes_nodel before delete on ventes for each row execute function interdire_suppression();
create trigger vente_lignes_nodel before delete on vente_lignes for each row execute function interdire_suppression();
create trigger remboursements_nodel before delete on remboursements for each row execute function interdire_suppression();
create trigger stock_nodel before delete on stock_mouvements for each row execute function interdire_suppression();
create trigger depenses_nodel before delete on depenses for each row execute function interdire_suppression();
create trigger depval_nodel before delete on depense_validations for each row execute function interdire_suppression();

-- Montant de ligne = quantité × prix unitaire (RG-02), cartons équivalents
create or replace function calc_ligne() returns trigger language plpgsql set search_path = erp, public as $$
declare ppc numeric;
begin
  select packs_par_carton into ppc from produits where id = new.produit_id;
  new.montant := round(new.quantite * new.prix_unitaire, 2);
  new.cartons := case when new.unite = 'pack' then round(new.quantite / coalesce(ppc, 12), 4) else new.quantite end;
  return new;
end $$;
create trigger vente_lignes_calc before insert or update on vente_lignes for each row execute function calc_ligne();

-- Remboursement : jamais au-delà du solde (RG-05)
create or replace function controle_remboursement() returns trigger language plpgsql set search_path = erp, public as $$
declare total numeric; deja numeric; tol numeric; v_mode text; v_statut text;
begin
  if new.statut <> 'valide' then return new; end if;
  select mode, statut into v_mode, v_statut from ventes where id = new.vente_id;
  if v_mode <> 'credit' or v_statut <> 'validee' then raise exception 'Remboursement possible uniquement sur une vente à crédit valide'; end if;
  select coalesce(sum(montant),0) into total from vente_lignes where vente_id = new.vente_id and not annulee;
  select coalesce(sum(montant),0) into deja from remboursements where vente_id = new.vente_id and statut = 'valide' and id <> new.id;
  select coalesce((valeur #>> '{}')::numeric, 0) into tol from parametres where cle = 'tolerance_solde_fcfa';
  if deja + new.montant > total + coalesce(tol,0) then
    raise exception 'Remboursement supérieur au solde restant (solde : % FCFA)', total - deja;
  end if;
  return new;
end $$;
create trigger remboursements_controle before insert or update on remboursements for each row execute function controle_remboursement();

-- Données de référence initiales
insert into parametres(cle, valeur) values ('plafond_cartons_client', '1000'::jsonb);
insert into parametres(cle, valeur) values ('seuils_plafond', '[75,90,100]'::jsonb);
insert into parametres(cle, valeur) values ('blocage_credit_depassement', 'false'::jsonb);
insert into parametres(cle, valeur) values ('delai_paiement_jours', '30'::jsonb);
insert into parametres(cle, valeur) values ('tolerance_solde_fcfa', '0'::jsonb);
insert into parametres(cle, valeur) values ('jours_alerte_echeance', '3'::jsonb);
insert into parametres(cle, valeur) values ('jours_creance_ancienne', '90'::jsonb);
insert into parametres(cle, valeur) values ('jours_stock_dormant', '30'::jsonb);
insert into parametres(cle, valeur) values ('seuils_budget', '[75,90,100]'::jsonb);
insert into parametres(cle, valeur) values ('seuil_depense_elevee', '500000'::jsonb);
insert into parametres(cle, valeur) values ('jours_saisie_tardive', '15'::jsonb);
insert into parametres(cle, valeur) values ('delai_session_min', '30'::jsonb);
insert into roles(nom, description, permissions, systeme) values ('Direction Générale (DG)', 'Lecture globale, alertes, rapports. Validation exceptionnelle des dépenses.', '{"dashboard":["lire"],"ventes":["lire","exporter"],"remboursements":["lire","exporter"],"creances":["lire","exporter"],"stock":["lire","exporter"],"depenses":["lire","valider","exporter"],"salaires":["lire"],"budgets":["lire","modifier"],"cloture":["lire"],"referentiels":["lire"],"parametres":["lire"],"audit":["lire","creer"]}'::jsonb, true);
insert into roles(nom, description, permissions, systeme) values ('Responsable Commercial & Force de Vente', 'Seul profil autorisé à créer, corriger et annuler les ventes et remboursements.', '{"dashboard":["lire"],"ventes":["lire","creer","modifier","annuler","exporter"],"remboursements":["lire","creer","annuler","exporter"],"creances":["lire","creer","exporter"],"stock":["lire","creer","annuler","exporter"],"depenses":["lire","creer","modifier","controler","exporter"],"budgets":["lire"],"cloture":["lire"],"referentiels":["lire","modifier"],"parametres":["lire"],"import":["creer"]}'::jsonb, true);
insert into roles(nom, description, permissions, systeme) values ('Contrôleur de Gestion', 'Analyse, rapprochements, exports, audit et signalement des anomalies.', '{"dashboard":["lire"],"ventes":["lire","exporter"],"remboursements":["lire","exporter"],"creances":["lire","exporter"],"stock":["lire","exporter"],"depenses":["lire","exporter"],"budgets":["lire"],"cloture":["lire"],"referentiels":["lire"],"parametres":["lire"],"audit":["lire","creer"]}'::jsonb, true);
insert into roles(nom, description, permissions, systeme) values ('DAF', 'Contrôle financier, validation des dépenses, clôture mensuelle, paramètres financiers.', '{"dashboard":["lire"],"ventes":["lire","exporter"],"remboursements":["lire","exporter"],"creances":["lire","exporter"],"stock":["lire","exporter"],"depenses":["lire","valider","annuler","exporter"],"salaires":["lire"],"budgets":["lire","modifier"],"cloture":["lire","modifier"],"referentiels":["lire"],"parametres":["lire","modifier"],"audit":["lire","creer"]}'::jsonb, true);
insert into roles(nom, description, permissions, systeme) values ('Administrateur ERP', 'Comptes, rôles, référentiels et paramètres. Aucune validation financière.', '{"dashboard":["lire"],"referentiels":["lire","modifier"],"parametres":["lire","modifier"],"utilisateurs":["lire","modifier"],"import":["creer"],"audit":["lire"]}'::jsonb, true);
insert into roles(nom, description, permissions, systeme) values ('Superviseur / Responsable d''équipe', 'Saisie et contrôle des dépenses de son équipe (périmètre à définir sur le compte).', '{"dashboard":["lire"],"depenses":["lire","creer","modifier","controler"],"referentiels":["lire"],"cloture":["lire"]}'::jsonb, true);
insert into zones(nom) values ('Niamey');
insert into zones(nom) values ('Tillabéri');
insert into zones(nom) values ('Dosso');
insert into zones(nom) values ('Tahoua');
insert into zones(nom) values ('Maradi');
insert into zones(nom) values ('Zinder');
insert into zones(nom) values ('Agadez');
insert into equipes(code, nom, zone_id) values ('NY1', 'Niamey 1', (select id from zones where nom = 'Niamey'));
insert into equipes(code, nom, zone_id) values ('NY2', 'Niamey 2', (select id from zones where nom = 'Niamey'));
insert into equipes(code, nom, zone_id) values ('BAL', 'Balleyara', (select id from zones where nom = 'Tillabéri'));
insert into equipes(code, nom, zone_id) values ('DOS', 'Dosso', (select id from zones where nom = 'Dosso'));
insert into equipes(code, nom, zone_id) values ('ZIN', 'Zinder', (select id from zones where nom = 'Zinder'));
insert into equipes(code, nom, zone_id) values ('TAH', 'Tahoua', (select id from zones where nom = 'Tahoua'));
insert into equipes(code, nom, zone_id) values ('KON', 'Konni', (select id from zones where nom = 'Tahoua'));
insert into equipes(code, nom, zone_id) values ('MAR', 'Maradi', (select id from zones where nom = 'Maradi'));
insert into equipes(code, nom, zone_id) values ('MAY', 'Équipe Mayonnaise', NULL);
insert into equipes(code, nom, zone_id) values ('CTR', 'Équipe Contrôleur', NULL);
insert into marches(nom, commune, zone_id, equipe_id) values ('Nouveau marché', 'Niamey', (select id from zones where nom = 'Niamey'), (select id from equipes where code = 'NY1'));
insert into marches(nom, commune, zone_id, equipe_id) values ('Petit marché', 'Niamey', (select id from zones where nom = 'Niamey'), (select id from equipes where code = 'NY1'));
insert into marches(nom, commune, zone_id, equipe_id) values ('Dar Salam', 'Niamey', (select id from zones where nom = 'Niamey'), (select id from equipes where code = 'NY1'));
insert into marches(nom, commune, zone_id, equipe_id) values ('Wadata', 'Niamey', (select id from zones where nom = 'Niamey'), (select id from equipes where code = 'NY1'));
insert into marches(nom, commune, zone_id, equipe_id) values ('Gamkallé', 'Niamey', (select id from zones where nom = 'Niamey'), (select id from equipes where code = 'NY1'));
insert into marches(nom, commune, zone_id, equipe_id) values ('Aéroport', 'Niamey', (select id from zones where nom = 'Niamey'), (select id from equipes where code = 'NY1'));
insert into marches(nom, commune, zone_id, equipe_id) values ('Katako', 'Niamey', (select id from zones where nom = 'Niamey'), (select id from equipes where code = 'NY2'));
insert into marches(nom, commune, zone_id, equipe_id) values ('Yantala', 'Niamey', (select id from zones where nom = 'Niamey'), (select id from equipes where code = 'NY2'));
insert into marches(nom, commune, zone_id, equipe_id) values ('Dolé', 'Niamey', (select id from zones where nom = 'Niamey'), (select id from equipes where code = 'NY2'));
insert into marches(nom, commune, zone_id, equipe_id) values ('Bonkaney', 'Niamey', (select id from zones where nom = 'Niamey'), (select id from equipes where code = 'NY2'));
insert into marches(nom, commune, zone_id, equipe_id) values ('Harobanda', 'Niamey', (select id from zones where nom = 'Niamey'), (select id from equipes where code = 'NY2'));
insert into marches(nom, commune, zone_id, equipe_id) values ('Tondibya', 'Niamey', (select id from zones where nom = 'Niamey'), (select id from equipes where code = 'NY2'));
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('CARB', 'Carburant', 'Véhicule', true, false, false, false);
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('VIDA', 'Vidange', 'Véhicule', true, true, false, false);
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('FILT', 'Filtres moteur', 'Véhicule', true, true, false, false);
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('VIGN', 'Vignette', 'Véhicule', true, true, false, false);
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('PATE', 'Patente', 'Administratif', true, false, true, false);
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('ASSU', 'Assurance', 'Véhicule', true, true, false, false);
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('REPA', 'Réparations et entretien', 'Véhicule', true, false, true, false);
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('CCAN', 'Caisses / cachets annulés', 'Autre', false, false, true, false);
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('CCAA', 'Caisse / cachet annuel', 'Autre', false, false, true, false);
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('SALA', 'Salaires et rémunérations agents', 'Personnel', false, false, false, true);
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('GADG', 'Gadgets et supports promotionnels', 'Marketing', true, false, true, false);
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('VTEC', 'Visite technique', 'Véhicule', true, true, false, false);
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('INSA', 'Frais d’insalubrité territoriale', 'Administratif', true, false, false, false);
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('AUTO', 'Autorisations', 'Administratif', true, false, true, false);
insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values ('AUTR', 'Autres frais autorisés', 'Autre', false, false, true, false);
insert into vehicules(immatriculation, modele, equipe_id, conducteur) values ('Véhicule commercial Zinder (immatriculation à compléter)', NULL, (select id from equipes where code = 'ZIN'), NULL);
insert into compteurs(cle, valeur) values ('VC', 0);
insert into compteurs(cle, valeur) values ('VR', 0);
insert into compteurs(cle, valeur) values ('RB', 0);
insert into compteurs(cle, valeur) values ('DP', 0);
insert into compteurs(cle, valeur) values ('SK', 0);

create table fichiers (cle text primary key, type text, nom text, base64 text not null, created_at timestamptz not null default now());

alter table depenses add column if not exists validite_debut date;
alter table depenses add column if not exists validite_fin date;

-- Objectifs commerciaux
create table if not exists objectifs (
  id uuid primary key default gen_random_uuid(),
  mois text not null, axe text not null check (axe in ('global','zone','equipe','marche','agent','produit')),
  cible_id uuid, produit_id uuid references produits(id),
  objectif_cartons numeric(14,3) check (objectif_cartons >= 0), objectif_ca numeric(16,2) check (objectif_ca >= 0),
  commentaire text, actif boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(), updated_by uuid, updated_at timestamptz
);
create unique index if not exists objectifs_uq on objectifs (mois, axe, coalesce(cible_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(produit_id, '00000000-0000-0000-0000-000000000000'::uuid)) where actif;
