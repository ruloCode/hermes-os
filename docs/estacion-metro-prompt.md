# Prompt de arranque · Tótem de estación del Metro

Pégalo tal cual en un Claude Code abierto en `~/dev/side/hermes-os`, en una sesión nueva.

````text
Vamos a construir el "Tótem de estación" del Metro de Medellín sobre la Sala de Agentes 3D que ya existe en hermes-os. Objetivo de esta sesión: dejar funcionando, con datos REALES, el flujo completo del demo del Build Day: un viajero frente a una pantalla vertical le pregunta a dos agentes (Hermes = la ruta y el sistema · Iván = la ciudad) cómo llegar a un lugar o qué hacer cerca, y la pantalla muestra la ruta del Metro con sus líneas, tiempos y transbordos, más la opción de seguir la conversación en el celular.

## Lo que YA existe (no lo reescribas, léelo primero)
- CLAUDE.md del repo, bullet "Sala de Agentes 3D" (lee TODO el bullet: convenciones, lecciones de ElevenLabs, seams de QA).
- docs/sala-de-agentes-3d.md (plan original), docs/estacion-metro.md (producto, mercado, propuesta de diseño Medellín, diferenciales) y el informe visual https://claude.ai/artifact/EiCZLkBRHmtZzrYLVnTeux. Las decisiones de ahí NO se reabren.
- /sala (apps/web/src/app/sala/page.tsx): página suelta fuera del shell. Modo ELENCO: UNA sesión de ElevenLabs con un agente multi-voz que interpreta a Hermes e Iván (lib/sala/cast.ts, CastCall; client tools planas en lib/sala/client-tools.ts). Se conecta sola cuando la cámara ve a alguien; QA sin micrófono con window.__hermesSalaSay(texto) y window.__hermesSalaDebug().
- Config en ~/.hermes-os/sala.json (contrato en packages/shared/src/sala.ts): agents (hermes-sala, paisa activos; el resto enabled:false), topic, cast {members, default, agent_id}. Los agentes ya existen en ElevenLabs; pnpm setup:elevenlabs --sala los re-parchea (setupCast en apps/agent/scripts/setup-elevenlabs-agent.ts). Token por clave: /api/elevenlabs/token?agent=cast.
- Agente Hono en :8650 (launchd com.hermes-os.agent; reiniciar con launchctl kickstart -k gui/$UID/com.hermes-os.agent tras tocar apps/agent). Dev web en :31999 (NEXT_PUBLIC_WEB_PORT=31999 pnpm --filter @hermes/web dev). Rutas /sala/* en apps/agent/src/index.ts y apps/agent/src/sala/store.ts.
- Tests: node --test en apps/agent (pnpm test); la lógica pura vive en packages/shared y se prueba desde apps/agent/src/sala/*.test.ts.
- OJO git: el árbol trae 160+ archivos modificados AJENOS sin commitear. Commitea SOLO tus archivos; para archivos ya modificados (index.ts, env.ts, CLAUDE.md, pnpm-lock.yaml) arma el blob HEAD + tus hunks con git hash-object/update-index (así se hicieron los commits de la sala). Nunca git add -A.

## Reglas
1. Todo dato visible es real o no se muestra. Nada de rutas, tiempos o lugares inventados en código: salen del GTFS del Metro o de archivos de configuración en ~/.hermes-os que el humano edita.
2. Ningún nombre propio ni dato de la ciudad en el código: estación por defecto, lugares recomendados y textos de la ciudad van en sala.json / archivos de ~/.hermes-os. El mismo repo debe servir para otra ciudad con otra config.
3. Un commit por fase, mensaje feat(estacion): …, con pnpm typecheck y pnpm test en verde antes de cada uno. No tocar el shell del dashboard ni /sala en modo elenco (debe seguir funcionando igual).
4. El agente de ElevenLabs solo se PARCHEA (ya existe); no crees agentes nuevos ni gastes cuota de voz sin necesidad. Los QA de conversación usan __hermesSalaSay (texto), máximo un puñado de turnos por prueba.
5. Si una fase se pasa 30 min de su estimado, para, resume qué se atascó y qué recorte propones. No sigas solo.
6. Al terminar cada fase, deja un párrafo de verificación con lo que probaste y cómo (comando o URL).

## Fases (en orden; cada una deja algo verificable)

### Fase 0 · GTFS del Metro (60 min) — packages/shared + apps/agent
- Localiza y descarga el GTFS del Metro de Medellín desde su portal de datos abiertos (ArcGIS Hub: https://datosabiertos-metrodemedellin.opendata.arcgis.com/). Guárdalo en ~/.hermes-os/gtfs/metro/ (zip descomprimido: stops.txt, routes.txt, trips.txt, stop_times.txt, frequencies.txt si existe). Documenta la URL exacta en docs/estacion-metro.md. Si el portal no da GTFS descargable, dilo y construye la red desde la capa oficial de líneas y estaciones del mismo portal (con tiempos por tramo tomados del stop_times o, si no hay, marcados como "estimado" en la UI). No inventes.
- Parser y planificador PUROS en packages/shared/src/gtfs.ts: cargar stops/routes/trips/stop_times a un grafo por línea (secuencia de estaciones por route), transbordos por estación compartida, y planRoute(origen, destino) → tramos [{line, color, from, to, stopsCount, minutes}] con la ruta de menos transbordos y luego menos tiempo (BFS/Dijkstra sobre estaciones; la línea y sus colores salen de routes.txt route_color). Resolver nombres de estación con normalización (tildes, "Estación", mayúsculas) y alias en config.
- Tests en apps/agent/src/sala/gtfs.test.ts con un GTFS sintético mínimo (3 líneas, 2 transbordos) + un test que cargue el real si existe y compruebe que Poblado→Arví pasa por Acevedo y usa las líneas A, K y L (colores A #0065B3, K lima, L marrón vienen del GTFS; si el GTFS trae otros, manda el GTFS).
- Listo cuando: pnpm test verde y un script tsx imprime la ruta Poblado→Arví con tramos y minutos reales.

### Fase 1 · Tools del agente (45 min) — apps/agent
- Rutas Hono: POST /metro/route {from, to} → planRoute; GET /metro/stations (lista con alias); GET /metro/status → lee ~/.hermes-os/metro-status.json (novedades por línea escritas por el humano: {line, text, delayMin, until}) porque no hay API pública de estado; si el archivo no existe, devuelve [] y la UI no muestra banner. GET /metro/places?station= → lee ~/.hermes-os/lugares.json (lugares por estación con nombre, minutos a pie, horario, nota); mismo criterio: sin archivo, sin tarjetas.
- Client tools del elenco (lib/sala/client-tools.ts): metro_route, metro_status, places_near, más las que ya hay. Cada tool devuelve texto para la voz Y emite un evento de UI (bus simple en el cliente) con el payload estructurado, para que la pantalla pinte la tarjeta sin depender del texto del modelo.
- Plantillas: docs/lugares.example.json y docs/metro-status.example.json; crea en ~/.hermes-os versiones reales para el demo con 3 estaciones (Poblado, Parque Berrío, Acevedo) y 3 lugares cada una, con horarios verificables (pon la fuente en un campo "source").
- Listo cuando: curl a las tres rutas devuelve datos reales; el reinicio del agente está hecho.

### Fase 2 · Prompt del elenco para la estación (30 min) — setup script + sala.json
- En sala.json agrega el bloque "station": {"id", "name", "line", "default_language":"es"} y úsalo como dynamic variable (station_name, station_line) del elenco. Añade al prompt del director las reglas: Hermes SIEMPRE llama metro_route antes de dar una ruta y dice línea, transbordos y minutos tal como vuelven; Iván da contexto de la ciudad y NUNCA inventa horarios (usa places_near); si hay novedad en metro_status, Hermes la menciona antes de la ruta; respuestas de 1-3 frases; nombrar a uno → responde ese; preguntar a los dos → uno y luego el otro; nunca hablar por el otro.
- Re-parchea con pnpm setup:elevenlabs --sala. Verifica por __hermesSalaSay que "¿Cómo llego a Parque Arví?" dispara metro_route (mira el log de tools en __hermesSalaDebug) y la respuesta cita la ruta real.

### Fase 3 · Modo tótem (90 min) — apps/web
- Ruta /estacion (página suelta, hermana de /sala) que reusa CastCall, SalaScene opcional (la escena 3D queda chica arriba o se reemplaza por los dos personajes estáticos: la marioneta NO va aquí) y aplica el sistema de diseño Medellín SOLO en esta página (tokens locales en el componente, no en globals.css): fondo verde montaña #1F4D3A con curvas de nivel sutiles (SVG generado), guayaba #C4553A para Iván y acción principal, azul Metro #0065B3 para Hermes, lima #B2D459 confirmación, naranja #F8821E alerta, mantequilla #F6E7C1 tarjetas; Baloo 2 (Google Fonts, con fallback) para titulares y frases de los agentes, Inter para datos. Prohibido: Botero, neón, cursivas, grafiti.
- Layout vertical 9:16 (probar a 1080×1920): barra superior con badge de línea (color del GTFS), nombre de estación, hora y "próximo tren" si frequencies/stop_times lo permiten (si no, no se muestra). Estados: reposo ("¿Para dónde vas?", los dos con su rol) · escuchando (transcripción en vivo) · ruta (tarjeta con tramos, colores oficiales, minutos, pasajes; quien habla se enciende) · qué hacer cerca (bloques tipo silleta con minutos a pie y horario) · novedad del servicio (banner naranja + opciones) · subtítulos en vivo SIEMPRE y aviso de privacidad SIEMPRE. Se conecta solo al detectar presencia (reusa usePose solo como detector de "hay alguien", sin dibujar el cuerpo) con un botón "Entrar" de respaldo.
- Idioma: chips Español/English/Português que mandan contextual update; Iván mantiene el acento.
- Listo cuando: en :31999/estacion, __hermesSalaSay("¿Cómo llego a Parque Arví?") pinta la tarjeta con los tramos reales del GTFS y la figura de quien habla pulsa; "Tengo una hora, ¿qué hago cerca?" pinta los bloques de lugares. Captura de pantalla con Playwright en 1080×1920 (venv ~/.cache/hermes-pw-venv; si faltan los browsers: playwright install chromium).

### Fase 4 · Sigue en tu celular (60 min) — agente + web
- POST /sala/handoff {summary, language, route} → token efímero (memoria del agente, 15 min) y GET /sala/handoff/:token. El tótem muestra un QR (generado en cliente, sin dependencias pesadas: un módulo QR pequeño propio o SVG) con la URL LAN/túnel de la web + /m/:token.
- Página /m/[token]: tema claro mantequilla, los mismos dos anfitriones (avatares robot, no humanos), la tarjeta de ruta recibida, y una nueva sesión con el elenco que arranca con sendContextualUpdate del resumen (idioma, ruta, estación de origen) para retomar la charla; barra "Mantén para hablar" y chips de idioma.
- Listo cuando: abrir el QR desde el celular en la LAN muestra la ruta y al hablar Iván recuerda a dónde ibas.

### Fase 5 · Ensayo del guion (30 min)
- Script Playwright (apps/web/scripts/estacion-qa.mjs o en el venv) que corre el guion de 90 s por texto: saludo → "¿Cómo llego a Parque Arví?" → "Iván, ¿dónde almuerzo antes de subir?" → "¿Qué hago cerca de Parque Berrío en una hora?" → Esc. Verifica: tools llamadas, tarjetas pintadas, 0 ms de solapamiento entre voces, sin textos entre corchetes. Correrlo tres veces seguidas en verde.
- Documenta en docs/estacion-metro.md: fuentes de datos, archivos de ~/.hermes-os, cómo correr el demo (comandos, puertos, micrófono de solapa), y lo que quedó pendiente.

Empieza por la fase 0. Antes de escribir código, muéstrame en cinco líneas qué encontraste en el portal de datos abiertos del Metro (URL del GTFS o de las capas) y sigue.
````
