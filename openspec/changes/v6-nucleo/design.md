# Diseño de v6 «Núcleo»

Cada decisión dice qué se eligió, por qué y con qué evidencia. Las rutas son relativas a `hermes-os`
salvo que digan `phone:` (repo `hermes-phone`).

## 0. Hechos medidos esta noche (2026-11-09, esta máquina: M4, 16 GB)

| Medición | Resultado |
|---|---|
| Línea base | `pnpm typecheck` en verde; 1.444 tests del agente y 18 de la web pasan; el teléfono compila y sus tests pasan |
| SDK | `@anthropic-ai/claude-agent-sdk` 0.3.274 → **0.3.322** en la rama |
| Modelos que responden con esta cuenta | `claude-haiku-5-5`, `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-fable-5-2`; los alias `haiku` y `sonnet` resuelven a la 5.5 |
| Modelo por defecto del CLI (sin `HERMES_MODEL`) | `claude-opus-5-5` |
| `thinking: disabled` en Sonnet 5.5 y Haiku 5.5 | Funciona por el SDK (la documentación de la API decía que Sonnet 5.5 lo rechazaba) |
| Arranque de un `query()` de una sola vuelta | Unos 2 s hasta el primer token con el CLI caliente |
| Embeddings locales (`llama-server` + `bge-m3-Q8_0.gguf`) | 1.024 dimensiones; 64 textos en 538 ms; 760 MB de RAM; español↔inglés 0,62 de coseno contra 0,37 de un texto ajeno |

## 1. Catálogo de modelos — `apps/agent/src/agent/models.ts`

**Decisión.** Una tabla única: nivel → modelo, y función → nivel + esfuerzo + razonamiento.

```ts
type ModelTier = "fast" | "balanced" | "deep" | "frontier";
//               haiku-5-5  sonnet-5-5  opus-5-5  fable-5-2
interface FeatureModel { model: string; effort?: "low"|"medium"|"high"|"xhigh"|"max"; thinking?: "off"|"adaptive" }
function modelFor(feature: Feature): FeatureModel
```

Orden de precedencia: variable heredada de la función (`HERMES_COPILOT_MODEL`, `HERMES_GYM_MODEL`…,
siguen valiendo) → `HERMES_MODEL_<FUNCION>` → `HERMES_MODEL` (solo para chat y tareas, como hoy) →
catálogo. `HERMES_MODEL_TIER_<NIVEL>` cambia el modelo de un nivel entero.

| Nivel | Funciones | Razón |
|---|---|---|
| fast | capa rápida de juntas, correcciones de clase, conceptos, revisión de aprendizaje, coordinador de cola, consolidación de memoria | Corren muchas veces; la latencia y el precio mandan |
| balanced | chat, aportes de equipo, estratégico, frase de clase, gimnasio, tutor, dojo, upwork, visión, reportes de inglés, contenido, preparación de junta | Calidad de redacción con costo de la mitad de Opus |
| deep | tareas (`/tasks`), programadas nuevas, acta de junta, edición de video, runs de código | Trabajo de muchos pasos donde un error cuesta más que los tokens |
| frontier | ninguna por defecto | Fable 5.2 queda disponible por variable para trabajo autónomo largo |

**El cambio que más pesa:** el chat pasa de Opus 5.5 (lo que el CLI elegía por defecto) a Sonnet 5.5.
Las tareas programadas conservan el modelo congelado al crearse.

## 2. Gasto medido — `apps/agent/src/agent/tracked-query.ts` y `usage-ledger.ts`

**Decisión.** Un envoltorio de `query()` y ningún otro camino al modelo.

```ts
function trackedQuery(feature: Feature, params: QueryParams, meta?: { project?: string; ref?: string }): Query
```

- Devuelve el mismo objeto `Query` (un `Proxy`): los que lo llaman no cambian su bucle.
- Si no se pasó `env`, usa `childEnv()`. Meter un secreto al hijo sigue exigiendo escribirlo.
- Si no se pasó `model`, `effort` o `thinking`, los pone `modelFor(feature)`.
- En cada mensaje `result` deja una línea en `~/.hermes-os/usage/calls-AAAA-MM-DD.jsonl`:
  `{ts, feature, model, models[], input, output, cacheRead, cacheWrite, costUsd, ms, ttftMs, turns, status, project?, ref?}`.
  Una sesión persistente deja una línea por turno.
- Agregados puros en `packages/shared/src/usage-ledger.ts` (por función, modelo y día; razón de caché;
  p50 y p95 de latencia) con tests.
- Rutas en `apps/agent/src/usage-routes.ts`: `GET /usage/summary?days=`, `GET /usage/calls?day=`.

El registro por run de la Oficina (`usage.ts`, `.data/usage/`) sigue igual: es otra vista.
`costUsd` es la estimación del cliente del SDK, no la factura: con suscripción indica consumo relativo.

**Por qué un envoltorio y no un helper nuevo para las 19 llamadas de una sola tool.** Cambia una
línea por sitio, cierra el hueco de `childEnv` y da el registro, sin reescribir flujos que ya tienen
tests y simulaciones. Unificar esas 19 con salida estructurada queda para después, ya con datos.

