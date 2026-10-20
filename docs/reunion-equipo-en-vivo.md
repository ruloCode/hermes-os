# Reunión de equipo EN VIVO (modo `equipo`)

Copiloto para reuniones de equipo por Meet, Teams (web o app de escritorio) o en sala. Nació de una reunión real donde el tema era nuevo y no hubo qué decir. El copiloto de juntas de antes solo soplaba cuando **te preguntaban a ti**, y en una reunión de equipo casi nadie te pregunta directo.

Regla: **ayuda a hablar con criterio, no habla por ti**. Cada tarjeta es una frase corta para decirla con tus palabras. Nada de cifras, experiencia ni decisiones inventadas: lo que no está en la conversación ni en el proyecto no existe.

## Cómo se usa

Reuniones → proyecto en foco → tarjeta de inicio:

- **Tipo:** `Equipo` (aportar + conceptos) o `Entrevista · cliente` (el modo `junta` de siempre: te sopla la respuesta cuando te preguntan).
- **Audio:**
  - `Presencial`: el mic de la sala.
  - `Meet · Teams web`: mic + pestaña compartida con «Compartir audio de la pestaña».
  - `App de Teams`: mic + audio del sistema. Sirve para Teams, Zoom, Slack o cualquier app.
- La elección se recuerda en el navegador (`hermes-live-setup`).
- Ya en vivo, **⧉ Ventanita** abre la ventana flotante (Document PiP) encima de la llamada. Necesita su propio clic.

## Qué sopla

Dos motores (`apps/agent/src/meetings/live-team.ts`, `TeamCopilotController`), cada uno una sesión persistente del Agent SDK que recibe solo las líneas nuevas:

**Aportar** (interrumpible: la ventana más reciente gana)
- **Ventanas** (`detectOpening`, puro, en `packages/shared/src/team-copilot.ts`):
  - te nombran (`HERMES_OWNER_NAME` + `HERMES_OWNER_ALIASES`);
  - piden opinión al grupo;
  - se está decidiendo algo;
  - alguien plantea un problema;
  - una pregunta en el aire;
  - llevas rato callado (900 caracteres ajenos desde tu última frase, como mucho una vez cada 75 s).
- Entre dos automáticos pasan al menos 12 s. Un pedido a mano también cuenta para ese intervalo.
- **Que te nombren salta el intervalo e interrumpe lo que esté en vuelo:** esa respuesta importa más que el glosario.
- **Formato:** dos líneas, ángulo y frase.
  - Ángulos: `Responde · Trade-off · Riesgo · Alcance · Precedente · Siguiente paso · Medición · Pregunta · Puente`.
  - **Puente** es el aporte honesto cuando el tema es nuevo: "No lo he llevado a producción; lo que yo validaría primero es…". Así hablas con criterio sin fingir experiencia.
  - `—` = el momento no amerita.
- **A mano:** `Aportar` · `Pregunta` · `¿De qué hablan?` (intents `full` · `question` · `explain`).

**Entender** (en cola, sin streaming)
- Cada ~8 s de conversación ajena manda los términos o conceptos nuevos, una línea por concepto («término — explicación», máximo 2).
- Ninguno sale dos veces en la reunión.
- Si el proyecto lo define, la línea termina con "(del proyecto)". Si no, es conocimiento general.

**Loop estratégico** (el de siempre, 20–45 s): en este modo prioriza `dato` y `rumbo`, porque es lo que la capa rápida no tiene fresco.

## Velocidad y contexto (2026-10-14, tras la primera junta real)

En la primera reunión real (proyecto de cliente, migración a Postgres), la capa rápida respondió `—` a "¿Tienen alguna sugerencia de cómo continuar con la migración?". Las únicas tarjetas buenas llegaron a los 64 s, desde el loop estratégico. Tres causas, medidas, y lo que se hizo con cada una:

