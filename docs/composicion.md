# Composición — escribir canciones con Hermes

Versión **estática** (2026-09-02) con datos de prueba para validar la idea antes de
tocar Supabase o el agente. Ruta `/composicion`, montada por el AppShell como el resto
de vistas (navegar no la desmonta, la llamada de voz sobrevive).

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

## Lógica pura (con tests posibles, sin React)

- `apps/web/src/lib/music-theory.ts` — escalas, acordes diatónicos, grados romanos,
  análisis funcional (diatónico/prestado/fuera), prestados con explicación, deletreo
  correcto por tonalidad (el ♭II de La menor es **Bb**, no A#: por eso `chordSymbol`
  acepta `spell`), notación latina (Do Re Mi), transposición, presets por grados.
- `apps/web/src/lib/lyrics-analysis.ts` — métrica española (vocales fuertes/débiles,
  diptongos, sinalefa, ajuste aguda/llana/esdrújula), terminación desde la vocal tónica,
  rima consonante vs asonante, esquema de estrofa, parser de acordes inline.
  La métrica es **aproximada y se etiqueta como tal**.
- `apps/web/src/lib/chord-audio.ts` — piano de juguete con osciladores y envolvente;
  `playChord` y `playProgression` (loop, callback de paso, stop real).

## Estado

`useComposicionState` guarda todo en memoria (mock en `components/composicion/mock.ts`).
Su API ya tiene la forma del futuro provider: cuando esto pase a producción se cambia
por un poll a `/composicion/*` y **los componentes no cambian**.

## Para pasarlo a producción

1. **Migración**: `songs`, `song_sections`, `song_versions`, `composition_refs`,
   `notebook_entries`. Espejo al vault en `projects/composicion/` (el .md de cada
   canción con letra + acordes es lo que se lleva a la guitarra).
2. **Rutas del agente**: `GET /composicion/board`, PATCH finos por canción/sección,
   `POST /composicion/refs` (resolver título/canal por oEmbed como el radar del Estudio),
   `POST /composicion/songs/:id/chat` (SSE con tools acotadas `get_song`/`update_song`,
   patrón `content/chat.ts` — sin Bash).
3. **Búsqueda real de referencias**: `browse_web` (chrome-devtools-mcp) para traer
   letras y progresiones citando la fuente.
4. **Voz**: tools `capture_song_idea` / `what_am_i_writing` para anotar un verso o un
   título sin abrir el laptop.
5. **Tarareos**: grabar desde el móvil (ya hay recorder) → `assets/` de la canción,
   como la voz en off del Estudio.
6. **Banco de rimas**: el mock tiene ~120 palabras. En producción, un diccionario
   español real indexado por terminación.
7. **Hábito**: la racha del riel debe colgar del hábito "Componer" (como /ingles),
   no de un array de prueba.
