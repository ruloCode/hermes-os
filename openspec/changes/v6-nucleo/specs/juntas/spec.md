# Capacidad: juntas

## ADDED Requirements

### Requirement: Preparación de junta
Antes de una reunión, Hermes DEBE poder armar una hoja de preparación para un proyecto: objetivo de
la reunión, hasta tres preguntas para hacer, pendientes abiertos, lo que el dueño prometió y riesgos.
Cada punto cita de dónde salió (acta y fecha, tarea o nota del proyecto).

#### Scenario: Proyecto con actas
- CUANDO se pide la preparación de un proyecto con actas anteriores
- ENTONCES la hoja trae pendientes y promesas con el acta y la fecha de cada uno

#### Scenario: Proyecto sin historia
- CUANDO el proyecto no tiene actas ni tareas
- ENTONCES la hoja lo dice y no inventa puntos

#### Scenario: Un punto sin fuente
- CUANDO el modelo redacta un punto que no se puede atar a una fuente
- ENTONCES ese punto se descarta antes de mostrarse

#### Scenario: Próximo evento
- CUANDO hay un evento de calendario en las próximas horas cuyo título nombra un proyecto
- ENTONCES la preparación se ofrece para ese evento, con su hora

#### Scenario: Segunda consulta el mismo día
- CUANDO se vuelve a pedir la preparación del mismo proyecto el mismo día sin actas nuevas
- ENTONCES se devuelve la guardada, sin otra llamada al modelo

### Requirement: La preparación alimenta al copiloto
Al iniciar una junta en vivo con preparación, el copiloto DEBE conocer el objetivo y las preguntas.

#### Scenario: Junta con preparación
- CUANDO se inicia la junta en vivo de un proyecto que tiene preparación de hoy
- ENTONCES el contexto del copiloto incluye el objetivo, las preguntas y las promesas

### Requirement: La preparación se ve donde se inicia la junta
La tarjeta de inicio de la junta en la web DEBE mostrar la preparación del proyecto elegido, con un
botón para generarla si no existe.

#### Scenario: Sin preparación
- CUANDO el proyecto elegido no tiene preparación de hoy
- ENTONCES la tarjeta ofrece «Preparar» y muestra el avance mientras se genera

### Requirement: La capa rápida usa el modelo rápido vigente
La capa rápida del copiloto DEBE resolver su modelo desde el catálogo (nivel `fast`) y registrar su
tiempo al primer token en el registro de gasto.

#### Scenario: Simulación
- CUANDO corre `live:sim --copilot` con el motor de prueba
- ENTONCES pasan los mismos asserts que antes del cambio

## Notas de implementación

Paquete «juntas: preparación» (tareas 3.1–3.4). La 3.5 (`live:sim`) la corre el paquete núcleo.

### Dónde vive
- Lógica pura: `packages/shared/src/meeting-prep.ts` (pendientes, promesas, decisiones, validación de
  fuentes, evento → proyecto, huella/caché, bloque del copiloto, estado de la tarjeta).
- Agente: `apps/agent/src/meetings/prep.ts` (datos + UNA llamada `trackedQuery("meetings.prep")` con la
  tool `record_meeting_prep`), `prep-store.ts` (disco), `prep-routes.ts` (rutas).
- Disco: `~/.hermes-os/meetings/prep/<slug>/<AAAA-MM-DD>.json` (día de Bogotá). Sin migración.
- Copiloto: `meeting-context.ts` lee la hoja de HOY al arrancar la junta y `meetingContextBlocks` la pone
  PRIMERA (objetivo, preguntas, promesas, riesgos). Sin hoja, los bloques quedan idénticos a antes. Así
  entra a todos los motores (capa rápida, estratégico, equipo) sin tocar `live.ts`.
- Web: `components/live/MeetingPrepSection.tsx` dentro de `LiveSetupCard` (prop `project`), cliente en
  `lib/meeting-prep-api.ts`.

### Decisiones
- **Nada sin fuente.** El modelo cita cada punto con la clave de una fuente de la lista que se le dio
  (`meeting:<id>`, `task:<id>`, `note:nota`, `event:<id>`). `validatePrep` descarta lo que no cita o cita
  una clave inexistente y REEMPLAZA la cita por la fuente real (fecha y título nunca salen del modelo).
  Si se descarta todo (sin objetivo ni preguntas), la hoja queda `draft-failed`.
- **Pendientes, promesas y decisiones no los escribe el modelo**: salen de las actas con reglas.
  - Pendiente = accionable no `done`/`dismissed` (estado de triage real vía `overlayTaskState`), tarea
    abierta de la tabla `tasks` y «Tareas Pendientes» de la nota SIN las `[x]` (`extractTasks` del vault
    las incluye). Dedup por solapamiento de términos (`sameTask`), la más reciente gana.
  - Promesa = (1) el resumen nombra al dueño (`HERMES_OWNER_NAME` + `HERMES_OWNER_ALIASES`) con verbo de
    compromiso y sin negación, o (2) SU voz en la transcripción con un compromiso en primera persona
    (explícito, o futuro con cuándo/a quién). Su voz = el «soy yo» de la junta en vivo: el acta guarda la
    etiqueta del STT (`coach.metrics.selfSpeaker`) pero la transcripción dice «Hablante N» por orden de
    aparición; se toma el candidato por el orden de `bySpeaker` y se COMPRUEBA con el conteo de palabras
    (coincide exacto en las actas reales). Si no cuadra, no se atribuye. Los accionables no son promesas
    por sí solos: el ingest no guarda responsable.
  - Decisión = frase del resumen con «se decidió/acordó…», sin «no hubo decisiones».
