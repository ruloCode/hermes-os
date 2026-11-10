/**
 * El ÚNICO camino al modelo: `query()` del Agent SDK envuelto.
 *
 * Tres cosas que antes dependían de que cada sitio se acordara:
 *  1. **Entorno saneado.** Sin `env` explícito, el hijo recibe `childEnv()`. Diez
 *     sitios llamaban a `query()` heredando el `.env` completo (service role de
 *     Supabase incluida); uno de ellos con Bash y 300 turnos.
 *  2. **Modelo del catálogo.** Sin `model`, lo pone `modelFor(feature)`; sin él
 *     el CLI elegía el suyo (claude-opus-5-5) y nadie lo sabía.
 *  3. **Gasto medido.** Cada turno deja una línea en el registro (usage-ledger).
 *
 * Devuelve el MISMO objeto `Query` (un Proxy): quien lo llama no cambia su
 * bucle ni pierde `interrupt()`, `setModel()` o `mcpServerStatus()`.
 *
 * Cómo se mide (verificado con el SDK 0.3.322, sesión de tres turnos):
 *  - `result.usage` es del turno, pero `result.modelUsage` y `total_cost_usd`
 *    son ACUMULADOS de la sesión. En una sesión persistente el gasto del turno
 *    es la diferencia contra el resultado anterior. `modelUsage` además cuenta
 *    las llamadas de fondo del CLI que `usage` no trae.
 *  - El turno empieza cuando el mensaje del usuario ENTRA al SDK (se envuelve
 *    el iterable de entrada), no cuando se creó la sesión: si no, el rato en
 *    silencio de una junta contaría como latencia.
 */
import { query, type Options, type Query } from "@anthropic-ai/claude-agent-sdk";
import type { CallEntry, CallStatus } from "@hermes/shared";
import { recordCall } from "../usage-ledger.js";
import { childEnv } from "./child-env.js";
import { modelFor, type Feature } from "./models.js";

type QueryParams = Parameters<typeof query>[0];

export interface TrackMeta {
  /** Slug del proyecto, si la llamada es de uno. */
  project?: string;
  /** Id de lo que se estaba haciendo (tarea, junta, pieza): para rastrear una línea cara. */
  ref?: string;
}

interface Totals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

const ZERO: Totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : 0;
}

/** Suma de `modelUsage` (acumulado de la sesión) y el modelo que más salida produjo. */
export function totalsOf(modelUsage: unknown, totalCostUsd: unknown): { totals: Totals; models: string[]; primary: string | null } {
  const totals: Totals = { ...ZERO };
  const models: string[] = [];
  let primary: string | null = null;
  let best = -1;
  if (modelUsage && typeof modelUsage === "object") {
    for (const [model, raw] of Object.entries(modelUsage as Record<string, Record<string, unknown>>)) {
      if (!raw || typeof raw !== "object") continue;
      models.push(model);
      totals.input += n(raw.inputTokens);
      totals.output += n(raw.outputTokens);
      totals.cacheRead += n(raw.cacheReadInputTokens);
      totals.cacheWrite += n(raw.cacheCreationInputTokens);
      totals.cost += n(raw.costUSD);
      if (n(raw.outputTokens) > best) {
        best = n(raw.outputTokens);
        primary = model;
      }
    }
  }
  if (typeof totalCostUsd === "number" && Number.isFinite(totalCostUsd)) totals.cost = totalCostUsd;
  return { totals, models, primary };
}

/** Lo de este turno = acumulado ahora − acumulado del resultado anterior (nunca negativo). */
export function turnDelta(now: Totals, prev: Totals): Totals {
  const d = (a: number, b: number) => (a >= b ? a - b : a);
  return {
    input: d(now.input, prev.input),
    output: d(now.output, prev.output),
    cacheRead: d(now.cacheRead, prev.cacheRead),
    cacheWrite: d(now.cacheWrite, prev.cacheWrite),
    cost: d(now.cost, prev.cost),
  };
}

/**
 * Las opciones que de verdad viajan al SDK: lo que pasó quien llama, más el
 * entorno saneado y el modelo/esfuerzo/razonamiento del catálogo donde no dijo nada.
 */
export function resolveOptions(feature: Feature, options: Options | undefined): Options {
  const fm = modelFor(feature);
  const out: Options = { ...(options ?? {}) };
  if (out.env === undefined) out.env = childEnv();
  if (!out.model) out.model = fm.model;
  if (out.effort === undefined && fm.effort) out.effort = fm.effort;
  // `maxThinkingTokens` es la forma vieja de lo mismo: si alguien la puso, manda.
  if (out.thinking === undefined && out.maxThinkingTokens === undefined && fm.thinking) {
    out.thinking = fm.thinking === "off" ? { type: "disabled" } : { type: "adaptive" };
  }
  return out;
}

