# Capacidad: pulso

Segunda fase del cambio. Reemplaza la idea de «un job por función» por un solo observador.

## ADDED Requirements

### Requirement: Un pulso que decide si algo merece interrumpir
Hermes DEBE revisar cada cierto tiempo el estado agregado (agenda, pendientes, juntas recientes,
metas en marcha, foco, finanzas del día y oportunidades) y decidir si hay algo que el dueño deba saber.

#### Scenario: Nada cambió
- CUANDO el estado es igual al de la revisión anterior
- ENTONCES no se llama a ningún modelo

#### Scenario: Algo cambió
- CUANDO cambió algo relevante desde la última revisión
- ENTONCES un modelo barato recibe solo el cambio y el resumen del estado, y responde «nada» o una tarjeta con título, texto, motivo y fuente

#### Scenario: Apagado
- CUANDO `HERMES_PULSE=off`
- ENTONCES no corre

#### Scenario: Horas de silencio
- CUANDO es de noche (entre las 22:00 y las 7:00 hora local)
- ENTONCES el pulso no llama al modelo ni avisa; lo que cambió se revisa en la primera pasada de la mañana

### Requirement: Bandeja antes que aviso
Lo que el pulso encuentra DEBE ir a una bandeja visible en el dashboard y en el teléfono. Solo lo
urgente gasta un aviso del presupuesto diario.

#### Scenario: Hallazgo normal
- CUANDO el pulso encuentra algo útil pero no urgente
- ENTONCES queda en la bandeja y no suena nada

#### Scenario: Avisos apagados (por defecto)
- CUANDO `HERMES_PULSE` no es `notify`
- ENTONCES nada suena nunca: todo queda en la bandeja, también lo urgente

#### Scenario: Hallazgo urgente con avisos prendidos y presupuesto
- CUANDO `HERMES_PULSE=notify`, el hallazgo es urgente y quedan avisos hoy
- ENTONCES sale un aviso al teléfono, con el motivo

#### Scenario: Sin presupuesto
- CUANDO ya se gastaron los avisos del día
- ENTONCES queda en la bandeja y se anota que no se avisó

### Requirement: Cada tarjeta tiene fuente y se puede descartar
Una tarjeta del pulso DEBE citar de dónde salió, y el dueño puede descartarla o decir «nunca de esto».

#### Scenario: «Nunca de esto»
- CUANDO el dueño marca una clase de tarjeta como no deseada
- ENTONCES el pulso deja de producir esa clase

### Requirement: Tope de gasto
El pulso DEBE respetar un tope diario de llamadas al modelo y registrarse en el gasto como `pulse`.

#### Scenario: Tope alcanzado
- CUANDO se alcanza el tope del día
- ENTONCES el pulso sigue revisando el estado pero no llama al modelo hasta el día siguiente

## Notas de implementación

**Dónde vive.** Lógica pura en `packages/shared/src/pulse.ts`; agente en `apps/agent/src/pulso/`
(`collect.ts` fuentes · `pulse.ts` la pasada con dependencias inyectadas · `model.ts` el juicio ·
`store.ts` disco · `index.ts` cableado real · `jobs.ts` · `routes.ts`); web en
`apps/web/src/lib/pulse-api.ts` y `apps/web/src/components/pulse/PulseInbox.tsx`. Tests:
`apps/agent/src/pulso/pulse.test.ts` (28: uno por escenario + diffState + bandeja + prompt).

**Cómo decide sin gastar.** El estado (`PulseState`) se convierte en *situaciones* con clave estable
(`situations(state, tz)`, que usa el reloj de la foto). `diffState` compara claves: el reloj avanzando,
un título que cambia, un pendiente nuevo sin fecha o un accionable menos NO son cambios; cruzar una
ventana sí (aparece una clave nueva). Ventanas y umbrales:

| Clase | Cuándo existe | Clave | Quién la redacta | Urgente |
|---|---|---|---|---|
| `junta-sin-preparar` | evento con proyecto reconocido (el de `nextPrep`), sin hoja de hoy, empieza en (0, 30] min | `…:<eventId>` | regla | sí |
| `pendiente-vencido` | pendiente de Mi día abierto con `due` < hoy | `…:<id>:<due>` | regla | no |
| `accionables-sin-triage` | acta de ≤3 días con accionables sin tarea ni issue | `…:<proyecto>/<acta>` | regla | no |
| `tarea-bloqueada` | programada con `blocked_reason` | `…:<id>:<hash motivo>` | regla | no |
| `habito` | desde las 20:00 locales, hábitos sin marcar | `habito:<fecha>` | regla | no |
| `meta-sin-avance` | meta *en marcha*, ≥2 ocasiones del plan en 7 días y 0 hechas | `…:<id>:<lunes>` (una por semana) | modelo | no |
| `oportunidad` | Upwork `nueva`, puntaje ≥ `HERMES_UPWORK_NOTIFY_MIN`, ≤24 h | `…:<jobId>` | modelo | el modelo puede |
| `foco` | hoy ≥1,5× el promedio y +30 min, con ≥3 días completos | `foco:<fecha>` | modelo | no |
| `finanzas` | variable del mes excedido / categoría sobre su mediana | `finanzas:excedido:<mes>` · `finanzas:desvio:<mes>:<cat>` | modelo | nunca |

