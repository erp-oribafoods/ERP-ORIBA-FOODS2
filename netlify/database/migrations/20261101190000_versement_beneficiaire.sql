-- Versements : argent destiné à Oriba Food ou à Oriba Rice
alter table versements add column if not exists beneficiaire text check (beneficiaire in ('Oriba Food', 'Oriba Rice'));
