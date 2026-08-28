-- Hermes OS · migración 008 — Billeteras (saldo actual por cuenta)
-- El "saldo actual" de Rulo vive repartido en billeteras (bancolombia, nu,
-- nequi, ontop…). El saldo se fija conversacionalmente ("tengo 55 mil en
-- nequi") y se AJUSTA automáticamente con cada transacción que indique
-- billetera (gasto resta, ingreso suma) — recalibrable en cualquier momento.

create table if not exists wallets (
  id bigint generated always as identity primary key,
  local_key text unique,                 -- sha1('wallet'|name lower)
  name text not null,
  currency text not null default 'COP' check (currency in ('COP','USD')),
  balance numeric(14,2) not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS: deny-all sin policies; el service role (agente) la ignora.
alter table wallets enable row level security;
