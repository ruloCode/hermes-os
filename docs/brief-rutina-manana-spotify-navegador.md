# Brief: rutina de las 6:00, salto de anuncios, inicio con recomendaciones, Spotify y navegador

> Para el agente que lo implementa. Escrito el 2026-10-20 a las ~22:30 (Bogotá) por la sesión que construyó el control del cuarto. Todo lo que aquí dice "verificado" se midió esa noche en los equipos reales. Lo que no está verificado está marcado como tal.

## 0. Prioridad y plazo

1. **Rutina de mañana 21-oct a las 6:00** — tiene hora fija. Debe quedar probada ANTES de que el dueño se duerma.
2. **Saltar anuncios de YouTube** — la rutina lo necesita; después sirve para todo video que ponga Hermes.
3. **Recomendaciones de YouTube en el inicio del teléfono.**
4. **Control total de Spotify desde el teléfono** — requiere decisiones del dueño (sección 7).
5. **Control total del navegador de la TV desde el teléfono.**

Haz 1 y 2 primero y avísale al dueño cuando estén probadas; 3-5 pueden ir después.

## 1. Pedido del dueño (en sus palabras, resumido)

- Mañana despertarse a las **6:00**. A esa hora: **prender la TV**, poner en YouTube una **meditación matutina de 10 minutos** y **encender las luces suave** para despertar. **Apenas termine el video, poner música animada** para comenzar el día.
- YouTube a veces muestra publicidad: **aprender a saltarla en cuanto se pueda**.
- En el **inicio de la app del teléfono** ver los datos de los que ha hablado (ya están: ver 3.5) y **recomendaciones de contenido de YouTube**.
- **Control total de Spotify y del navegador** desde la app del teléfono.

## 2. Mapa del sistema

| Pieza | Dónde | Notas |
|---|---|---|
| Agente (cerebro) | `~/dev/side/hermes-os/apps/agent` (Hono + Claude Agent SDK), producción en `:8650` | Reiniciar: `launchctl kickstart -k gui/$UID/com.hermes-os.agent` |
| Control de la TV | `apps/agent/src/tv/` (`plan.ts` puro + tests, `adb.ts`, `remote.ts`, `index.ts`, `scenes.ts`, `schedule.ts`, `youtube.ts`) | Rutas `/tv/*` en `apps/agent/src/index.ts` |
| Mi día / agenda / tiempo | `apps/agent/src/day/`, `apps/agent/src/agenda/`, `apps/agent/src/wakatime.ts` | |
| Curaduría "Aprender IA" | `apps/agent/src/learn/ai.ts` + `~/.hermes-os/youtube/curaduria-ia.json` | 40 videos en inglés verificados con yt-dlp |
| App del teléfono | `~/dev/side/hermes-phone` (Kotlin + Compose) en un Samsung S25 | Ver su `CLAUDE.md`. Compilar/instalar: `SERIAL=RFGYB098QCN ./phone build` y `adb -s RFGYB098QCN install -r -g app/build/outputs/apk/debug/app-debug.apk` |
| Pantalla de inicio de la TV | `~/dev/side/hermes-tv/app` | `./gradlew assembleRelease` + `adb -s 192.168.0.24:5555 install -r …` |
| TV | Google TV TCL, Android 14, 1 GB RAM, `192.168.0.24:5555` por adb (autorizado "siempre") | Modo de energía **Alto**: sigue en la red dormida |
| Luces | Tira Kasa KL400L5 en `192.168.0.84` (`HERMES_LIGHTS_HOST` en `.env`) | Una sola zona (un color a la vez) |
| Voz del teléfono | Agente ElevenLabs "Hermes Phone"; herramientas en `apps/agent/scripts/setup-elevenlabs-agent.ts` (`PHONE_TOOLS`), ejecutadas en `hermes-phone/.../voice/VoiceController.kt` | Republicar: `pnpm setup:elevenlabs --phone` |

El `.env` vive en la raíz de hermes-os. Nunca escribas secretos en el código ni en este repo (es PÚBLICO). Java para compilar Android: `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`. adb: `/opt/homebrew/share/android-commandlinetools/platform-tools/adb`.

## 3. Lo que ya existe y funciona (verificado)

