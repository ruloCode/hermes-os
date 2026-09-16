# Aprendizaje, memoria y tareas programadas

Tres piezas que llegaron juntas (2026-09-16) porque resuelven el mismo hueco:
**Hermes recordaba hechos pero no aprendía a trabajar, y no podía hacer nada
por su cuenta.** El diseño se apoya en lo que ya funciona en
[hermes-agent de Nous Research](https://github.com/NousResearch/hermes-agent),
adaptado a un agente que corre sobre el Claude Agent SDK.

## 1. Memoria: SOUL.md + USER.md + pgvector

Tres capas con trabajos distintos, y no se pisan:

| Capa | Quién escribe | Dónde | Cuándo se lee |
|---|---|---|---|
| `SOUL.md` | El humano | `~/.hermes-os/SOUL.md` | Cada sesión (system prompt) |
| `USER.md` | **Hermes** | `~/.hermes-os/USER.md` | Cada sesión (system prompt) |
| `memories` | Hermes | Supabase + pgvector | Bajo demanda (`search_knowledge`) |

`USER.md` (`apps/agent/src/profile.ts`) es la novedad: el perfil que el agente
mantiene solo. Tres decisiones que importan:

- **Tope duro de 1.400 caracteres, sin auto-compactar.** Al pasarse, la
  escritura **falla** con el perfil actual en el mensaje y el agente tiene que
  consolidar. Un perfil que crece sin límite deja de ser un perfil: viaja en
  cada llamada al modelo.
- **Snapshot al abrir la sesión.** Lo que se escribe hoy manda desde la
  próxima sesión. Recargarlo a mitad de conversación reconstruiría el system
  prompt y tiraría el prefijo cacheado — el costo se multiplica por turno.
  El tool result sí muestra el estado vivo, así que el agente sabe qué guardó.
- **Dedup por solapamiento de términos**, no por prefijo: "prefiere pnpm sobre
  npm" y "prefiere pnpm siempre" son la misma idea aunque divergan en la
  tercera palabra.

Tool: `update_profile` (add · replace · remove · list).
Rutas: `GET/POST/DELETE /learning/profile`.

## 2. Skills: memoria procedimental

Las memorias guardan HECHOS. Una skill guarda un **procedimiento**: "cómo
publicar una pieza de punta a punta". Sin esto, cada sesión vuelve a deducir
el mismo flujo.

Viven como un **plugin local del CLI** en `~/.hermes-os/plugin/skills/<n>/SKILL.md`
y se pasan por `plugins: [{type:"local", path}]` en `session.ts` — así el CLI
las descubre sin que toquemos `~/.claude` del usuario. El system prompt lleva
solo el **índice** (nombre + descripción); el cuerpo lo carga el CLI cuando
hace falta.

**Estándares de autoría** (`learning/skills.ts`, validados antes de escribir):

- `description` ≤ 120 chars. No es cosmético: el índice trunca ahí, y lo que
  se pasa de ese largo nunca se lee, así que la skill no se activa nunca.
- Secciones obligatorias `## Cuándo usarla` y `## Verificación`.
- Sin adjetivos de marketing, nombre en minúsculas-con-guiones, cuerpo ≤ 8.000 chars.

**Curador** (job diario): archiva las skills del agente con 45 días sin uso y
al menos 14 de vida. **Archivar nunca borra** — mueve a `.archive/` y se
restaura. Las fijadas (`pinned`) y las escritas por el humano no se tocan.

Tool: `manage_skill` (create · patch · view · list).
Rutas: `/learning/skills`, `.../pin`, `.../archive`.

## 3. El loop de aprendizaje

Después de un turno **con señal** (una corrección explícita, ≥2 tools, o
bastante texto), `learning/review.ts` lanza una revisión en background:

```
turno → ¿vale la pena? → modelo barato relee el turno
      → propone (skill · perfil · memoria) → learning_proposals
      → tú apruebas en el dashboard → se aplica
```

Por qué así:

- **No toca la conversación principal.** Corre en otro proceso, con su propio
  prompt, y lo que produce entra en la siguiente sesión.
- **Nunca escribe directo.** Emite propuestas. `HERMES_LEARNING=auto` las
  aplica solas; `off` apaga la revisión. Un agente que se reescribe el perfil
  sin permiso es un agente en el que dejas de confiar.
- **Superficie cero**: sus únicas tools son las tres de proponer. Sin Bash,
  sin Read, sin red.
- Lo normal es que **no proponga nada**. Un turno ordinario no deja aprendizaje.

Rutas: `GET /learning/proposals`, `POST /learning/proposals/:id/apply|reject`.

## 4. Tareas programadas

"Cada lunes a las 8 dime qué tengo atascado" no tenía dónde vivir: el registry
de `jobs.ts` es memoria pura y se borra al reiniciar. Ahora viven en Postgres
(`scheduled_tasks`) y un barrido de un minuto las ejecuta.

**Cron propio con zona horaria** (`scheduled/cron.ts`, sin dependencias): 5
campos, listas, rangos, pasos, alias y nombres de día en español. La tz importa
de verdad — "lunes 8am en Bogotá" no es una hora fija en UTC — así que el
cálculo va sobre la hora de pared de la zona pedida y luego se resuelve al
instante real. `describeCron` devuelve la lectura en español para que el
agente confirme por voz lo que entendió.

**Tres reglas para que una tarea rota no queme tokens** (`scheduled/runner.ts`):

1. **Modelo congelado al crear.** Cambiar `HERMES_MODEL` después no mueve el
   destino de una tarea vieja.
2. **Reintento solo si no hubo trabajo.** Si falló sin llamar tools ni
   producir texto, fue infraestructura → 5, 15 y 30 min. Si el modelo sí
   trabajó y falló, reintentar solo repite el gasto: se espera al horario.
3. **Bloqueo a los 3 fallos** + incidente por firma del error: el aviso sale
   una vez, no en cada corrida.

Cada corrida es una sesión **fresca** (sin resume): la tarea de las 8am no
arrastra el contexto de la de ayer.

Tools: `schedule_task`, `list_scheduled_tasks`, `manage_scheduled_task`.
Rutas: `GET/POST /scheduled`, `PATCH/DELETE /scheduled/:id`,
`POST /scheduled/:id/run`, `GET /scheduled/:id/runs`.

## Seguridad: el entorno del proceso hijo

`agent/child-env.ts` (nuevo) sanea lo que heredan los procesos que spawnea el
SDK. Antes heredaban `process.env` completo — con `SUPABASE_SERVICE_ROLE_KEY`,
`LINEAR_API_KEY`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY` — y cualquier `Bash`
del modelo podía leerlas con `env`. Las tools de Hermes corren **dentro** del
proceso del agente (servidor MCP in-process), así que el hijo no necesita
ninguna: ahora recibe una allowlist (`PATH`, `HOME`, locale, proxy, config del
CLI) y nada más. Meter un secreto al hijo requiere pasarlo explícito.

## Configuración

```bash
HERMES_LEARNING=            # "" aprende con aprobación · auto · off
HERMES_LEARNING_MODEL=      # default claude-haiku-4-5
HERMES_SCHEDULED_TZ=        # default America/Bogota
HERMES_HOME=                # default ~/.hermes-os (los tests usan un temporal)
```

Migración **025** (`supabase/migrations/025_learning_scheduled.sql`). Sin ella
todo degrada sin romper: el perfil y las skills viven en disco y funcionan
igual; las tareas programadas responden que no hay dónde guardarlas.

## Tests

Primeros tests del repo: `pnpm test` (runner nativo de Node, sin dependencias
nuevas). 39 tests sobre la lógica pura — cron con zonas horarias y DST, topes
y dedup del perfil, estándares de autoría de skills. Contratos de
comportamiento, nunca snapshots de un valor actual.

Encontraron dos bugs reales antes del primer uso: `*` en día-de-semana
producía `[0..6, 0]` (el 7→domingo duplicaba el 0), así que el chequeo de
"están todos los días" fallaba y **cualquier fecha pasaba el filtro**; y la
dedup del perfil por prefijo no detectaba entradas que divergen en la tercera
palabra.
