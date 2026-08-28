-- Hermes OS · migración 017 — Etapas del Estudio con seguimiento real
--
-- 1) Los estados pasan a ser FASES ("qué se está haciendo ahora"), no hitos
--    ("qué ya quedó hecho"): grabado → grabacion, editado → edicion. Así la
--    pregunta "¿qué grabo el sábado?" se responde con status='grabacion'.
-- 2) Seguimiento: status_since (desde cuándo lleva en la etapa) + stage_history
--    (append-only, una entrada por transición) — el lead time es dato real.
-- 3) Trazabilidad del radar: ref_id = la referencia que originó la pieza.

-- El check viejo se llama content_pieces_status_check, pero lo buscamos por
-- definición para no depender del nombre autogenerado.
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'content_pieces'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%grabado%'
  loop
    execute format('alter table content_pieces drop constraint %I', c.conname);
  end loop;
end $$;

update content_pieces set status = 'grabacion' where status = 'grabado';
update content_pieces set status = 'edicion'   where status = 'editado';

alter table content_pieces add constraint content_pieces_status_check
  check (status in ('idea','guion','grabacion','edicion','programado','publicado','descartada'));

alter table content_pieces add column if not exists status_since timestamptz;
alter table content_pieces add column if not exists stage_history jsonb not null default '[]';
alter table content_pieces add column if not exists ref_id bigint; -- content_refs.id (sin FK, convención)

-- Backfill honesto: lo único verificable es la etapa actual y desde cuándo la
-- fila no se toca. No se inventan transiciones pasadas.
update content_pieces
   set status_since = coalesce(updated_at, created_at)
 where status_since is null;

update content_pieces
   set stage_history = jsonb_build_array(
         jsonb_build_object('status', status, 'at', coalesce(status_since, created_at))
       )
 where stage_history = '[]'::jsonb;

create index if not exists content_pieces_ref_idx on content_pieces (ref_id);
create index if not exists content_pieces_since_idx on content_pieces (status, status_since);

-- 4) El Estudio se muda a su propio proyecto del vault: projects/rulocodeshow/
--    (los .md ya se movieron; aquí se corrige el puntero de cada pieza).
update content_pieces
   set vault_path = replace(vault_path, 'projects/rulocode/contenido/', 'projects/rulocodeshow/contenido/')
 where vault_path like 'projects/rulocode/contenido/%';
