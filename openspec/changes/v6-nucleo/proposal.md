# v6 «Núcleo»: memoria que no se cae, gasto medido, modelos al día y un teléfono que sí frena

Fecha: 2026-11-09 · Ramas: `v6/nucleo` en `hermes-os` y en `hermes-phone` · Estado: en ejecución

## Por qué

Hermes creció a lo ancho (unas 230 mil líneas, 340 rutas) sobre un núcleo de unas 3.600 líneas que
hoy tiene fallos silenciosos. La auditoría del 9-nov los midió:

| Hallazgo | Evidencia |
|---|---|
| La memoria semántica está caída | 3.451 errores `insufficient_quota` de OpenAI en `agent.err.log`; las memorias nuevas se guardan sin vector y la búsqueda cae a un `ILIKE` sobre una sola tabla |
| No se sabe cuánto gasta cada función | El gasto se registra en 2 de unos 22 sitios que llaman al modelo; el chat no deja traza |
| El chat paga de más y tarda de más | Cada turno arranca el CLI y reconstruye el system prompt con la búsqueda del mensaje, así que el prefijo cacheado se pierde en cada turno |
| Los modelos quedaron atrás | Varios valores por defecto apuntan a `claude-haiku-4-5`; sin `HERMES_MODEL` el chat, las tareas y el acta corren en `claude-opus-5-5`, el modelo más caro de uso diario |
| Los secretos llegan al proceso hijo | 10 sitios llaman a `query()` sin `childEnv()`; uno de ellos permite Bash con 300 turnos |
| Las skills se archivarían solas | `recordSkillUse` no tiene ningún llamador; el curador archiva a los 45 días sin uso |
| El teléfono da dos pasos por cada uno | `tap`/`type`/`scroll` devuelven `"ok"` y obligan a releer la pantalla |
| El freno de distracciones es parejo | Hay aviso a los N minutos seguidos, pero no presupuesto diario, ni intención, ni distinción entre los mensajes de Instagram y los Reels |

El dueño pidió, para el último trimestre: memoria, gasto de tokens, modelos al día, una aplicación
móvil mucho mejor y más fuerza en lo que más usa (reuniones en vivo, inglés, finanzas y foco).

## Qué cambia

**Núcleo del agente**
1. **Catálogo de modelos** (`modelos`): una sola tabla dice qué modelo, esfuerzo y razonamiento usa
   cada función. Familia Claude 5 verificada con esta cuenta.
2. **Gasto medido** (`gasto`): toda llamada al modelo pasa por un envoltorio que registra función,
   modelo, tokens, caché, costo y latencia, y aplica `childEnv()` por defecto. Panel de gasto.
3. **Sesión estable y viva** (`sesion`): system prompt estable por sesión (el contexto del mensaje
   viaja en el mensaje), sesión persistente para el chat, y menos tools por canal.

**Memoria**
4. **Memoria v2** (`memoria`): índice local híbrido (léxico + vectores locales con bge-m3) que cubre
   Supabase y los almacenes de `~/.hermes-os`. No depende de OpenAI. Consolidación nocturna con
   vigencia de los hechos, salud visible y evaluación con preguntas reales.

**Lo que más se usa**
5. **Preparación de junta** (`juntas`): antes de la reunión, una hoja con objetivos, preguntas,
   pendientes y lo que se prometió, que además alimenta al copiloto.
6. **Repaso diario de inglés** (`ingles`): tarjetas con los errores reales del dueño y repetición
   espaciada, en la web y en el teléfono.
7. **Finanzas de hoy** (`finanzas`): «disponible hoy», cargos repetidos, gastos hormiga y desvíos,
   cada número con su método.

**Teléfono**
8. **Cuerpo** (`telefono-cuerpo`): cada acción devuelve la pantalla nueva, pasos en lote, intents,
   plazo de confirmación compartido, conexión más rápida y cola de chat sin conexión.
9. **Foco** (`telefono-foco`): presupuesto diario, fricción creciente, intención antes de entrar y
   freno por superficie (Reels y Shorts sin tocar los mensajes).
10. **Aplicación** (`telefono-app`): inglés y finanzas de hoy en el teléfono, novedades y versión 0.2.0.

**Proactividad y contexto de trabajo**
11. **Pulso** (`pulso`): un solo agente de fondo que decide si algo merece interrumpir. Segunda fase.
12. **Contexto de desarrollo** (`contexto-dev`): `CLAUDE.md` pasa de unos 70 mil tokens a un índice
    corto; el detalle de cada función vive en `docs/contexto/`.

## Qué no cambia

- Producción no se toca: nada se reinicia, no se aplican migraciones de Supabase, no se republican
  los agentes de ElevenLabs y no se hace push. Todo queda en las ramas `v6/nucleo`.
- Ninguna migración de base de datos: lo nuevo se guarda en `~/.hermes-os` o se deriva.
- La voz sigue en ElevenLabs. Probar Eleven Realtime queda como pendiente con medición.
- No se agregan dependencias de npm. En la máquina se instaló `llama.cpp` (Homebrew) y se descargó
  el modelo de embeddings `bge-m3-Q8_0.gguf` (635 MB, licencia MIT) en `~/.hermes-os/models/`.

## Cómo se sabe que quedó bien

- `pnpm typecheck` y `pnpm test` en verde, con tests nuevos por cada capacidad.
- Un agente de ensayo (`HERMES_JOBS=off`, otro puerto) arranca y responde las rutas nuevas.
- Recuperación medida con preguntas reales: modo viejo contra modo nuevo.
- Latencia del segundo turno de chat medida: antes y después.
- `./gradlew :core:test :app:assembleDebug` en verde y el APK 0.2.0 listo para instalar.

## Riesgos

| Riesgo | Mitigación |
|---|---|
| Cambiar el modelo del chat de Opus 5.5 a Sonnet 5.5 baja la calidad percibida | Un solo valor en el catálogo o `HERMES_MODEL` lo devuelve; el gasto por función queda medido para decidir con datos |
| La sesión persistente del chat falla en un caso no previsto | Interruptor `HERMES_CHAT_SESSION=oneshot` y caída automática al camino de siempre |
| El freno por superficie depende de identificadores internos de Instagram y YouTube | Los identificadores son configurables, hay un diagnóstico por `./phone qa`, y queda marcado como no probado en el teléfono real |
| El índice local se desfasa de Supabase | Sincronización incremental por huella y reconstrucción completa con un comando |
