-- Demandes de carburant et de vidange (fiches imprimables)
create table if not exists demandes (
  id uuid primary key default gen_random_uuid(),
  numero text not null unique, type text not null check (type in ('carburant','vidange')),
  date date not null, equipe_id uuid references equipes(id), zone_id uuid references zones(id), vehicule_id uuid references vehicules(id),
  chef_equipe text, km_actuel numeric(12,1) not null check (km_actuel > 0), montant_demande numeric(16,2) check (montant_demande >= 0),
  km_derniere_vidange numeric(12,1) check (km_derniere_vidange >= 0), motif text,
  statut text not null default 'soumise' check (statut in ('soumise','accordee','refusee','annulee')),
  demandeur_nom text, solde_carte_avant numeric(16,2), montant_accorde numeric(16,2), plafond_restant numeric(16,2),
  cout_pris_en_charge numeric(16,2), prochaine_vidange_km numeric(12,1), decision_commentaire text,
  decide_par uuid, decide_par_nom text, decide_le timestamptz, depense_id uuid references depenses(id),
  created_by uuid, created_at timestamptz not null default now(), updated_by uuid, updated_at timestamptz
);
