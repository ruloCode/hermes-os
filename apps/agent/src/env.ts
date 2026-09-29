import { config } from "dotenv";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// El .env vive en la raíz del monorepo para compartirlo entre apps.
const root = resolve(fileURLToPath(import.meta.url), "../../../..");
config({ path: resolve(root, ".env") });

export const env = {
  PORT: Number(process.env.HERMES_PORT || 8642),
  VAULT_PATH: process.env.VAULT_PATH || "",
  CLAWD_PATH: process.env.CLAWD_PATH || "",
  MACHINE_NAME: process.env.MACHINE_NAME || "local",
  HERMES_API_KEY: process.env.HERMES_API_KEY || "",
  // Multi-máquina: dirección con la que OTROS PCs de la red alcanzan a este
  // agente. Sin ella se deriva de la IP LAN real (presence.ts) — se pone a
  // mano solo si hay un nombre/puerto de por medio (Tailscale, reverse proxy).
  PUBLIC_URL: (process.env.HERMES_PUBLIC_URL || "").replace(/\/$/, ""),
  // Raíz de los clones de código EN ESTA máquina. El vault guarda ruta_local
  // con las rutas de la Mac; en otro PC el mismo proyecto vive en otra parte,
  // así que los runs lo buscan aquí por nombre de carpeta antes de rendirse.
  CODE_ROOT: process.env.HERMES_CODE_ROOT || resolve(homedir(), "dev"),
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || "",
  // Agente de voz de ElevenLabs. Comparte el valor con el dashboard web
  // (NEXT_PUBLIC_…) para que la app móvil obtenga el token del mismo agente.
  ELEVENLABS_AGENT_ID: process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "",
  // Tutor de inglés (segundo agente; token vía GET /elevenlabs/token?agent=tutor).
  ELEVENLABS_TUTOR_AGENT_ID: process.env.NEXT_PUBLIC_ELEVENLABS_TUTOR_AGENT_ID || "",
  // Proveedor de STT preferido para reuniones: "whisper" | "scribe".
  // Default: scribe primero, Whisper de fallback. Ponlo en "whisper" si
  // ElevenLabs se queda sin créditos para no gastar la llamada fallida a Scribe.
  STT_PROVIDER: (process.env.HERMES_STT || "").toLowerCase(),
  // Junta EN VIVO: STT streaming con diarización (AssemblyAI Universal-Streaming).
  ASSEMBLYAI_API_KEY: process.env.ASSEMBLYAI_API_KEY || "",
  // Provider del STT en vivo: "assemblyai" | "fake" (guion de prueba, sin gastar).
  LIVE_STT_PROVIDER: (process.env.HERMES_LIVE_STT || "assemblyai").toLowerCase(),
  // Capa RÁPIDA del copiloto de juntas (sugerencias streaming tras una pregunta).
  // Corre con la suscripción de Claude Code (sesión persistente del Agent SDK),
  // no requiere API key. "" = activada | "fake" (respuesta enlatada, e2e sin
  // gastar) | "off" (solo queda el loop estratégico de 20-45 s).
  COPILOT_PROVIDER: (process.env.HERMES_COPILOT || "").toLowerCase(),
  COPILOT_MODEL: process.env.HERMES_COPILOT_MODEL || "claude-haiku-4-5",
  // Dashboard: calendario (URL iCal SECRETA de Google Calendar) y clima
  // (Open-Meteo sin API key; defaults: Medellín).
  GOOGLE_CALENDAR_ICS_URL: process.env.GOOGLE_CALENDAR_ICS_URL || "",
  // Google Calendar API (escritura por voz: crear/mover/borrar eventos). OAuth2
  // con refresh token; se obtiene una vez con `pnpm --filter @hermes/agent google:auth`.
  // Si falta cualquiera de los tres, la escritura se desactiva y la lectura cae
  // al feed ICS. GOOGLE_CALENDAR_ID: "primary" u otro id; TZ para eventos nuevos.
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
  GOOGLE_OAUTH_REFRESH_TOKEN: process.env.GOOGLE_OAUTH_REFRESH_TOKEN || "",
  GOOGLE_CALENDAR_ID: process.env.GOOGLE_CALENDAR_ID || "primary",
  GOOGLE_CALENDAR_TZ: process.env.GOOGLE_CALENDAR_TZ || "America/Bogota",
  // Puerto del loopback para el consentimiento OAuth una sola vez (debe
  // coincidir con el redirect URI autorizado en el cliente OAuth de Google).
  GOOGLE_OAUTH_PORT: Number(process.env.GOOGLE_OAUTH_PORT || 8788),
  WEATHER_LAT: Number(process.env.WEATHER_LAT || 4.711),
  WEATHER_LON: Number(process.env.WEATHER_LON || -74.0721),
  WEATHER_PLACE: process.env.WEATHER_PLACE || "Bogotá",
  // Control por gestos (mano → cursor vía webcam + robotjs). "off" desactiva
  // las rutas /input/gestures por completo; cualquier otro valor las deja.
  GESTURES_ENABLED: (process.env.HERMES_GESTURES || "").toLowerCase() !== "off",
  // Navegación profunda por voz (chrome-devtools-mcp sobre un Chrome CDP
  // dedicado). "off" no registra el MCP ni expone /browser/navigate.
  BROWSER_AGENT_ENABLED: (process.env.HERMES_BROWSER_AGENT || "").toLowerCase() !== "off",
  // Sala de agentes 3D (/sala): "off" apaga /sala/* y el token por clave.
  SALA_ENABLED: (process.env.HERMES_SALA || "").toLowerCase() !== "off",
  // Tótem de estación (/estacion): "off" apaga /metro/*. Los datos salen del
  // GTFS en ~/.hermes-os/gtfs/metro y de los JSON del humano (ver
  // docs/estacion-metro.md); sin feed las rutas responden el motivo.
  ESTACION_ENABLED: (process.env.HERMES_ESTACION || "").toLowerCase() !== "off",
  // Linear (manejo de tareas). Personal API key (Settings → API en Linear).
  // Sin key, las tools de Linear responden con el CTA de configuración.
  LINEAR_API_KEY: process.env.LINEAR_API_KEY || "",
  // Team por defecto para issues nuevos (key tipo "RUL"). Sin él, el primer team.
  LINEAR_TEAM_KEY: process.env.LINEAR_TEAM_KEY || "",
  // Edición automática de piezas del Estudio: repo local de OpenMontage
  // (agent-first — su CLAUDE.md/AGENT_GUIDE dirigen el pipeline). Si la ruta
  // no existe, el botón de la UI lo dice y las rutas responden 503.
  VIDEO_EDIT_PATH: process.env.VIDEO_EDIT_PATH || resolve(homedir(), "dev/video-edit"),
  // Carpeta madre del material del Estudio (p.ej. un disco extraíble): cada
  // pieza vive en <root>/<slug>/{crudos,assets,exports}. Vacío = sin disco
  // configurado; si no está montado, la UI lo dice y el checklist queda en
  // modo solo-nombres (fallback local en ~/Movies/estudio).
  ESTUDIO_MEDIA_ROOT: process.env.ESTUDIO_MEDIA_ROOT || "",
  // Grafo de código (graphify). launchd corre con PATH mínimo (sin ~/.local/bin),
  // por eso el binario se resuelve por ruta absoluta.
  GRAPHIFY_BIN: process.env.GRAPHIFY_BIN || resolve(homedir(), ".local/bin/graphify"),
  // Memoria de código (codebase-memory-mcp): el mismo criterio de ruta absoluta.
  CBM_BIN: process.env.CBM_BIN || resolve(homedir(), ".local/bin/codebase-memory-mcp"),
  // Puerto de la UI del daemon de cbm: de ahí sale el grafo 3D (/api/layout).
  CBM_UI_PORT: Number(process.env.CBM_UI_PORT || 9749),
  // Tope de nodos que se le piden al layout (el render 3D no lee más).
  CBM_MAX_NODES: Number(process.env.CBM_MAX_NODES || 6000),
  // Proveedor del grafo de código: "auto" (cbm si está instalado, si no
  // graphify), "cbm" o "graphify". graphify sigue siendo el que indexa el
  // vault y material que no es código, así que no se va.
  CODE_MEMORY: (process.env.HERMES_CODE_MEMORY || "auto").toLowerCase(),
  // Repo indexado que responde query_code_graph (piloto: este monorepo).
  CODE_GRAPH_ROOT: process.env.CODE_GRAPH_ROOT || root,
  // STT local (whisper.cpp) — la red de seguridad cuando los proveedores de
  // nube fallan (sin créditos, sin internet) o el audio pasa de 25 MB. Rutas
  // absolutas por la misma razón que graphify: launchd corre con PATH mínimo.
  WHISPER_BIN: process.env.WHISPER_BIN || "/opt/homebrew/bin/whisper-cli",
  WHISPER_MODEL:
    process.env.WHISPER_MODEL || resolve(homedir(), ".cache/whisper-models/ggml-large-v3-turbo.bin"),
  FFMPEG_BIN: process.env.FFMPEG_BIN || "/opt/homebrew/bin/ffmpeg",
  // Aprendizaje (revisión en background tras cada turno → propuestas de
  // skill/perfil/memoria). "" = activo con aprobación · "auto" = aplica sin
  // preguntar · "off" = no revisa. El modelo de la revisión es barato a
  // propósito: corre después de CADA turno con señal.
  LEARNING: (process.env.HERMES_LEARNING || "").toLowerCase(),
  LEARNING_MODEL: process.env.HERMES_LEARNING_MODEL || "claude-haiku-4-5",
  // Zona horaria por defecto de las tareas programadas (cron en hora local).
  SCHEDULED_TZ: process.env.HERMES_SCHEDULED_TZ || process.env.GOOGLE_CALENDAR_TZ || "America/Bogota",
  // Composición (/composicion): "off" apaga /composicion/* con 404.
  COMPOSICION_ENABLED: (process.env.HERMES_COMPOSICION || "").toLowerCase() !== "off",
  // Carpeta madre de las sesiones grabadas (video de la cámara / memos): cada
  // sesión vive en <root>/<slug>/{crudos,assets,analisis}. Vacío o disco sin
  // montar = fallback local en ~/Movies/composicion/sesiones (como el Estudio:
  // importar nunca se bloquea por un cable).
  COMPOSICION_MEDIA_ROOT: process.env.COMPOSICION_MEDIA_ROOT || "",
  // Estado liviano (board.json + JSON por sesión). HERMES_HOME se lee aquí y no
  // desde home.ts porque ese módulo se evalúa ANTES de cargar el .env.
  COMPOSICION_DIR:
    process.env.HERMES_COMPOSICION_DIR ||
    join(process.env.HERMES_HOME || join(homedir(), ".hermes-os"), "composicion"),
  // Python del venv de audio-separator (trae torch con MPS + librosa). Ruta
  // absoluta: launchd no tiene ~/.local en PATH, y NO uvx en runtime.
  COMPOSICION_PYTHON:
    process.env.COMPOSICION_PYTHON ||
    resolve(homedir(), ".local/share/uv/tools/audio-separator/bin/python"),
  // Modelos de separación en una carpeta FIJA (el default del paquete es /tmp,
  // que se borra y obliga a bajar 900 MB otra vez).
  AUDIO_SEPARATOR_MODELS:
    process.env.AUDIO_SEPARATOR_MODELS ||
    join(process.env.HERMES_HOME || join(homedir(), ".hermes-os"), "models", "audio-separator"),
  COMPOSICION_SEPARATOR_MODEL:
    process.env.COMPOSICION_SEPARATOR_MODEL || "vocals_mel_band_roformer.ckpt",
  // Letras sobre molde: modelo y esfuerzo PROPIOS. Con el modelo por defecto de
  // la cuenta y razonamiento extendido, 4 versiones de un coro tardaban 11 min
  // (medido); escribir contra un molde medido no pide razonamiento profundo.
  COMPOSICION_LYRICS_MODEL: process.env.COMPOSICION_LYRICS_MODEL || "claude-sonnet-5",
  COMPOSICION_LYRICS_EFFORT: (["low", "medium", "high", "xhigh", "max"] as const).find(
    (e) => e === process.env.COMPOSICION_LYRICS_EFFORT,
  ) ?? "medium",
  // Sin razonamiento extendido por defecto: el conteo de sílabas lo hace el
  // verificador determinista (lineFit) y la reparación corrige; el modelo solo
  // escribe. Medido sobre un coro real (1 versión, 4 frases): 36 s sin
  // razonamiento contra 207–379 s con él. "adaptive" lo vuelve a encender.
  COMPOSICION_LYRICS_THINKING:
    (process.env.COMPOSICION_LYRICS_THINKING || "off").toLowerCase() === "adaptive" ? "adaptive" : "off",
  // Composición es una herramienta interna: /composicion/* rechaza lo que llega
  // por el túnel cloudflared (solo red local / Tailscale). "off" lo permite.
  COMPOSICION_LAN_ONLY: (process.env.COMPOSICION_LAN_ONLY || "").toLowerCase() !== "off",
  // Guía cantada (TTS con timestamps de ElevenLabs + PSOLA local). El modelo
  // multilingüe lee español; la voz vacía obliga a la UI a elegir de la lista
  // real (GET /composicion/guide/voices). Usa la misma ELEVENLABS_API_KEY.
  COMPOSICION_TTS_MODEL: process.env.COMPOSICION_TTS_MODEL || "eleven_multilingual_v2",
  COMPOSICION_GUIDE_VOICE: process.env.COMPOSICION_GUIDE_VOICE || "",
};

export const REPO_ROOT = root;