1. **Contexto vacío.** El RAG (`match_knowledge`) necesita embeddings de OpenAI. Sin créditos cae a un ILIKE sobre memorias, y el proyecto no tenía sección "Briefing Reuniones". El copiloto no veía las 5 actas recientes sobre la misma migración.
   - Ahora: **`meetings/meeting-context.ts`** arma un dossier LOCAL al arrancar la junta, en paralelo con el STT (~0,4 s). Trae objetivo y stack de la nota (hasta "Estado Actual"), el estado sin callouts, las tareas pendientes y **las últimas 4 actas** (resumen + accionables).
   - Lo usan las tres capas.
   - El prompt pide **continuidad** ("eso ya lo hablamos el 7: quedamos en…") y concreción: tablas, personas, pendientes reales.
2. **El motor se callaba.**
   - El warm-up decía `Responde únicamente "—"`, y la sesión persistente arrancaba practicando el silencio. Ahora pide "OK".
   - El prompt prohíbe `—` ante una pregunta al grupo, una decisión o una mención. Solo calla en saludos y logística.
   - Pisos por tipo de ventana: pregunta y opinión 4 s · decisión y problema 10 s · rato callado 12 s · mención 0. Con 12 s parejos se perdió "¿En qué estado estamos?", que llegó 5 s después de otra pregunta.
3. **El loop estratégico era lento por diseño.** Esperaba 45 s o 250 caracteres, y cada corrida costaba 11-16 s: un CLI nuevo, una vuelta del modelo para cargar la tool, la tool y un mensaje final que nadie leía.
   - Ahora es una **sesión persistente** como la capa rápida. Le llegan solo las líneas nuevas y responde en texto «tipo | sugerencia | por qué» (`parseStrategic`).
   - Tarda **3-5 s** con la sesión caliente (8 s la primera corrida).
   - En modo equipo **cada ventana lo despierta**, con un piso de 15 s.
   - El RAG por corrida tiene un tope de 0,8 s.
   - El camino viejo por `query()` + tool queda solo para `HERMES_COPILOT=off`.

**Modelo:** Sonnet por defecto para los aportes (`HERMES_COPILOT_TEAM_MODEL`) y el loop estratégico (`HERMES_COPILOT_DEEP_MODEL`), sin razonamiento extendido. Comparado con Haiku sobre la misma junta, fue igual de rápido (1,4-2,1 s al primer token) y trajo precedentes con fecha, nombres reales y compromisos con dueño. Haiku daba preguntas genéricas. El glosario sigue en Haiku.

**Glosario:** solo pasan términos que se DIJERON (`conceptMentioned`). Haiku "explicaba" términos que sacaba del contexto del proyecto.

Replay para medir cualquier cambio de prompt o modelo: las 5 frases reales con sus pausas contra el contexto del proyecto, imprimiendo cada tarjeta con su latencia (script en el historial de la sesión; reproducir con `TeamCopilotController` + `createFastEngine` + `loadMeetingContext`).

## El repaso al cerrar

El acta suma `## Repaso` (`teamReviewMarkdown`):

- **Ventanas para aportar:** los aportes que salieron solos, con **si hablaste o no**. Es dato del transcript, no opinión del modelo. Tomaste la ventana si **empezaste** a hablar entre 2 s antes y 20 s después de que se abrió.
  - Con 45 s y contando turnos que ya venían, una reunión movida salía "6 de 6" siempre.
  - Sin «soy yo» marcado no se afirma nada.
- **Para estudiar:** los conceptos que salieron.

## Audio de la app de escritorio

El browser solo captura pestañas, así que la app de Teams va por un helper nativo:

1. `apps/agent/native/system-audio.swift` usa ScreenCaptureKit y captura todo el audio del sistema menos su propio proceso. Teams reproduce desde un WebView auxiliar, y filtrar por app lo perdería.
2. Escribe PCM16 mono a 16 kHz por stdout y su estado en NDJSON por stderr.
3. `meetings/system-audio.ts` lo reenvía en frames de 100 ms por WS **`/audio/system/ws`**. Solo LAN: por el túnel responde 4403.
4. El browser lo inyecta con el worklet `pcm16-source` al **mismo** mezclador que la pestaña, con su analizador antes de mezclar. Así el «soy yo» automático (energía mic vs llamada) funciona igual, y ahora corre en toda junta remota, no solo en la clase.

