-- Objectifs commerciaux par agent, zone, équipe, marché, produit ou global
create table if not exists objectifs (
  id uuid primary key default gen_random_uuid(),
  mois text not null, axe text not null check (axe in ('global','zone','equipe','marche','agent','produit')),
  cible_id uuid, produit_id uuid references produits(id),
  objectif_cartons numeric(14,3) check (objectif_cartons >= 0), objectif_ca numeric(16,2) check (objectif_ca >= 0),
  commentaire text, actif boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(), updated_by uuid, updated_at timestamptz
);
create unique index if not exists objectifs_uq on objectifs (mois, axe, coalesce(cible_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(produit_id, '00000000-0000-0000-0000-000000000000'::uuid)) where actif;
update roles set permissions = permissions || '{"objectifs":["lire","modifier"]}'::jsonb where nom in ('Direction Générale (DG)', 'Responsable Commercial & Force de Vente');
update roles set permissions = permissions || '{"objectifs":["lire"]}'::jsonb where nom in ('Contrôleur de Gestion', 'DAF');
