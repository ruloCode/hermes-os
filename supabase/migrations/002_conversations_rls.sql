-- Hermes OS · migración 002
-- 1) Tabla de mensajes de conversación (espejo en nube del historial de consola)
-- 2) RLS ON en todas las tablas: solo el service role (agente server-side) accede.
--    La publishable/anon key queda sin acceso. Si el dashboard llega a leer
--    Supabase directo con la anon key, se agregan policies read-only aparte.

-- ── Mensajes de conversación de la consola ────────────────────────────
create table if not exists conversation_messages (
  id bigint generated always as identity primary key,
  -- Clave determinística para idempotencia del backfill: sha1(proyecto|archivo|índice)
  local_key text unique,
  project_slug text not null,
  role text not null check (role in ('user','assistant')),
  content text not null,
  ts timestamptz not null default now(),
  session_id text,
  machine text,
  -- null = conversación activa; slug del archivo si viene del archive
  chat_id text,
  created_at timestamptz default now()
);

create index if not exists conversation_messages_project_ts_idx
  on conversation_messages (project_slug, ts desc);

-- ── RLS: activar en todas las tablas (deny-all sin policies) ───────────
-- El service role IGNORA RLS, así que el agente sigue funcionando.
alter table memories             enable row level security;
alter table preferences          enable row level security;
alter table sessions             enable row level security;
alter table agent_activity       enable row level security;
alter table agent_presence       enable row level security;
alter table projects_cache       enable row level security;
alter table conversation_messages enable row level security;
