-- Hermes OS · migración 025 — Aprendizaje + tareas programadas
--
-- Dos huecos que hermes-agent (Nous) tiene resueltos y aquí faltaban:
--
-- 1) APRENDIZAJE. Hermes ya recuerda HECHOS (memories + pgvector), pero no
--    PROCEDIMIENTOS: cada vez que resolvía algo multi-paso, la próxima sesión
--    empezaba de cero. Ahora una revisión en background propone skills y
--    ajustes al perfil, y nada entra sin decisión humana: las propuestas
--    viven aquí (learning_proposals) y se ven en el dashboard.
--    Las skills en sí son ARCHIVOS (~/.hermes-os/plugin/skills/<n>/SKILL.md)
--    porque el CLI de Claude Code las carga del disco; esta tabla solo
--    guarda su telemetría de uso para que el curador archive las muertas.
--
-- 2) TAREAS PROGRAMADAS. "cada lunes a las 8 dime qué tengo atascado" no
--    tenía dónde vivir: el registry de jobs es memoria pura y se borra al
--    reiniciar. Estas sí sobreviven, con tres reglas aprendidas de Nous:
--    el modelo queda CONGELADO al crear (cambiar HERMES_MODEL no mueve una
--    tarea vieja), el reintento solo aplica si la corrida no gastó nada, y
--    tras 3 fallos seguidos la tarea se bloquea sola — un job mal
--    configurado no debe quemar tokens para siempre.

-- ── Propuestas de aprendizaje ──────────────────────────────────────────
create table if not exists learning_proposals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('skill_create', 'skill_patch', 'profile', 'memory')),
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  rationale text not null default '',
  source text not null default 'chat',
  source_ref text,
  status text not null default 'pending' check (status in ('pending', 'applied', 'rejected', 'failed')),
  error text,
  machine text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists learning_proposals_pending_idx
  on learning_proposals (created_at desc) where status = 'pending';

-- ── Telemetría de skills (el disco manda; esto solo cuenta uso) ────────
create table if not exists skill_usage (
  name text primary key,
  created_by text not null default 'agent' check (created_by in ('agent', 'human')),
  use_count int not null default 0,
  last_used_at timestamptz,
  pinned boolean not null default false,
  state text not null default 'active' check (state in ('active', 'stale', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── Tareas programadas ─────────────────────────────────────────────────
create table if not exists scheduled_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  prompt text not null,
  -- cron de 5 campos (min hora dom mes dow) evaluado en tz, no en UTC.
  cron text not null,
  tz text not null default 'America/Bogota',
  skills text[] not null default '{}',
  -- Congelado al crear: un cambio global de modelo NUNCA mueve una tarea vieja.
  model text,
  project text,
  deliver jsonb not null default '{"notify":true}'::jsonb,
  enabled boolean not null default true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  last_status text check (last_status in ('ok', 'error')),
  last_output text,
  consecutive_failures int not null default 0,
  -- Reintento 5/15/30 min SOLO si la corrida falló sin llamar al modelo.
  retry_at timestamptz,
  -- Se llena tras 3 fallos seguidos: deja de correr sola hasta que la revises.
  blocked_reason text,
  -- Firma del error repetido: el aviso sale UNA vez, no en cada corrida.
  incident_signature text,
  incident_acked boolean not null default false,
  machine text,
  created_by text not null default 'agent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_tasks_due_idx
  on scheduled_tasks (next_run_at) where enabled and blocked_reason is null;

create table if not exists scheduled_task_runs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references scheduled_tasks (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'ok' check (status in ('ok', 'error')),
  output text,
  error text,
  tool_calls int not null default 0,
  duration_ms int,
  attempt int not null default 1,
  machine text
);

create index if not exists scheduled_task_runs_task_idx
  on scheduled_task_runs (task_id, started_at desc);

-- Solo service_role (el agente). Igual que el resto de tablas internas.
alter table learning_proposals enable row level security;
alter table skill_usage enable row level security;
alter table scheduled_tasks enable row level security;
alter table scheduled_task_runs enable row level security;