- **Evento → proyecto**: palabras completas o palabras seguidas que juntas forman el nombre
  («Rulo Code Show» ↔ `rulocodeshow`); nombres de una palabra < 4 letras no cuentan; empate = no se
  asigna; eventos de todo el día no cuentan; en curso sí. Ventana de 12 h. Los proyectos del vault no
  tienen alias hoy: solo slug y nombre.
- **Caché**: proyecto + día + `prepFingerprint` (fuentes sin el evento + pendientes abiertos). Un acta
  nueva o un pendiente que se cierra la rehacen; una hoja `draft-failed` no se reusa (pedirla = reintentar).
  Una generación por proyecto a la vez.
- **Sin historia** (ni actas, ni tareas abiertas, ni tareas en la nota): no se llama al modelo.
- **Idioma**: preguntas y apertura en el idioma de la transcripción más reciente (`guessLang`); objetivo
  y riesgos en español. Las reglas de articulación van en el prompt.

### Contrato JSON (lo consume también Hermes Phone)
Todas responden 200. Error: `{ "ok": false, "error": "motivo en español" }`.

`MeetingPrep` (version 1):
```json
{
  "version": 1,
  "project": "nevadatech", "projectName": "NevadaTech",
  "day": "2026-11-10", "generatedAt": "2026-11-10T14:49:01.000Z",
  "fingerprint": "dc92e2114a578506",
  "status": "ready | no-history | draft-failed",
  "note": "motivo, solo si status != ready",
  "language": "es | en",
  "event": { "title": "Daily NevadaTech", "startsAt": "2026-11-10T16:00:00.000Z" },
  "objective": { "text": "…", "source": { "kind": "note", "ref": "nota", "label": "Nota del proyecto" } },
  "questions": [ { "text": "…", "source": { "kind": "meeting", "ref": "<id del acta>", "date": "2026-11-10", "label": "<título del acta>" } } ],
  "pending":   [ { "text": "…", "detail": "one_liner del accionable (opcional)", "source": { "kind": "task", "ref": "42", "label": "…" } } ],
  "promises":  [ { "text": "…", "source": { "kind": "meeting", "ref": "…", "date": "…", "label": "…" } } ],
  "decisions": [ ],
  "risks":     [ ],
  "opener": { "text": "…", "source": { … } },
  "sources": [ { "kind": "meeting | task | note | event", "ref": "…", "date": "AAAA-MM-DD (actas y eventos)", "label": "…" } ],
  "dropped": 0
}
```
`event`, `note`, `projectName`, `detail` y `opener` pueden faltar; `objective`/`opener` pueden ser `null`.
Topes: 3 preguntas, 3 riesgos, 8 pendientes, 6 promesas, 5 decisiones.

- `GET /meetings/prep?project=<slug>` → `{ ok: true, prep: MeetingPrep | null, stale: boolean }`
  (`stale` = las fuentes cambiaron desde que se armó; sugiere «Rehacer»).
- `POST /meetings/prep` `{ "project": "<slug>", "force"?: true }` → `{ ok: true, prep, cached }`
  (`cached` = la de hoy seguía valiendo, sin modelo). Tarda ~10 s cuando genera.
- `GET /meetings/prep/next` → `{ ok: true, event: {title, startsAt} | null, project: string | null,
  projectName?, matched?, prep: MeetingPrep | null }` (solo proyectos con `estado: activo`).

### Límites conocidos
- **Las dos rutas GET quedan tapadas en `index.ts`**: `mountV6Routes(app)` se llama en la línea ~2573 y
  `app.get("/meetings/:project")` / `"/meetings/:project/:id"` están antes (~1638): Hono atiende la primera
  que se registró, así que `GET /meetings/prep` devuelve `[]` (las actas del «proyecto» prep) y
  `GET /meetings/prep/next` un 404 de acta. `POST /meetings/prep` funciona. Arreglo de una línea para quien
  integra: llamar `mountV6Routes(app)` antes de las rutas `/meetings/:project…` (o justo después de crear
  `app` y su middleware de auth). La web degrada: si el GET falla ofrece «Preparar», y el POST devuelve la
  guardada sin gastar modelo.
- La detección de promesas en la transcripción solo funciona en juntas en vivo con «soy yo» marcado, o si
  el dueño renombró su hablante con su nombre. Juntas subidas sin eso solo aportan lo que diga el resumen.
- El objetivo puede citar la nota del proyecto aunque hable de un acta: la regla garantiza que la fuente
  existe, no que sea la mejor.