export function trackedQuery(feature: Feature, params: QueryParams, meta: TrackMeta = {}): Query {
  const options = resolveOptions(feature, params.options);
  const abortSignal = options.abortController?.signal;

  // Inicio de cada turno. Con prompt de texto es uno solo, ahora. Con entrada en
  // streaming, cada mensaje del usuario que entra abre uno (cola FIFO: el SDK
  // cierra cada turno con su `result`, en orden).
  const starts: number[] = [];
  let prompt = params.prompt;
  if (typeof prompt === "string") {
    starts.push(Date.now());
  } else {
    const source = prompt;
    prompt = (async function* () {
      for await (const message of source) {
        if ((message as { type?: string }).type === "user") starts.push(Date.now());
        yield message;
      }
    })() as typeof params.prompt;
  }

  const q = query({ ...params, prompt, options });

  let prev: Totals = { ...ZERO };
  let models: string[] = [];
  let ttftAt: number | null = null;
  let sawWork = false;
  let closed = false;

  const write = (status: CallStatus, result?: Record<string, any>) => {
    const startedAt = starts.shift() ?? null;
    const now = Date.now();
    let delta: Totals = { ...ZERO };
    let primary: string | null = null;
    let costKnown = false;
    if (result) {
      const t = totalsOf(result.modelUsage, result.total_cost_usd);
      delta = turnDelta(t.totals, prev);
      prev = t.totals;
      if (t.models.length) models = t.models;
      primary = t.primary;
      costKnown = typeof result.total_cost_usd === "number" || t.totals.cost > 0;
      // Sin modelUsage (CLI viejo): al menos lo del turno.
      if (!t.models.length && result.usage) {
        delta = {
          input: n(result.usage.input_tokens),
          output: n(result.usage.output_tokens),
          cacheRead: n(result.usage.cache_read_input_tokens),
          cacheWrite: n(result.usage.cache_creation_input_tokens),
          cost: delta.cost,
        };
      }
    }
    const entry: CallEntry = {
      ts: new Date(now).toISOString(),
      feature,
      model: primary ?? String(options.model ?? "desconocido"),
      models: models.length ? models : [String(options.model ?? "desconocido")],
      input: delta.input,
      output: delta.output,
      cacheRead: delta.cacheRead,
      cacheWrite: delta.cacheWrite,
      costUsd: costKnown ? Math.round(delta.cost * 1e6) / 1e6 : null,
      ms: startedAt !== null ? now - startedAt : 0,
      ttftMs: startedAt !== null && ttftAt !== null && ttftAt >= startedAt ? ttftAt - startedAt : null,
      turns: n(result?.num_turns),
      status,
      ...(meta.project ? { project: meta.project } : {}),
      ...(meta.ref ? { ref: meta.ref } : {}),
    };
    ttftAt = null;
    sawWork = false;
    recordCall(entry);
  };

  const onMessage = (message: unknown) => {
    const m = message as Record<string, any>;
    if (m.type === "stream_event") {
      if (ttftAt === null && m.event?.type === "content_block_delta" && m.event.delta?.type === "text_delta") ttftAt = Date.now();
      sawWork = true;
      return;
    }
    if (m.type === "assistant") {
      // Sin mensajes parciales, el primer bloque de texto completo es el primer texto.
      if (ttftAt === null && (m.message?.content ?? []).some((b: any) => b?.type === "text" && b.text)) ttftAt = Date.now();
      sawWork = true;
      return;
    }
    if (m.type === "result") {
      // Un turno interrumpido cierra con error_during_execution: es un corte, no un fallo.
      const aborted = abortSignal?.aborted || m.subtype === "error_during_execution";
      write(m.subtype === "success" ? "ok" : aborted ? "aborted" : "error", m);
    }
  };

  /** La sesión se acabó con un turno a medias (lanzó, o quien llama dejó de leer). */
  const close = (status: CallStatus) => {
    if (closed) return;
    closed = true;
    if (starts.length && (sawWork || status !== "cut")) write(status);
  };

  const proxy: Query = new Proxy(q, {
    get(target, prop) {
      if (prop === "next") {
        return async (...args: [] | [undefined]) => {
          try {
            const step = await target.next(...args);
            if (step.done) close("cut");
            else onMessage(step.value);
            return step;
          } catch (err) {
            close(abortSignal?.aborted ? "aborted" : "error");
            throw err;
          }
        };
      }
      if (prop === "return") {
        return async (value?: unknown) => {
          close("cut");
          return target.return(value as never);
        };
      }
      if (prop === "throw") {
        return async (err?: unknown) => {
          close("error");
          return target.throw(err);
        };
      }
      if (prop === Symbol.asyncIterator) return () => proxy;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return proxy;
}