Lo de regla entra a la bandeja sin modelo (también de noche: la bandeja no suena). Lo de juicio va al
modelo en UNA llamada por pasada (hasta 8 situaciones). Si es de noche (22:00–7:00) o se llegó al tope
del día, espera en `pending` y se revisa en la primera pasada posible si sigue vigente. Si el modelo
falla, se reintenta a lo sumo 2 veces. Una fuente que falla conserva su sección de la foto anterior
(`carryOver`): una caída de Supabase no produce "nuevas" situaciones al volver.

**El modelo.** `trackedQuery("pulse", …)` (Haiku, sin razonamiento) con UNA tool `record_pulse`; sin
Bash, Read ni red (`canUseTool` niega todo lo demás). Recibe solo las situaciones nuevas (s1…sN) y un
resumen de conteos; el prompt marca los títulos externos como datos. La FUENTE y la clase de la tarjeta
no las escribe el modelo: salen de la situación que cita; citar una que no existe la descarta.
Finanzas: el modelo no recibe montos, y `validateCard` descarta una tarjeta de finanzas con dígitos.

**Bandeja.** Dedupe por clave de situación; «Listo» recuerda la clave 30 días (no vuelve por la misma
causa); caducidad por clase (la de junta, 30 min después de empezar); lo resuelto sale solo; «Nunca de
esto» silencia la clase (ni siquiera va al modelo) y se puede deshacer; orden urgentes → recientes;
tope de 12 vivas (sale la no urgente más vieja).

**Aviso.** Solo con `HERMES_PULSE=notify`, tarjeta urgente, fuera del silencio, que no sea de
finanzas y con avisos del día (`HERMES_PHONE_NOTICES_PER_DAY` menos lo usado en `phone/notices.json`).
Sale por `phoneLink.notify` (import perezoso) con el texto y el porqué. Si no sale, la tarjeta guarda
`notice: {sent:false, reason}` y el registro lo anota. Los tests usan un canal doble; ninguna prueba
de esta noche avisó.

**Variables.** `HERMES_PULSE` (`off` · por defecto bandeja · `notify`), `HERMES_PULSE_MAX_CALLS`
(default 12), `HERMES_PULSE_DISTRACTION_APPS` (paquetes Android separados por comas; sin lista no hay
tarjetas de foco: sin regla del dueño no hay intervención). Job `pulso` cada 10 min (no se registra con
`off`). Disco en `$HERMES_HOME/pulso/`: `state.json` (foto, pendientes, llamadas del día, última
pasada), `inbox.json`, `log.jsonl` (una línea por pasada, solo claves, nunca títulos).

**Contrato HTTP** (todas 200; `{ok:false, error}` con motivo):

- `GET /pulse/inbox` →
  `{ ok, mode: "off"|"inbox"|"notify", cards: PulseCard[], counts: {live, urgent, byKind}, never: PulseKind[], lastRun: {at, model, reason?, added, cards} | null, calls: {today, max} }`
  con `PulseCard = { id, key, kind, title, text, why, source: {kind, ref, label, url?}, urgent, createdAt, expiresAt, by: "rule"|"model", notice?: {sent, reason} }`.
  `source.kind ∈ calendar · day-task · meeting (ref = proyecto/acta) · goal · scheduled · upwork (url) · habit · focus · finance`.
- `POST /pulse/cards/:id/dismiss` → `{ok, card}` · `POST /pulse/cards/:id/never` → `{ok, kind, removed}` ·
  `POST /pulse/never/:kind/undo` → `{ok, kind}`.
- `POST /pulse/run` cuerpo `{dryRun?, fresh?, model?: false}` → `{ok, skipped?, dryRun, sources: {ok, failed}, added: string[], resolved: string[], model: {called:true, keys, ms, cards, rejected, error?} | {called:false, reason, waiting} | null, cards: PulseCard[], inbox: {live, urgent}}`.
  `dryRun` no escribe ni avisa (sí llama al modelo salvo `model:false`); `fresh` ignora la foto anterior.
- `GET /pulse/log?limit=` (1–200, default 20) → `{ok, lines}` (más reciente primero).

**Web.** Contador «Bandeja» en la barra lateral, junto a «en curso», solo con tarjetas vivas (ámbar
si hay urgentes); abre una hoja lateral (también ⌘K «Bandeja»). Un solo poll compartido: al abrir +
cada 60 s con la pestaña visible.

**Límites conocidos.** Linear no entra (una llamada GraphQL cada 10 min por tareas que no son del
dueño no vale). Solo el próximo evento que `nextPrep` reconoce tiene proyecto: otras juntas del día no
producen `junta-sin-preparar`. El foco compara minutos de hoy (parciales) con días completos: solo
dispara cuando hoy YA superó un día normal. Las tarjetas urgentes que caen de noche no se re-avisan en
la mañana (quedan en la bandeja). El teléfono aún no muestra la bandeja (el contrato está arriba).
