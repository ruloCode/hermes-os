-- Hermes OS · migración 003 — Reuniones/Juntas por proyecto
-- La verdad de una reunión vive como markdown en el vault
-- (projects/<slug>/reuniones/<fecha>.md). Estas tablas son el ESPEJO para
-- búsqueda semántica (pgvector) e historial/estado accesible desde otra Mac.
-- Sin FKs a propósito: el repo asocia por slug/id sueltos (como projects_cache).

create extension if not exists vector;

-- ── Reuniones (resumen + embedding del resumen) ───────────────────────
create table if not exists meetings (
  id bigint generated always as identity primary key,
  -- Idempotencia del espejo/backfill: sha1(project|meeting_id)
  local_key text unique,
  -- Ancla de la API = nombre del archivo del vault sin .md (ej: 2026-07-07-1830-kickoff)
  meeting_id text not null,
  project_slug text not null,
  title text not null,
  meeting_date timestamptz not null default now(),
  transcript text,
  summary text,
  -- Se embebe el RESUMEN (corto): un transcript largo no cabe en un vector
  -- (embed() trunca a 8000 chars).
  summary_embedding vector(1536),
  duration_sec int,
  source text default 'upload' check (source in ('audio','upload','paste')),
  stt_provider text,
  participants text[] default '{}',
  machine text,
  -- Ruta del .md en el vault (fuente de verdad).
  vault_path text,
  created_at timestamptz default now()
);

create index if not exists meetings_project_date_idx
  on meetings (project_slug, meeting_date desc);
create index if not exists meetings_embedding_idx
  on meetings using hnsw (summary_embedding vector_cosine_ops);

-- Los 2 accionables propuestos de una reunión viven en el frontmatter del .md;
-- se vuelven `tasks` (migración 004) solo al triarlos. No hay tabla dedicada.

-- ── RPC: búsqueda semántica sobre resúmenes, filtrable por proyecto ────
-- Mismo ranking que match_memories (85% similitud + 15% recencia a 90 días).
create or replace function match_meetings(
  query_embedding vector(1536),
  match_count int default 8,
  filter_project text default null
)
returns table (
  id bigint,
  meeting_id text,
  project_slug text,
  title text,
  summary text,
  meeting_date timestamptz,
  similarity float
)
language sql stable
as $$
  select
    m.id, m.meeting_id, m.project_slug, m.title, m.summary, m.meeting_date,
    1 - (m.summary_embedding <=> query_embedding) as similarity
  from meetings m
  where m.summary_embedding is not null
    and (filter_project is null or m.project_slug = filter_project)
  order by
    (1 - (m.summary_embedding <=> query_embedding)) * 0.85
    + greatest(0, 1 - extract(epoch from (now() - m.meeting_date)) / (90*24*3600)) * 0.15
    desc
  limit match_count;
$$;

-- ── RLS: deny-all sin policies; el service role (agente) la ignora ─────
alter table meetings enable row level security;
