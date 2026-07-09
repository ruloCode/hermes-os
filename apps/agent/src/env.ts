import { config } from "dotenv";
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
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || "",
  // Agente de voz de ElevenLabs. Comparte el valor con el dashboard web
  // (NEXT_PUBLIC_…) para que la app móvil obtenga el token del mismo agente.
  ELEVENLABS_AGENT_ID: process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "",
  // Proveedor de STT preferido para reuniones: "whisper" | "scribe".
  // Default: scribe primero, Whisper de fallback. Ponlo en "whisper" si
  // ElevenLabs se queda sin créditos para no gastar la llamada fallida a Scribe.
  STT_PROVIDER: (process.env.HERMES_STT || "").toLowerCase(),
};

export const REPO_ROOT = root;
