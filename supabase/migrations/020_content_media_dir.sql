-- Estudio: carpeta canónica de la pieza en el disco extraíble
-- (/Volumes/Rulo/estudio/<slug>/ con crudos/ assets/ exports/). Se sella al
-- crearla para que renombrar la pieza no rompa el enlace con el disco.
alter table content_pieces
  add column if not exists media_dir text;
