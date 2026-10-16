# Clase de inglés en vivo (compañera de clase por Google Meet)

La idea es tener a alguien al lado en las clases 1 a 1 de inglés por Meet, sin que Hermes hable por ti. La compañera hace cuatro cosas:

- corrige lo que **tú** dices;
- te da un **andamio** cuando la profe te pregunta algo: palabras clave y el arranque de la frase, que terminas tú;
- te explica en español lo que no entendiste;
- al final arma un reporte que alimenta a la tutora de voz.

Es un modo de la **Junta EN VIVO** (`coachMode: "clase-ingles"`). Usa el mismo audio (mic + pestaña de Meet), el mismo STT con diarización y la misma capa rápida de Haiku. El cierre va al pipeline de inglés y no al de juntas.

## Cómo se usa

1. En `/ingles`, pulsa **● Clase en vivo** (o ⌘K → "Clase de inglés en vivo").
2. Chrome pide el mic y la pestaña: elige la pestaña de **Meet** y marca "compartir audio de la pestaña".
3. Pulsa **⧉ Abrir ventanita**. Es un Document PiP que queda flotando encima de Meet. Chrome exige un clic propio para abrirla, porque el del inicio ya se gastó pidiendo la pestaña.
4. **"¿Cuál eres tú?"** se resuelve solo en cuanto hablas 2 veces (ver "Soy yo automático"). Si no, toca "Voz N". Sin esto no hay correcciones.
5. Al terminar (■ Terminar): la sesión queda en el historial como **Clase**, con el reporte del coach y el botón **▶ Repasar ahora** con la tutora.

Conviene contarle a la profe que la clase se transcribe para tus apuntes, porque su voz pasa por AssemblyAI.

## Qué hace en vivo

| Kind | Cuándo | Qué muestra | Motor |
|---|---|---|---|
| `corregir` | Terminas de hablar. Tus finales se juntan hasta 6 s de silencio o hasta que habla la profe; necesita 5 palabras o más y que sea inglés. | `lo que dijiste → cómo se dice` + la regla en español | **En cola, sin interrumpir**: la corrección de hace 5 s sigue sirviendo. Llega entera, sin streaming. |
| `andamio` | Pregunta de la profe (final con `?`, o el end_of_turn crudo con pinta de pregunta) o botón **Ayúdame** | `Clave: … (traducción) · …` + `Arranca: …` | Interrumpible: la pregunta nueva gana |
| `explicar` | Botón **¿Qué dijo?** | Lo último de la profe en español simple + `Clave: palabra = significado` | Interrumpible |
| `decir` | Botón **Dame la frase** | La respuesta completa en inglés sencillo, con huecos `[así]` si es sobre tu vida | Interrumpible |

Reglas del corrector:

- Solo corrige errores que afectan la claridad o los que ya repites.
- Si duda de si fue un error del STT, no corrige.
- Responde `—` cuando no hay nada que corregir, y eso no genera tarjeta.
- Prioriza los errores de tus últimas 6 sesiones (`recentEnglishErrors`).

El loop estratégico de 20-45 s está **apagado** en este modo: es de juntas, va en español y trae accionables.

**Métricas** (barra del coach y ventanita, en `LiveCoachMetrics.class`):

- tu % del tiempo hablado (meta ≥40 %, se pinta ámbar por debajo);
- turnos tuyos en español;
- correcciones por cada 100 palabras;
- muletillas contadas **solo en inglés**: "este" o "pues" en clase son caídas al español, no muletillas.

## "Soy yo" automático

En remoto el navegador tiene las dos fuentes por separado antes de mezclarlas:

- el **mic**, con cancelación de eco, que no oye a la profe por los parlantes;
- la **pestaña de Meet**, que no te devuelve tu propia voz.

`useLiveMeetingAudio` mide el RMS de cada una por frame. El provider la guarda en el reloj del audio **enviado**, que es el reloj del STT. `inferSelfSpeaker` (en `packages/shared/src/english-class.ts`) elige la voz cuyos turnos coinciden con el mic:

- necesita 2 o más turnos con el mic dominando;
- con mayoría de 3 a 1;
- y con un solo candidato.

Decide una vez por sesión. Lo que marca el humano manda.

## Al cerrar

`ingestClass` (en `apps/agent/src/english/class-ingest.ts`) guarda la clase como sesión de inglés:

