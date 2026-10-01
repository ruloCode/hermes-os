# Arte de la Oficina de agentes (v8)

Todo lo de esta carpeta es **arte propio**, generado con Higgsfield con prompts escritos para la Oficina: sin personajes, marcas, logos, edificios reconocibles ni estilos de una franquicia. Las fuentes en PNG viven en `raw/`, que **no se commitea** (≈ 28 MB). Para regenerar una pieza, se repite el prompt y se procesa con `apps/web/scripts/oficina-assets.py`.

Fecha de todo: **2026-10-01**. Los créditos son los que reportó `transactions` de Higgsfield; las generaciones fallidas se reembolsaron y no cuentan.

## Panorama de la ciudad (cilindro de fondo)

Un día, un atardecer y una noche con **la misma composición**, para que el cruce entre horas no se vea "fantasma". La noche y el atardecer son ediciones del día, que se pasa como referencia. Se procesan con `oficina-assets.py pano`: se deja el 75 % inferior (≈ 21:9, con el horizonte) y se lleva a 2048 × 1024.

| Archivo | Modelo | Créditos | Prompt |
| --- | --- | --- | --- |
| `panorama-dia.webp` | Recraft V4.1 (`standard`, 2k, 16:9, paleta `#4a90d9 #cfe8f7 #4f9d55 #3f7a52 #c96f4a #e8dcc5 #b5563a #7fa36b`) | 8 | Flat stylized illustration of a distant panoramic skyline, cel-shaded cartoon game background, soft simple shapes. Lower third: a long continuous band of small distant low-rise brick and cream buildings with tiny windows and round green trees, all at the same far distance, no foreground objects, no railing, no roof. Middle: layered green Andean mountain ridges with soft mist, gentle and continuous across the whole width. Upper half: clear bright blue midday sky with a few soft rounded white clouds. Even lighting, horizontally continuous composition, no landmarks, no text, no people, no cars. |
| `panorama-atardecer.webp` | GPT Image 2.5 (medium, 2k, 16:9, referencia: el día) | 1 | Redraw this exact illustration at sunset golden hour. Keep the identical composition, the same mountains, clouds, buildings, windows and trees in exactly the same positions and sizes, same flat cel-shaded cartoon style. Change only the lighting and colors: sky gradient from warm peach and orange near the mountains up to soft violet-blue at the top, clouds tinted pink and gold, mountains in warm olive and purple shades with golden rim light on the left slopes, mist glowing peach, building facades warm orange with long soft shadows, a few windows starting to glow yellow. No sun disc, no text. |
| `panorama-noche.webp` | GPT Image 2.5 (medium, 2k, 16:9, referencia: el día) | 1 | Redraw this exact illustration at night. Keep the identical composition, the same mountains, clouds, buildings, windows and trees in exactly the same positions and sizes, same flat cel-shaded cartoon style. Change only the lighting: deep navy blue night sky with a few small stars (not black), mountains in cool dark blue-green silhouettes with soft moonlit edges, mist faintly glowing, about half of the building windows lit warm yellow, the rest dark blue, trees dark green. No moon disc, no text. |

Descartado: un primer intento con **Soul Location** (21:9) salió fotográfico, con una azotea en primer plano. No sirve como fondo de cilindro y choca con el toon (0,12 créditos).

## Texturas sin costura (1024 × 1024)

Todas con **GPT Image 2.5** (medium, 1k, 1:1), a **0,5 créditos** cada una. El prompt empieza siempre con *"Seamless tileable texture, flat orthographic view filling the whole square:"* y termina con *"even flat lighting, no shadows, no vignette, no text. Edges must tile perfectly."*

| Archivo | Lo que pide el prompt | Proceso |
| --- | --- | --- |
| `tex-ladrillo.webp` | exposed red-orange brick wall in running bond, exactly 16 rows, 4 bricks per row, light warm grey mortar, hand-painted stylized | `exact --crop 0,80,1024,899`: 10 hiladas medidas por el mortero (período de 81,8 px) y 4 ladrillos de 256 px. Repite exacto, sin mezclar |
| `tex-concreto.webp` | warm grey polished concrete floor, soft mottling, faint speckles, no joints | `tile` (mezcla en una banda del 14 % junto al borde) |
| `tex-deck.webp` | outdoor wooden deck, exactly 8 horizontal planks edge to edge, honey-brown, thin dark gaps | `exact --crop 0,4,1024,900 --xband 0.12`: 7 tablones medidos por las juntas (128 px) y mezcla solo a lo ancho |
| `tex-madera.webp` | light oak wood grain, long soft grain lines, a few knots | `tile` |
| `tex-tela.webp` | soft woven upholstery fabric, light neutral warm grey linen weave | `tile`. Es gris a propósito: el color del mueble la tiñe (sofá terracota, sillón verde) |
| `tex-tiza.webp` | empty dark slate chalkboard surface with faint eraser smudges, no writing | `tile`. Es el fondo de la pizarra del café; el menú se escribe encima en canvas |

