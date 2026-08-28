import { config } from "dotenv";
import { homedir } from "node:os";
import { resolve } from "node:path";
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
  // Repo indexado que responde query_code_graph (piloto: este monorepo).
  CODE_GRAPH_ROOT: process.env.CODE_GRAPH_ROOT || root,
};

export const REPO_ROOT = root;
