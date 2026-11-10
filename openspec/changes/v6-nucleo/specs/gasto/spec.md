# Capacidad: gasto

## ADDED Requirements

### Requirement: Toda llamada al modelo queda registrada
Toda llamada a `query()` del Agent SDK en `apps/agent/src` DEBE pasar por `trackedQuery(feature, …)`.
Cada resultado deja una línea en `~/.hermes-os/usage/calls-AAAA-MM-DD.jsonl` con función, modelo,
tokens de entrada, salida, caché leída y escrita, costo estimado, duración, tiempo al primer token,
vueltas y estado.

#### Scenario: Llamada de una vuelta
- CUANDO una función llama al modelo y termina bien
- ENTONCES aparece una línea con su `feature` y `status: "ok"`

#### Scenario: Sesión persistente
- CUANDO una sesión con entrada en streaming atiende tres turnos
- ENTONCES quedan tres líneas, una por turno

#### Scenario: Llamada que lanza
- CUANDO el SDK lanza desde el iterador o el turno se aborta
- ENTONCES queda una línea con `status: "error"` o `"aborted"` y lo que se alcanzó a medir

#### Scenario: Ningún `query()` suelto
- CUANDO se busca `query(` importado del SDK fuera de `tracked-query.ts`
- ENTONCES no aparece ninguno (un test lo comprueba)

### Requirement: El proceso hijo no hereda secretos por omisión
`trackedQuery` DEBE usar `childEnv()` cuando quien llama no pasó `env`.

#### Scenario: Sitio que antes heredaba el entorno completo
- CUANDO `content/edit.ts` (y los otros nueve sitios) llaman al modelo sin `env`
- ENTONCES el hijo recibe solo la lista permitida y no ve `SUPABASE_SERVICE_ROLE_KEY`

#### Scenario: Un run que sí necesita una variable
- CUANDO un run necesita una variable concreta
- ENTONCES la pasa escrita con `childEnv({ NOMBRE: valor })`

### Requirement: Resumen de gasto por función
`GET /usage/summary?days=N` DEBE devolver, por función y por modelo: llamadas, tokens, costo estimado,
razón de caché leída y latencia p50 y p95. Solo con datos reales: una función sin llamadas no aparece.

#### Scenario: Semana con datos
- CUANDO se pide el resumen de 7 días
- ENTONCES las funciones salen ordenadas por costo y cada una dice cuánto de su entrada vino de caché

#### Scenario: Sin registro
- CUANDO no hay archivos de esos días
- ENTONCES responde vacío con `since: null` y la interfaz dice desde cuándo se mide

### Requirement: Panel de gasto en el dashboard
El dashboard DEBE mostrar el gasto por función, por modelo y por día con los datos del resumen, y
decir que el costo es una estimación del cliente.

#### Scenario: Función cara
- CUANDO una función concentra la mayor parte del costo de la semana
- ENTONCES aparece primera, con su modelo y su razón de caché
