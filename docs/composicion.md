# Composición — escribir canciones con Hermes

Ruta `/composicion`, montada por el AppShell como el resto de vistas (navegar no la
desmonta, la llamada de voz sobrevive). Nació como versión estática (2026-09-02); desde
2026-09-24 el tablero vive en el agente y hay **Sesiones** (el Playground: una sesión
grabada → pasajes cantados → melodía, melismas, molde y versiones de letra). Y desde
2026-09-25, **Temas**: la máquina de temas (abajo).

**Es una herramienta interna y confidencial**: `/composicion/*` rechaza lo que llega por
el túnel del móvil (solo red local o Tailscale), sus eventos no se espejan en Supabase
y la UI dice qué sale del equipo (`GET /composicion/privacy`).

## La regla que ordena todo

**El factor humano no se delega.** La primera versión la escribes tú; Hermes entra
cuando ya hay algo que empujar, y todo lo que propone es una tarjeta con
`Usar / Variar / Descartar` + el **por qué** visible. Nada entra a la canción sin un
clic humano. Esto está escrito en el riel (Principios) para que sea contrato, no
buena intención.

Lo que sí automatiza son **instrumentos de medida**, no decisiones: sílabas métricas,
esquema de rima, grados romanos, qué acorde es prestado y por qué. Como el metrónomo:
mide, no compone.

## Qué hay

| Sección | Qué resuelve |
| --- | --- |
| **Canciones** | Lista → takeover de una canción con el copiloto al lado |
| **Referencias** | Lo que te alimenta: canciones, letras, progresiones, poemas, ambientes |
| **Cuaderno** | Versos sueltos, frases, títulos, tarareos: lo que todavía no es canción |
| **Riel** | Ritual del día, racha de escritura, qué toca hoy, principios |

### Canción (takeover)
Tabs de una cosa a la vez:

- **Letra** — secciones (verso/pre/coro/puente…), cada verso con sus acordes inline
  `[Am]` (ChordPro) y, al margen, **sílabas métricas** y la **letra del esquema de rima**
  (A/B/C). Clic en la terminación de un verso abre las rimas del banco (consonantes en
  violeta, asonantes en cian). "✦ Hermes" por sección precarga la pregunta en el copiloto.
- **Tonalidad** — rejilla de 12 tónicas + Mayor/menor. Muestra la escala en el piano,
  los **7 acordes diatónicos** con grado romano y función (tónica/subdominante/dominante,
  clic = suenan), los **prestados** que suelen funcionar con su porqué, y las tonalidades
  vecinas (relativa, paralela, quintas). Cambiar de tonalidad **transpone** los acordes
  de toda la canción (toggle).
- **Acordes** — progresión por sección en tarjetas grandes: símbolo + grado + estado
  (diatónico / prestado / fuera). ▶ la toca al tempo y compás reales con el paso
  encendido (WebAudio puro, sin samples). Se arma desde la paleta, los prestados, un
  campo libre o presets clásicos resueltos en tu tonalidad.
- **Estructura** — línea de tiempo proporcional a los compases, reordenar, duración
  estimada real (compases × pulsos ÷ bpm).
- **Referencias** — enlazar/quitar del tablero: es el contexto que Hermes leerá.
- **Historial** — cada cambio real deja rastro (letra / armonía / estructura / tonalidad).

## Lógica pura (en `packages/shared`, con tests en `apps/agent/src/composicion/*.test.ts`)

- `music-theory.ts` — escalas, acordes diatónicos, grados romanos, análisis funcional
  (diatónico/prestado/fuera), prestados con explicación, deletreo correcto por
  tonalidad (el ♭II de La menor es **Bb**, no A#: por eso `chordSymbol` acepta
  `spell`), notación latina (Do Re Mi), transposición, presets por grados.
- `lyrics-analysis.ts` — métrica española (vocales fuertes/débiles, diptongos,
  sinalefa, ajuste aguda/llana/esdrújula), terminación desde la vocal tónica, rima
  consonante vs asonante, esquema de estrofa, parser de acordes inline. La métrica es
  **aproximada y se etiqueta como tal**.
- `melody.ts` — de PCM a notas (YIN + Viterbi, 92,6 % de acuerdo con pyin medido),
  sílabas ancladas a la transcripción, **melismas** (una sílaba sobre 2+ notas),
  frases con su **molde** (sílabas, acentos, final, melismas; modos respetar /
  silabizar), tonalidad (Krumhansl + Temperley, top-3 con confianza), `lineFit` (qué
  tan bien calza una línea de letra con el molde) y `detectPassages` (pistas
  combinadas; la recurrencia cuenta en ±60 s, no en toda la sesión).
- `composicion.ts` — el contrato: tablero, sesiones, pasajes, análisis, letras, fuentes,
  privacidad y la lista de rutas.
- `apps/web/src/lib/chord-audio.ts` (no es puro: WebAudio) — `playChord`,
  `playProgression`, `playNote`, `playMelody`, con stop real.

## Persistencia

- **Tablero** (canciones, referencias, cuaderno): `~/.hermes-os/composicion/board.json`
  (`GET/PUT /composicion/board`). La web se hidrata de ahí y guarda con un PUT diferido;
  un 404 siembra un tablero **vacío** (el mock es solo para el modo sin agente, rotulado
  "datos de prueba"). El mock no lleva material real: el repo es público.
