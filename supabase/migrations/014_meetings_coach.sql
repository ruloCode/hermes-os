-- Coach de juntas EN VIVO: métricas reales (ratio de habla, wpm, muletillas)
-- + evaluación de desempeño post-junta (score/highlights/improvements).
-- Solo lo llenan juntas con source='live'; el resto queda null.
alter table meetings add column if not exists coach jsonb;
