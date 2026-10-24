"use client";

// Python en el navegador para el Dojo: UN Web Worker con Pyodide, fuera de
// React (un singleton, como lib/voice-partials.ts), para que la carga de ~10 MB
// se pague una vez por pestaña y sobreviva a entrar y salir de un problema.
//
// Lo delicado son los bucles infinitos: Python dentro del worker no se puede
// interrumpir, así que la página lleva un reloj POR CASO (el harness avisa
// "start" antes de cada uno) y, si se pasa, mata el worker con terminate() y lo
// reporta con lo que alcanzó a correr. El siguiente uso arranca uno nuevo
// (Pyodide ya está en la caché del navegador: unos segundos, no la descarga).

import {
  DOJO_HARNESS,
  type DojoCase,
  type DojoCaseResult,
  type DojoExecRun,
  type DojoTestRun,
  type DojoTrace,
} from "@hermes/shared";

export type PythonStatus = "idle" | "loading" | "ready" | "error";

export type ExecOutcome =
  | { kind: "ok"; run: DojoExecRun }
  | { kind: "timeout"; seconds: number }
  | { kind: "error"; message: string };

export type TestOutcome =
  | { kind: "ok"; run: DojoTestRun }
  /** Se colgó en el caso `index`; `results` = los que alcanzaron a terminar. */
  | { kind: "timeout"; index: number | null; results: DojoCaseResult[]; seconds: number }
  | { kind: "error"; message: string };

interface TestSpec {
  fn: string;
  compare: string;
  timeLimitMs: number | null;
  banned: string[];
  cases: DojoCase[];
}

/** Margen sobre el límite del caso: armar 100.000 elementos y medir también cuesta. */
const CASE_SLACK_MS = 3_000;
const CASE_DEFAULT_MS = 3_000;
const EXEC_TIMEOUT_MS = 10_000;
/** Cargar el módulo del alumno (antes del primer caso). */
const LOAD_TIMEOUT_MS = 8_000;

type Msg =
  | { id: number; type: "result"; data: unknown }
  | { id: number; type: "event"; data: { event: "start"; index: number } | { event: "case"; result: DojoCaseResult } }
  | { id: number; type: "error"; error: string };

let worker: Worker | null = null;
let booting: Promise<void> | null = null;
let status: PythonStatus = "idle";
let seq = 0;
const listeners = new Set<() => void>();

function setStatus(s: PythonStatus) {
  status = s;
  for (const l of listeners) l();
}

export function pythonStatus(): PythonStatus {
  return status;
}

export function subscribePython(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function kill() {
  worker?.terminate();
  worker = null;
  booting = null;
  setStatus("idle");
}

/** Arranca Pyodide si no está (idempotente). Llamarlo al abrir el Dojo lo precalienta. */
export function ensurePython(): Promise<void> {
  if (booting) return booting;
  setStatus("loading");
  const w = new Worker("/dojo/py-worker.js", { type: "module" });
  worker = w;
  const id = ++seq;
  booting = new Promise<void>((resolve, reject) => {
    const onMsg = (e: MessageEvent<Msg>) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", onMsg);
      if (e.data.type === "error") {
        setStatus("error");
        booting = null;
        worker = null;
        w.terminate();
        reject(new Error(e.data.error));
      } else {
        setStatus("ready");
        resolve();
      }
    };
    w.addEventListener("message", onMsg);
    w.addEventListener("error", () => {
      setStatus("error");
      booting = null;
      worker = null;
      reject(new Error("No pude cargar Python (¿sin internet? Pyodide viene de cdn.jsdelivr.net)."));
    });
    w.postMessage({ id, type: "boot", harness: DOJO_HARNESS });
  });
  return booting;
}

// Una corrida a la vez: la UI deshabilita los botones mientras tanto, y esta
// cadena lo garantiza aunque dos cosas pidan correr a la vez.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => null);
  return next;
}

