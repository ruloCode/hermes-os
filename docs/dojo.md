# Dojo de algoritmos (`/dojo`)

Una sección inspirada en LeetCode, pero pensada para **aprender** y no para competir: ir de no saber nada a resolver problemas de nivel medio-difícil en Python, escribiendo cada línea uno mismo. Nació el 2026-10-22.

## La regla

**Hermes no escribe tu solución** (la misma regla que «el factor humano no se delega» de Composición). Hermes explica, pregunta y revisa:

- **Pistas por escalones**, una por clic: reformular → un caso a mano → el patrón → pseudocódigo. Nunca código ejecutable. Cada pista queda en el registro.
- **La solución de referencia** solo se ve después de pasar todos los tests o de rendirse.
- **El coach** (`/dojo/coach`) tiene tres momentos: «¿Lo entendí?» (revisa tu comprensión), «Cuestiona mi plan» y «¿Por qué falla?» (explica un caso que falla). El modelo VE la solución de referencia para poder juzgar un plan, así que el prompt le prohíbe mostrarla y `stripCode` quita cualquier bloque o línea de Python que se le cuele. Pedirle el plan o el porqué cuenta como una pista: «sin pistas» quiere decir que lo resolviste solo.

## El método (cada problema)

1. **Entender**: con tus palabras, qué entra y qué sale, y un caso que podría romperlo.
2. **Planear**: el enfoque en una o dos frases, antes de escribir Python.
3. **Escribir**: el editor se abre aquí; antes queda bloqueado a propósito.
4. **Probar**: ⌘↵ corre los ejemplos; ⌘⇧↵ envía todos los casos, ocultos incluidos.
5. **Reflexionar**: la complejidad de TU solución + lo que aprendiste. Después se muestra la referencia, comparada con lo que dijiste.

En un repaso los pasos 1 y 2 se saltan: se escribe desde cero.

## El mundo: seis capítulos

El plan es un mapa estilo Duolingo (`DOJO_UNITS` en `packages/shared/src/dojo-catalog.ts`). Cada capítulo es un **lugar** con su máquina y dos frases de historia, nodos en zigzag, un **cofre** a mitad de camino (+40 XP al terminar las lecciones de antes) y un **jefe** al final (la prueba):

| Capítulo | Idea | Máquina | Jefe |
|---|---|---|---|
| 1 · El taller | funciones y return | prensa | El cronómetro (`segundos`) |
| 2 · La clasificadora | if / elif / else | compuertas | ¿Año bisiesto? |
| 3 · La fábrica | bucles y acumulador | cinta | FizzBuzz |
| 4 · La imprenta | listas y textos | tipos | Palabras al revés |
| 5 · La pista de carreras | complejidad | pines + ventana | Los k días seguidos |
| 6 · La bodega | dict y set | casilleros | Agrupar anagramas |

**Candados** (`dojoView`): dentro de un capítulo abierto cada lección se abre al terminar la anterior; el capítulo siguiente se abre al dominar el anterior (pasar su jefe o hacerlo todo). El jefe de un capítulo cerrado SIEMPRE se puede intentar: vencerlo es saltar el capítulo. Los ids de las lecciones no cambian al reordenar, así los intentos viejos siguen valiendo.

## Todo se teclea

- **Ejemplos de las lecciones**: se copian sobre el texto fantasma (`TypeOver`) antes de correrlos. Tecla equivocada = no avanza y cuenta como error; la sangría al empezar línea va sola; Enter = salto de línea. El foco salta solo al siguiente bloque.
- **Preguntas**: se responden escribiendo (`checkAnswer`: `O(n^2)` = `O(n²)`, `o(n)` = `O(n)`, pero `none` ≠ `None` porque Python distingue).
- **La referencia**: tras pasar o rendirse se reescribe con guía o de memoria (XP ×2).
- Cada pasada va a `~/.hermes-os/dojo/typing.jsonl` (`POST /dojo/typing`; se descartan las de >30 caracteres por segundo o <0,3 s).

## El juego

XP y nivel calculados del registro real (`dojoXp`, no hay contador aparte): un problema da su XP grande una vez (más si fue limpio, más si es jefe), después solo los repasos; teclear siempre suma (×1,5 con precisión ≥98 %, ×2 de memoria); cofres +40. Nivel 1→2 pide 100 XP, 2→3 pide 200… El «+N XP» que flota es la diferencia REAL del total que devuelve el agente. Combo = teclas seguidas sin error (avisos en ×25/50/100…), meta diaria de 600 caracteres, sonido procedural opcional (`lib/dojo/game.ts`).

## Las máquinas (Anatomy) y el modo en vivo

