# Hermes OS — contexto para Claude Code

Monorepo pnpm. Dos procesos: `apps/web` (Next.js 15, dashboard "AGENTIC OS") y `apps/agent` (Hono, Claude Agent SDK; producción en :8650 vía launchd `com.hermes-os.agent`). Tipos y lógica pura compartida en `packages/shared`. El cuerpo en Android vive en el repo hermano `../hermes-phone`.

Este archivo es un ÍNDICE: lo que se carga en cada sesión. El detalle de cada función vive en `docs/contexto/<función>.md` (tabla abajo). **Lo nuevo se documenta en su archivo y gana una fila en la tabla; no se agrega como párrafo aquí.** Los cambios grandes se especifican antes en `openspec/` (ver `openspec/project.md`).

## Arquitectura
- La voz (ElevenLabs Agents) usa **client tools que corren en el browser** y llaman al agente local — sin túnel. El LLM de voz solo rutea; el trabajo real lo hace el Agent SDK vía `POST /tasks` (async, `task_id` inmediato).
- El chat de texto usa el **contrato Hermes**: `POST /v1/chat/completions` OpenAI-compatible SSE + header `X-Hermes-Session-Id` (resume de sesión SDK).
- Memoria/preferencias/presencia en **Supabase**; el **vault de Obsidian** es la verdad de proyectos (frontmatter `estado` + "Estado Actual"/"Tareas Pendientes"). Lo que no necesita SQL vive en `~/.hermes-os/` (JSON/JSONL por función).
- **Modelos = un catálogo** (`apps/agent/src/agent/models.ts`): función → nivel (`fast` Haiku 5.5 · `balanced` Sonnet 5.5 · `deep` Opus 5.5 · `frontier` Fable 5.2) + esfuerzo + razonamiento. **Ningún id `claude-*` fuera de ese archivo** (un test lo exige). Cambiar un nivel: `HERMES_MODEL_TIER_<NIVEL>`; una función: su variable de siempre o `HERMES_MODEL_<FUNCION>`. Sonda de la cuenta: `pnpm --filter @hermes/agent exec tsx scripts/probe-models.ts`.
- **Toda llamada al modelo va por `trackedQuery(feature, …)`** (`agent/tracked-query.ts`): pone `childEnv()` si no se pasó `env`, el modelo del catálogo, y deja una línea de gasto por turno en `~/.hermes-os/usage/calls-AAAA-MM-DD.jsonl` (`/usage/summary`, vista `/gasto`). Ojo: en sesiones persistentes `modelUsage` y `total_cost_usd` son ACUMULADOS; el envoltorio resta. Un test prohíbe importar `query` del SDK en otro lado.
- **El proceso hijo NO hereda el `.env`**: el CLI recibe una allowlist (`agent/child-env.ts`); las tools de Hermes corren dentro del agente (MCP in-process). Bash/Write/Edit pasan por `canUseTool` → `agent/guardrails.ts`.
- Actividad en vivo: bus en memoria → SSE `/events` → ActivityFeed; espejo en `agent_activity` (Realtime). Serie 24h vía RPC `activity_hourly` (migración 011).
- Rutas nuevas en su propio archivo `mountXRoutes(app)`; `index.ts` ya mide 4.000+ líneas y solo monta. Las de v6 se montan desde `apps/agent/src/v6.ts`.

## Dónde está el detalle

