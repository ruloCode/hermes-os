# Misión: Oficina de agentes v8 — calidad visual "muy top", gente viva con voz propia y cero espacios negros

Trabajas en el monorepo `hermes-os`, en la rama **`oficina/calidad-visual`**, dentro del worktree **`/Users/rulocode/dev/side/hermes-os-visual`**. No trabajes en `/Users/rulocode/dev/side/hermes-os`: ahí está `main` y desde ahí corre producción (`:31415` y `:8650`).

Antes de diseñar nada, lee completos:
- `CLAUDE.md`, la entrada "Oficina de agentes 3D" con todos sus "ojo" (v1 a v7 e Interacciones).
- `docs/oficina-de-agentes.md` entero.
- Las capturas de cómo se ve hoy en `docs/img/oficina-v8/antes-*.png`.

Verifica en el código todo lo que este prompt da por hecho (rutas, nombres, campos) antes de usarlo. Si algo no existe o se llama distinto, dilo y adapta.

## Objetivo

Que la Oficina (`/oficina`) se vea y se sienta como un juego de alta calidad para presentarla:
1. **Cero espacios negros.** El mundo de afuera tiene cielo, ciudad y suelo que siguen la hora real, en los dos temas.
2. **Materiales, texturas, luz y detalle de alta calidad**, sin perder el estilo toon ni el rendimiento.
3. **Gente viva:** cada persona tiene **su propia voz**, que no se repite. Las personas que caminan **interactúan entre sí** y reaccionan a lo que pasa en la oficina.

Hay **1.000 créditos de Higgsfield** (plan Plus) para generar assets. Úsalos con cabeza (ver presupuesto abajo).

## Diagnóstico ya hecho (verifícalo)

**De dónde sale el negro.** En `apps/web/src/lib/oficina/office-world.ts`, `scene.background` y `scene.fog` usan `palette.bg`, que es el color de fondo de la **interfaz**: casi negro en el tema oscuro. Afuera del edificio solo hay un plano `outside` de 400 × 400 con `toon(palette.floor)`. La hora real (`daylightAt` en `room.ts`) solo pinta los canvas de las ventanas y la intensidad del sol. Por eso en la azotea, a mediodía y con el HUD diciendo "día", el cielo es negro (`antes-azotea-*.png`). Tampoco hay ciudad, calle ni horizonte.

**Interior.** Las texturas son canvas procedurales de 512 px (ladrillo, concreto, deck, tiza) sobre `MeshToonMaterial` con rampa de 3 pasos y `OutlineEffect`, que dibuja todo dos veces. Los muebles son primitivas; los cuadros y afiches, canvas.

**Gente** (`lib/oficina/npc.ts`, `person.ts`, `shared/office-ambient.ts`):
- Personas chibi procedurales con poses (`sit`, `cup`, `sitcup`, `dance`, `eat`…). Hay 9 de ambiente más 4 con rol.
- Caminan con la rejilla `NavGrid`. Entre ellas **no interactúan**: solo esquivan al dueño.
- Al saludarlas (`crowd.greet`) sale un globo con una frase de datos reales (`chatter` en `app/oficina/page.tsx`), pero **sin voz**. El único TTS es `speak()` (`lib/oficina/speech.ts`, `speechSynthesis`), con una sola voz para todo.

**Voces disponibles** (medido el 2026-10-01):
- **Sistema (gratis, sin red, texto dinámico):** macOS trae 10 voces en español, cada una en es_ES y es_MX: Eddy, Flo, Grandma, Grandpa, Mónica, Paulina, Reed, Rocko, Sandy y Shelley (`say -v '?'`). Verifica cuáles expone Chrome en `speechSynthesis.getVoices()` y con qué nombre. Con pitch y rate distintos alcanzan para que nadie se repita.
- **Higgsfield:**
  - `text2speech_v2`, con motores `elevenlabs`, `minimax`, `seed_speech`, `vibe_voice` y `cozy_voice`, y más de 49 voces predefinidas (`list_voices`, paginado).
  - `seed_audio`, con pitch y rate.
  - `elevenlabs_v4`: diálogo con hasta 10 voces, sirve para una charla entre dos personas en un solo clip.
  - `inworld_text_to_speech` con voces es (Diego, Lupita, Miguel, Rafael), marcado "Game pipeline only".
  - El agente ya tiene llaves REST de Higgsfield (`HIGGSFIELD_API_KEY_ID`/`_SECRET`, base `https://api.higgsfield.ai`; ver `apps/agent/src/avatar.ts`). **No está verificado** que la API REST exponga TTS. Compruébalo antes de diseñar sobre eso.
