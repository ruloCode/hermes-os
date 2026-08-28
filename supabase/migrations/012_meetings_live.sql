-- Hermes OS · migración 012 — Reuniones EN VIVO (copiloto de juntas)
-- Amplía el CHECK de meetings.source con 'live': la junta capturada por el
-- mic de la Mac con STT streaming (AssemblyAI) entra al MISMO pipeline de
-- ingest que audio/upload/paste. El constraint nació inline en la migración
-- 003 → Postgres lo nombró meetings_source_check.

alter table meetings drop constraint if exists meetings_source_check;
alter table meetings add constraint meetings_source_check
  check (source in ('audio', 'upload', 'paste', 'live'));