## 3. Sesión estable y viva

**3.1 Prompt estable.** `buildSystemPromptCaptured` se parte en dos:
- **Base** (identidad, teléfono, SOUL, USER.md, perfil del vault, proyectos, preferencias, skills):
  se toma una foto por sesión del cliente y se reutiliza en cada turno de esa sesión (1 h de vida).
- **Contexto del turno** (memorias recientes en el primer turno; lo relevante al mensaje en cada turno,
  sin repetir lo ya enviado en la sesión): viaja al inicio del mensaje del usuario dentro de
  `<contexto-hermes>…</contexto-hermes>`. Es dato, no instrucción, y así lo dice la base.

Con eso el prefijo (tools + system prompt + historial) es idéntico entre turnos y la caché se lee.

**3.2 Sesión persistente del chat** (`apps/agent/src/agent/chat-sessions.ts`). Un proceso del CLI
vivo por sesión de cliente, con entrada en streaming, como ya hace la capa rápida de juntas.
- Clave: id de sesión del cliente + perfil de tools + modelo + proyecto en foco. Si cambia, se recicla.
- Vida: 10 min sin uso; máximo 3 vivas (sale la menos usada).
- Detener = `interrupt()` del turno, la sesión sigue.
- Cualquier fallo cae al camino de una sola vuelta con `resume`. `HERMES_CHAT_SESSION=oneshot` lo fuerza.

**3.3 Tools por canal** (`apps/agent/src/agent/tool-profiles.ts`). Perfiles `chat-web`, `chat-phone`,
`task`, `scheduled`: qué servidores MCP se registran y qué tools integradas existen. El teléfono no
carga el MCP de Chrome ni el remoto de Linear; las tareas cargan todo.

**3.4 Uso de skills.** Hook `PostToolUse` sobre la tool `Skill` → `recordSkillUse(nombre)`.

## 4. Memoria v2 — `apps/agent/src/memoria/`

**Decisión.** Un índice local derivado, no una migración. Supabase y los archivos siguen siendo la
verdad; el índice se reconstruye desde ellos.

**Por qué local.** (a) El fallo de hoy es un proveedor externo sin crédito. (b) Cambiar la dimensión
de los vectores en pgvector exige migrar y re-embeber todo. (c) El corpus es personal: una búsqueda
por fuerza bruta sobre decenas de miles de vectores de 1.024 toma milisegundos. (d) Los almacenes de
`~/.hermes-os` nunca estuvieron en `match_knowledge`.

```
~/.hermes-os/memoria/v2/
  docs.jsonl     una línea por fragmento: id, source, ref, title, text, project, createdAt, hash
  vectors.f32    Float32 en el mismo orden que docs.jsonl
  meta.json      modelo, dimensiones, conteos por fuente, última sincronización
  state.json     hechos reemplazados (id → reemplazado por, desde cuándo), usos
```

- **Lógica pura** (`packages/shared/src/memory-index.ts`): tokenizador es/en sin tildes ni palabras
  vacías, BM25, coseno, fusión por rango recíproco, impulso por recencia e importancia, diversidad por
  fuente, exclusión de hechos reemplazados. Con tests.
- **Vectores** (`memoria/embedder.ts`): local primero (`llama-server --embedding`, se arranca al
  necesitarlo, se apaga a los 10 min sin uso) → OpenAI si hay llave y no está en enfriamiento (un
  `insufficient_quota` lo enfría 6 h y avisa UNA vez) → nada (queda la búsqueda léxica, que ya supera
  al `ILIKE` de frase entera).
- **Fuentes** (`memoria/sources.ts`): memorias, reuniones, ejecuciones, conversaciones y vault (las
  cinco de hoy) más gimnasio, inglés (sesiones y plan), metas y actas del compañero, Upwork,
  pendientes del día y tutor. **Fuera a propósito:** finanzas (tiene candado en el teléfono) y
  composición (confidencial).
- **Búsqueda** (`searchKnowledge` en `knowledge.ts`): `HERMES_MEMORY=auto|v2|supabase`. En `auto` usa
  v2 si el índice existe.
- **Sincronización:** incremental cada 15 min por huella; `save_memory` inserta al instante;
  `pnpm memoria:build` reconstruye todo.
- **Sueño** (`memoria/dream.ts`, 3:30): agrupa memorias casi iguales o contradictorias y un modelo
  barato propone fusionar o marcar como reemplazada. Propone; aplica solo con `HERMES_LEARNING=auto`.
  Lo reemplazado no se borra: deja de aparecer y guarda desde cuándo.
- **Salud:** `GET /memoria/status`; aviso único cuando no hay vectores.
- **Evaluación:** `pnpm memoria:eval` sobre `~/.hermes-os/memoria/eval.jsonl` (preguntas del dueño
  con la respuesta esperada); recall@5 y MRR por modo. `--bootstrap` propone preguntas desde actas reales.

## 5. Preparación de junta — `apps/agent/src/meetings/prep.ts`

