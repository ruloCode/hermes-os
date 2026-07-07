-- Hermes OS · migración inicial
-- Aplica en el proyecto Supabase (SQL Editor o CLI). Requiere pgvector.

create extension if not exists vector;

-- ── Memorias del agente (fuente de verdad para memoria/preferencias) ──
create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('user','feedback','project','reference','daily','agent')),
  content text not null,
  summary text,
  embedding vector(1536),
  project_slug text,
  tags text[] default '{}',
  importance smallint default 3 check (importance between 1 and 5),
  source text default 'agent',        -- voice | chat | agent | migration
  machine text,
  session_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists memories_type_created_idx on memories (type, created_at desc);
create index if not exists memories_project_idx on memories (project_slug);
-- HNSW para búsqueda semántica por coseno
create index if not exists memories_embedding_idx on memories
  using hnsw (embedding vector_cosine_ops);

-- ── Preferencias del usuario ──────────────────────────────────────────
create table if not exists preferences (
  key text primary key,
  value jsonb not null,
  source text default 'agent',
  updated_at timestamptz default now()
);

-- ── Sesiones de conversación (texto y voz) ────────────────────────────
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  sdk_session_id text,
  channel text default 'text' check (channel in ('text','voice','task')),
  title text,
  summary text,
  machine text,
  started_at timestamptz default now(),
  ended_at timestamptz
);

-- ── Log de actividad del agente (Realtime ON) ─────────────────────────
create table if not exists agent_activity (
  id bigint generated always as identity primary key,
  session_id uuid,
  task_id text,
  kind text not null,
  tool_name text,
  payload jsonb default '{}',
  machine text,
  created_at timestamptz default now()
);

create index if not exists agent_activity_created_idx on agent_activity (created_at desc);

-- ── Presencia por máquina (Realtime ON) ───────────────────────────────
create table if not exists agent_presence (
  machine text primary key,
  status text default 'idle' check (status in ('idle','working','thinking','offline')),
  current_task text,
  last_heartbeat timestamptz default now(),
  version text
);

-- ── Cache de proyectos del vault (para dashboards remotos) ────────────
create table if not exists projects_cache (
  slug text primary key,
  name text not null,
  estado text,
  rama text,
  ruta_local text,
  estado_actual text,
  tareas_pendientes jsonb default '[]',
  synced_at timestamptz default now()
);

-- ── RPC: búsqueda semántica con mezcla de recencia ────────────────────
create or replace function match_memories(
  query_embedding vector(1536),
  match_count int default 8,
  filter_type text default null
)
returns table (
  id uuid,
  type text,
  content text,
  summary text,
  project_slug text,
  tags text[],
  importance smallint,
  created_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    m.id, m.type, m.content, m.summary, m.project_slug, m.tags,
    m.importance, m.created_at,
    1 - (m.embedding <=> query_embedding) as similarity
  from memories m
  where m.embedding is not null
    and (filter_type is null or m.type = filter_type)
  order by
    -- 85% similitud, 15% recencia (decae en ~90 días)
    (1 - (m.embedding <=> query_embedding)) * 0.85
    + greatest(0, 1 - extract(epoch from (now() - m.created_at)) / (90*24*3600)) * 0.15
    desc
  limit match_count;
$$;

-- Realtime para presencia y actividad
alter publication supabase_realtime add table agent_activity;
alter publication supabase_realtime add table agent_presence;
