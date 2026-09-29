import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  defaultSignsConfig,
  isSignAction,
  SIGN_HOLD_MAX_MS,
  SIGN_HOLD_MIN_MS,
  SIGN_MAX_COUNT,
  SIGN_MAX_SAMPLES,
  SIGN_VECTOR_LENGTH,
  type FingerShape,
  type SignDef,
  type SignsConfig,
} from "@hermes/shared";
import { HERMES_HOME } from "../home.js";

/**
 * Persistencia de las señas de mano (~/.hermes-os/gesture-signs.json). Vive
 * en el agente y no en el browser porque las señas son de ESTA máquina (las
 * acciones de sistema corren aquí) y así sobreviven a cambiar de navegador.
 * El browser reconoce; el agente guarda y valida: un cliente que mande una
 * acción fuera del catálogo o un vector malformado recibe 400, no un archivo
 * roto. Sin archivo → las de fábrica.
 */

export const SIGNS_PATH: string =
  process.env.HERMES_SIGNS_PATH || join(HERMES_HOME, "gesture-signs.json");

export class SignsValidationError extends Error {}

const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

function isShape(v: unknown): v is FingerShape {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return ["thumb", "index", "middle", "ring", "pinky"].every((k) => typeof s[k] === "boolean");
}

function validateSign(raw: unknown, idx: number): SignDef {
  if (!raw || typeof raw !== "object") throw new SignsValidationError(`seña ${idx}: no es un objeto`);
  const s = raw as Record<string, unknown>;
  const where = `seña ${idx}`;
  if (typeof s.id !== "string" || !SLUG.test(s.id)) throw new SignsValidationError(`${where}: id inválido`);
  if (typeof s.name !== "string" || s.name.trim().length === 0 || s.name.length > 60) {
    throw new SignsValidationError(`${where}: nombre vacío o >60 chars`);
  }
  if (s.emoji !== undefined && (typeof s.emoji !== "string" || s.emoji.length > 8)) {
    throw new SignsValidationError(`${where}: emoji inválido`);
  }
  if (s.shape !== undefined && !isShape(s.shape)) throw new SignsValidationError(`${where}: shape inválida`);
  if (!Array.isArray(s.samples) || s.samples.length > SIGN_MAX_SAMPLES) {
    throw new SignsValidationError(`${where}: samples debe ser un array de ≤${SIGN_MAX_SAMPLES}`);
  }
  for (const v of s.samples) {
    if (!Array.isArray(v) || v.length !== SIGN_VECTOR_LENGTH || !v.every((n) => typeof n === "number" && Number.isFinite(n))) {
      throw new SignsValidationError(`${where}: cada muestra son ${SIGN_VECTOR_LENGTH} números`);
    }
  }
  if (!s.shape && s.samples.length === 0) {
    throw new SignsValidationError(`${where}: necesita forma o muestras`);
  }
  if (s.action !== null && (typeof s.action !== "string" || !isSignAction(s.action))) {
    throw new SignsValidationError(`${where}: acción desconocida "${String(s.action)}"`);
  }
  const holdMs = typeof s.holdMs === "number" ? Math.round(s.holdMs) : NaN;
  if (!(holdMs >= SIGN_HOLD_MIN_MS && holdMs <= SIGN_HOLD_MAX_MS)) {
    throw new SignsValidationError(`${where}: holdMs fuera de ${SIGN_HOLD_MIN_MS}-${SIGN_HOLD_MAX_MS}`);
  }
  return {
    id: s.id,
    name: s.name.trim(),
    ...(s.emoji ? { emoji: s.emoji } : {}),
    ...(s.shape ? { shape: s.shape as FingerShape } : {}),
    samples: s.samples as number[][],
    action: s.action as string | null,
    holdMs,
    enabled: s.enabled !== false,
    builtin: s.builtin === true,
  };
}

/** Valida un config completo (lanza SignsValidationError con el motivo). */
export function validateSignsConfig(raw: unknown): SignsConfig {
  if (!raw || typeof raw !== "object") throw new SignsValidationError("config no es un objeto");
  const c = raw as Record<string, unknown>;
  if (!Array.isArray(c.signs)) throw new SignsValidationError("signs debe ser un array");
  if (c.signs.length > SIGN_MAX_COUNT) throw new SignsValidationError(`máximo ${SIGN_MAX_COUNT} señas`);
  const signs = c.signs.map(validateSign);
  const ids = new Set<string>();
  for (const s of signs) {
    if (ids.has(s.id)) throw new SignsValidationError(`id repetido: ${s.id}`);
    ids.add(s.id);
  }
  return { version: 1, signs };
}

export async function readSignsConfig(): Promise<SignsConfig> {
  let text: string;
  try {
    text = await readFile(SIGNS_PATH, "utf8");
  } catch {
    return defaultSignsConfig();
  }
  try {
    return validateSignsConfig(JSON.parse(text));
  } catch (err) {
    // Un archivo corrupto no deja al usuario sin señas: fábrica + aviso.
    console.error("[signs] gesture-signs.json inválido, usando las de fábrica:", (err as Error).message);
    return defaultSignsConfig();
  }
}

/** Escritura atómica (tmp + rename): un corte a mitad no deja medio JSON. */
export async function writeSignsConfig(raw: unknown): Promise<SignsConfig> {
  const config = validateSignsConfig(raw);
  await mkdir(dirname(SIGNS_PATH), { recursive: true });
  const tmp = `${SIGNS_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(config, null, 2), "utf8");
  await rename(tmp, SIGNS_PATH);
  return config;
}