Datos primero: próximo evento del calendario, dossier del proyecto (`meeting-context.ts`), últimas
actas, accionables abiertos. Una llamada al modelo (`balanced`) redacta: objetivo, tres preguntas, lo
que se prometió y riesgos. Cada punto cita su fuente (acta y fecha) o no se muestra. Se guarda por
proyecto y día. Va a la tarjeta de inicio, al contexto del copiloto y al teléfono.

## 6. Repaso diario de inglés — `packages/shared/src/english-review.ts`

Cada error real (dijo → mejor | regla) es una tarjeta. Cajas de Leitner (1, 3, 7, 16 y 35 días). El
repaso de hoy son 8 tarjetas: primero las vencidas, luego nuevas. Dos tipos: escribir la frase bien
(comparación tolerante a mayúsculas, tildes y puntuación) y elegir la correcta. Sin modelo en el
camino: la tarjeta sale del error registrado. Respuestas en `~/.hermes-os/english-review/`.

## 7. Finanzas de hoy — `packages/shared/src/finance-today.ts`

- **Disponible hoy** = (ingreso del plan − gastos fijos del plan − gasto variable del mes) ÷ días que
  quedan. Sin plan confirmado no hay número: se dice qué falta.
- **Cargos repetidos**: mismo comercio y monto parecido en dos meses o más.
- **Gastos hormiga**: comercios con muchas compras pequeñas en el mes, con su total.
- **Desvíos**: categoría que va por encima de su mediana de tres meses.
Las transferencias propias nunca cuentan. Cada número lleva una frase con su método.

## 8. Teléfono: cuerpo (`phone:body/`, `phone:link/`, `phone:net/`, `apps/agent/src/phone/`)

- **Actuar devuelve la pantalla.** `tap`, `type`, `scroll` y `global` responden con la pantalla ya
  estable y si cambió. El agente deja de releer.
- **Lote** (`act_batch`): varios pasos seguidos; se detiene en el primero que exige confirmación o
  que no encuentra su objetivo, y dice hasta dónde llegó.
- **Intents** (`intent`): abrir enlace, navegar a un lugar, marcar un número, compartir un texto,
  buscar en una app. Los que tienen efecto pasan por la misma política de confirmación.
- **Plazo de confirmación compartido.** El teléfono avisa `pending` con su plazo; el agente espera
  hasta ese plazo. Una aprobación que llega fuera de plazo no ejecuta nada.
- **Conexión.** Gana la primera ruta de mayor prioridad que responde, sin esperar a las lentas.
- **Chat sin conexión.** El mensaje queda en cola y sale al reconectar.
- **Voz.** La salida de las tools se recorta por líneas, nunca a mitad de un JSON.
- Todo se anuncia como capacidades en el `hello` (`act2`, `batch`, `intent`). Un agente viejo sigue
  usando las tools de siempre.

## 9. Teléfono: foco (`phone:core/Focus*.kt`, `phone:focus/`, `phone:ui/Focus*.kt`)

Se mantiene la regla madre: **sin una regla del dueño no hay intervención.** Lo nuevo son opciones
de regla y plantillas apagadas que se prenden con un toque.

- **Presupuesto diario** (`RuleScope.Budget(minutes)`): minutos al día entre las apps de la regla.
  Avisa al 80 %; al 100 % el freno sale en cada apertura hasta el otro día.
- **Fricción creciente**: la espera del freno crece con cada «entrar» del día: 10, 20, 40 y 60 s.
- **Intención** (`Brake.INTENT`): «¿A qué entras?» con opciones y minutos. Al acabarse el tiempo, la
  hoja vuelve citando la intención.
- **Superficie** (`surface` en la regla): el freno solo sale en Reels o Shorts; los mensajes quedan
  libres. Detección por identificadores de vista y textos, configurable.
- **Conciencia**: la hoja dice cuántas aperturas y minutos llevas hoy en esa app.
- Evidencia: el aviso a pantalla completa al pasar un límite propio redujo unos 30 min al día (RCT
  citado en `phone:docs/foco.md`); la espera antes de entrar es el mecanismo de «one sec».

## 10. Contexto de desarrollo

`CLAUDE.md` pesa 155 KB (unos 70 mil tokens en cada sesión de trabajo sobre el repo). Pasa a ser un
índice de menos de 12 KB con arquitectura, convenciones y una tabla «función → documento»; cada
párrafo actual se mueve, sin perder texto, a `docs/contexto/<función>.md`.

## 11. Lo que se dejó fuera, y por qué

| Fuera | Motivo |
|---|---|
| Migrar la voz a Eleven Realtime | Exige republicar agentes y medir con voz real |
| AppFunctions de Android | Beta y con permiso limitado a apps elegidas; la accesibilidad sigue siendo el camino |
| Unificar las 19 llamadas de una sola tool con salida estructurada | Primero el registro de gasto; después se decide con datos |
| Partir `index.ts` | Las rutas nuevas ya nacen en archivos propios; mover las 290 existentes es un cambio aparte |
| Capturas de pantalla para el agente del teléfono | Requiere probar en el dispositivo |