### 3.1 Escenas configurables (la base de la rutina)
- Archivo del dueño: `~/.hermes-os/escenas.json` (se relee en cada uso, no hay que reiniciar). Formato y validación en `tv/plan.ts` → `parseScenes` (una escena con un paso inválido se descarta entera).
- Pasos que ya existen: `lights` (action/value como `/lights/command`), `tv-power` (on/off), `tv-open` (app + `url` opcional + `fresh`), `tv-key` (tecla), `wait` (≤30 s), `lights-ramp` (`from`/`to`/`minutes` ≤60, minuto a minuto), `tv-sleep` (minutos).
- Horario: campo `cron` (5 campos, zona del dueño, `America/Bogota`) o `before_alarm_min` (N min antes de la próxima alarma del teléfono). Job `room-scenes` cada minuto (`tv/schedule.ts`); **lo que tocaba con el agente caído NO se recupera** (a propósito).
- Escenas actuales: `cine` (Prime), `noches`, `amanecer` (15 min antes de la alarma, luz 1→60 %), `cierre` (18:00), `descanso` (22:30).
- Cada escena que arranca sube `sceneGen`: una rampa de otra escena se detiene sola.

### 3.2 YouTube en la TV
- Buscar: `tv/youtube.ts` → `searchYouTube(query)` con yt-dlp (`/opt/homebrew/bin/yt-dlp`), `pickVideo` descarta Shorts (<90 s).
- Abrir: `playYouTube(id, title)` en `tv/index.ts` = prende la TV + `am start -a VIEW -d https://www.youtube.com/watch?v=<id> com.google.android.youtube.tv` + recuerda el último video (para la miniatura).
- Qué suena: `GET /tv/now` → `parseNowPlaying` sobre `dumpsys media_session`. YouTube da **título y canal** (`description=Título, Canal, null`), estado `PLAYING`/`PAUSED` y posición (se suma lo transcurrido con `/proc/uptime`).
- **Anuncios (verificado):** al abrir un video salió un anuncio de pre-roll con "Saltar en 9". Pasada la cuenta, **una sola pulsación de OK (`KEYCODE_DPAD_CENTER`) lo saltó**: el foco cae por defecto en "Saltar". NO verificado: qué reporta `media_session` durante el anuncio (¿título del anuncio, vacío, otro paquete?) — **mídelo antes de diseñar la detección**.

### 3.3 Encender / apagar la TV
- `tvPower` en `tv/index.ts`: por **adb primero** (`KEYCODE_WAKEUP`/`KEYCODE_SLEEP`, que NO alternan). Probado a 40 s y 80 s de reposo. La prueba de 5 min no fue concluyente (alguien prendió la TV a mano en medio).
- Por Bluetooth (ESP32) **NO se puede despertar**: en reposo la TV corta el BLE. La placa además está **desconectada** ahora. No dependas de ella.
- **Nunca mandes `power` (interruptor) a ciegas**: ya apagó la TV una vez cuando se creía apagada.

### 3.4 Luces
- `lights.ts`: `lightsCommand(action, value)` vía el binario `kasa` (ruta absoluta), ~0,5 s por orden. `lightsInfo()` da brillo/tono reales. `color_temp > 0` = modo blanco (el tono guardado se ignora).

### 3.5 App del teléfono (lo que el dueño ya ve)
- Inicio "centro de mando" (`ui/Home.kt`): reloj, sistemas (Mac/TV/Luces), **Redes hoy** (minutos en apps con `CATEGORY_SOCIAL`, medido en el teléfono), **Código** (WakaTime), **Escritorio/TV**, **Hábitos**, tarjeta "Hoy" (próximo evento, pendientes, lo que suena con miniatura), accesos 2×2, una conversación.
- Cuarto (`ui/Room.kt`): pestañas Control/Escenas/Luces, cruceta, volumen, "Aprender IA" con miniaturas (`ui/NetImage.kt` = cargador sin Coil).
- Agenda (`ui/Agenda.kt`): eventos + pendientes + agentes por día (`GET /agenda`).
- Voz: modo silencioso (responde por notificación) y micrófono silenciable (`VoiceController.setSilent` / `setMicMuted`).

