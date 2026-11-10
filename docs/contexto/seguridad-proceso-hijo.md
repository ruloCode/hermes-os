# Proceso hijo, guardrails y tests

> Cuándo leerlo: llamar al modelo, permisos de tools, secretos, cómo se escriben los tests.

- **El proceso hijo NO hereda el `.env`** (`apps/agent/src/agent/child-env.ts`): el SDK spawnea `claude` y antes le pasaba `process.env` completo — service role de Supabase, Linear, ElevenLabs, OpenAI — así que cualquier `Bash` del modelo (o una inyección desde una página que navegue) las leía con `env`. Las tools de Hermes corren DENTRO de este proceso (MCP in-process): el hijo recibe una allowlist (`PATH`, `HOME`, locale, proxy, config del CLI) y nada más. Meter un secreto al hijo exige pasarlo explícito.
- **Tests** (`pnpm test`, runner nativo de Node — cero dependencias nuevas): la lógica pura del repo ya se prueba. Contratos de comportamiento, **nunca snapshots** de un valor actual. Los primeros 39 encontraron dos bugs reales antes del primer uso (`*` en día-de-semana producía `[0..6,0]` y el filtro dejaba pasar cualquier fecha; la dedup del perfil por prefijo no veía entradas que divergen en la 3ª palabra).
- Guardrails en `apps/agent/src/agent/guardrails.ts`: Bash/Write/Edit pasan por `canUseTool`; las tools seguras van en `allowedTools`.
