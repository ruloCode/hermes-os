import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { HERMES_HOME } from "./home.js";
import { OWNER } from "./owner.js";

/**
 * Perfil del dueño que Hermes MANTIENE solo (~/.hermes-os/USER.md).
 *
 * Es la contraparte de SOUL.md: SOUL.md lo escribe el humano y no se toca;
 * USER.md lo escribe el agente a medida que aprende quién es su dueño y cómo
 * le gusta trabajar. Ambos se inyectan al system prompt.
 *
 * Tres decisiones, copiadas de lo que a hermes-agent (Nous) le funcionó:
 *
 * - TOPE DURO de caracteres, sin auto-compactar. Al pasarse, la escritura
 *   FALLA con el texto actual y el agente tiene que consolidar. Un perfil que
 *   crece sin límite deja de ser un perfil: viaja en CADA llamada.
 * - SNAPSHOT AL INICIO DE SESIÓN. El archivo se lee al armar el prompt y no
 *   se recarga a mitad de conversación (eso rompería el prefijo cacheado).
 *   Lo que se escribe hoy manda desde la próxima sesión; el tool result ya
 *   muestra el estado vivo, así que el agente sabe qué acaba de guardar.
 * - ENTRADAS DE UNA LÍNEA. `- clave: valor` se busca y se reemplaza por
 *   substring; sin estructura, consolidar sería reescribir todo el archivo.
 */

export const PROFILE_PATH: string = process.env.HERMES_PROFILE_PATH || join(HERMES_HOME, "USER.md");

/** ~5-10 entradas. Sale en cada system prompt: el tope ES la feature. */
export const PROFILE_MAX_CHARS = 1400;

const HEADER = `# Perfil de ${OWNER}

Lo que Hermes ha aprendido sobre su dueño. Una entrada por línea.
`;

let cache: { mtimeMs: number; text: string } | null = null;

/** Contenido de USER.md cacheado por mtime ("" si no existe). */
export async function readProfile(): Promise<string> {
  try {
    const { mtimeMs } = statSync(PROFILE_PATH);
    if (cache && cache.mtimeMs === mtimeMs) return cache.text;
    const text = (await readFile(PROFILE_PATH, "utf8")).trim();
    cache = { mtimeMs, text };
    return text;
  } catch {
    cache = null;
    return "";
  }
}

/** Solo las entradas (líneas `- …`), sin encabezado ni prosa. */
export async function profileEntries(): Promise<string[]> {
  const text = await readProfile();
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
}

/** Bloque para el system prompt ("" si no hay perfil todavía). */
export async function profilePromptBlock(): Promise<string> {
  const entries = await profileEntries();
  if (!entries.length) return "";
  return `# Perfil de ${OWNER} (USER.md — lo mantienes tú)\n${entries
    .map((e) => `- ${e}`)
    .join("\n")}`;
}

async function writeEntries(entries: string[]): Promise<void> {
  const body = `${HEADER}\n${entries.map((e) => `- ${e}`).join("\n")}\n`;
  await mkdir(dirname(PROFILE_PATH), { recursive: true });
  const tmp = `${PROFILE_PATH}.tmp`;
  await writeFile(tmp, body, "utf8");
  await rename(tmp, PROFILE_PATH); // atómico: nunca un perfil a medio escribir
  cache = null;
}

export interface ProfileResult {
  ok: boolean;
  message: string;
  /** Estado vivo tras la operación: el agente lo ve aunque el prompt no cambie. */
  entries: string[];
  usedChars: number;
}

function sizeOf(entries: string[]): number {
  return entries.reduce((n, e) => n + e.length + 3, 0); // "- " + "\n"
}