## 4. Tarea 1 — Rutina de las 6:00 (mañana 21-oct)

### 4.1 Lo que tiene que pasar
| Hora (aprox.) | Qué |
|---|---|
| 06:00:00 | Luces: blanco cálido (2700K), rampa suave de 1 % → 60 % en ~10 min |
| 06:00 | TV se prende (adb `KEYCODE_WAKEUP`) |
| 06:00 + ~10 s | YouTube abre la meditación elegida |
| en cuanto se pueda | Saltar anuncios (Tarea 2) |
| fin del video (~06:10-06:12) | Poner música animada |

### 4.2 Diseño recomendado
1. **Elegir HOY la meditación** con yt-dlp: "meditación matutina guiada 10 minutos" en español, 8-14 min, no Short, canal creíble (con vistas y publicaciones regulares). Guardar el `id` en la escena (no buscar a las 6:00: si yt-dlp falla, la rutina se cae). Escoger también la **música** (una mezcla/lista larga, p. ej. "música animada para empezar el día", ≥30 min) y guardar su `id`. Muéstrale al dueño ambos títulos y canales antes de dejarlos fijos.
2. **Pasos nuevos** en `tv/plan.ts` (con validación y tests, como los demás):
   - `tv-youtube` `{ id, title }` → `playYouTube` + arranca el saltador de anuncios (Tarea 2).
   - `wait-video-end` `{ max_ms }` → sondea `/tv/now`-equivalente cada ~5 s hasta que el video que se puso **termine** (deja de estar en `media_session` con ese título, o pasa a otro título que no sea anuncio, o llega a su duración) o se cumpla `max_ms` (p. ej. 20 min). Ojo con `WAIT_MAX_MS = 30 000` y `STEPS_MAX`: este paso es distinto de `wait`.
   - Detecta el **final** con datos, no con un temporizador fijo: la duración real está en yt-dlp (`%(duration)s`) y la posición en `media_session`.
3. **La escena**, de una sola vez, en `~/.hermes-os/escenas.json`:
   ```json
   {
     "id": "despertar",
     "name": "Despertar",
     "cron": "0 6 21 10 *",
     "steps": [
       { "kind": "lights", "action": "temperature", "value": "2700" },
       { "kind": "tv-power", "action": "on" },
       { "kind": "tv-youtube", "id": "<id meditación>", "title": "<título exacto>" },
       { "kind": "lights-ramp", "from": 1, "to": 60, "minutes": 10 },
       { "kind": "wait-video-end", "max_ms": 1200000 },
       { "kind": "tv-youtube", "id": "<id música>", "title": "<título exacto>" }
     ]
   }
   ```
   Cuidado: la rampa dura 10 min y los pasos van en orden. Si la rampa va antes de `wait-video-end`, ese espera DESPUÉS de la rampa: está bien si la meditación dura ≥10 min; si no, corre la rampa en paralelo (hazlo explícito en el diseño, no por accidente). `cron` con día y mes fijos = solo mañana; después de probar, el dueño decide si la deja diaria (`0 6 * * *`).
4. **Choque con "Amanecer"**: la alarma del teléfono está hoy a las **5:30** (`GET /day/alarm` → `2026-10-21T10:30:00Z`), así que `amanecer` correrá a las **5:15**. Pregúntale al dueño: ¿mueve su alarma a las 6:00 o desactivas `amanecer` para mañana? **No le cambies la alarma tú.**
5. **Prueba de verdad esta noche** (con permiso del dueño, porque prende la TV y las luces): corre la escena con un `cron` a 2-3 min vista, o con `POST /tv/scene {"scene":"despertar"}`, y verifica:
   - `GET /tv/now` muestra la meditación `PLAYING`;
   - los anuncios se saltan (log);
   - al terminar (o simulando con un video corto de prueba) entra la música;
   - `GET /lights/info` sube de brillo.
   Después apágalo todo (`/lights/command off`, `/tv/command power_off`).
6. **A las 6:00** el job `room-scenes` la dispara. Deja un registro legible (`console.log("[tv] …")` + `emit({ kind: "tv", … })`) para revisar a las 6:15 qué pasó.

