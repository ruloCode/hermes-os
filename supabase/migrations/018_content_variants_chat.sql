-- Hermes OS · migración 018 — Variantes del guion + chat por pieza (ESTUDIO)
--
-- 1) `variants`: pool de versiones alternativas por PARTE del guion
--    ("hook" o la etiqueta del beat: "[0-3s]", "Bloque 2"). Cada una:
--    { id, part, text, angle, source: 'hermes'|'manual', created_at }.
--    La versión ACTIVA no vive aquí: es el texto real en hook/script_md —
--    elegir una variante lo reescribe (una sola fuente de verdad, el
--    teleprompter y el espejo del vault no cambian de contrato).
-- 2) Chat por pieza: historial persistente (content_chat_messages) +
--    `chat_session_id` (sesión SDK a resumir — la conversación tiene
--    memoria entre visitas).

alter table content_pieces add column if not exists variants jsonb not null default '[]';
alter table content_pieces add column if not exists chat_session_id text;

create table if not exists content_chat_messages (
  id bigint generated always as identity primary key,
  piece_id bigint not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists content_chat_piece_idx on content_chat_messages (piece_id, created_at);

-- Mismo modelo de acceso que el resto del Estudio: deny-all, solo service key.
alter table content_chat_messages enable row level security;
