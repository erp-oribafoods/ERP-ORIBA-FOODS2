-- Fonction de l'agent (Chef d'équipe, Agent commercial, Agent de vente…), reprise de la liste des agents et objectifs de vente
alter table agents add column if not exists fonction text;