- **Sesiones**: estado liviano en `~/.hermes-os/composicion/sesiones/<id>/` (session.json,
  transcript.json, passages/, lyrics/) y medios en `COMPOSICION_MEDIA_ROOT/<id>/`
  (`{crudos, assets, analisis}`; fallback `~/Movies/composicion/sesiones`).

## Sesiones (el Playground)

Pipeline por sesión, con etapas persistidas y reanudables: copiar (md5, o adoptar si el
archivo ya está en la carpeta) → audio → transcribir (Scribe diarizado) → resumen
(Agent SDK: líneas LITERALES, estructura, decisiones, pendientes) → pasajes → separar
(Mel-Roformer en el venv de audio-separator, solo los pasajes; cada pasaje se persiste
apenas termina y reanudar salta lo ya separado) → melodía (notas, sílabas, melismas,
molde y tonalidad por pasaje; la del instrumento manda). La UI: lista de sesiones +
importar (cámara por DCIM, archivo, memo del micrófono) → sesión (checklist en vivo,
video, voces, pasajes con evidencia, resumen) → memo (Melodía · Molde · Versiones) →
aplicar a una canción con diff y deshacer.

## Temas (la máquina de temas)

Nació de una junta con músicos y productores: **"una máquina de temas; componer 10
temas y con partes de esos armar el mío — la originalidad no se pierde, se acelera el
proceso"**. Una canción = 4 capas (pista · intención · fonemas melódicos · traducción
a letra), más Análisis y Montaje. Un TEMA recorre 6 etapas con la misma pista sonando
en loop en todas (transporte fijo abajo):

| Etapa | El humano | Hermes |
| --- | --- | --- |
| Intención | de qué habla, qué transmite, a quién, qué evitar, palabras ancla, género | entra al prompt de letra POR ENCIMA de todo |
| Pista | tonalidad, acordes por compás (bloques), bpm (−/+ y Tap), compás, groove, secciones | diatónicos, prestados, plantillas; motor WebAudio sin samples (dembow/dancehall/rnb/pop) |
| Grabar | tararea "na na / uh uh" ENCIMA de la pista (cuenta 4·3·2·1, varias vueltas = varias tomas, ★) | grabación alineada a la muestra (AudioWorklet en el mismo reloj), latencia medida por loopback |
| Análisis | lee y corrige | la toma en la rejilla: compás.tiempo, rol sobre el acorde, melismas, vocal, dinámica pp..ff, lectura en números |
| Letra | consigna, Tu versión, bloquear, regenerar | versiones con ÁNGULOS distintos medidas contra el molde (sílabas, final, acentos, **eco fonético** de las vocales del tarareo, malacentos) + **guía cantada** |
| Montaje | elige por sección qué parte usar (de este tema o de otros), escucha el ensamble | aplicar a una canción con diff y deshacer |

Piezas clave:
- **Una toma es una `ComposeSession` con `take`** (rejilla con la que se grabó) y un solo
  pasaje P01: reusa todo el pipeline, el molde y las letras de Sesiones. Con audífonos
  no se separa (la mezcla ES la voz); transcribir es opcional (local por defecto).
- **Letras** (`apps/agent/src/composicion/lyrics.ts`): una llamada POR VERSIÓN en
  paralelo (máx 4), cada una con su ángulo; hasta 2 rondas de reparación contra el
  verificador determinista (`lineFit`: sílabas, malacentos, eco < 35 %), con la lectura
  sílaba por sílaba en el pedido. Modelo y razonamiento propios
  (`COMPOSICION_LYRICS_MODEL` sonnet · `COMPOSICION_LYRICS_THINKING` off). Medido sobre un
  coro real: 4 versiones en ~50 s (con razonamiento extendido: 6–11 min).
- **Guía cantada** ("vocaloid-lite"): TTS de ElevenLabs con timestamps por carácter →
  sílabas → PSOLA en TypeScript puro a la altura de CADA nota (o al contorno real del
  tarareo) → WAV. Caché por texto: cambiar altura o modo no vuelve a cobrar. Se rotula
  como guía, no como demo.
- **Montaje**: `montageSlots` propone la ★ pero la elección es humana; aplicar usa
  `applyToSong` (puro) para el diff y el resultado.
- Persistencia: `~/.hermes-os/composicion/temas/<id>.json`; tomas en
  `<raíz madre>/temas/<tema>/tomas/<sesión>/`.

## Fase 2 (definida, no construida)

- **Generador de melismas/fonemas sobre acordes** ("dame opciones de melismas para
  estos acordes"): reglas (notas del acorde en tiempo fuerte, paso/bordadura en débil,
  células del género) + Markov de grados; candidatos como `TemaCandidate.kind = "generado"`.
- **Perfil de hits por microcorpus propio**: referencias que el compositor posee →
  mismo pipeline → SOLO rasgos agregados (grados, sílabas/compás, % melismas, ámbito,
  largo de frase) + n-gramas con HMAC para una guardia anti-copia. No hay corpus público
  de urbano latino con melodía; Chordonomicon es NC y Hooktheory prohíbe minería.

## Pendiente

1. **Corregir notas en Análisis** (±1 semitono, bordes de frase): hoy `patchTake` solo
   acepta favorita, latencia y pista de texto.
2. **Fase 2** (arriba): generador de melismas y perfil de hits.
3. **Búsqueda real de referencias**: `browse_web` para traer letras y progresiones
   citando la fuente.
4. **Voz**: tools `capture_song_idea` / `what_am_i_writing`.
5. **Banco de rimas**: el mock tiene ~120 palabras; falta un diccionario real.
6. **Hábito**: la racha del riel debe colgar del hábito "Componer".
