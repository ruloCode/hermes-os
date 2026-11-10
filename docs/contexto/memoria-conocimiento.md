# Memoria y capa de conocimiento

> Cuándo leerlo: tocar memorias, búsqueda de conocimiento, embeddings o el vault como fuente.

- Memoria/preferencias/presencia viven en **Supabase** (pgvector); el **vault de Obsidian** es la verdad de proyectos (frontmatter `estado` + secciones "Estado Actual"/"Tareas Pendientes").
- **Capa de conocimiento unificada** (migraciones 009/010): el RPC `match_knowledge` busca semánticamente en memorias + reuniones + ejecuciones + conversaciones (texto/voz) + vault (`vault_docs`). Cliente en `apps/agent/src/knowledge.ts`; backfill: `pnpm backfill:knowledge`.
