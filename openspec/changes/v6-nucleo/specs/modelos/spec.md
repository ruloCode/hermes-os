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
