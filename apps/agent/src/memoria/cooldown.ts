/**
 * Enfriamiento de OpenAI para embeddings, persistido en disco.
 *
 * Con la cuenta sin crédito, cada búsqueda y cada sincronización le pegaban a
 * la API y volvían con `insufficient_quota`: 3.451 errores en el log. Un 429 de
 * cuota no se arregla solo en minutos, así que lo enfría 6 h — y en DISCO,
 * porque un reinicio del agente (o un script) no debe volver a martillar.
 *
 * Lo comparten `embeddings.ts` (vectores de 1.536 para Supabase) y el motor de
 * la memoria v2: los dos le hablan al mismo proveedor con la misma llave.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HERMES_HOME } from "../home.js";

export const OPENAI_COOLDOWN_MS = 6 * 3600_000;

export interface Cooldown {
  /** Epoch ms hasta el que no se llama. */
  until: number;
  reason: string;
  /** Cuándo empezó (para decir «desde las…»). */
  since: number;
}

const file = () => join(process.env.HERMES_MEMORIA_HOME || join(HERMES_HOME, "memoria"), "openai-cooldown.json");

export function readCooldown(): Cooldown | null {
  try {
    const c = JSON.parse(readFileSync(file(), "utf8")) as Cooldown;
    return typeof c.until === "number" ? c : null;
  } catch {
    return null;
  }
}

/** ¿OpenAI está en enfriamiento ahora? (reloj inyectable para los tests). */
export function openaiCooling(now = Date.now()): Cooldown | null {
  const c = readCooldown();
  return c && c.until > now ? c : null;
}

/**
 * ¿Esta respuesta de error de OpenAI es «sin crédito»? Solo la cuota enfría 6 h;
 * un 429 por ritmo (rate limit) se arregla solo en segundos y no debe apagar nada.
 */
export function isQuotaError(status: number, body: string): boolean {
  return status === 429 && /insufficient_quota|exceeded your current quota|billing/i.test(body);
}

/**
 * Enfría OpenAI. Devuelve true si ESTA llamada abrió el enfriamiento (para que
 * el aviso salga una vez y no una por cada intento en vuelo).
 */
export function startCooldown(reason: string, now = Date.now(), ms = OPENAI_COOLDOWN_MS): boolean {
  const prev = openaiCooling(now);
  if (prev) return false;
  const c: Cooldown = { until: now + ms, reason: reason.slice(0, 300), since: now };
  const path = file();
  try {
    mkdirSync(join(path, ".."), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(c, null, 2));
    renameSync(tmp, path);
  } catch (err) {
    console.error("[memoria] no pude guardar el enfriamiento de OpenAI:", (err as Error).message);
  }
  console.warn(
    `[memoria] OpenAI sin crédito (${reason.slice(0, 120)}): no se le vuelve a llamar para embeddings hasta ${new Date(c.until).toLocaleString("es-CO")}.`,
  );
  return true;
}