- **ElevenLabs directo: NO usar.** Quedan unos 7.400 caracteres del mes y hay una factura abierta de US$5 sin método de pago.

**Higgsfield para assets visuales:**
- `soul_location`: ambientes y fondos, en 21:9 y 16:9.
- `recraft_v4_1`: ilustración y vector, con paleta de colores.
- `z_image`: rápido y estilizado.
- Imagen a 3D (GLB): `meshy_v7_image_to_3d` (lowpoly, texturas, **rigging y animación**), `tripo_h3_1_image_to_3d` y `hunyuan3d_v3_image_to_3d`. three.js los carga con `GLTFLoader` de `three/addons`, sin dependencias nuevas.

## Reglas que NO se negocian (las de siempre)

1. **Todo dato visible o hablado es real.** Lo que dice la gente sobre la oficina (agentes, permisos, uso de Claude, gasto, cafés del día, hora, clima) sale de una fuente real. Si no existe, no se dice. La charla entre personas puede ser trivial (saludos, el café, el clima real), pero **nunca un número inventado**.
2. **Agentes ≠ decorado.** Los agentes son los frijoles con audífonos y antena. Nada nuevo puede parecer un agente ni contar en el HUD, el equipo, la pizarra ni Recepción.
3. **Diseños propios.** Ni personajes, ni logos, ni marcas, ni música con derechos. Lo generado con Higgsfield se pide con prompts propios y sin estilos de marcas o franquicias.
4. **Sin dependencias nuevas.** three.js, WebAudio y `GLTFLoader` de `three/addons` alcanzan.
5. **No romper lo que existe.** Estos cinco QA deben pasar completos, en los dos temas, contra dev y contra producción:
   - `apps/web/scripts/oficina-qa.py`
   - `apps/web/scripts/oficina-pad-qa.py`
   - `apps/web/scripts/oficina-npc-qa.py`
   - `apps/web/scripts/oficina-features-qa.py`
   - `apps/web/scripts/oficina-extras-qa.py`

   Ojo con la prioridad de "E": escritorio de pod > NPC con rol > tableros y juegos > objetos, la gata y la gente.
6. **Rendimiento: ≥ 55 fps** en los dos temas, medido con el QA. Agrega a `__hermesOficinaDebug()` las draw calls, los triángulos y la memoria de texturas (`renderer.info`), y no te pases de un presupuesto que fijes y documentes. Usa `InstancedMesh`, `mergeByMaterial`, texturas potencia de 2 con mipmaps y atlas donde se pueda. Lo que no se ve (otros pisos, fuera de cámara) no cuesta.
7. **Interruptores:** cada capa grande nueva va en "Capas" (`hermes-oficina-capas`). Apagada, la oficina se ve como hoy. Las voces de la gente se apagan junto con el sonido o con su propio interruptor; nunca hablan sin un gesto previo del usuario (autoplay) y nunca encima de una llamada con Hermes o el equipo (que bajen igual que el ambiente).
8. **Los dos temas.** El mundo de afuera sigue la **hora real**, no el tema: el tema oscuro es de la interfaz, no de la noche. Propón cómo se ve el exterior en cada tema y justifícalo.
9. **No gastar tokens ni créditos a ciegas.**
   - QA con `__hermesOficinaSim("demo", n)` y los seams.
   - Antes de cada lote en Higgsfield, genera **una** pieza, mide su costo real (`balance` antes y después, o `transactions`) y su calidad, y recién ahí lanza el lote.
   - **Pregúntame antes de pasar de 300 créditos en total.** Reporta el gasto al final.