Cada idea se explica con una máquina isométrica hecha con el kit de [Anatomy](https://github.com/wheresryan22/anatomy) (MIT, vendorizado en `components/dojo/iso/`): prensa, compuertas, cinta, tipos, pines, ventana y casilleros (`components/dojo/figures/<máquina>/`). En un problema sin resolver la máquina muestra el **problema** (qué entra y qué sale), no el mecanismo: se desbloquea al pasar o rendirse (`reveal`).

**En vivo**: al parar de teclear (~0,6 s) el código del alumno corre con el ejemplo elegido bajo el **trazador** del harness (`__dojo_trace`, `sys.settrace`: línea, locals reales, salida y retorno por paso; tope de 600 pasos, así un bucle infinito no cuelga) y la máquina repite lo que hizo SU código, paso a paso, con el editor marcando la línea. Una máquina declara `live(frame)` = «puedo mostrar esta ejecución»; si no (o si el alumno resolvió de una forma que su mecanismo no representa), entra **la mesa de trabajo** (`figures/mesa/`): un banco con una bandeja por variable que sirve para cualquier código. Los ejemplos de las lecciones también arman la mesa mientras los tecleas (`__dojo_trace_exec`, línea por línea).

## Repaso espaciado

Resolver con pistas o rendirse deja el problema en el escalón 0 (vuelve mañana). Cada repaso limpio a partir de su fecha sube un escalón (3 días, luego 7); pasado el último, se gradúa. Un repaso con pistas vuelve al principio. Resolverlo limpio a la primera no agenda nada. Lógica en `reviewState` (`packages/shared/src/dojo.ts`).

## Arquitectura

- **Lógica pura** en `packages/shared/src/dojo.ts`: tipos, repaso, racha, `dojoView`, `stripCode`, explicaciones de errores en español, `pyRepr`, y el **harness de Python** (`DOJO_HARNESS`).
- **Contenido** en `packages/shared/src/dojo-catalog.ts`: problemas propios escritos a mano. Los enunciados de LeetCode tienen copyright; las ideas clásicas se cuentan con palabras y ejemplos nuestros.
- **Python en el navegador**: Pyodide 314.0.7 desde jsDelivr, dentro de un **worker de módulo** (`apps/web/public/dojo/py-worker.js`). Desde la 314, Pyodide rechaza los workers clásicos: el `importScripts` fallaba con un «failed to load» que no decía por qué. `lib/dojo/python.ts` es un singleton fuera de React: precalienta al abrir el Dojo (~2 s desde la caché) y corre una cosa a la vez.
- **Bucles infinitos**: Python dentro del worker no se puede interrumpir. El harness avisa `start` antes de cada caso y `case` al terminarlo (llama a `postMessage` desde Python), la página lleva un reloj por caso (límite + 3 s) y, si se pasa, mata el worker con `terminate()` y reporta lo que alcanzó a correr. El siguiente uso arranca un worker nuevo.
- **Complejidad que se nota**: los casos grandes llevan `timeLimitMs` y entradas con `argsExpr` (una expresión de Python, para no mandar 100.000 números en JSON). Medido en Chrome: Pyodide hace ~10 millones de sumas simples en ~1,2 s. Una solución O(n) de «Comprar y vender» resuelve 100.000 días en ~12 ms; la O(n²) se corta.
- **Comparación** (`compare`): `exact` (booleanos estrictos: 1 no es True), `unordered` y `groups`. `banned` revisa el AST (p. ej. «El mayor» sin `max`).
- **Editor**: CodeMirror 6 armado a mano, sin autocompletado de palabras (la idea es teclear), con sangría de 4, cierre de paréntesis, colores por tokens del tema, Vim opcional (`@replit/codemirror-vim`, carga diferida), A−/A+ y la línea del error marcada en rojo. Borrador y preferencias en localStorage.
- **Agente**: `apps/agent/src/dojo/` — `store.ts` (intentos en `~/.hermes-os/dojo/attempts.jsonl`, sin migración; lo aprobado marca el hábito «Dojo»), `coach.ts` (Agent SDK + UNA tool, `HERMES_DOJO_MODEL`, default sonnet, sin razonamiento extendido) y `routes.ts`.

## Rutas

- `GET /dojo`: estado de cada lección, racha, repasos que vencen y avance por unidad.
- `POST /dojo/attempts`: guarda un intento (al pasar, al rendirse o al terminar una lección). `{ ok, attempt, dojo | error }`.
- `POST /dojo/typing`: una pasada de mecanografía → `{ ok, dojo | error }`.
- `POST /dojo/coach`: `{ itemId, stage: entender|plan|debug, … }` → `{ ok, feedback | error }`.

## Tests

`apps/agent/src/dojo/dojo.test.ts` corre **cada solución de referencia contra todos sus casos con el mismo harness**, en CPython (se salta sin `python3`). También ejecuta el código de cada lección, comprueba que la respuesta de cada «¿Qué imprime?» sea lo que Python imprime de verdad, y que fallen los errores típicos: `print` en vez de `return`, 1 por True, `max` prohibido, `/` con enteros enormes y usar el mismo elemento dos veces. Un problema nuevo que no pase esto no entra.

## QA en el navegador

Máquinas: `/dev/dojo-figuras` (índice) · `?item=<id>&theme=light|dark&reveal=0|1` (modo guion) · `?item=<id>&live=1&ex=N&code=<URL-encoded>` (modo en vivo con la referencia o con un código equivocado).

Agente de ensayo aislado (no toca tus datos ni marca el hábito real) + web dev:

```sh
env HERMES_PORT=8661 HERMES_JOBS=off HERMES_TUNNEL=off HERMES_HUB=off MACHINE_NAME=dojo-qa \
  NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= HERMES_HOME=/tmp/dojo-home \
  pnpm --filter @hermes/agent exec tsx src/index.ts
env NEXT_PUBLIC_WEB_PORT=31999 NEXT_PUBLIC_HERMES_URL=http://localhost:8661 pnpm --filter @hermes/web dev
```

Playwright con `channel="chrome"` (el headless-shell cacheado no coincide con la versión instalada).
