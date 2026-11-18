-- Vente de mayonnaise (équipe de nuit) : fiches journalières, lignes par produit, visites des vendeurs, objectifs mensuels.
create table if not exists mayo_fiches (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  date date not null,
  vendeur text not null,
  axe text,
  observation text,
  reaction text,
  statut text not null default 'validee' check (statut in ('validee', 'annulee')),
  motif text,
  ref_externe text,
  created_by uuid references utilisateurs(id),
  created_at timestamptz not null default now(),
  updated_by uuid references utilisateurs(id),
  updated_at timestamptz
);
create index if not exists mayo_fiches_date on mayo_fiches(date);
create table if not exists mayo_lignes (
  id uuid primary key default gen_random_uuid(),
  fiche_id uuid not null references mayo_fiches(id) on delete cascade,
  produit text not null check (produit in ('oriba', 'aida', 'delice')),
  stock_initial numeric not null default 0 check (stock_initial >= 0),
  vendu_comptant numeric not null default 0 check (vendu_comptant >= 0),
  vendu_credit numeric not null default 0 check (vendu_credit >= 0),
  prix numeric not null default 0 check (prix >= 0),
  client_credit text,
  check (vendu_comptant + vendu_credit <= stock_initial)
);
create index if not exists mayo_lignes_fiche on mayo_lignes(fiche_id);
create table if not exists mayo_visites (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  axe text,
  agent text,
  client text not null,
  telephone text,
  lieu text,
  prise boolean not null default false,
  marques jsonb not null default '[]'::jsonb,
  motif text,
  observation text,
  date_relance date,
  statut text not null default 'validee' check (statut in ('validee', 'annulee')),
  motif_annulation text,
  ref_externe text unique,
  created_by uuid references utilisateurs(id),
  created_at timestamptz not null default now(),
  updated_by uuid references utilisateurs(id),
  updated_at timestamptz
);
create index if not exists mayo_visites_date on mayo_visites(date);
create table if not exists mayo_objectifs (
  id uuid primary key default gen_random_uuid(),
  mois text not null,
  produit text not null check (produit in ('oriba', 'aida', 'delice', 'visites')),
  objectif numeric not null default 0 check (objectif >= 0),
  created_by uuid references utilisateurs(id),
  created_at timestamptz not null default now(),
  updated_by uuid references utilisateurs(id),
  updated_at timestamptz,
  unique (mois, produit)
);
drop trigger if exists mayo_fiches_nodel on mayo_fiches;
create trigger mayo_fiches_nodel before delete on mayo_fiches for each row execute function interdire_suppression();
drop trigger if exists mayo_visites_nodel on mayo_visites;
create trigger mayo_visites_nodel before delete on mayo_visites for each row execute function interdire_suppression();
