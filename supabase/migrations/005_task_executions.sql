-- Hermes OS · migración 005 — Ejecuciones de tareas (memoria de Control de Misión)
-- Cada vez que una tarea del tracker se ejecuta (Ejecutar) o continúa (Continuar)
-- se genera un documento con {prompt · análisis · resultado}. La VERDAD vive como
-- markdown en el vault (projects/<slug>/ejecuciones/<id>.md); esta tabla es el
-- ESPEJO para historial/estado accesible desde otra Mac y consulta rápida por tarea.
-- Sin FKs a propósito: se asocia por task_id/run_id sueltos (como el resto del repo).

create table if not exists task_executions (
  id bigint generated always as identity primary key,
  -- Idempotencia del espejo: sha1(project_slug|run_id). Un run = una ejecución.
  local_key text unique,
  -- Ancla de la API = nombre del archivo del vault sin .md (ej: 2026-07-07-1830-a1b2c3d4).
  execution_id text not null,
  -- Tarea del tracker que se ejecutó (suelto, sin FK a `tasks`).
  task_id bigint,
  project_slug text not null,
  -- Punteros a la corrida de Claude Code (run efímero + sesión persistida en disco).
  run_id text,
  session_id text,
  -- execute = sesión nueva (Ejecutar) · continue = resume de la sesión (Continuar).
  kind text not null default 'execute' check (kind in ('execute','continue')),
  -- done = el run cerró con código 0 · error = falló/cancelado.
  status text not null default 'done' check (status in ('done','error')),
  -- Prompt de intención que se mandó (exec_prompt o el de continuar).
  prompt text,
  -- Narrativa del pase LLM ("qué se hizo, por qué, qué se logró") + trace de pasos.
  analysis text,
  -- Resultado final (último texto del asistente, sin recorte).
  result text,
  model text,
  effort text,
  -- Métricas reales del run (del evento result del CLI). numeric por el costo en USD.
  cost_usd numeric,
  duration_ms int,
  num_turns int,
  machine text,
  -- Ruta del .md en el vault (fuente de verdad).
  vault_path text,
  created_at timestamptz default now(),
  finished_at timestamptz
);

-- Listar las ejecuciones de una tarea, de la más reciente a la más vieja.
create index if not exists task_executions_task_idx
  on task_executions (task_id, created_at desc);
-- Historial por proyecto (backfill / vista global futura).
create index if not exists task_executions_project_idx
  on task_executions (project_slug, created_at desc);
-- Cruce por run (reconciliación / dedup).
create index if not exists task_executions_run_idx
  on task_executions (run_id);

-- RLS: deny-all sin policies; el service role (agente) la ignora.
alter table task_executions enable row level security;
