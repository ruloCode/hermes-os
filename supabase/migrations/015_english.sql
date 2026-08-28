-- Hermes OS · migración 015 — Práctica de inglés (tutor de voz ElevenLabs)
-- Sesiones de conversación con el tutor (errores/aciertos/fluidez + reporte
-- post-sesión generado por el Agent SDK) y vocabulario con spaced repetition
-- simple. Sin FK por convención del repo; RLS deny-all (el service role la ignora).

create table if not exists english_sessions (
  id bigint generated always as identity primary key,
  local_key text unique,                 -- sha1('english'|started_at iso) — idempotente
  started_at timestamptz not null,
  duration_sec int,
  topics text[] not null default '{}',
  fluency smallint check (fluency between 1 and 5),
  errors jsonb not null default '[]',    -- [{quote, correction, note_es}]
  wins jsonb not null default '[]',      -- [string]
  transcript text,
  report_md text,                        -- reporte post-sesión (english/report.ts)
  report_status text not null default 'pending'
    check (report_status in ('pending','running','done','skipped','error')),
  source text not null default 'web',    -- web | mobile | meeting (sesión pasiva)
  created_at timestamptz default now()
);
create index if not exists english_sessions_started_idx on english_sessions (started_at desc);

create table if not exists english_vocab (
  id bigint generated always as identity primary key,
  local_key text unique,                 -- sha1('vocab'|term lower) — no duplicar términos
  term text not null,
  meaning_es text not null,
  example text,
  times_reviewed int not null default 0,
  last_reviewed_at timestamptz,
  learned boolean not null default false,
  created_at timestamptz default now()
);
create index if not exists english_vocab_due_idx on english_vocab (learned, last_reviewed_at);

alter table english_sessions enable row level security;
alter table english_vocab enable row level security;
