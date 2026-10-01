// GET /office/plan-usage: el uso de la suscripción de Claude (sesión de 5 h,
// semana y límites por modelo como "Fable") — los mismos números de /usage.
//
// Fuente: el control `get_usage` del CLI, expuesto por el Agent SDK como
// `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` (EXPERIMENTAL: si
// una versión del SDK lo cambia, la ruta responde el error y el tablero lo
// dice). Se abre una sesión con entrada en streaming que NUNCA manda un
// mensaje: el CLI arranca, responde el control y se cierra. Cero tokens.
// Caché de 60 s y una sola consulta en vuelo: arrancar el CLI tarda ~2 s.

import { query } from "@anthropic-ai/claude-agent-sdk";
import { parsePlanUsage, type PlanUsage } from "@hermes/shared";
import { childEnv } from "../agent/child-env.js";

const CACHE_MS = 60_000;
const TIMEOUT_MS = 25_000;
let cached: { at: number; value: PlanUsage } | null = null;
let inflight: Promise<PlanUsage> | null = null;

async function fetchPlanUsage(): Promise<PlanUsage> {
  let release = () => {};
  const gate = new Promise<void>((r) => (release = r));
  // Entrada en streaming que no produce ningún mensaje: no hay turno, no hay modelo.
  async function* input(): AsyncGenerator<never> {
    await gate;
  }
  const q = query({
    prompt: input(),
    options: { cwd: process.cwd(), settingSources: [], tools: [], env: childEnv(), permissionMode: "default" },
  });
  // El iterador hay que drenarlo para que el SDK procese el control; nada llega salvo el init.
  const drain = (async () => {
    try {
      for await (const _ of q) {
        /* sin turnos */
      }
    } catch {
      /* cerrado */
    }
  })();
  let timer: NodeJS.Timeout | undefined;
  try {
    const raw = await Promise.race([
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("el CLI no respondió a tiempo")), TIMEOUT_MS))),
    ]);
    return parsePlanUsage(raw, new Date());
  } finally {
    clearTimeout(timer);
    release();
    try {
      q.close();
    } catch {
      /* ya cerrado */
    }
    void drain;
  }
}

export async function planUsage(force = false): Promise<PlanUsage> {
  if (!force && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  inflight ??= fetchPlanUsage()
    .catch((err): PlanUsage => ({ available: false, subscription: null, windows: [], error: `No se pudo leer el uso del plan: ${String(err instanceof Error ? err.message : err).slice(0, 200)}`, fetchedAt: new Date().toISOString() }))
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => (inflight = null));
  return inflight;
}
