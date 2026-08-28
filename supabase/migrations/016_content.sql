-- Hermes OS · migración 016 — Estudio de contenido (marca RuloCode)
-- Piezas del pipeline de producción (idea → guion → grabado → editado →
-- programado → publicado), sesiones de grabación batch y radar de
-- tendencias/referentes. Sin FK por convención del repo; RLS deny-all
-- (el service role del agente la ignora).

create table if not exists content_pieces (
  id bigint generated always as identity primary key,
  local_key text unique,                 -- sha1('piece'|title lower) — seed/creación idempotente
  title text not null,
  pillar text not null default 'p1' check (pillar in ('p1','p2','p3','p4','p5')),
  platforms text[] not null default '{}',
  format text not null default 'vertical'
    check (format in ('pilar','vertical','post','carrusel','otro')),
  status text not null default 'idea'
    check (status in ('idea','guion','grabado','editado','programado','publicado','descartada')),
  publish_at timestamptz,
  week_label text,                       -- etiqueta de planeación, ej. 'M1·S1'
  hook text,
  script_md text,                        -- guion markdown (editable en la UI, espejo al vault)
  takes jsonb not null default '[]',     -- [{id,label,range,verdict,note}]
  edit_points jsonb not null default '[]', -- [{id,tc,kind,note}] para el kit Divisual
  publications jsonb not null default '[]', -- [{id,platform,title,copy,scheduled_at,status}]
  linear_identifier text,                -- RUL-x del issue enlazado
  linear_url text,
  session_id bigint,                     -- content_sessions.id (sin FK, convención)
  vault_path text,                       -- espejo .md relativo al vault
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()   -- se bumpea desde el store (sin triggers, convención)
);
create index if not exists content_pieces_status_idx on content_pieces (status, publish_at);
create index if not exists content_pieces_publish_idx on content_pieces (publish_at desc);

create table if not exists content_sessions (
  id bigint generated always as identity primary key,
  local_key text unique,                 -- sha1('csession'|scheduled_at iso)
  title text not null,
  scheduled_at timestamptz,
  status text not null default 'planeada'
    check (status in ('planeada','en_curso','completada','cancelada')),
  checklist jsonb not null default '[]', -- [{label,done}]
  folder text,                           -- carpeta local de grabación
  notes text,
  created_at timestamptz default now()
);
create index if not exists content_sessions_sched_idx on content_sessions (scheduled_at desc);

create table if not exists content_refs (
  id bigint generated always as identity primary key,
  local_key text unique,                 -- sha1('ref'|kind|title lower)
  kind text not null check (kind in ('tendencia','referente','guardada')),
  title text not null,
  body text,
  metric text,                           -- dato corto de cabecera, ej. '+53%'
  source text,
  apply_status text check (apply_status in ('aplicado','probar','observar')),
  pillar text check (pillar in ('p1','p2','p3','p4','p5')),
  created_at timestamptz default now()
);

alter table content_pieces enable row level security;
alter table content_sessions enable row level security;
alter table content_refs enable row level security;
