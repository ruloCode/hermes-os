-- Hermes OS · migración 006 — Finanzas personales (transacciones + presupuestos)
-- Registro de gastos/ingresos dictados por voz/chat con categorización del LLM.
-- Supabase-first (sin espejo en vault): datos estructurados de alta frecuencia.
-- Moneda por movimiento: COP default, USD explícito. Sin FK por convención.

create table if not exists transactions (
  id bigint generated always as identity primary key,
  -- Idempotencia voz: sha1('tx'|kind|amount|currency|category|occurred_on|note).
  -- Repetir la misma frase el mismo día colisiona A PROPÓSITO (retry de la voz
  -- no duplica); allow_duplicate del store agrega sufijo random para forzar.
  local_key text unique,
  kind text not null check (kind in ('expense','income')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'COP' check (currency in ('COP','USD')),
  -- Sin CHECK: el set canónico vive en FINANCE_CATEGORIES (@hermes/shared);
  -- ampliar categorías no debe requerir migración.
  category text not null default 'otros',
  account text,                          -- opcional: 'bancolombia', 'efectivo', 'tc'
  note text,                             -- lo que dijo: "el súper"
  occurred_on date not null,             -- fecha en America/Bogota (la calcula el agente)
  source text not null default 'agent',  -- voice | chat | web | agent
  machine text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  -- Soft-delete: "bórrala" anula sin perder el rastro (correcciones auditables).
  voided_at timestamptz
);

create index if not exists transactions_occurred_idx on transactions (occurred_on desc);
create index if not exists transactions_cat_occurred_idx on transactions (category, occurred_on desc);
create index if not exists transactions_kind_occurred_idx on transactions (kind, occurred_on desc);

create table if not exists budgets (
  id bigint generated always as identity primary key,
  category text not null unique,         -- un presupuesto por categoría, aplica cada mes
  monthly_limit numeric(14,2) not null check (monthly_limit > 0),
  currency text not null default 'COP' check (currency in ('COP','USD')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS: deny-all sin policies; el service role (agente) la ignora.
alter table transactions enable row level security;
alter table budgets enable row level security;
