-- Documents administratifs de la Force de Vente : pièces générées (numérotées) et pièces numérisées archivées.
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  numero text unique,
  titre text,
  agent_id uuid references agents(id),
  date_doc date not null,
  source text not null default 'genere' check (source in ('genere', 'televerse')),
  lien_table text,
  lien_id text,
  contenu jsonb,
  fichier_cle text,
  fichier_nom text,
  fichier_type text,
  statut text not null default 'emis' check (statut in ('emis', 'archive', 'annule')),
  motif text,
  observation text,
  created_by uuid references utilisateurs(id),
  created_at timestamptz not null default now(),
  updated_by uuid references utilisateurs(id),
  updated_at timestamptz
);
create index if not exists documents_date on documents(date_doc);
create index if not exists documents_code on documents(code);
drop trigger if exists documents_nodel on documents;
create trigger documents_nodel before delete on documents for each row execute function interdire_suppression();
