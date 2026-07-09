-- Hermes OS · migración 004 — Tareas (tracker de misión por proyecto)
-- Tarea de primera clase con ciclo de vida. Verdad del ESTADO aquí; espejo
-- humano en "## Tareas Pendientes" de la nota del vault (checkbox, [x] al hacer).
-- Fuentes: meeting (triage de junta) · manual · vault (import) · voice.
-- Sin FK por convención del repo (project_slug/meeting_id sueltos).

-- Por si se aplica en un entorno donde 003 vieja creó la tabla superada.
drop table if exists meeting_actionables;

create table if not exists tasks (
  id bigint generated always as identity primary key,
  -- Idempotencia: meeting=sha1(project|meeting|id|idx), vault=sha1(project|vault|title), etc.
  local_key text unique,
  project_slug text not null,
  title text not null,
  detail text,
  -- Prompt para ejecutar la tarea con `claude -p` (accionables de junta lo traen).
  exec_prompt text,
  status text not null default 'pending'
    check (status in ('pending','running','done','dismissed')),
  source text not null default 'manual'
    check (source in ('meeting','manual','vault','voice')),
  -- Procedencia si viene de una reunión.
  meeting_id text,
  meeting_idx smallint,
  -- Ejecución en Claude Code.
  run_id text,
  session_id text,
  machine text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  done_at timestamptz
);

create index if not exists tasks_project_status_idx on tasks (project_slug, status);
create index if not exists tasks_project_created_idx on tasks (project_slug, created_at desc);
create index if not exists tasks_meeting_idx on tasks (meeting_id);

-- RLS: deny-all sin policies; el service role (agente) la ignora.
alter table tasks enable row level security;
