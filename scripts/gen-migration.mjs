// Génère la migration initiale (DDL + données de référence) à partir de shared/schema.js
import fs from 'node:fs';
import { DEFAULT_ROLES, DEFAULT_PARAMS, DEFAULT_CATEGORIES, DEFAULT_ZONES, DEFAULT_EQUIPES, DEFAULT_MARCHES } from '../shared/schema.js';

const q = (s) => (s === null || s === undefined ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`);

const ddl = `
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
create or replace function interdire_modif_audit() returns trigger language plpgsql as $$
begin raise exception 'Le journal d''audit ne peut pas être modifié ni supprimé'; end $$;
create trigger audit_log_immuable before update or delete on audit_log for each row execute function interdire_modif_audit();

-- Aucune suppression physique des opérations (RG-08 / DEP-03)
create or replace function interdire_suppression() returns trigger language plpgsql as $$
begin raise exception 'Suppression interdite : utilisez l''annulation avec motif'; end $$;
create trigger ventes_nodel before delete on ventes for each row execute function interdire_suppression();
create trigger vente_lignes_nodel before delete on vente_lignes for each row execute function interdire_suppression();
create trigger remboursements_nodel before delete on remboursements for each row execute function interdire_suppression();
create trigger stock_nodel before delete on stock_mouvements for each row execute function interdire_suppression();
create trigger depenses_nodel before delete on depenses for each row execute function interdire_suppression();
create trigger depval_nodel before delete on depense_validations for each row execute function interdire_suppression();

-- Montant de ligne = quantité × prix unitaire (RG-02), cartons équivalents
create or replace function calc_ligne() returns trigger language plpgsql as $$
declare ppc numeric;
begin
  select packs_par_carton into ppc from produits where id = new.produit_id;
  new.montant := round(new.quantite * new.prix_unitaire, 2);
  new.cartons := case when new.unite = 'pack' then round(new.quantite / coalesce(ppc, 12), 4) else new.quantite end;
  return new;
end $$;
create trigger vente_lignes_calc before insert or update on vente_lignes for each row execute function calc_ligne();

-- Remboursement : jamais au-delà du solde (RG-05)
create or replace function controle_remboursement() returns trigger language plpgsql as $$
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
`;

let seed = '\n-- Données de référence initiales\n';
for (const [k, v] of Object.entries(DEFAULT_PARAMS)) seed += `insert into parametres(cle, valeur) values (${q(k)}, ${q(JSON.stringify(v))}::jsonb);\n`;
for (const r of DEFAULT_ROLES) seed += `insert into roles(nom, description, permissions, systeme) values (${q(r.nom)}, ${q(r.description)}, ${q(JSON.stringify(r.permissions))}::jsonb, true);\n`;
for (const z of DEFAULT_ZONES) seed += `insert into zones(nom) values (${q(z)});\n`;
for (const [code, nom, zone] of DEFAULT_EQUIPES) seed += `insert into equipes(code, nom, zone_id) values (${q(code)}, ${q(nom)}, ${zone ? `(select id from zones where nom = ${q(zone)})` : 'NULL'});\n`;
for (const [nom, eq] of DEFAULT_MARCHES) seed += `insert into marches(nom, commune, zone_id, equipe_id) values (${q(nom)}, 'Niamey', (select id from zones where nom = 'Niamey'), (select id from equipes where code = ${q(eq)}));\n`;
for (const [code, lib, fam, j, v, d, s] of DEFAULT_CATEGORIES) seed += `insert into categories_depense(code, libelle, famille, justif_obligatoire, vehicule_obligatoire, description_obligatoire, sensible) values (${q(code)}, ${q(lib)}, ${q(fam)}, ${!!j}, ${!!v}, ${!!d}, ${!!s});\n`;
seed += `insert into vehicules(immatriculation, modele, equipe_id, conducteur) values ('Véhicule commercial Zinder (immatriculation à compléter)', NULL, (select id from equipes where code = 'ZIN'), NULL);\n`;
for (const c of ['VC', 'VR', 'RB', 'DP', 'SK']) seed += `insert into compteurs(cle, valeur) values (${q(c)}, 0);\n`;

fs.mkdirSync('netlify/database/migrations', { recursive: true });
fs.writeFileSync('netlify/database/migrations/20261028100000_schema_initial.sql', ddl + seed);
// Variante Supabase : schéma dédié « erp », non exposé à l'API publique
const supa = `create schema if not exists erp;\nrevoke all on schema erp from anon, authenticated;\nset search_path to erp, public;\n`
  + (ddl + seed).replace(/language plpgsql as \$\$/g, 'language plpgsql set search_path = erp, public as $$$$')
  + `\ncreate table fichiers (cle text primary key, type text, nom text, base64 text not null, created_at timestamptz not null default now());\n`;
fs.mkdirSync('supabase', { recursive: true });
fs.writeFileSync('supabase/erp_schema.sql', supa);
console.log('Migration écrite');