## Lo que hay que construir (por prioridad; si se acaba el tiempo, para en orden y avisa)

### A. Mundo exterior y cielo: adiós al negro (P0)
- Cielo que siga `daylightAt`: un domo con gradiente (shader simple o canvas) más el panorama generado.
- **Panorama de ciudad**, propio y con sabor de cerros andinos (Bogotá, sin edificios reconocibles), para día, atardecer y noche. Se genera con `soul_location` en 21:9 y se monta como **cilindro de fondo** alrededor del edificio (no es un equirect 2:1; resuelve la costura con espejado o con prompts que empalmen). El cambio entre día, atardecer y noche se funde según la hora.
- Suelo exterior: calle y andenes alrededor, árboles y postes instanciados, algunos edificios vecinos low-poly en el plano medio y luces de la ciudad de noche.
- Niebla con el color del horizonte, no con `palette.bg`. Arregla también cualquier hueco negro adentro: el canto de las losas, el hueco de la escalera y lo que se ve por las ventanas.

### B. Materiales, texturas y detalle de alta calidad (P0)
- Texturas generadas, **sin costura** y en potencia de 2 (1024 px, comprimidas), para ladrillo, concreto pulido, deck de la azotea, madera, telas de tapetes y sofás y la pizarra de tiza. Siguen en `MeshToonMaterial` (el estilo se queda), con `anisotropy` y mipmaps.
- Arte propio para los cuadros, afiches y vistas de las ventanas (las del piso 1 hoy son canvas).
- Iluminación por hora: hemisférica más el sol tibio y largo al atardecer. De noche, ventanas y lámparas emisivas y sombras de contacto baratas (blob o gradiente) bajo muebles y personas. Si propones post-proceso, mídelo contra el `OutlineEffect` y el presupuesto de fps. Recuerda: `NoToneMapping` a propósito.
- Opcional, solo si el presupuesto lo permite y luego de un prototipo medido: 1 o 2 props "héroe" en GLB (por ejemplo la cafetera) con Meshy en modo lowpoly.

### C. Gente viva (P0)
**Voz propia que no se repite:**
- Lógica pura y probada en `packages/shared` (`assignVoices`): asigna una voz única y pegajosa a cada persona de ambiente; las de rol tienen voz fija; nunca hay dos iguales vivas a la vez.
- Motor por niveles:
  1. **Voces del sistema** (las 10 personas × es_ES/es_MX, más pitch y rate por persona) para todo el texto dinámico. Siempre funciona.
  2. **Voces premium de Higgsfield**, si verificas que la API REST tiene TTS: una ruta del agente (`POST /office/tts {voice, text}`) con caché en disco por hash, y respaldo al nivel 1. Si no hay REST, pre-genera por MCP (`generate_audio`) solo frases fijas sin datos (saludos, reacciones al café, a la gata, a un baile) por voz, como assets. El dato real va con el nivel 1 de esa misma persona.
- Al saludar se escucha con la voz de esa persona, sincronizada con su globo y su boca o cuerpo (late con el volumen). Una sola voz a la vez y nunca encima de Hermes o del equipo.

**Interactúan entre sí:**
- **Charlas:** dos (o tres) personas que se cruzan o coinciden en el café se detienen, se miran, gesticulan (pose nueva `talk`) y se turnan globos con voz baja posicional. Si estás cerca, escuchas la charla.
- Saludos al cruzarse, sentarse juntos, ping-pong que ya existe, ronda de café.
- Reacciones a eventos reales:
  - aplauden o miran cuando un agente termina (el confeti);
  - Recepción avisa cuando alguien te necesita;
  - se apartan y te miran si bailas.
- La coreografía sigue en `office-ambient.ts`, pura y sembrada, con tests. Respeta las 33 POIs (ninguna en `pois.dropped`), las escaleras y que nadie entre a los pods ni a la oficina de CEO.

**Calidad de los personajes:** mejora rostros, ropa y variedad del chibi procedural. Una versión GLB (Meshy con rig y animación) solo como experimento detrás de un interruptor y con números de fps. Las poses actuales (sentarse, taza, juegos) no se pueden perder.

