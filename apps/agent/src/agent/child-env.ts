/**
 * Entorno para los procesos hijo que spawnea el Agent SDK.
 *
 * El agente carga el .env de la raíz completo: SUPABASE_SERVICE_ROLE_KEY,
 * LINEAR_API_KEY, ELEVENLABS_API_KEY, OPENAI_API_KEY, HERMES_API_KEY… Si ese
 * process.env se hereda tal cual, cualquier `Bash` del modelo (o una página
 * que le inyecte instrucciones mientras navega) puede leerlos con `env`.
 *
 * Las tools de Hermes corren DENTRO de este proceso (servidor MCP in-process),
 * no en el hijo: el CLI no necesita ninguna de esas claves. Así que pasamos
 * una allowlist — lo mínimo para que `claude` arranque y encuentre su login —
 * y todo lo demás se queda de este lado.
 *
 * El mismo patrón que ya usa code-graph.ts al invocar graphify.
 */

/** Variables que el hijo SÍ necesita (o que son inertes). */
const ALLOWED = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "TZ",
  "NODE_OPTIONS",
  // Login y config del CLI de Claude Code (su credencial vive en el keychain).
  "CLAUDE_CONFIG_DIR",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "ANTHROPIC_MODEL",
  // Proxy corporativo / red.
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
]);

/** Prefijos permitidos (XDG_*, y nada más). */
const ALLOWED_PREFIXES = ["XDG_"];

/**
 * Copia saneada de process.env para un proceso hijo.
 *
 * `extra` agrega variables explícitas cuando un run las necesita de verdad
 * (p.ej. una API key que el propio comando va a usar). Es la única forma de
 * meter un secreto al hijo: a propósito, para que quede escrito en el código
 * que lo necesita y no por herencia silenciosa.
 */
export function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (ALLOWED.has(key) || ALLOWED_PREFIXES.some((p) => key.startsWith(p))) {
      out[key] = value;
    }
  }
  // ANTHROPIC_API_KEY solo si el dueño la puso explícitamente: sin ella el
  // CLI usa el login de la suscripción, que es el modo normal de Hermes.
  if (process.env.ANTHROPIC_API_KEY) out.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  return { ...out, ...extra };
}