### 4.3 Criterios de aceptación
- 06:00-06:01: TV prendida, meditación en `PLAYING` (`/tv/now`), luces encendidas en cálido.
- Todo anuncio saltable, saltado ≤2 s después de que se pueda (log por anuncio).
- Al terminar la meditación (±30 s), la música suena.
- 06:10: luces en ~60 %.
- Si algo falla, el log dice qué paso falló y por qué (nada de "listo" inventado).

## 5. Tarea 2 — Saltar anuncios de YouTube

- Primero **mide**: pon un video que tenga pre-roll y registra cada segundo `dumpsys media_session` (paquete, `description`, estado, posición) y una captura (`adb exec-out screencap -p`; YouTube NO tiene DRM, se puede capturar). Así sabrás cómo se distingue un anuncio del video pedido.
- Diseño sugerido: un vigilante (`tv/ads.ts`) que arranca con `playYouTube` y corre mientras YouTube esté al frente y el video sea el que Hermes puso (hasta 2-3 min después del final o hasta que se pause/cambie de app). Si detecta anuncio → espera a que el botón "Saltar" esté disponible (verificado: aparece tras ~5 s; o detéctalo en la captura) → `KEYCODE_DPAD_CENTER`. Si el anuncio no se puede saltar, no hagas nada.
- **No mandes OK a ciegas en bucle**: con el video normal, OK pausa/abre controles. Solo con anuncio detectado.
- También para anuncios a mitad del video (mid-roll).
- Lógica de decisión pura en `tv/plan.ts` con tests (estilo del repo: contratos, nunca snapshots).

## 6. Tarea 3 — Inicio del teléfono: datos + recomendaciones de YouTube

- Los datos ya están (3.5). **Pendiente sin resolver**: el dueño pidió también "el tiempo no seduzco mix del día"; no se entendió. **Pregúntale** qué app o métrica es antes de inventar algo.
- Recomendaciones: sección "Para ti en YouTube" en `ui/Home.kt`, con miniatura (`NetImage`), título, canal, duración; tocar = ponerlo en la TV.
  - Fuente 1 (ya existe): `GET /learn/ai` → los siguientes sin ver del plan de IA (en inglés).
  - Fuente 2 (nueva, opcional): búsquedas con yt-dlp sobre sus intereses reales (agentes de IA, inglés, composición musical, meditación), cacheadas en el agente (p. ej. 1 vez al día, `~/.hermes-os/youtube/recomendados.json`) para no llamar a yt-dlp en cada apertura. Cada recomendación con su **por qué** en una línea.
  - Regla de la casa: todo dato visible es real; sin recomendaciones, la sección no se pinta.

## 7. Tarea 4 — Control total de Spotify desde el teléfono

Hoy no hay NINGUNA integración con Spotify (no hay variables `SPOTIFY_*` en `.env`). Spotify está instalado en el teléfono (`com.spotify.music`) y en la TV (`com.spotify.tv.android` 1.134.2).

Opciones (decide con el dueño):
- **A. Spotify Web API (recomendada)**: OAuth con PKCE, el dueño crea una app en developer.spotify.com (acción suya) y autoriza su cuenta. Permite ver qué suena (con portada), play/pausa/siguiente/anterior, volumen, aleatorio, buscar y poner listas, cola, y **elegir el dispositivo** (la TV aparece como dispositivo Spotify Connect). **Exige Spotify Premium** para controlar la reproducción. Token y refresh SOLO en el `.env`/disco del agente, nunca en el APK.
- **B. Sin API**: abrir `spotify:` URIs en la app de la TV por adb + teclas multimedia. Sin "qué suena" fiable ni búsqueda real. Solo como respaldo.

Preguntas para el dueño: ¿tiene Premium?, ¿qué cuenta?, ¿acepta crear la app de desarrollador? UI sugerida: sección "Música" en Cuarto (portada, controles, dispositivos, búsqueda, sus listas) + herramientas de voz/chat (`spotify` play/pause/next/search…) siguiendo el patrón de `control_tv` (SDK en `agent/tools.ts`, voz en `setup-elevenlabs-agent.ts` + `VoiceController.kt`, republicar).

## 8. Tarea 5 — Control total del navegador de la TV desde el teléfono