export function runPython(code: string): Promise<ExecOutcome> {
  return serial(async () => {
    try {
      await ensurePython();
    } catch (err) {
      return { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
    const w = worker!;
    const id = ++seq;
    return new Promise<ExecOutcome>((resolve) => {
      const timer = setTimeout(() => {
        w.removeEventListener("message", onMsg);
        kill();
        resolve({ kind: "timeout", seconds: EXEC_TIMEOUT_MS / 1000 });
      }, EXEC_TIMEOUT_MS);
      const onMsg = (e: MessageEvent<Msg>) => {
        if (e.data.id !== id || e.data.type === "event") return;
        clearTimeout(timer);
        w.removeEventListener("message", onMsg);
        resolve(
          e.data.type === "error"
            ? { kind: "error", message: e.data.error }
            : { kind: "ok", run: e.data.data as DojoExecRun },
        );
      };
      w.addEventListener("message", onMsg);
      w.postMessage({ id, type: "exec", code, harness: DOJO_HARNESS });
    });
  });
}

export type TraceOutcome = { kind: "ok"; trace: DojoTrace } | { kind: "timeout" } | { kind: "error"; message: string };

/** El trazador corta solo a los 600 pasos; esto es para una operación que no avanza (10**10**8). */
const TRACE_TIMEOUT_MS = 5_000;

function traceRun(msg: { type: "trace" | "trace_exec"; code: string; spec?: unknown }): Promise<TraceOutcome> {
  return serial(async () => {
    try {
      await ensurePython();
    } catch (err) {
      return { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
    const w = worker!;
    const id = ++seq;
    return new Promise<TraceOutcome>((resolve) => {
      const timer = setTimeout(() => {
        w.removeEventListener("message", onMsg);
        kill();
        resolve({ kind: "timeout" });
      }, TRACE_TIMEOUT_MS);
      const onMsg = (e: MessageEvent<Msg>) => {
        if (e.data.id !== id || e.data.type === "event") return;
        clearTimeout(timer);
        w.removeEventListener("message", onMsg);
        resolve(
          e.data.type === "error"
            ? { kind: "error", message: e.data.error }
            : { kind: "ok", trace: e.data.data as DojoTrace },
        );
      };
      w.addEventListener("message", onMsg);
      w.postMessage({ id, ...msg, harness: DOJO_HARNESS });
    });
  });
}

/** Corre la función del ejercicio con UN ejemplo y devuelve cada paso (modo en vivo). */
export const traceFunction = (code: string, fn: string, args: unknown[]) =>
  traceRun({ type: "trace", code, spec: { fn, args } });

/** Corre un programa suelto paso a paso (los ejemplos de las lecciones). */
export const traceProgram = (code: string) => traceRun({ type: "trace_exec", code });

export function runTests(
  code: string,
  spec: TestSpec,
  onCase?: (r: DojoCaseResult) => void,
): Promise<TestOutcome> {
  return serial(async () => {
    try {
      await ensurePython();
    } catch (err) {
      return { kind: "error", message: err instanceof Error ? err.message : String(err) };
    }
    const w = worker!;
    const id = ++seq;
    const results: DojoCaseResult[] = [];
    let current: number | null = null;
    return new Promise<TestOutcome>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      let budget = LOAD_TIMEOUT_MS;
      const arm = (ms: number) => {
        clearTimeout(timer);
        budget = ms;
        timer = setTimeout(() => {
          w.removeEventListener("message", onMsg);
          kill();
          resolve({ kind: "timeout", index: current, results, seconds: Math.round(budget / 1000) });
        }, ms);
      };
      const onMsg = (e: MessageEvent<Msg>) => {
        if (e.data.id !== id) return;
        if (e.data.type === "event") {
          const ev = e.data.data;
          if (ev.event === "start") {
            current = ev.index;
            const c = spec.cases[ev.index];
            arm((c?.timeLimitMs ?? spec.timeLimitMs ?? CASE_DEFAULT_MS) + CASE_SLACK_MS);
          } else {
            results.push(ev.result);
            onCase?.(ev.result);
          }
          return;
        }
        clearTimeout(timer);
        w.removeEventListener("message", onMsg);
        resolve(
          e.data.type === "error"
            ? { kind: "error", message: e.data.error }
            : { kind: "ok", run: e.data.data as DojoTestRun },
        );
      };
      w.addEventListener("message", onMsg);
      arm(LOAD_TIMEOUT_MS);
      w.postMessage({ id, type: "test", code, spec, harness: DOJO_HARNESS });
    });
  });
}
