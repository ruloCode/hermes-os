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

## Notas de implementación

Paquete «gasto» (rutas + panel), 2026-11-10.

**Rutas** (`apps/agent/src/usage-routes.ts`, tests en `apps/agent/src/usage/routes.test.ts`):
- `GET /usage/summary?days=N` → `{ ok, summary, since, models }`. `since` es el primer día con
  registro EN DISCO (`firstDayWithCalls`), no el de la ventana: con él la interfaz dice «se mide
  desde…» aunque el periodo pedido salga vacío. `models` es un agregado que no pedía la spec: nivel y
  nombre de cada modelo del resumen (`describeModels`), para que el panel no adivine. El nombre solo
  se pone cuando el id es EXACTAMENTE el modelo de lista del nivel: un `claude-opus-4-8` congelado
  queda como «Profundo» con su id, no como «Opus 5.5».
- `GET /usage/calls?day=AAAA-MM-DD&limit=N` → la más reciente primero, `limit` 200 por defecto y 1000
  de tope, con `total` del día y `truncated`. El día pasa por un formato estricto y una fecha que
  exista porque termina en el nombre de un archivo.
- `GET /usage/models` → `features` (= `catalogView()`) y `tiers` (precio de lista + modelo `active`
  y `source`: si `HERMES_MODEL_TIER_<NIVEL>` cambió el nivel, el precio de lista ya no lo describe y
  el panel lo dice).
- Un `days`/`day`/`limit` inválido responde `{ ok:false, error }` con 200 y no se recorta en silencio:
  pedir 400 días y recibir 90 haría creer que el resumen cubre lo que no cubre.

**Panel** (`/gasto`, `apps/web/src/components/gasto/*`, cliente `apps/web/src/lib/usage-api.ts`):
- Vista propia montada por el AppShell y comando ⌘K «Gasto de modelos» (`/gasto`). **No** se agregó a
  la barra lateral: ⌘1..⌘9 numeran los nueve primeros destinos y ningún grupo (Agente · Vida ·
  Aprender · Crear) es su lugar natural; es una vista de consulta, no de uso diario. El tablero de
  gasto de la Oficina (que cuenta runs) enlaza a ella («Gasto por función ↗», en otra pestaña porque
  salir de /oficina desmonta la escena).
- Un solo poll (`useUsage`): al abrir, al cambiar de periodo y cada 60 s solo con la vista al frente y
  la pestaña visible. El catálogo, una vez por apertura. Caché por periodo: volver a «7 días» pinta lo
  que ya había mientras refresca; si un refresco falla se queda lo último y una línea ámbar dice de
  qué hora es.
- La parte de la entrada leída de caché es lo único con color (dos slots fijos de la paleta de charts:
  leída / escrita; sin caché = la pista vacía), con leyenda por nombre. Costo y llamadas van en barras
  neutras. Una función con 100 % escrita y 0 % leída muestra «0 %» (dato real), no «sin dato».
- Serie por día en columnas, no en línea (los días son cubetas: una línea inventaría el día que falta).
  Tres clases de día: con llamadas · medido sin llamadas (marca en la base = cero real) · anterior al
  primer registro (nada). Sin costos informados, la altura son las llamadas y el título lo dice. Con
  «Hoy» la serie no se dibuja: un día no es una serie.
- Tabla por función en columnas desde 64 rem de ancho de COLUMNA (container query) y apilada debajo:
  una tabla de ocho columnas con scroll lateral escondería el costo y la caché.
- Dato o nada: `costUsd` null → «sin dato»; latencia sin muestras → celda vacía; sin registro →
  «Todavía no hay gasto registrado… se mide desde que corre v6», sin cifras.

**Límites conocidos**
- `/usage/calls` está servido y probado pero el panel todavía no lo muestra (no había un lugar que no
  duplicara la tabla por función); queda para un detalle por función.
- La fila de cifras usa `Stat` de `components/vida/kit.tsx` (aún no promovido a `ui/`).
- Las etiquetas de función salen del catálogo del agente que contesta: una función que el registro trae
  pero que ese agente ya no tiene en `FEATURES` se muestra con su clave.
