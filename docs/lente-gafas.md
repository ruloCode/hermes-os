# Lente — lo de las Even Realities G2, dentro de Hermes

> Plan, 2026-10-22. **Fases 0 y 1 hechas el mismo día** (ver "Estado" abajo); el resto sigue en plan.
> Fuentes al final.

## Estado

| Fase | Estado | Dónde |
|---|---|---|
| 0 · contrato del cue | ✅ 2026-10-22 | `packages/shared/src/lens.ts` (`toCue`, `glanceText`, `LensDeck`, `LensStreamer`) · evento `cue` en `meetings/live.ts` (`broadcast`) · tests `meetings/lens.test.ts` · `live:sim` exige un `cue` final por sugerencia en TODOS los modos |
| 1 · superficies | ✅ 2026-10-22 | web `/lente` (+ `?sim=1`, ⌘K "Lente" abre ventana pequeña) · Hermes Phone: botón **Lente** en la junta en curso (`ui/Lens.kt`, `core/Lens.kt` con la misma baraja y tests) |
| 2 – 6 | pendiente | — |

Lo que cambió al implementar (manda sobre lo escrito más abajo):
- **Tope 90 caracteres** (~3 líneas en la G2), no "2 de 28". `glanceText` corta en fin de frase, luego en
  pausa, luego en palabra entera con "…"; el texto completo viaja en `full` para el historial.
- **TTL** = el del tipo o `2 s + 70 ms × carácter`, lo que sea mayor.
- **Prioridades**: 6 te nombraron / te preguntaron · 5 lo pediste a mano · 4 respuesta · 3 persona ·
  2 sugerencia, concepto, dilo así · 1 rumbo del estratégico. Una más importante pisa a la visible apenas
  ésta cumple 1,5 s de vista, también si llegó ANTES de ese mínimo (lo atrapó el primer ensayo: una
  Pregunta pedida a mano quedó tras un concepto de 10 s y caducó en la cola).
- **El streaming lo arma el agente** (`LensStreamer`): manda `cue` con `pending:true` cada ≤250 ms
  mientras la capa rápida escribe, con la misma id que la final. Así web, teléfono y gafas solo pintan
  `cue` + quitan la id en `suggestion_aborted`; nadie reimplementa el parseo parcial.
- **Calma** es preferencia de cada superficie (localStorage en la web, `Prefs.lensCalm` en el teléfono),
  no un `{type:"config"}` al agente: dos lentes pueden filtrar distinto en la misma junta.
- "Siguiente" sobre una tarjeta en streaming la descarta de verdad (sus parciales no la vuelven a poner).
- La pestaña `/lente` nunca reabre el micrófono aunque herede el sessionStorage del dashboard
  (candado en `LiveMeetingProvider`).


## 1. Qué son las Even Realities G2 (y por qué venden)

Gafas de **pantalla sin cámara**: 36 g, marco de magnesio/titanio, fórmula de −12 a +12, IP65,
~2 días de batería (estuche con 7 cargas), **pantalla verde monocroma micro-LED 640×350, FoV 27,5°**
por guía de onda (solo la ve quien las lleva), **4 micrófonos**, **sin cámara y sin parlante**.
USD 599. Se controlan con el touchpad de la patilla o con el **anillo R1** (USD 249: tocar/deslizar,
discreto, también mide signos vitales). Todo el cómputo vive en el teléfono (app Even Realities) y en
la nube: sin teléfono conectado y con internet, Conversate no funciona.

### Funciones (nombres oficiales)