- En la TV está **TV Bro** (`com.phlox.tvwebbrowser` 2.1.6), instalado y probado: abre páginas por `am start -a VIEW -d <url> com.phlox.tvwebbrowser`. Usa un **cursor tipo mouse** que mueven las flechas; la página baja al llevar el cursor al borde. (Firefox/Opera: el Play Store de la TV dice "no compatible".)
- **Confirma con el dueño** que "el navegador" es el de la TV (y no el Chrome de la Mac, que ya se controla con `browse_web`).
- Sugerido en Cuarto: barra de dirección/búsqueda (abre en TV Bro), atrás/adelante/recargar, y un **touchpad** en el teléfono que mueva el cursor (arrastrar = flechas; tocar = OK; dos dedos = desplazar). Escribir en campos de la página: teclado Bluetooth (ESP32, desconectada) o `adb shell input text` (escapa espacios y caracteres especiales). Mide la latencia de adb por tecla antes de prometer un touchpad fluido.

## 9. Trampas conocidas (no las repitas)

- **Reinstalar la app del teléfono corta una llamada de voz.** Antes de instalar: `adb -s RFGYB098QCN shell dumpsys audio | grep -E "rec (start|update|stop).*os.hermes.phone" | tail -2`. Si el último es `start` sin `stop`, espera.
- **El teléfono bloqueado no se puede capturar ni tocar.** Pide al dueño que lo desbloquee; no intentes desbloquearlo.
- **Otra sesión de Claude puede estar editando hermes-os al mismo tiempo** (ya pasó: un export duplicado `lastDays` habría tumbado producción). Antes de cada `kickstart`, `pnpm typecheck` **y** carga real de módulos: `cd apps/agent && npx tsx -e 'Promise.all([import("./src/agent/tools.ts"),import("./src/usage.ts")]).then(()=>console.log("ok"))'`.
- En `ui/Components.kt` de la app, `Pill` es el botón principal **a todo el ancho**: en una fila tapa a los demás (pasó con "Apagar"). Para chips usa `SmallButton` o un segmentado.
- En Kotlin, `/*` dentro de un comentario abre un comentario anidado (rompió el build con `/lights/*`).
- La IP de la tira y de la TV cambian por DHCP (la tira pasó de `.86` a `.84`). Si algo deja de responder, busca primero la IP (`kasa discover`, mDNS `_androidtvremote2._tcp`).
- adb a veces pide permiso de nuevo en la TV tras desconectar: el dueño tiene que aceptar "Permitir siempre".
- Prime Video ignora los enlaces profundos; YouTube y TV Bro sí los aceptan.

## 10. Reglas de trabajo

- Español en UI y comentarios; código en inglés. Lógica pura con tests (`pnpm test`, runner nativo de Node; contratos, no snapshots). `pnpm typecheck` y `pnpm test` antes de dar algo por hecho.
- **Todo dato visible es real**: sin fuente, el elemento no se muestra.
- Nada personal en el código (el repo es público): títulos, ids e IPs del dueño van en `~/.hermes-os/*.json` o `.env`.
- Acciones con efectos en el cuarto (prender TV/luces de madrugada, probar la rutina) → pide permiso al dueño primero. **No hagas commits sin que él lo pida.**
- Verifica con capturas reales (TV: `adb -s 192.168.0.24:5555 exec-out screencap -p`; teléfono: `adb -s RFGYB098QCN exec-out screencap -p`) y cuenta lo que viste, no lo que esperabas.
- Al terminar, actualiza el `CLAUDE.md` de hermes-os (sección "TV del cuarto") y el de hermes-phone si tocaste la app.

## 11. Preguntas abiertas para el dueño (hazlas al empezar)

1. ¿Mueves tu alarma a las 6:00, o desactivo "Amanecer" (5:15) para mañana?
2. ¿Te gustan la meditación y la música que elegí? (muéstrale título + canal + duración)
3. ¿La rutina queda solo para mañana o todos los días?
4. ¿Qué es "el tiempo no seduzco mix del día" para el inicio?
5. Spotify: ¿tienes Premium y aceptas crear la app de desarrollador?
6. Navegador: ¿el de la TV (TV Bro) o el Chrome de la Mac?
