-- Suppression autorisée uniquement quand la plateforme l'active explicitement dans la transaction
create or replace function interdire_suppression() returns trigger language plpgsql as $f$
begin
  if coalesce(current_setting('erp.suppression_autorisee', true), '') = 'on' then return old; end if;
  raise exception 'Suppression interdite : utilisez l''annulation avec motif';
end $f$;
update roles set permissions = permissions || '{"suppression":["supprimer"]}'::jsonb where nom = 'Responsable Commercial & Force de Vente';
