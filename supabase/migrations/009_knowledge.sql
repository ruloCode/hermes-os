-- Hermes OS · migración 009 — Capa de conocimiento unificada
-- Objetivo: que TODO lo que Hermes sabe sea buscable semánticamente desde un
-- solo punto (RPC match_knowledge): memorias, reuniones, ejecuciones de tareas,
-- conversaciones (texto y voz) y notas del vault de Obsidian.
--
-- Piezas:
--   1) embedding en task_executions y conversation_messages (espejos ya existentes)
--   2) channel en conversation_messages ('text' consola · 'voice' ElevenLabs)
--   3) vault_docs: índice vectorial del vault (hash-based, lo sincroniza el agente)
--   4) memories.use_count/last_used_at + RPC touch_memories (refuerzo por uso)
--   5) match_memories v2: el ranking ahora pesa la importancia (antes se ignoraba)
--   6) match_knowledge: búsqueda unificada cross-fuente con ranking por score

-- ── 1) Embeddings en los espejos existentes ────────────────────────────
alter table task_executions
  add column if not exists embedding vector(1536);
create index if not exists task_executions_embedding_idx
  on task_executions using hnsw (embedding vector_cosine_ops);

alter table conversation_messages
  add column if not exists embedding vector(1536);
create index if not exists conversation_messages_embedding_idx
  on conversation_messages using hnsw (embedding vector_cosine_ops);

-- ── 2) Canal del mensaje: consola ('text') o transcript de voz ('voice') ─
alter table conversation_messages
  add column if not exists channel text not null default 'text'
  check (channel in ('text','voice'));

-- ── 3) Índice vectorial del vault de Obsidian ──────────────────────────
-- La VERDAD sigue siendo el .md en disco; esta tabla es el índice semántico.
-- El agente la sincroniza por hash (solo re-embebe lo que cambió).
create table if not exists vault_docs (
  id bigint generated always as identity primary key,
  -- Ruta relativa al vault (ej: projects/ternium/Ternium.md). Única: un doc = una fila.
  path text not null unique,
  -- Slug si vive bajo projects/<slug>/ (para filtrar por proyecto).
  project_slug text,
  title text not null,
  -- Cuerpo markdown sin frontmatter, recortado (el embedding trunca a 8000 chars).
  content text not null,
  -- sha1 del archivo completo: si no cambió, no se re-embebe.
  content_hash text not null,
  embedding vector(1536),
  machine text,
  updated_at timestamptz default now()
);

create index if not exists vault_docs_project_idx on vault_docs (project_slug);
create index if not exists vault_docs_embedding_idx
  on vault_docs using hnsw (embedding vector_cosine_ops);

alter table vault_docs enable row level security;

-- ── 4) Refuerzo por uso: qué memorias se recuperan de verdad ───────────
alter table memories add column if not exists use_count int not null default 0;
alter table memories add column if not exists last_used_at timestamptz;

create or replace function touch_memories(ids uuid[])
returns void
language sql
as $$
  update memories
  set use_count = use_count + 1, last_used_at = now()
  where id = any(ids);
$$;

-- ── 5) match_memories v2: similitud + recencia + IMPORTANCIA ───────────
-- Antes: 85% similitud + 15% recencia (importance existía pero no rankeaba).
-- Ahora: 70% similitud + 15% recencia (~90 días) + 15% importancia (1-5).
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
    (1 - (m.embedding <=> query_embedding)) * 0.70
    + greatest(0, 1 - extract(epoch from (now() - m.created_at)) / (90*24*3600)) * 0.15
    + (coalesce(m.importance, 3) / 5.0) * 0.15
    desc
  limit match_count;
$$;

