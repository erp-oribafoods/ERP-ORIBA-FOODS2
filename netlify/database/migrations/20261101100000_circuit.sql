-- Circuit de distribution : usine / Oriba Rice → grossistes → agents-dépôts → sous-agents → clients
create table if not exists grossistes (
  id uuid primary key default gen_random_uuid(),
  code text, nom text not null, localite text, fournisseur text, telephone text,
  stock_initial numeric(14,3) not null default 0, solde_initial numeric(14,2) not null default 0,
  actif boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz
);
alter table agents add column if not exists role_circuit text check (role_circuit in ('depot', 'sous_agent'));
alter table agents add column if not exists depot_id uuid references agents(id);
alter table agents add column if not exists stock_initial numeric(14,3) not null default 0;

create table if not exists circuit_mvts (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  type text not null check (type in ('appro', 'prise', 'dispatch')),
  date date not null,
  grossiste_id uuid references grossistes(id),
  agent_id uuid references agents(id),
  sous_agent_id uuid references agents(id),
  fournisseur text,
  produit_id uuid references produits(id),
  cartons numeric(14,3) not null check (cartons > 0),
  prix numeric(14,2), montant numeric(16,2),
  mode text check (mode in ('comptant', 'credit')),
  observation text, ref_externe text,
  statut text not null default 'valide' check (statut in ('valide', 'annule')), motif text,
  import_id uuid, created_by uuid, created_at timestamptz not null default now(), updated_by uuid, updated_at timestamptz
);
create index if not exists circuit_mvts_date on circuit_mvts(date);

create table if not exists versements (
  id uuid primary key default gen_random_uuid(),
  numero text unique,
  date date not null,
  agent_id uuid references agents(id),
  grossiste_id uuid references grossistes(id),
  objet text not null check (objet in ('ventes_comptant', 'reglement_grossiste')),
  lieu text not null default 'caisse' check (lieu in ('caisse', 'grossiste')),
  lieu_grossiste_id uuid references grossistes(id),
  montant numeric(16,2) not null check (montant > 0),
  reference text, commentaire text, ref_externe text,
  statut text not null default 'valide' check (statut in ('valide', 'annule')), motif text,
  import_id uuid, created_by uuid, created_at timestamptz not null default now(), updated_by uuid, updated_at timestamptz
);
create index if not exists versements_date on versements(date);

alter table remboursements add column if not exists lieu text;
alter table remboursements add column if not exists lieu_grossiste_id uuid references grossistes(id);
alter table remboursements add column if not exists verse_par uuid references agents(id);

create trigger circuit_mvts_nodel before delete on circuit_mvts for each row execute function interdire_suppression();
create trigger versements_nodel before delete on versements for each row execute function interdire_suppression();

update roles set permissions = permissions || '{"circuit":["lire","creer","annuler","exporter"]}'::jsonb where nom = 'Responsable Commercial & Force de Vente';
update roles set permissions = permissions || '{"circuit":["lire","exporter"]}'::jsonb where nom in ('Direction Générale (DG)', 'Contrôleur de Gestion', 'DAF');
update roles set permissions = permissions || '{"circuit":["lire"]}'::jsonb where nom = 'Superviseur / Responsable d''équipe';
