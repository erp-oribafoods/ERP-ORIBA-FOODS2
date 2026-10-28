-- Période de validité des pièces (assurance, vignette, visite technique, patente, autorisation)
alter table depenses add column if not exists validite_debut date;
alter table depenses add column if not exists validite_fin date;
