-- Reste à encaisser au départ de chaque dépôt (situation d'ouverture), réparti entre Oriba Food et Oriba Rice
alter table agents add column if not exists solde_initial_food numeric(16,2) not null default 0;
alter table agents add column if not exists solde_initial_rice numeric(16,2) not null default 0;
