-- Hermes OS · migración 024 — Máquinas de la red interna (multi-PC)
-- El heartbeat de agent_presence ya decía QUIÉN está vivo pero no CÓMO
-- alcanzarlo: el dashboard tenía que hornear las URLs en una env
-- (NEXT_PUBLIC_HERMES_AGENTS) y eso no es descubrimiento, es una lista a mano.
--
-- Ahora cada agente publica su propia dirección LAN y de qué es capaz, así el
-- selector de máquina se arma solo: enciendes el PC y aparece; lo apagas y se
-- va a offline a los 90 s (la tabla ya está en supabase_realtime).
--
-- capabilities es jsonb a propósito: cada máquina tiene un subconjunto real de
-- Hermes (el Windows no controla Chrome por AppleScript ni inyecta CGEvents),
-- y la UI necesita decir la verdad sobre lo que ese PC puede hacer.

alter table agent_presence add column if not exists base_url text;
alter table agent_presence add column if not exists lan_ip text;
alter table agent_presence add column if not exists os text;
alter table agent_presence add column if not exists capabilities jsonb;