function result(ok: boolean, message: string, entries: string[]): ProfileResult {
  const usedChars = sizeOf(entries);
  const pct = Math.round((usedChars / PROFILE_MAX_CHARS) * 100);
  const warn =
    ok && pct >= 80
      ? ` ⚠️ El perfil va al ${pct}% de su capacidad: consolida entradas que se solapen antes de agregar más.`
      : "";
  return {
    ok,
    message: `${message} (${usedChars}/${PROFILE_MAX_CHARS} chars, ${entries.length} entradas)${warn}`,
    entries,
    usedChars,
  };
}

/** Normaliza para comparar: sin acentos, sin puntuación, minúsculas. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Términos con carga semántica: fuera las partículas de 1-2 letras. */
function terms(s: string): Set<string> {
  return new Set(norm(s).split(" ").filter((w) => w.length > 2));
}

/** Solapamiento a partir del cual dos entradas dicen lo mismo. */
const SAME_THRESHOLD = 0.6;

/**
 * ¿Dos entradas dicen lo mismo? Coeficiente de solapamiento (intersección
 * sobre el conjunto más chico), no prefijo compartido: "prefiere pnpm sobre
 * npm" y "prefiere pnpm siempre" divergen en la tercera palabra pero son la
 * misma preferencia, y un perfil con tope duro no puede gastar dos entradas
 * en eso. El mínimo de 2 términos evita que dos frases cortísimas colisionen.
 */
function sameIdea(a: string, b: string): boolean {
  const ta = terms(a);
  const tb = terms(b);
  const min = Math.min(ta.size, tb.size);
  if (min < 2) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / min >= SAME_THRESHOLD;
}

export async function addProfileEntry(entry: string): Promise<ProfileResult> {
  const clean = entry.trim().replace(/^[-*]\s*/, "").replace(/\s+/g, " ");
  if (!clean) return result(false, "Entrada vacía.", await profileEntries());
  const entries = await profileEntries();

  const dupe = entries.findIndex((e) => sameIdea(e, clean));
  if (dupe >= 0) {
    return result(
      false,
      `Ya existe una entrada parecida: "${entries[dupe]}". Usa replace para actualizarla en vez de duplicarla.`,
      entries,
    );
  }

  const next = [...entries, clean];
  if (sizeOf(next) > PROFILE_MAX_CHARS) {
    return result(
      false,
      `NO se guardó: el perfil llegaría a ${sizeOf(next)} chars y el tope es ${PROFILE_MAX_CHARS}. ` +
        `Consolida o elimina entradas viejas (replace/remove) y vuelve a intentar. Entradas actuales abajo.`,
      entries,
    );
  }
  await writeEntries(next);
  return result(true, `Perfil actualizado: "${clean}".`, next);
}

export async function replaceProfileEntry(find: string, replacement: string): Promise<ProfileResult> {
  const entries = await profileEntries();
  const needle = norm(find);
  const idx = entries.findIndex((e) => norm(e).includes(needle));
  if (idx < 0) return result(false, `No encontré ninguna entrada que contenga "${find}".`, entries);

  const clean = replacement.trim().replace(/^[-*]\s*/, "").replace(/\s+/g, " ");
  if (!clean) return result(false, "El reemplazo está vacío; usa remove si querías borrarla.", entries);

  const next = [...entries];
  const old = next[idx];
  next[idx] = clean;
  if (sizeOf(next) > PROFILE_MAX_CHARS) {
    return result(false, `NO se guardó: el reemplazo pasa el tope de ${PROFILE_MAX_CHARS} chars. Acórtalo.`, entries);
  }
  await writeEntries(next);
  return result(true, `Reemplazada "${old}" → "${clean}".`, next);
}

export async function removeProfileEntry(find: string): Promise<ProfileResult> {
  const entries = await profileEntries();
  const needle = norm(find);
  const idx = entries.findIndex((e) => norm(e).includes(needle));
  if (idx < 0) return result(false, `No encontré ninguna entrada que contenga "${find}".`, entries);
  const [old] = entries.splice(idx, 1);
  await writeEntries(entries);
  return result(true, `Eliminada "${old}".`, entries);
}
