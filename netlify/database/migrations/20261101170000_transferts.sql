-- Transfert de cartons d'un dépôt à un autre (ex. Dépôt Niamey 1 → Dépôt Niamey 2)
alter table circuit_mvts add column if not exists depot_dest_id uuid references agents(id);
alter table circuit_mvts drop constraint if exists circuit_mvts_type_check;
alter table circuit_mvts add constraint circuit_mvts_type_check check (type in ('appro', 'prise', 'dispatch', 'transfert'));
