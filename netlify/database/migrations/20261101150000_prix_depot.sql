-- Prix du carton DADI propre à chaque dépôt (Niamey 13 250, Konni 14 000, Tahoua 13 000…)
alter table agents add column if not exists prix_carton numeric(14,2);