-- ── 6) match_knowledge: búsqueda unificada en todo lo que Hermes sabe ──
-- Cada fuente saca sus top-N por distancia (usa su índice HNSW) y luego se
-- re-rankea el conjunto por score. Pesos por fuente:
--   memory:       70% similitud + 15% recencia (90d) + 15% importancia
--   meeting:      80% similitud + 20% recencia (180d)
--   execution:    80% similitud + 20% recencia (120d)
--   conversation: 75% similitud + 25% recencia (60d)  — el chat envejece rápido
--   vault:        85% similitud + 15% frescura de sync (365d) — casi atemporal
create or replace function match_knowledge(
  query_embedding vector(1536),
  match_count int default 12,
  filter_sources text[] default null,
  filter_project text default null
)
returns table (
  source text,
  ref text,
  title text,
  content text,
  project_slug text,
  created_at timestamptz,
  similarity float,
  score float
)
language sql stable
as $$
  with hits as (
    (
      select
        'memory'::text as source,
        m.id::text as ref,
        coalesce(m.summary, left(m.content, 120)) as title,
        m.content,
        m.project_slug,
        m.created_at,
        1 - (m.embedding <=> query_embedding) as similarity,
        (1 - (m.embedding <=> query_embedding)) * 0.70
          + greatest(0, 1 - extract(epoch from (now() - m.created_at)) / (90*24*3600)) * 0.15
          + (coalesce(m.importance, 3) / 5.0) * 0.15 as score
      from memories m
      where m.embedding is not null
        and (filter_sources is null or 'memory' = any(filter_sources))
        and (filter_project is null or m.project_slug = filter_project)
      order by m.embedding <=> query_embedding
      limit match_count
    )
    union all
    (
      select
        'meeting',
        mt.meeting_id,
        mt.title,
        coalesce(mt.summary, ''),
        mt.project_slug,
        mt.meeting_date,
        1 - (mt.summary_embedding <=> query_embedding),
        (1 - (mt.summary_embedding <=> query_embedding)) * 0.80
          + greatest(0, 1 - extract(epoch from (now() - mt.meeting_date)) / (180*24*3600)) * 0.20
      from meetings mt
      where mt.summary_embedding is not null
        and (filter_sources is null or 'meeting' = any(filter_sources))
        and (filter_project is null or mt.project_slug = filter_project)
      order by mt.summary_embedding <=> query_embedding
      limit match_count
    )
    union all
    (
      select
        'execution',
        te.execution_id,
        coalesce(left(te.prompt, 120), 'ejecución'),
        coalesce(te.analysis, '') || E'\n' || coalesce(te.result, ''),
        te.project_slug,
        te.created_at,
        1 - (te.embedding <=> query_embedding),
        (1 - (te.embedding <=> query_embedding)) * 0.80
          + greatest(0, 1 - extract(epoch from (now() - te.created_at)) / (120*24*3600)) * 0.20
      from task_executions te
      where te.embedding is not null
        and (filter_sources is null or 'execution' = any(filter_sources))
        and (filter_project is null or te.project_slug = filter_project)
      order by te.embedding <=> query_embedding
      limit match_count
    )
    union all
    (
      select
        'conversation',
        cm.id::text,
        cm.role || ' · ' || cm.project_slug || case when cm.channel = 'voice' then ' (voz)' else '' end,
        cm.content,
        cm.project_slug,
        cm.ts,
        1 - (cm.embedding <=> query_embedding),
        (1 - (cm.embedding <=> query_embedding)) * 0.75
          + greatest(0, 1 - extract(epoch from (now() - cm.ts)) / (60*24*3600)) * 0.25
      from conversation_messages cm
      where cm.embedding is not null
        and (filter_sources is null or 'conversation' = any(filter_sources))
        and (filter_project is null or cm.project_slug = filter_project)
      order by cm.embedding <=> query_embedding
      limit match_count
    )
    union all
    (
      select
        'vault',
        vd.path,
        vd.title,
        vd.content,
        vd.project_slug,
        vd.updated_at,
        1 - (vd.embedding <=> query_embedding),
        (1 - (vd.embedding <=> query_embedding)) * 0.85
          + greatest(0, 1 - extract(epoch from (now() - vd.updated_at)) / (365*24*3600)) * 0.15
      from vault_docs vd
      where vd.embedding is not null
        and (filter_sources is null or 'vault' = any(filter_sources))
        and (filter_project is null or vd.project_slug = filter_project)
      order by vd.embedding <=> query_embedding
      limit match_count
    )
  )
  select * from hits
  order by score desc
  limit match_count;
$$;
