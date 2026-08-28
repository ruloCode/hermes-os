-- Hermes OS · migración 022 — Bucle de resultados del Estudio (fase YouTube)
--
-- Hasta aquí el sistema producía y publicaba a ciegas: cero ingesta de
-- métricas en todo el repo (auditoría 2026-08-10, docs/mejoras-flujo-contenido.md).
-- Estas dos tablas cierran el bucle con DATO REAL de la API — nunca estimado:
--
-- 1) `content_metrics`: snapshot por (video remoto × fuente × día). El job
--    `content-metrics-sync` upserta idempotente — correr dos veces el mismo
--    día no duplica nada. `source` distingue de dónde salió cada fila
--    ('youtube-analytics' | 'youtube-data' | 'ig-insights' | 'tiktok-display'
--    | 'manual' — la manual es un número real transcrito por Rulo de un
--    Studio, jamás una estimación).
--
-- 2) `content_retention`: la curva de audiencia de YouTube Analytics
--    (100 puntos elapsedVideoTimeRatio por video). Dice el SEGUNDO exacto del
--    abandono — el único criterio de corte que no es opinión. Se refresca
--    entera por video (delete + insert del sync).

create table if not exists content_metrics (
  id bigint generated always as identity primary key,
  piece_id bigint not null references content_pieces (id) on delete cascade,
  -- id de la variante dentro del jsonb publications de la pieza
  publication_id text not null,
  platform text not null,
  remote_id text not null,
  source text not null,
  day date not null,
  views bigint,
  -- métrica post-2025 de YouTube (vista con intención); null donde no aplique
  engaged_views bigint,
  avg_view_duration_s numeric,
  avg_view_pct numeric,
  watch_time_s bigint,
  likes int,
  comments int,
  shares int,
  saves int,
  subs_gained int,
  fetched_at timestamptz not null default now(),
  unique (remote_id, source, day)
);

create index if not exists content_metrics_piece_idx on content_metrics (piece_id, day desc);

create table if not exists content_retention (
  remote_id text not null,
  elapsed_ratio numeric not null,
  watch_ratio numeric,
  rel_performance numeric,
  fetched_at timestamptz not null default now(),
  primary key (remote_id, elapsed_ratio)
);

-- Deny-all: solo el service role del agente (mismo modelo que el resto del Estudio).
alter table content_metrics enable row level security;
alter table content_retention enable row level security;