| Función | Qué hace |
|---|---|
| **Conversate** | El asistente de conversación. Corre solo cuando lo activas. Cuatro piezas ↓ |
| · **Prep Notes** | Antes de la conversación cargas puntos, cifras y referencias (texto o TXT/DOCX/PDF). Durante, los puntos se despliegan con un toque. |
| · **AI Cues** | Tarjetas que aparecen solas "cuando es relevante" y **se desvanecen a los pocos segundos**. Cuatro tipos: **Suggestions** (aclarar, cuestionar, reorientar) · **Answers** (de TUS materiales) · **Concepts** (términos que no conoces) · **Bios** (quién es la persona que mencionan). En marzo 2026 sumaron *fact checking* y palabras clave. |
| · **Live Transcript** | Subtítulos en vivo; el transcript queda en la app (y en el teléfono, para que el otro lo lea sin gafas). |
| · **AI Summary** | Puntos clave + accionables al cerrar. |
| **Translate** | Traducción en vivo en 35 idiomas, en tu línea de visión. |
| **Teleprompter** | Guion (PDF/Word/TXT) con tres modos de avance: **AI-paced (sigue tu voz)**, velocidad fija y manual (anillo/toque). |
| **Even AI** | "Hey, Even": preguntas, búsquedas y disparar funciones (también escucha continua). |
| **Navigation** | Giro a giro en la periferia. |
| **QuickList / Calendar / Notifications** | Tareas, agenda editable y notificaciones **filtradas** (solo lo relevante). |
| **Dashboard** | Hora, clima, agenda, noticias, acciones. |
| **Even Hub** | Tienda de apps de terceros (ver §5: es nuestra puerta al hardware real). |

### Qué las diferencia en el mercado

- **Sin cámara, a propósito.** Es su argumento central ("Camera-free. By design."): no incomodan a la
  otra persona, se pueden usar en juntas, clínicas y oficinas. Meta Ray-Ban Display (USD 799) y Rokid
  sí tienen cámara; Halliday tampoco la tiene; Brilliant Labs Halo es la abierta y barata.
- **Parecen gafas normales** y llevan fórmula: uso todo el día, no "gadget".
- **Conversación primero, no "IA que ve"**: el producto estrella no es preguntarle cosas, es que te
  sople mientras hablas con alguien. Nadie más lo empaqueta así (Prep Notes + Cues + Summary).
- **Mirar, no leer**: tarjetas de una o dos líneas que se van solas. El formato es parte del producto.
- **Control discreto** con el anillo: pasar una tarjeta o pedir ayuda sin que el otro lo note.
- **Privacidad declarada**: el audio se procesa y se borra; se guarda solo texto.
- **Ecosistema abierto** (Even Hub): ya hay ~200 apps de la comunidad, varias que conectan Claude Code,
  coaches de conversación y traductores. Ojo: las que se llaman "Hermes" (`hermes-even-hub-app`,
  `even-g2-hermes`, `GlassAI`) son del Hermes Agent de Nous, no de este repo.

Lo flojo (según reseñas): verde monocromo difícil de ver a pleno sol, depende del teléfono e internet,
precio alto, y el anillo se activa sin querer.

## 2. Lo que Hermes YA tiene (mapa función por función)

| Even G2 | En Hermes hoy | Estado |
|---|---|---|
| Live Transcript | Junta EN VIVO: AssemblyAI con diarización, mic + pestaña/app, es/en con code-switching | ✅ más completo (hablantes, «soy yo») |
| AI Cues · Suggestions | Capa rápida (`live-copilot.ts`, ~1,4 s), equipo «aportar» con **ángulo** (`live-team.ts`), estratégico `decir/preguntar/rumbo` | ✅ |
| AI Cues · Concepts | Motor **entender** del modo equipo («término — explicación», una vez cada uno) y `explicar` en la clase | ✅ |
| AI Cues · Answers | Estratégico `dato` con RAG (`match_knowledge`) + dossier local (`meeting-context.ts`) | 🟡 responde de TU conocimiento, no de un material cargado para ESA junta |
| AI Cues · Bios | — | ❌ |
| Fact checking | — | ❌ |
| Prep Notes | Dossier automático: nota del proyecto + tareas + últimas 4 actas | 🟡 automático, pero no puedes cargar notas/PDF/objetivo para una junta concreta |
| AI Summary | Ingest: acta + accionables a Linear + `## Coach` + `## Repaso` | ✅ muy por encima |
| Translate | STT es/en; la clase corrige y da la FRASE en inglés | 🟡 no hay "subtítulos traducidos" ni conversación con alguien de otro idioma |
| Teleprompter | Modo grabación del Estudio (beats, A−/A+, ↑↓) | 🟡 avance manual; no sigue tu voz |
| Even AI | Voz ElevenLabs de Hermes, Hermes Phone (botón lateral) | ✅ |
| QuickList / Calendar | `day_task`, `/agenda`, Mi día | ✅ |
| Notifications filtradas | Avisos del teléfono con presupuesto diario, compañero proactivo | ✅ |
| Dashboard | Inicio, `/phone/home`, salvapantallas de la TV | ✅ |
| Navigation | Rutas de Metro del tótem (no giro a giro) | ⚪ fuera de alcance |
| Anillo R1 | Atajos, gestos, Hermes Phone | ❌ no hay control discreto DURANTE una conversación |
| **La pantalla en el ojo** | Tarjetas largas en el dashboard / ventanita PiP / teléfono | ❌ **éste es el hueco de verdad** |

