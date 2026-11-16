-- Comptes supprimés : retirés de la liste et sans accès, nom conservé dans l'historique des opérations.
alter table utilisateurs drop constraint if exists utilisateurs_statut_check;
alter table utilisateurs add constraint utilisateurs_statut_check check (statut in ('actif','suspendu','desactive','supprime'));
