-- Le chef d'équipe est le dépôt : son nom est porté par le dépôt
alter table agents add column if not exists responsable text;