**Conclusión:** el cerebro ya lo tenemos y es mejor que el de Even (contexto real de proyectos y actas,
diarización, coach, articulación, pool de motores). Lo que falta es **(1) el formato de mirar**,
**(2) una superficie que puedas ver sin dejar de mirar a la persona**, **(3) control discreto** y
cuatro cues nuevos: **Bios, Answers de tus materiales, fact-check y traducción**.

## 3. Qué vamos a construir — "Lente"

Un modo de salida de la Junta EN VIVO (no un cerebro nuevo, igual que hicimos con el teléfono):

```
mic / pestaña / app / gafas ─▶ WS /meetings/live/:id/ws ─▶ STT ─▶ motores (rápida · equipo · estratégico · nuevos)
                                                                     │
                                                         LiveSuggestion (como hoy)
                                                                     │
                                                    toCue()  ← NUEVO, puro, en shared
                                                                     │
                     ┌───────────────────┬──────────────────┬──────────────────────┐
                 /lente (web)     Hermes Phone "Lente"   Ventanita PiP     Even G2 (Even Hub)
```

### Fase 0 — El contrato del cue (base de todo)

`packages/shared/src/lens.ts`, puro, con tests en `apps/agent/src/meetings/lens.test.ts`:

- `LensCue = { id, type, title?, text, ttlMs, priority, sourceRef?, atMs }`,
  `type ∈ "sugerencia" | "respuesta" | "concepto" | "persona" | "dato-ojo" | "traduccion" | "dilo-asi" | "punto"`.
- `toCue(s: LiveSuggestion)`: mapea los kinds actuales (`decir/aportar/preguntar/rumbo` → sugerencia,
  `dato` → respuesta, `entender/explicar` → concepto, `pulir/corregir` → dilo-asi, `andamio` → sugerencia).
- **Reglas de mirar** (contratos de comportamiento, no snapshots):
  - `text` ≤ 90 caracteres y ≤ 2 líneas de 28 (lo que cabe en 576 px de ancho de la G2); si no cabe,
    `glanceText()` corta en frase completa, nunca a media palabra. El texto completo sigue en el historial.
  - `ttlMs` por tipo (sugerencia 8 s, concepto 10 s, persona 12 s, traducción hasta la siguiente).
  - Prioridad: te nombran / pregunta directa > respuesta > persona > concepto > sugerencia de rumbo.
  - **Una tarjeta a la vez** en la lente; lo que llega mientras tanto entra a una cola de máx. 2 y lo
    más viejo se descarta (en una lente, lo atrasado estorba).
- Evento WS nuevo `{type:"cue", cue}` (además de los `suggestion_*` de siempre, que no se tocan).

### Fase 1 — La superficie: dónde miras sin que se note

1. **`/lente` en la web** (página suelta, fuera del shell, como `/estacion`): fondo negro, texto verde
   grande, una tarjeta, icono del tipo, desvanecido. Se conecta como `viewer` al WS de la junta viva
   (ya existe el rol). Sirve hoy en: el teléfono apoyado en la mesa, una segunda pantalla, la ventanita
   PiP encima de Meet/Teams. Atajo de prueba: `?sim=1` reproduce cues de guion sin junta.
2. **Hermes Phone → pantalla "Lente"**: mismo WS como viewer, pantalla siempre encendida, brillo bajo,
   modo "boca arriba en la mesa". El teléfono ya graba la junta: puede ser audio + lente a la vez.
3. **Ajuste en vivo**: `lens: { cues: on/off por tipo, frecuencia: calma | normal | intensa }` por
   `{type:"config"}` (patrón de `auto_help`). Calma = solo cuando te preguntan o te nombran.

### Fase 2 — Los cues que faltan (lo que más importa para conversar)