> **Ojo:** la mezcla del borde (`tile`) sirve para texturas sin patrón (concreto, tela, madera). En un patrón regular deja una franja borrosa: en el ladrillo se veían ladrillos dobles. Por eso el ladrillo y el deck se recortan a un número entero de períodos.

## Cuadros y afiche

**GPT Image 2.5** (medium, 1k), **0,5 créditos** cada uno. Todos piden *"no text, no signature, no frame"*. Proceso: `art` (recorte al centro y escala).

| Archivo | Dónde | Prompt (resumen) |
| --- | --- | --- |
| `arte-cafetal.webp` | Pared del fondo, piso 1 | Original minimalist landscape painting: stylized green Andean mountains with a winding path, a small coffee farm with terraced rows and a few wax palm trees, flat cel-shaded shapes, warm morning light |
| `afiche-cafe.webp` | Café, pared del fondo (en vez del afiche tipográfico) | Original illustrated poster without any text: a big stylized steaming coffee cup with a small green mountain range rising from the steam, flat retro vector style |
| `arte-circulos.webp` | Oficina de CEO | Original modern abstract painting: overlapping soft circles and arcs in terracotta, mustard, sage and deep teal on warm cream |
| `arte-amanecer.webp` | Café, pared del fondo, entre el afiche y el centro | Original calm abstract painting: wide horizontal bands of soft color like a sunrise over layered hills |

## Voces pregrabadas de la gente (`voces/`)

Seis voces × 33 frases FIJAS de las charlas (`CHAT_LINES` en `packages/shared/src/office-chatter.ts`: saludos, el café, la gata, la vista; **ningún número ni dato**). Las frases con datos (la hora, el clima, cuántos agentes trabajan) se dicen con la voz del sistema de esa misma persona. Se usan **solo** en las charlas entre personas y en las reacciones; al saludar al dueño la respuesta lleva datos y suena con la voz del sistema.

- **Modelo:** Higgsfield `text2speech_v2` con la variante `elevenlabs`, voces predefinidas, cobrado en créditos de Higgsfield (no toca la cuenta de ElevenLabs). **0,15 créditos** por frase. Se probó primero `seed_audio` (0,3), pero Whisper lo oía en inglés (p = 0,66), así que se descartó por el acento.
- **Voces:** Marisol, Inés y Elena (femeninas) y Julián, Xavier y Gideon (masculinas), según el `gender` de `list_voices`. **André y Marcus quedaron fuera**: André sonaba tan inglés que Whisper TRADUJO la frase ("How delicious that coffee smells!").
- **Validación de cada clip** (sin oído humano): se transcribe con `whisper-cli` local (large-v3-turbo) y se compara con el texto. Si coincide menos del 75 %, o suena a otra lengua romance sin coincidir completo, se descarta y se regenera. Alias conocidos: "Chao" suena /tʃao/ (Whisper escribe "Tchau"/"Chau"), "quiubo" es coloquial (Whisper escribe "Kiavo"/"¿Qué hubo?") y "Jaja" escrito junto lo convierten en risa, así que se pidió "¡Ja, ja!".
- **Proceso:** se recortan los silencios de las puntas, se normaliza a −18 LUFS y queda un mp3 mono de 24 kHz a 40 kbps (≈ 10 KB por frase, 1,9 MB en total).
- **Falta una:** "Bien, bien. ¿Y tú?" en la voz de Inés. Tres intentos salieron "Et tu" (francés). Esa frase suena con su voz del sistema.
- `voces/manifest.json` dice qué frases tiene cada voz y su timbre. La voz premium de una persona sigue el timbre de su voz del sistema.

## Créditos gastados (2026-10-01)

| Qué | Piezas | Créditos |
| --- | --- | --- |
| Panoramas (1 Recraft + 2 GPT Image) | 3 | 10,0 |
| Prueba descartada de Soul Location | 1 | 0,12 |
| Texturas y arte (GPT Image 2.5) | 11 | 5,5 |
| Pruebas de voz (seed_audio, text2speech) | 2 | 0,45 |
| Voces de la gente (incluye reintentos que no pasaron la validación) | ~215 | ~31,9 |
| **Total** | | **47,9 de 1.000** (saldo final: 952,08) |
