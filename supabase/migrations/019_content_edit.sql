-- Estudio: crudos + edición automática (OpenMontage, ~/dev/video-edit).
-- `raw_clips` = clips crudos vinculados a la pieza (archivos locales del
-- agente, con metadata de ffprobe). `edit_job` = snapshot del run de edición
-- automática en curso/último (el board lo trae con el poll de 10s).
alter table content_pieces
  add column if not exists raw_clips jsonb not null default '[]'::jsonb,
  add column if not exists edit_job jsonb;