1. **Prep Notes de verdad** (`meetings/prep.ts`, en disco `~/.hermes-os/prep/<sessionId|slug>.json`,
   sin migración): en la tarjeta de inicio — y por voz/chat con una tool `meeting_prep` — cargas
   **objetivo** ("quiero que aprueben el sprint 2"), **puntos a tocar**, **personas** y archivos
   (PDF/DOCX/TXT/URL → texto con lo que ya tenemos). Entra al prompt de los motores igual que el dossier.
   - **Puntos a tocar con check automático**: cuando el transcript cubre un punto (match por términos,
     como la dedup de USER.md) se marca solo; a los 2/3 del tiempo agendado, cue `punto`: «Falta: precio».
   - **Objetivo**: el estratégico ya tiene `rumbo`; ahora rumbo = contra TU objetivo, no adivinado.
2. **Bios** (`persona`): cuando alguien es nombrado (o se presenta), buscar en actas, memorias y
   contactos del vault → «Andrés · líder técnico Ternium · el 14-oct pidió la demo de reportes».
   Regla de la casa: dato con fuente; si no hay nada, no sale tarjeta (nunca una bio inventada).
3. **Answers de tus materiales** (`respuesta`): si la pregunta se responde con las Prep Notes o el
   dossier, la cifra exacta con su fuente («$4M COP · propuesta v2, p. 3»). Va por la capa rápida.
4. **Fact-check** (`dato-ojo`): una cifra/fecha/compromiso dicho en voz alta que choca con un dato
   tuyo → «Ojo: el acta del 14-oct dice 3 semanas, no 2». Umbral alto: prefiere falsos negativos
   (como `detectWeakPhrases`). Solo números, fechas y nombres de entregables.
5. **Coach de un vistazo**: lo que ya mide `live-coach.ts`, convertido en cue solo cuando importa:
   «Llevas 3 min seguidos», «Hablas a 190 ppm», «Ana no ha hablado». Máx. uno cada 3 min.

### Fase 3 — Traducción en vivo (Translate)

Modo `coachMode:"traduccion"` de la Junta EN VIVO, para hablar con alguien en otro idioma:

- STT con los dos idiomas (ya existe `["es","en"]`); por cada final del OTRO, cue `traduccion` en
  tu idioma (motor en cola con Haiku: traducir es corto; medir latencia como en la clase).
- Para ti: la **frase para responder** en su idioma (reusar la FRASE de la clase con `Sube:`),
  y opcional que Hermes la diga en voz alta por el teléfono (TTS) — la G2 no tiene parlante.
- Subtítulos completos en la lente del otro: `/lente?para=otro` en tu teléfono girado hacia él
  (lo que Even hace con el transcript en el teléfono).
- Idiomas: arrancar con es↔en (lo que AssemblyAI ya nos da bien); el resto después.

### Fase 4 — Teleprompter que te sigue (AI-paced)

Sobre `script-beats.ts` y el modo grabación del Estudio:

- `followScript(beats, finalesYParciales)` (puro, shared): posición = el beat cuyas palabras más
  coinciden con lo último que dijiste (ventana deslizante, tolera muletillas y saltos).
- Fuente de voz: el mismo STT en vivo (mic) — sirve para grabar reels **y** para charlas/pitches.
- En la lente: frase vigente + la siguiente; si te sales del guion 10 s, cue «Vuelve a: …».
- Modo **pitch**: en vez de guion literal, viñetas que se marcan al cubrirlas (reusa Prep Notes).

### Fase 5 — Control discreto (nuestro "anillo")

Cuatro acciones, nada más: **siguiente / pedir ayuda ahora / marcar momento / callar cues 5 min**.

- **Hermes Phone**: botones de volumen con la pantalla Lente abierta (o el servicio de accesibilidad
  con `FLAG_REQUEST_FILTER_KEY_EVENTS` en junta viva): subir = ayuda ahora, bajar = siguiente,
  dos veces = marcar.
- **Mac**: atajo global (el helper Swift ya existe) para las mismas acciones durante Meet/Teams.
- **Anillo/clicker BLE barato**: se ve como teclado HID → mismo mapeo (o la ESP32-S3 de la TV).
- **Marcar momento** = `{type:"mark"}` → el acta lo lista en `## Momentos` con su minuto y texto.

### Fase 6 — Las gafas de verdad (si compras unas G2)

El Even Hub nos lo pone fácil y casi todo ya encaja:

