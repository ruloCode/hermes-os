import { config } from "dotenv";
import { readFileSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Identidad del DUEÑO de esta instancia de Hermes. Todo lo que el agente
 * sabe "de quién es" sale de aquí — nunca del código — para que el mismo
 * repo corra en la máquina de cualquiera sin cruzar configuraciones:
 *
 *   - HERMES_OWNER_NAME: nombre con el que Hermes se dirige a su dueño
 *     (default: el usuario del sistema, capitalizado).
 *   - SOUL.md (~/.hermes-os/SOUL.md, override HERMES_SOUL_PATH): persona
 *     y preferencias en markdown libre. Se inyecta al system prompt del
 *     agente y a los prompts especializados que necesitan conocer al dueño
 *     (Estudio, coach de juntas, tutor). Vive FUERA del repo: es dato
 *     personal, no código. Plantilla en docs/SOUL.example.md.
 */

// Mismo .env de la raíz que env.ts (dotenv no pisa variables ya definidas):
// este módulo puede importarse antes que env.ts y debe ver HERMES_OWNER_NAME.
config({ path: resolve(fileURLToPath(import.meta.url), "../../../..", ".env") });

function systemUserName(): string {
  try {
    const u = userInfo().username || "";
    return u ? u.charAt(0).toUpperCase() + u.slice(1) : "";
  } catch {
    return "";
  }
}

export const OWNER: string = process.env.HERMES_OWNER_NAME?.trim() || systemUserName() || "Usuario";

export const SOUL_PATH: string = process.env.HERMES_SOUL_PATH || join(homedir(), ".hermes-os", "SOUL.md");

const SOUL_MAX_CHARS = 6000;
let cache: { mtimeMs: number; text: string } | null = null;

/** Contenido de SOUL.md (cacheado por mtime; "" si no existe). */
export function readSoul(): string {
  try {
    const { mtimeMs } = statSync(SOUL_PATH);
    if (cache && cache.mtimeMs === mtimeMs) return cache.text;
    const text = readFileSync(SOUL_PATH, "utf8").trim().slice(0, SOUL_MAX_CHARS);
    cache = { mtimeMs, text };
    return text;
  } catch {
    cache = null;
    return "";
  }
}

/**
 * Cuerpo de una sección `## <título>` de SOUL.md (sin el encabezado; "" si
 * no existe). Los prompts especializados piden solo lo que necesitan:
 * `soulSection("Creador de contenido")`, `soulSection("Inglés")`.
 */
export function soulSection(title: string): string {
  const soul = readSoul();
  if (!soul) return "";
  const re = new RegExp(`^##\\s+${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "im");
  const m = re.exec(soul);
  if (!m) return "";
  const rest = soul.slice(m.index + m[0].length);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

/** Bloque listo para un system prompt: "# Sobre <dueño>\n<SOUL.md>" ("" si no hay SOUL). */
export function soulPromptBlock(): string {
  const soul = readSoul();
  return soul ? `# Sobre ${OWNER} (SOUL.md)\n${soul}` : "";
}

/**
 * Frase de contexto sobre el dueño para un prompt especializado: ": <sección
 * de SOUL.md en una línea>" o el fallback dado (que debe traer su propio
 * separador). Así el prompt lee "guiones para Ana: dev que…" con SOUL, y
 * "guiones para Ana" a secas sin él.
 */
export function ownerBlurb(section: string, fallback = ""): string {
  const text = soulSection(section).replace(/\s+/g, " ").trim();
  return text ? `: ${text}` : fallback;
}
