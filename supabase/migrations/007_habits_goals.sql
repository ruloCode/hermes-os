-- Hermes OS · migración 007 — Hábitos (check-ins + rachas) y metas personales
-- Coach de desarrollo personal: hábitos daily/weekly marcables por voz con
-- racha calculada en el agente (TS), y metas con progreso numérico o milestones.
-- Sin FK por convención del repo (habit_id suelto).

create table if not exists habits (
  id bigint generated always as identity primary key,
  local_key text unique,                 -- sha1('habit'|name lower) — no duplicar por nombre
  name text not null,
  cadence text not null default 'daily' check (cadence in ('daily','weekly')),
  -- Para weekly: cuántas veces por semana cuenta como cumplido (ej. gym 3x).
  times_per_week smallint not null default 7 check (times_per_week between 1 and 7),
  active boolean not null default true,
  created_at timestamptz default now(),
  archived_at timestamptz
);

create table if not exists habit_checkins (
  id bigint generated always as identity primary key,
  -- sha1('checkin'|habit_id|date) → 1 check-in por hábito/día; repetir
  -- "ya medité" el mismo día no duplica (upsert idempotente).
  local_key text unique,
  habit_id bigint not null,
  date date not null,                    -- America/Bogota
  done boolean not null default true,
  note text,
  source text not null default 'agent',  -- voice | chat | web | agent
  created_at timestamptz default now()
);
create index if not exists habit_checkins_habit_date_idx on habit_checkins (habit_id, date desc);

create table if not exists goals (
  id bigint generated always as identity primary key,
  local_key text unique,                 -- sha1('goal'|title lower)
  title text not null,
  description text,
  target_value numeric(14,2),            -- null = meta cualitativa (solo milestones)
  current_value numeric(14,2) not null default 0,
  unit text,                             -- 'libros', 'kg', 'USD', '%'
  milestones jsonb not null default '[]',-- [{title, done, done_at}]
  status text not null default 'active'
    check (status in ('active','paused','done','abandoned')),
  due_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  done_at timestamptz
);
create index if not exists goals_status_idx on goals (status);

-- RLS: deny-all sin policies; el service role (agente) la ignora.
alter table habits enable row level security;
alter table habit_checkins enable row level security;
alter table goals enable row level security;
