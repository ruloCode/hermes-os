# Capacidad: modelos

## ADDED Requirements

### Requirement: Catálogo único de modelos
El agente DEBE resolver el modelo, el esfuerzo y el razonamiento de cada función desde
`apps/agent/src/agent/models.ts`. Ningún otro archivo escribe un id de modelo.

#### Scenario: Función sin variables de entorno
- CUANDO una función pide su modelo y no hay variables que la toquen
- ENTONCES recibe el modelo de su nivel en el catálogo (`fast` → `claude-haiku-5-5`, `balanced` → `claude-sonnet-5-5`, `deep` → `claude-opus-5-5`, `frontier` → `claude-fable-5-2`)

#### Scenario: Variable heredada
- CUANDO existe la variable que esa función ya usaba (por ejemplo `HERMES_GYM_MODEL=opus`)
- ENTONCES esa variable gana sobre el catálogo

#### Scenario: Cambiar un nivel entero
- CUANDO se define `HERMES_MODEL_TIER_BALANCED=claude-opus-5-5`
- ENTONCES todas las funciones del nivel `balanced` sin variable propia usan ese modelo

#### Scenario: Ningún id fuera del catálogo
- CUANDO se buscan literales `claude-*` en `apps/agent/src` fuera de `models.ts` y de los tests
- ENTONCES no aparece ninguno (la lista de modelos válidos de `claude-cli.ts` sale del catálogo)

### Requirement: El chat usa el nivel equilibrado
El chat de texto DEBE usar el nivel `balanced` salvo que `HERMES_MODEL` diga otra cosa.

#### Scenario: Chat sin `HERMES_MODEL`
- CUANDO llega un turno de chat y `HERMES_MODEL` está vacío
- ENTONCES el turno corre en `claude-sonnet-5-5` y no en el modelo por defecto del CLI

### Requirement: Las tareas programadas conservan su modelo
Una tarea programada DEBE seguir corriendo con el modelo que se congeló al crearla.

#### Scenario: Tarea creada antes del cambio
- CUANDO una tarea creada con un modelo anterior vuelve a correr
- ENTONCES usa ese mismo modelo

### Requirement: Sonda del catálogo
DEBE existir un comando que pruebe cada modelo del catálogo con la cuenta en uso y diga cuáles
responden, cuánto tardan y qué id contestó.

#### Scenario: Un modelo no disponible
- CUANDO la sonda encuentra un modelo que la cuenta no puede usar
- ENTONCES lo marca como fallido con el error y los demás siguen probándose

## Notas de implementación

- **Todo `query()` pasa por `trackedQuery`** (guardián en `tracked-query.test.ts`). `createFastEngine` /
  `createFastEnginePool` (meetings/live-copilot.ts) reciben el `feature` y el `meta` de quien los crea:
  `copilot.fast` (capa rápida), `copilot.polish` («dilo más claro»), `copilot.team`, `copilot.concepts`,
  `copilot.class`, `copilot.correct` (clase y práctica), `copilot.practice` (ayuda con la tutora),
  `copilot.vision` y `meetings.strategic` (estratégico persistente). Filas nuevas en `FEATURES`:
  esas cinco más `cli.run` (default de los runs de `claude -p`) y `cloud.agent` (Managed Agents).
- **Variables heredadas**: todas las que se quitaron de `env.ts` siguen en `legacyEnv`
  (`HERMES_COPILOT_MODEL` en las cinco funciones rápidas, `HERMES_GYM_MODEL` también en
  `english.drill`, que antes la leía).
- **Razonamiento**: se respetó lo que cada sitio hacía. Los sitios que apagaban el razonamiento
  (motores de juntas, gimnasio, plan de inglés, dojo, Upwork, estratégico) lo dejaron de escribir y
  ahora sale del catálogo; se agregó `thinking: "off"` a `gym.generate` (el sitio ya lo apagaba). No se
  apagó el razonamiento de ningún sitio que antes razonaba.
- **Cambios de modelo que no son neutros** (decisión del catálogo, no de cada sitio): los sitios que
  pasaban `process.env.HERMES_MODEL || undefined` corrían con el default del CLI (Opus 5.5). Ahora:
  chat → Sonnet 5.5; acta de junta → Opus 5.5 con `effort: "medium"` (antes, el esfuerzo por defecto
  del modelo); análisis de ejecuciones → Haiku 5.5; contenido, reporte de inglés y resumen de
  composición → Sonnet 5.5. Los defaults viejos `claude-haiku-4-5` (capa rápida, aprendizaje, cola) y
  `claude-sonnet-5` (letras) pasan a la familia 5.5. El default de `claude -p` sin modelo elegido queda en `cli.run`
  nivel `balanced` (Sonnet 5.5, como antes): el orquestador revirtió la subida a Opus para no encarecer cada run.
- **Programadas**: las nuevas congelan `modelIdFor("scheduled")`. Una fila vieja con `model = null`
  corría con el default del CLI; ahora corre con `modelIdFor("task")` (Opus 5.5, el mismo modelo) para
  no cambiarle el destino en silencio.
- **`content/edit.ts`** ya no hereda el `.env`: OpenMontage carga su propio `.env` desde su repo
  (`tools/base_tool.py`) y el prompt prohíbe proveedores de pago; no necesita ninguna llave de Hermes.
- Límite conocido: si un motor de junta se destruye justo después de su última respuesta, ese turno
  queda en el registro como `cut` sin tokens (el `result` no alcanza a leerse).
- La sonda (`scripts/probe-models.ts`) sigue importando `query` directo: está fuera de `src/` y es
  la herramienta que valida el catálogo mismo.
