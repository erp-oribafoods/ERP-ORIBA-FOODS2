-- Suivi mensuel des agents terrain (reprise de l'application « Suivi Terrain Dadi »)
alter table agents add column if not exists marche_id uuid references marches(id);
create table if not exists suivi_agents (
  id uuid primary key default gen_random_uuid(),
  mois text not null check (mois ~ '^[0-9]{4}-[0-9]{2}$'),
  agent_id uuid not null references agents(id),
  jours_presents integer check (jours_presents between 0 and 31), retards integer check (retards >= 0),
  abs_j integer check (abs_j >= 0), abs_nj integer check (abs_nj >= 0),
  ventes_declarees numeric(14,3) check (ventes_declarees >= 0),
  obj_destock numeric(14,3) check (obj_destock >= 0), destock numeric(14,3) check (destock >= 0),
  visites integer check (visites >= 0), nouveaux_clients integer check (nouveaux_clients >= 0), plv integer check (plv >= 0),
  note numeric(4,1) check (note between 0 and 10), commentaire text,
  created_by uuid, created_at timestamptz not null default now(), updated_by uuid, updated_at timestamptz,
  unique (mois, agent_id)
);
update roles set permissions = permissions || '{"suivi":["lire","modifier"]}'::jsonb where nom in ('Responsable Commercial & Force de Vente', 'Superviseur / Responsable d''équipe');
update roles set permissions = permissions || '{"suivi":["lire"]}'::jsonb where nom in ('Direction Générale (DG)', 'Contrôleur de Gestion', 'DAF');
insert into roles (id, nom, description, permissions, actif)
select gen_random_uuid(), 'Ressources Humaines', 'Présence, retards, absences et évaluation mensuelle des agents terrain ; primes.',
  '{"suivi":["lire","modifier"],"objectifs":["lire"],"referentiels":["lire"]}'::jsonb, true
where not exists (select 1 from roles where nom = 'Ressources Humaines');
