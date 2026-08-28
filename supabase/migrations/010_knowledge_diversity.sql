-- Hermes OS · migración 010 — Diversidad de fuentes en match_knowledge
-- Problema detectado en pruebas: el LIMIT global por score dejaba que los
-- turnos de chat recientes (boost de recencia) llenaran TODO el resultado y
-- las demás fuentes (memorias, vault, reuniones) ni siquiera llegaban al
-- cliente. Ahora ninguna fuente puede ocupar más de la mitad del resultado
-- (mínimo 2 por fuente); el cliente además dedupea contenidos casi idénticos.
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
  select h.source, h.ref, h.title, h.content, h.project_slug, h.created_at, h.similarity, h.score
  from (
    select hits.*,
      row_number() over (partition by hits.source order by hits.score desc) as source_rank
    from hits
  ) h
  -- Diversidad: ninguna fuente pasa de la mitad del pedido (mínimo 2).
  where h.source_rank <= greatest(2, match_count / 2)
  order by h.score desc
  limit match_count;
$$;