Detalles:

- El helper se compila solo la primera vez (`scripts/build-system-audio.sh`). Si el Xcode completo no corre (por ejemplo, con la licencia sin aceptar), usa las Command Line Tools.
- **Permiso:** Ajustes → Privacidad y seguridad → **Grabación de pantalla y audio del sistema** → el `node` del LaunchAgent (`~/.hermes/node/bin/node`). Sin él, el helper responde con el motivo y el dashboard lo muestra en el banner «Sin audio de la app».
- **Audífonos:** el AEC de Chrome solo cancela lo que suena desde Chrome. Por bocinas, el mic vuelve a captar a los demás y duplica voces.

## QA

- Tests: `apps/agent/src/meetings/team.test.ts` (parsers, ventanas, repaso y reglas de disparo con motores falsos).
- Sim e2e (BORRA su acta del vault y de Supabase al final):
  ```
  HERMES_PORT=8699 HERMES_JOBS=off MACHINE_NAME=hermes-sim \
    HERMES_LIVE_STT=fake HERMES_LIVE_STT_SCRIPT=team [HERMES_COPILOT=fake] npx tsx src/index.ts
  HERMES_PORT=8699 npx tsx scripts/live-sim.ts --team --project hermes-os
  ```
  - Con `HERMES_COPILOT=fake` son respuestas enlatadas.
  - Sin él mide Haiku real: aportes con ~1–3 s hasta el primer token.
- **Ojos con el agente de prueba:**
  - Arrancarlo corre `reconcileRunningTasks()`, que pasa a pendientes las tareas `running` que no son suyas: mira antes que no haya ninguna.
  - Matarlo con una reunión viva deja un `.live-*.json` que el siguiente arranque ingesta como acta "(interrumpida)".
  - Su fila de `agent_presence` (`hermes-sim`) aparece en el selector de máquinas hasta que la borras.

## Pool en cola e historial (2026-10-20)

Lo mismo que se hizo en la clase de inglés tras la clase del 16-oct, ahora en junta y equipo:

- **Nada se corta.** El motor de aportes era interrumpible: la ventana siguiente cortaba el aporte a medio escribir (se veía arrancar y desaparecer). Ahora es `createFastEnginePool` (`meetings/live-copilot.ts`): dos sesiones persistentes en cola. Una ventana nueva va al motor libre; si los dos están ocupados espera (de lo que espera solo sigue lo último, y lo pedido a mano no lo desplaza un automático).
- **Contexto armado al enviar.** `lazyRequest` + `promptFor(engine)`: el prompt incremental se arma para el motor que lo envía y en el momento de enviarlo. Armado al encolar, un pedido descartado se llevaba líneas que ningún motor veía; y con dos sesiones, cada una tiene su propio cursor.
- **Más rápido.** Pisos de disparo: junta 4 → 1,5 s; pregunta/opinión de equipo 4 → 1,5 s (la cola ya evita la ráfaga). Medido con Sonnet real sobre el guion de equipo: 9/9 aportes terminados, 0 cortados, primer texto p50 1,4 s (los dos primeros 3,8–4,7 s: los motores aún calentaban). Junta (Haiku): 5/5, ~1,4 s.
- **Historial.** `MeetingHelpFeed` en el riel y en la ventanita (que antes solo mostraba el último aporte y 2 conceptos): todo queda, ordenado por el momento en que se pidió (`fastStartedAt` en live.ts — no salta de lugar al terminar). Lo que aún no tiene texto, o solo el "—" del silencio, es una línea de estado y no una tarjeta. "Soplar ahora" ya no se bloquea mientras otra se escribe.
- **Micrófono.** Medidores Tú/Llamada, aviso si el sistema silencia o corta el mic, y selector de micrófono en la tarjeta de inicio. El aviso por lo medido ("casi no te oigo") queda solo en la clase: en una reunión pasar minutos callado es normal.
- Tests: `meetings/pool.test.ts`.
