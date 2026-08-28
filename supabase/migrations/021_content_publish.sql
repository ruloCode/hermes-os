-- Hermes OS · migración 021 — Publicación automática de piezas (Estudio)
--
-- 1) `master_path`: el video final CANÓNICO de la pieza. Hasta ahora el master
--    vivía en dos sitios sin ser obligatorio en ninguno — edit_job.output_path
--    (solo si pasó por OpenMontage) o suelto en <media_dir>/exports/ (si la
--    edición fue manual, y entonces la BD ni se enteraba). Se sella cuando el
--    agente lo verifica en disco, igual que vault_path o media_dir.
--
-- 2) `publish_job`: snapshot del run de publicación en curso/último (mismo
--    patrón que edit_job — el board lo trae con el poll de 10s).
--
-- 3) Las variantes de `publications` (jsonb) ganan el estado REAL de la
--    publicación, separado del estado editorial que marca el humano:
--      status        → editorial: borrador | programada | publicada  (humano)
--      publish_state → máquina:   pendiente | subiendo | programada |
--                                 publicada | error | manual         (verificado)
--    Colapsarlos sería mentir: "publicada" a mano no significa que la API lo
--    confirmara. El backfill deja las variantes viejas en 'manual' porque eso
--    es exactamente lo que eran — subidas a mano, sin que Hermes las tocara.

alter table content_pieces
  add column if not exists master_path text,
  add column if not exists publish_job jsonb;

-- Backfill honesto: si el run de edición dejó un master verificado, ese es el
-- master de la pieza. No se inventa nada para las demás.
update content_pieces
   set master_path = edit_job ->> 'output_path'
 where master_path is null
   and edit_job ->> 'status' = 'done'
   and coalesce(edit_job ->> 'output_path', '') <> '';

-- Cada variante existente pasa a 'manual' (provider incluido) sin perder nada.
update content_pieces
   set publications = (
     select jsonb_agg(
       pub
       || jsonb_build_object(
            'provider',        coalesce(pub ->> 'provider', 'manual'),
            'publish_state',   coalesce(pub ->> 'publish_state', 'manual'),
            'remote_id',       pub -> 'remote_id',
            'remote_url',      pub -> 'remote_url',
            'attempts',        coalesce(pub -> 'attempts', '0'::jsonb),
            'last_attempt_at', pub -> 'last_attempt_at',
            'last_error',      pub -> 'last_error'
          )
     )
     from jsonb_array_elements(publications) as pub
   )
 where jsonb_typeof(publications) = 'array'
   and jsonb_array_length(publications) > 0;

-- El sweep de publicación busca piezas programadas: índice por fecha objetivo.
create index if not exists content_pieces_publish_state_idx
  on content_pieces (status, publish_at)
  where status in ('programado', 'publicado');