- Una app de Even Hub es **una web en el WebView del teléfono** (o una PWA en tu propia URL, sin
  revisión ni tienda). El micrófono de las gafas llega como **PCM 16 kHz, 16 bits, mono** — exactamente
  el formato que ya recibe `/meetings/live/:id/ws`. Las tarjetas se pintan con contenedores de texto
  (`bridge.callEvenApp`), sin fuentes ni animación ni color: el formato de la Fase 0 es justo ése.
- App `hermes-lente` (PWA): `audioControl(true)` → WS como `role=audio&client=glasses`;
  eventos `cue` → contenedor de texto; touchpad/anillo (`CLICK`, `DOUBLE_CLICK`, `SCROLL_*`) →
  las 4 acciones de la Fase 5. `LiveClientKind` suma `"glasses"`.
- Red: `fetch` solo a dominios en la whitelist de `app.json` y con CORS → la URL del túnel / Tailscale
  (y revisar en el simulador si el WebView permite WebSocket a esa URL; la doc no lo dice).
- Probar sin comprar: `evenhub` CLI + simulador (`everything-evenhub`), que emula pantalla, audio y anillo.

## 4. Orden recomendado y criterios de "listo"

| # | Entrega | Listo cuando |
|---|---|---|
| 0 | `lens.ts` + evento `cue` + tests | `pnpm test` cubre mapeo, corte de texto, TTL, prioridad y cola de 2 |
| 1 | `/lente` + pantalla Lente en Phone | en una junta `HERMES_LIVE_STT=fake` las tarjetas salen y se van solas; `live:sim --lens` lo asierta |
| 2 | Prep Notes + puntos + Bios + Answers | junta real con objetivo cargado: al menos un `persona` y un `respuesta` con fuente, cero inventados |
| 5 | Control discreto (volumen + atajo Mac) | pedir ayuda sin tocar la pantalla; `## Momentos` en el acta |
| 3 | Traducción es↔en | primer cue traducido ≤ 2 s tras el final del otro (medido) |
| 4 | Teleprompter que sigue la voz | lee un guion del Estudio sin tocar teclas; se recupera de un salto |
| 2b | Fact-check + coach de un vistazo | sin falsos positivos en el replay de las actas reales |
| 6 | PWA en Even Hub | corre en el simulador; con hardware, junta completa desde las gafas |

La Fase 5 va antes que la 3 a propósito: sin control discreto, la lente en una conversación
cara a cara se vuelve tocar el teléfono, que es justo lo que las gafas evitan.

## 5. Reglas que no se negocian

- **Todo dato visible es real**: Bios, Answers y fact-check llevan fuente o no salen.
- **Una tarjeta a la vez, y se va sola**. Lo largo vive en el historial y en el acta, no en la lente.
- **Prefiere callar** antes que soplar mal: en `calma` solo sale lo que responde a algo que te dijeron.
- **No es un cerebro nuevo**: todo cue sale de los motores de la Junta EN VIVO; la lente solo formatea.
- **Privacidad**: el modo Lente respeta la custodia actual (audio guardado); agregar un interruptor
  "solo texto" (no guardar audio) para conversaciones casuales, como hace Even.

## Fuentes

- Página oficial: https://www.evenrealities.com/smart-glasses · Conversate: https://www.evenrealities.com/en-CA/conversate
- Teleprompter: https://evenrealities.com/teleprompter-glasses · Specs: https://support.evenrealities.com/hc/en-us/articles/13499229138959-Specs
- Prep Notes (mar-2026): https://tools.prnewswire.com/en-us/live/20823/release/20260326EN16415
- Reseñas: https://mobilesyrup.com/2026/10/19/even-realities-g2s-are-my-new-daily-smartglasses-the-r1-ring-is-clutch/ · https://heise.de/-11076939 · https://www.tomsguide.com/computing/smart-glasses/even-realities-g2-smart-glasses-review · https://www.bgr.com/2024472/even-g2-display-smart-glasses-r1-ring/
- Even Hub (SDK): https://hub.evenrealities.com/docs/get-started/architecture · https://hub.evenrealities.com/docs/build/device-apis
- Comunidad: https://github.com/pangoleen/awesome-even-realities-g2
- Comparativas: https://treeview.studio/blog/best-smart-glasses · https://techeconomy.ng/even-realities-g2-vs-meta-ray-ban-can-a-camera-free-smart-glasses-startup-challenge-meta
