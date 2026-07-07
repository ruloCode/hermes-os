# Hermes OS — contexto para Claude Code

Monorepo pnpm. Dos procesos: `apps/web` (Next.js 15, dashboard "AGENTIC OS") y `apps/agent` (Hono :8642, Claude Agent SDK). Tipos compartidos en `packages/shared`.

## Arquitectura en 5 líneas
- La voz (ElevenLabs Agents) usa **client tools que corren en el browser** y llaman a `localhost:8642` — sin túnel. El LLM de voz solo rutea; el trabajo real lo hace el Agent SDK vía `POST /tasks` (async, `task_id` inmediato).
- El chat de texto usa el **contrato Hermes**: `POST /v1/chat/completions` OpenAI-compatible SSE + header `X-Hermes-Session-Id` (resume de sesión SDK).
- Memoria/preferencias/presencia viven en **Supabase** (pgvector, RPC `match_memories`); el **vault de Obsidian** es la verdad de proyectos (frontmatter `estado` + secciones "Estado Actual"/"Tareas Pendientes").
- Guardrails en `apps/agent/src/agent/guardrails.ts`: Bash/Write/Edit pasan por `canUseTool`; las tools seguras van en `allowedTools`.
- Actividad en vivo: bus en memoria → SSE `/events` → ActivityFeed; espejo en `agent_activity` (Realtime).

## Convenciones
- Español en UI, comentarios y mensajes. Código y nombres en inglés.
- El `.env` vive en la RAÍZ del monorepo (no en apps/).
- No agregar dependencias pesadas al dashboard sin necesidad; el grafo es canvas puro.
- `pnpm typecheck` antes de commitear.

## Pendientes conocidos
- Verificar payloads exactos de ElevenLabs al correr `pnpm setup:elevenlabs` por primera vez (tools API).
- Fase 5: túnel cloudflared + fallback Custom-LLM (el contrato ya es OpenAI-compatible a propósito).