| Función | Documento | Léelo cuando vayas a… |
|---|---|---|
| Memoria y capa de conocimiento | `docs/contexto/memoria-conocimiento.md` | tocar memorias, búsqueda, embeddings o el vault como fuente |
| Identidad del dueño fuera del código | `docs/contexto/identidad-dueno.md` | tocar prompts, SOUL.md, nombres propios, defaults personales |
| Aprendizaje, USER.md, skills y programadas | `docs/contexto/aprendizaje-y-tareas.md` | tocar USER.md, skills, curador, loop de aprendizaje o cron |
| Proceso hijo, guardrails y tests | `docs/contexto/seguridad-proceso-hijo.md` | llamar al modelo, permisos de tools, secretos, escribir tests |
| Junta EN VIVO y copiloto | `docs/contexto/juntas-en-vivo.md` | reuniones en vivo, capa rápida, coach, STT, acta |
| Reunión de equipo EN VIVO | `docs/contexto/reunion-equipo.md` | modo equipo, aportes, audio del sistema, pool de motores |
| Lente (tarjetas para gafas) | `docs/contexto/lente.md` | evento `cue`, /lente, gafas |
| Articulación y gimnasio | `docs/contexto/articulacion-gimnasio.md` | reglas de articulación, «Dilo más claro», /gimnasio |
| Dojo de algoritmos | `docs/contexto/dojo.md` | /dojo, Pyodide, trazador |
| Entender (tutor de proyecto) | `docs/contexto/entender.md` | /entender, pizarra, modo voz |
| Inglés: tutora, clase en vivo y plan | `docs/contexto/ingles.md` | tutora por voz, clase por Meet, compañera, plan |
| Red, centro y multi-máquina | `docs/contexto/red-y-multimaquina.md` | rutas LAN/Tailscale, hub, varias máquinas, transferencias |
| Modo avión (modelo local) | `docs/contexto/modo-avion.md` | llama-server, chat sin internet |
| Hermes Phone, compañero y juntas desde el teléfono | `docs/contexto/hermes-phone.md` | /phone/ws, avisos, foco, finanzas desde avisos, compañero |
| Acceso remoto y app Expo (heredada) | `docs/contexto/movil-expo-y-acceso-remoto.md` | túnel, JWT, subida por partes, jobs durables |
| Upwork desde Gmail | `docs/contexto/upwork.md` | Gmail readonly, puntaje de ofertas, borradores |
| TeKer IA | `docs/contexto/teker-ia.md` | tool teker_ia y su chat |
| Linear y tablero de tareas | `docs/contexto/linear-y-tareas.md` | issues, Copy prompt, ejecutar, triage de accionables |
| Estudio (contenido) | `docs/contexto/estudio.md` | /estudio: piezas, etapas, teleprompter, voz en off, edición |
| Composición (canciones) | `docs/contexto/composicion.md` | /composicion (confidencial) |
| Tótem de estación | `docs/contexto/estacion.md` | /estacion, GTFS |
| Control por gestos y señas | `docs/contexto/gestos.md` | MediaPipe, cursor por mano, señas |
| Control del navegador | `docs/contexto/navegador.md` | abrir sitios, pestañas, chrome-devtools-mcp |
| El cuarto: luces y TV | `docs/contexto/cuarto-luces-y-tv.md` | Kasa, Hermes TV, escenas, Mi día, despertar |
| La Mac por voz y visión | `docs/contexto/mac-y-vision.md` | mac_open/mac_media, /vision/ws |
| Avatar (demo) | `docs/contexto/avatar.md` | /dev/terminator |
| Grafo de código y vista 3D | `docs/contexto/grafo-de-codigo.md` | query_code_graph, cbm, graphify |
| Oficina de agentes 3D | `docs/contexto/oficina.md` | /oficina |
| Sala de Agentes 3D | `docs/contexto/sala.md` | /sala |
| RuloView | `docs/contexto/ruloview.md` | /ruloview |
| Dashboard: marca, diseño y shell | `docs/contexto/dashboard.md` | **cualquier cambio de interfaz web** (y `docs/ui-v5-grafito.md`) |
| v6 «Núcleo» (noviembre 2026) | `openspec/changes/v6-nucleo/` | gasto, memoria v2, sesión del chat, preparación de junta, repaso de inglés, finanzas de hoy, pulso, teléfono |

## Convenciones
- Español en UI, comentarios y mensajes. Código y nombres en inglés.
- **Todo dato visible es real**: sin métricas inventadas ni relleno; si la fuente no existe, el elemento se omite.
- **Ningún nombre propio en código**: el mismo repo corre en la máquina de cualquiera con su `.env` + `~/.hermes-os/SOUL.md`.
- El `.env` vive en la RAÍZ del monorepo (no en apps/).
- Lógica pura en `packages/shared` con tests de contrato (runner nativo de Node), nunca snapshots.
- No agregar dependencias pesadas al dashboard sin necesidad. Excepción sancionada por Rulo: el **Knowledge Network usa three.js** (WebGL real con bloom contenido, OrbitControls con zoom por scroll, raycasting y fullscreen nativo) — hay 10 skills de referencia en `.claude/skills/threejs-*`. Branding del grafo: los nodos se leen violeta/cian, el bloom es acento (strength ~0.38, threshold 0.55), nunca white-out. En el agente las únicas dependencias nuevas son `node-ical` y `chrome-devtools-mcp` (navegación web agéntica).
- Sin prettier en el repo; el estilo de facto es `--print-width 100`.
- `pnpm typecheck` y `pnpm test` antes de commitear.
- Reiniciar producción: `launchctl kickstart -k gui/$UID/com.hermes-os.agent` (o `.web`).
- **Agente de ensayo** (otro puerto, sin tocar producción): `HERMES_PORT=<p> HERMES_JOBS=off HERMES_HUB=off MACHINE_NAME=ensayo pnpm --filter @hermes/agent exec tsx src/index.ts`. `HERMES_JOBS=off` también salta los rescates del arranque (si no, para él lo vivo de producción es huérfano). Matarlo por puerto, nunca con `pkill`.
- **QA en el navegador con producción arriba**: `next dev` y `next start` compartían `.next/`, y el dev lo SOBRESCRIBE — levantar un dev para probar (aunque sea en otro puerto) dejaba al `next start` de :31415 sirviendo un árbol a medias, sin un solo error en los logs. La señal es `.next/` **sin `BUILD_ID`**; recuperarlo exige `pnpm build` + `kickstart .web`. Ya no pasa: `next.config.ts` manda el dev a `.next-dev/`.

## Pendientes conocidos
- Configurar `GOOGLE_CALENDAR_ICS_URL` en `.env` para el panel AGENDA.
- Túnel: ya corre como quick tunnel (URL rotativa publicada en Supabase). Siguiente paso opcional: named tunnel con dominio propio (URL fija) + fallback Custom-LLM de voz (el contrato ya es OpenAI-compatible a propósito).
- `mobile/` (Expo) está fuera del workspace y lo reemplazó `../hermes-phone`; solo sigue viva la ruta `/mobile/errors`.