### D. Pulido de presentación (P1)
- Cámara de presentación (un "modo demo" que recorra los tres pisos solo, con un seam).
- Transiciones suaves de día y noche.
- Partículas sutiles: vapor, polvo en la luz, hojas en la azotea.
- Detalles de interiores que hoy se ven planos.

## Cómo trabajar

- Worktree: `cd /Users/rulocode/dev/side/hermes-os-visual && pnpm install`. El `.env` vive en la raíz del repo principal: enlázalo o cópialo (`ln -s ../hermes-os/.env .env`) y **no lo commitees**.
- Dev web: `cd apps/web && pnpm exec next dev -p 31998` (usa su propio `.next-dev/`). El dashboard habla con el agente de producción en `:8650` (`NEXT_PUBLIC_HERMES_URL`).
- Si cambias rutas del agente, corre **otro** agente desde el worktree en otro puerto (`HERMES_PORT=8651 pnpm --filter @hermes/agent dev`) y apunta el dev web a él (`NEXT_PUBLIC_HERMES_URL=http://localhost:8651`). No reinicies el agente de producción.
- Playwright: `~/.cache/hermes-pw-venv/bin/python`. Nunca esperes `networkidle` (hay SSE abiertos). Headless no tiene GPU real: usa los seams. Los QA aceptan `--url`; el de extras también `--agent`.
- Los assets generados van en `apps/web/public/oficina/` con nombres claros y un `README.md` que diga modelo, prompt, fecha y créditos de cada uno. El repo es **público**: solo arte propio.
- `pnpm typecheck` y `pnpm test` en verde antes de cada commit. Commits en español, `feat` y `docs` separados, con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. **Sin push** y sin merge a `main`: eso lo decido yo.
- Si algo pone en riesgo la demo (fps, los QA, el "near" de los pods, las escaleras), apágalo por defecto y avísame.

## Antes de escribir código, dame en pocas líneas

1. Cómo matas el negro (cielo, cilindro de ciudad, suelo, niebla) y cómo se ve en cada tema.
2. Qué vas a generar en Higgsfield, cuántas piezas y el costo medido de la primera.
3. Si la API REST de Higgsfield tiene TTS (sí o no, con evidencia) y el diseño de voces que eliges.
4. Cómo van a interactuar las personas entre sí (estados nuevos del planificador).
5. Tu presupuesto de rendimiento (draw calls, triángulos, MB de texturas) y el orden de trabajo.

Luego ejecuta sin esperar confirmación, salvo el tope de 300 créditos o algo que choque con las reglas.

## Entregables

- Exterior con cielo, ciudad y suelo por hora; texturas y arte nuevos; gente con voces únicas que conversa y reacciona.
- Lógica pura con tests: `assignVoices`, las charlas del planificador y el cruce de día y noche.
- Seams nuevos en `__hermesOficinaDebug()`: render (draw calls, triángulos, texturas), voces asignadas, charlas activas y panorama vigente. Más una forma de forzar la hora (`__hermesOficinaHour(h)`) para capturar día, atardecer y noche.
- QA nuevo `apps/web/scripts/oficina-visual-qa.py`, en los dos temas:
  - sin píxeles casi negros en el cielo y el borde de la escena, a cualquier hora;
  - que cada persona tenga una voz distinta;
  - que haya al menos una charla entre personas en N segundos;
  - fps ≥ 55 y sin errores de consola.
  - Más los cinco QA existentes en verde.
- Capturas de "después" (día, atardecer y noche; los tres pisos; los dos temas) en `docs/img/oficina-v8/`, junto a las de "antes".
- Documentación: una sección nueva en `docs/oficina-de-agentes.md` (assets y su procedencia, voces, charlas, presupuesto) y una línea en `CLAUDE.md` con los "ojo" que encuentres.

## Al terminar, dime en pocas líneas

- qué cambió en lo visual (con las capturas antes y después);
- cómo suenan y se reparten las voces, y con qué motor;
- cómo interactúa la gente;
- cuántos créditos de Higgsfield se gastaron y en qué;
- qué quedó pendiente y por qué.
