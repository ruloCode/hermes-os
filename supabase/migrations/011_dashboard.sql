-- Hermes OS · migración 011 — Datos del rediseño del dashboard
-- 1) RPC activity_hourly: serie horaria de agent_activity para el área chart
--    de "ACTIVIDAD 24H" (PostgREST no agrega, y traer filas crudas choca con
--    el cap de ~1000 filas del cliente en un día activo).
-- 2) Tokens por run en task_executions: el evento result del CLI trae usage
--    (input/output/cache) que antes se descartaba; ahora se persiste junto a
--    cost_usd/num_turns para poder consultarlo después.

create or replace function activity_hourly(hours int default 24)
returns table (
  hour timestamptz,
  total bigint,
  tool_calls bigint,
  tasks bigint,
  errors bigint
)
language sql stable
as $$
  select
    date_trunc('hour', created_at) as hour,
    count(*) as total,
    count(*) filter (where kind in ('tool_call', 'tool_result')) as tool_calls,
    count(*) filter (where kind in ('task_start', 'task_done')) as tasks,
    count(*) filter (where kind = 'error') as errors
  from agent_activity
  where created_at > now() - make_interval(hours => hours)
  group by 1
  order by 1;
$$;

alter table task_executions
  add column if not exists input_tokens int,
  add column if not exists output_tokens int,
  add column if not exists cache_creation_tokens int,
  add column if not exists cache_read_tokens int;