- tabla `english_sessions` con `source: "class"`;
- transcript con **Profe:** y **Yo:**, encabezado por una línea con las métricas;
- las correcciones en vivo, deduplicadas y con tope de 20, como `errors`.

Luego dispara `generatePracticeReport`, cuyo prompt sabe que fue una clase real, y hace el check-in del hábito "Práctica de inglés". `{{practice_context}}` abre la siguiente práctica con "Last session was a REAL CLASS…": la tutora pregunta cómo te fue y vuelve a entrenar sus errores.

**No hace falta republicar el agente de ElevenLabs**: la instrucción viaja en el contexto.

Las clases interrumpidas por un reinicio del agente se recuperan igual. El snapshot vive en `projects/ingles/reuniones/.live-*.json` y `recoverOrphanLiveMeetings` lo enruta por `coachMode`.

## También en "Practicar ahora" (tutora de voz)

Las mismas tarjetas acompañan la práctica con la tutora de IA, en la sección **Compañera** del riel de /ingles.

Ahí no hay audio propio ni STT: ElevenLabs ya transcribe. `usePracticeCompanion` sube cada línea final (`TÚ`/`TUTOR`) por el WS `/english/practice/ws`. Del lado del agente, `english/practice-companion.ts` usa el mismo `ClassCompanionController`, con dos motores y prompts que saben que es la tutora.

Diferencias con la clase:

- **El andamio NO es automático:** la tutora pregunta en casi cada turno, así que sale solo con **Ayúdame**.
- **Una compañera viva a la vez:** cada una sostiene 2 procesos CLI, y cerrar el WS los mata.
- **Las correcciones se suman a los `errors` de la sesión** que guarda la tutora (`mergePracticeCorrections`: primero lo del tutor, luego lo nuevo, tope 12), también en el auto-guardado por cierre abrupto. Así el reporte las ve.

Latencias medidas con Haiku el 2026-10-07:

- corrección ~2 s;
- andamio ~1,4 s;
- frase ~1 s.

**"Dame la frase" usa solo lo que dijiste:** lo que no está en el transcript va como hueco `[así]`. La primera versión inventaba detalles de tu trabajo.

## Ayuda automática: la frase sola (default)

Cuando te preguntan algo, la ayuda sale sin pedirla. Es una preferencia del navegador (`lib/auto-help.ts`, localStorage), con un toggle **Sola: Frase · Pistas · No** en el riel de la práctica, el riel de la clase y la ventanita.

**Frase** es el valor por defecto: el 2026-10-07 Rulo pidió que siempre llegara la respuesta completa, en tiempo real y fluida. Viaja al agente por `{type:"config"}` (práctica) o `{type:"auto_help"}` (clase), y también en el start, y cambia en caliente (`ClassCompanionController.setAutoHelp`).

En la práctica, la ayuda del turno se muestra en grande en el centro, bajo la tutora ("Dilo así"). Se va cuando respondes o ella vuelve a hablar.

Reglas de la frase:

- máximo 20 palabras, porque se lee mientras hablas;
- en charla general, una respuesta natural sin huecos;
- los datos concretos de tu vida que no dijiste van como `[hueco]`, máximo 2.

Medido con Haiku: primer texto ~0,6-0,8 s y frase completa ~1 s desde que llega la pregunta.

**Bugs que destapó la prueba real:**

- `guessLang` contaba substrings de una lista corta y en empate decía "es". Por eso "Yes, I make a similar agent last year" nunca se corregía. Ahora cuenta tokens con listas amplias y, en empate, deciden los acentos.
- El modelo a veces responde `forma | regla` sin "lo que dijo", con una flecha dentro de la regla. El parser solo acepta la flecha antes del `|`. Sin ella, usa lo que se mandó a corregir, que viaja como `trigger`.

## Práctica más rápida, con contexto completo y nueva pantalla (2026-10-07)

La lentitud no era el modelo: en la práctica real Haiku respondía en ~1 s. Venía de tres cosas, y las tres se arreglaron.

**1. El texto de la tutora llegaba al FINAL de su turno.** Ahora va en streaming:

- `tutorConfig` lleva `client_events` con `agent_chat_response_part`. Se republica solo a la tutora con `pnpm setup:elevenlabs --tutor`, un flag nuevo que no toca Hermes ni la Sala.
- `VoiceSessionBridge` → `lib/voice-partials.ts` (emisor fuera de React, para no re-renderizar el shell en cada token) → `usePracticeCompanion` manda `{type:"partial"}` en cada oración completa → `ClassCompanionController.onPartialOther`.
- La ayuda arranca apenas ella completa la pregunta, mientras sigue hablando. Medido: ~0,6 s después de cerrar la pregunta.
- La pregunta se deduplica por texto, así que el final no repite la ayuda.
- `askOf` también detecta órdenes sin "?" ("Tell me about…").
- El debounce bajó a 1,2 s.

**2. La compañera se calentaba tarde.** Ahora abre con la llamada en "conectando".

**3. El contexto era una ventana de 1.400 caracteres.** Ahora es toda la conversación:

- El controlador lleva su propio registro de líneas finales.
- A cada motor le manda solo lo nuevo, porque su sesión persistente recuerda lo anterior.
- Si la sesión se reinicia, `FastEngine.epoch()` cambia y se le reenvía la conversación entera.
- El system prompt suma lo que sabe de ti (`loadCompanionKnowledge`): la sección "Quién soy" de SOUL.md, `buildPracticeContext` y los errores repetidos. Con eso la frase usa tus datos reales ("Probably Hermes OS…") en vez de `[huecos]`.

**Nueva pantalla de práctica** (`LivePractice.tsx`; patrones Mobbin: Speak, Duolingo, Gemini Live):

- **Barra de llamada:** quién habla, con onda real; tiempo desde que conectó; ayuda automática; silenciar (`useConversationInput`); terminar.
- **Conversación:**
  - La frase de la tutora aparece EN STREAMING mientras la dice. Si ya se vio así, no repite el karaoke al cerrarse.
  - Tus burbujas llevan su feedback debajo: «dijiste → mejor | regla», "✓ Bien dicho" (evento `checked`) o "revisando…" (con tope de 8 s).
- **Dock "Tu turno"** fijo abajo: la frase en grande; las pistas como chips más el arranque; atajos F · P · Q · M.
- **Riel "Esta práctica":** tus turnos, palabras, bien dichas y la lista de correcciones.
- **Detalles del resto de la vista:**
  - Las stats de /ingles se ocultan mientras estás en vivo.
  - Al colgar se abre el reporte de la sesión nueva.
  - La barra de presencia ya dice "Tutora" y no "Hermes".
- QA sin llamada: `/dev/ui` → "Simular conversación", con streaming, frase, pistas y correcciones simuladas.

## Archivos

- **Shared:** `packages/shared/src/english-class.ts`, con la lógica pura: `parseCorrection`, `correctionsFromSuggestions`, `classSpeakerNames`, `computeClassMetrics`, `inferSelfSpeaker`, `guessLang`.
- **Agente:**
  - `apps/agent/src/english/class-companion.ts`: el controller y los prompts.
  - `apps/agent/src/english/class-ingest.ts`: el cierre.
  - `meetings/live.ts`: decide según `coachMode`.
  - `meetings/live-copilot.ts`: `createFastEngine` con `interrupt:false`, `kind` en los eventos.
- **Web:**
  - `components/live/ClassPip.tsx`: la ventanita, con un solo dueño en `providers.tsx`.
  - `LiveMeetingProvider.startClass()`.
  - `LiveSuggestionsRail`, que muestra los botones de clase.
  - `views/InglesView.tsx`: el takeover y el salto al reporte.

## Pruebas

- **`pnpm test`:** `apps/agent/src/english/class.test.ts` (26 contratos).
- **Sim sin gastar:**
  - Agente con `HERMES_PORT=8660 HERMES_JOBS=off HERMES_LIVE_STT=fake HERMES_LIVE_STT_SCRIPT=class HERMES_COPILOT=fake`.
  - Luego `HERMES_PORT=8660 pnpm --filter @hermes/agent live:sim --class` (17 asserts).
  - Borra la sesión que crea. El check-in del hábito de ese día hay que borrarlo a mano si no practicaste.
- **Con Haiku real:** quitar `HERMES_COPILOT=fake`. Medido el 2026-10-07:
  - corrección ~1 s;
  - "¿Qué dijo?" ~1,2 s;
  - andamio ~1 s (el primero ~4 s, en frío).
- **Ojo:** el formato del andamio necesitó un ejemplo literal en el prompt. Sin él, Haiku omitía las etiquetas `Clave:`/`Arranca:`.
