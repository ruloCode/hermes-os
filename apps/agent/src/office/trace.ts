// Trazas del loop de cada personaje de la Oficina: lo que el agente leyó, qué
// tool llamó, qué le devolvió, los permisos y los guardrails — SIN recortes
// (tope de ~20 KB por campo, marcado). Una por tarea del SDK o run de claude -p,
// con el mismo id del personaje.
//
// - Memoria: las trazas vivas (y las recién terminadas, 10 min) para el snapshot.
// - Disco: ~/.hermes-os/trazas/<id>.jsonl, append por lote (meta, prompt,
//   inventario y eventos). De ahí sale la repetición del modo vitrina.
// - Canal: los eventos nuevos van por /office/events ({type:"trace"}), el
//   mismo canal de la Oficina: nada de un stream por agente.
//
// La conversión es pura (TraceRecorder en @hermes/shared). Lo que va por el bus
// general (feed, monitores, laptop) sigue igual, recortado.

import { appendFile, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  TraceRecorder,
  parseTraceJsonl,
  reduceTrace,
  traceSummary,
  type TraceDecider,
  type TraceEvent,
  type TraceFile,
  type TraceInventoryCapture,
  type TraceLine,
  type TraceMeta,
  type TracePromptInfo,
} from "@hermes/shared";
import { HERMES_HOME } from "../home.js";
import { publishOfficeUpdate } from "./state.js";

export const TRACE_DIR = process.env.HERMES_TRACE_DIR || join(HERMES_HOME, "trazas");
const KEEP_AFTER_END_MS = 10 * 60_000;
const MAX_LIVE_EVENTS = 4000;
const ID_RE = /^[\w-]{1,80}$/;

interface LiveTrace {
  meta: TraceMeta;
  recorder: TraceRecorder;
  events: TraceEvent[];
  prompt?: TracePromptInfo;
  inventory?: TraceInventoryCapture;
  ended: boolean;
  write: Promise<unknown>;
}

const live = new Map<string, LiveTrace>();
let dirReady: Promise<unknown> | null = null;

function fileOf(id: string): string {
  return join(TRACE_DIR, `${id}.jsonl`);
}

function persist(t: LiveTrace, lines: TraceLine[]) {
  if (!lines.length) return;
  dirReady ??= mkdir(TRACE_DIR, { recursive: true }).catch(() => {});
  const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  t.write = t.write.then(() => dirReady).then(() => appendFile(fileOf(t.meta.id), body, "utf8")).catch((err) => console.error("[trace] no se pudo guardar:", String(err).slice(0, 200)));
}

function push(t: LiveTrace, events: TraceEvent[]) {
  if (!events.length) return;
  t.events.push(...events);
  if (t.events.length > MAX_LIVE_EVENTS) t.events.splice(0, t.events.length - MAX_LIVE_EVENTS);
  persist(t, events.map((event) => ({ type: "event", event })));
  publishOfficeUpdate({ type: "trace", id: t.meta.id, events });
}

/** Lo que un punto de arranque usa para alimentar su traza. */
export interface TraceHandle {
  readonly id: string;
  /** Un mensaje crudo del SDK o una línea parseada del stream-json del CLI. */
  ingest(raw: unknown): void;
  permission(p: { tool?: string; decision: "asked" | "allowed" | "denied"; by: TraceDecider; text?: string; input?: string }): void;
  guardrail(tool: string, reason: string, input?: unknown): void;
  error(text: string, isError?: boolean): void;
  setPrompt(prompt: TracePromptInfo): void;
  setInventory(inventory: TraceInventoryCapture): void;
  end(): void;
}

function handleFor(t: LiveTrace): TraceHandle {
  return {
    id: t.meta.id,
    ingest: (raw) => {
      if (t.ended) return;
      push(t, t.recorder.ingest(raw));
    },
    permission: (p) => push(t, [t.recorder.permission(p)]),
    guardrail: (tool, reason, input) => push(t, [t.recorder.guardrail(tool, reason, input === undefined ? undefined : JSON.stringify(input))]),
    error: (text, isError = true) => {
      const ev = t.recorder.error(text);
      if (!isError) ev.isError = false;
      push(t, [ev]);
    },
    setPrompt: (prompt) => {
      t.prompt = prompt;
      persist(t, [{ type: "prompt", prompt }]);
      publishOfficeUpdate({ type: "trace", id: t.meta.id, prompt });
    },
    setInventory: (inventory) => {
      t.inventory = inventory;
      persist(t, [{ type: "inventory", inventory }]);
      publishOfficeUpdate({ type: "trace", id: t.meta.id, inventory });
    },
    end: () => {
      if (t.ended) return;
      t.ended = true;
      setTimeout(() => {
        if (live.get(t.meta.id) === t) live.delete(t.meta.id);
      }, KEEP_AFTER_END_MS).unref();
    },
  };
}

/** Abre la traza de un personaje (mismo id). Si ya existía viva, la reemplaza. */
export function startTrace(meta: Omit<TraceMeta, "startedAt"> & { startedAt?: string }): TraceHandle {
  const full: TraceMeta = { ...meta, title: meta.title.slice(0, 300), startedAt: meta.startedAt ?? new Date().toISOString() };
  const t: LiveTrace = { meta: full, recorder: new TraceRecorder(meta.source), events: [], ended: false, write: Promise.resolve() };
  live.set(full.id, t);
  persist(t, [{ type: "meta", meta: full }]);
  return handleFor(t);
}

/** La traza viva de un personaje (las aprobaciones la usan para dejar su rastro). */
export function liveTrace(id: string): TraceHandle | null {
  const t = live.get(id);
  return t && !t.ended ? handleFor(t) : null;
}

/** Snapshot completo: de memoria si sigue viva, si no del disco. */
export async function getTrace(id: string): Promise<TraceFile | null> {
  if (!ID_RE.test(id)) return null;
  const t = live.get(id);
  if (t) return { meta: t.meta, events: [...t.events], prompt: t.prompt ?? null, inventory: t.inventory ?? null };
  try {
    return parseTraceJsonl(await readFile(fileOf(id), "utf8"));
  } catch {
    return null;
  }
}

export interface TraceListItem {
  meta: TraceMeta;
  summary: string;
  events: number;
  done: boolean;
  isError: boolean;
  endedAt: string;
}

/** Las trazas guardadas, de la más reciente a la más vieja (para la repetición del modo vitrina). */
export async function listTraces(limit = 20): Promise<TraceListItem[]> {
  let names: string[] = [];
  try {
    names = (await readdir(TRACE_DIR)).filter((n) => n.endsWith(".jsonl"));
  } catch {
    return [];
  }
  const withTime = await Promise.all(
    names.map(async (n) => {
      try {
        return { n, mtime: (await stat(join(TRACE_DIR, n))).mtimeMs };
      } catch {
        return { n, mtime: 0 };
      }
    }),
  );
  withTime.sort((a, b) => b.mtime - a.mtime);
  const out: TraceListItem[] = [];
  for (const { n, mtime } of withTime.slice(0, limit)) {
    const file = await getTrace(n.replace(/\.jsonl$/, ""));
    if (!file?.meta) continue;
    const r = reduceTrace(file.events);
    out.push({ meta: file.meta, summary: traceSummary(r), events: file.events.length, done: r.done, isError: r.isError, endedAt: new Date(mtime).toISOString() });
  }
  return out;
}
