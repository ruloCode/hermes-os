// Trazas en el navegador: una por personaje (mismo id). Viven FUERA de React —
// cada evento del loop llega por /office/events y un re-render por evento
// tumbaría los fps de la escena — y los componentes se suscriben con
// useSyncExternalStore, agrupados por frame.
//
// La repetición (modo vitrina, plan B sin red) entra por aquí mismo: los
// eventos de un archivo grabado se empujan con su ritmo real (comprimido), y
// la UI y el reductor son los de siempre. Cero código paralelo.

import { useEffect, useSyncExternalStore } from "react";
import type { CliRunConfig, SdkAgentConfig, TraceEvent, TraceFile, TraceInventoryCapture, TraceMeta, TracePromptInfo } from "@hermes/shared";
import { hermesGet } from "@/lib/hermes";

export interface TraceConfig {
  sdk?: SdkAgentConfig & { hermesTools?: { name: string; description: string }[] };
  cliDenyRules?: string[];
}

export interface TraceData {
  id: string;
  meta: TraceMeta | null;
  events: TraceEvent[];
  prompt: TracePromptInfo | null;
  inventory: TraceInventoryCapture | null;
  config: TraceConfig | null;
  /** idle: nadie la pidió · loading · ok · missing (el agente no la tiene). */
  status: "idle" | "loading" | "ok" | "missing";
  /** Si es una repetición: lo que la pantalla dice ("repetición de las 19:42"). */
  replay?: string;
}

interface Entry {
  data: TraceData;
  bySeq: Map<number, TraceEvent>;
  dirty: boolean;
}

const EMPTY: TraceData = { id: "", meta: null, events: [], prompt: null, inventory: null, config: null, status: "idle" };

class TraceStore {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<() => void>>();
  private pending = new Set<string>();
  private frame = 0;

  private entry(id: string): Entry {
    let e = this.entries.get(id);
    if (!e) {
      e = { data: { ...EMPTY, id }, bySeq: new Map(), dirty: false };
      this.entries.set(id, e);
    }
    return e;
  }

  private touch(id: string) {
    this.pending.add(id);
    if (this.frame) return;
    const flush = () => {
      this.frame = 0;
      const ids = [...this.pending];
      this.pending.clear();
      for (const pid of ids) {
        const e = this.entries.get(pid);
        if (e?.dirty) {
          e.data = { ...e.data, events: [...e.bySeq.values()].sort((a, b) => a.seq - b.seq) };
          e.dirty = false;
        }
        for (const fn of this.listeners.get(pid) ?? []) fn();
      }
    };
    this.frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame(flush) : (setTimeout(flush, 16) as unknown as number);
  }

  private addEvents(e: Entry, events: TraceEvent[]) {
    for (const ev of events) e.bySeq.set(ev.seq, ev);
    if (events.length) e.dirty = true;
  }

  get(id: string | null): TraceData {
    return id ? (this.entries.get(id)?.data ?? EMPTY) : EMPTY;
  }

  subscribe(id: string, fn: () => void): () => void {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  /** Lo que llega por /office/events. Se guarda aunque nadie lo esté mirando (así abrir el panel no pierde nada). */
  applyLive(u: { id: string; events?: TraceEvent[]; prompt?: TracePromptInfo; inventory?: TraceInventoryCapture }) {
    const e = this.entry(u.id);
    if (u.events) this.addEvents(e, u.events);
    if (u.prompt || u.inventory) e.data = { ...e.data, ...(u.prompt ? { prompt: u.prompt } : {}), ...(u.inventory ? { inventory: u.inventory } : {}) };
    this.touch(u.id);
  }

  /** El snapshot completo del agente (lo que pasó antes de abrir la página). Lo vivo y lo del snapshot se juntan por seq. */
  async load(id: string): Promise<void> {
    const e = this.entry(id);
    if (e.data.status === "loading" || e.data.replay) return;
    e.data = { ...e.data, status: "loading" };
    this.touch(id);
    try {
      const file = await hermesGet<TraceFile & { config?: TraceConfig; found?: boolean }>(`/office/trace/${encodeURIComponent(id)}`);
      if (file.found === false || !Array.isArray(file.events)) {
        e.data = { ...e.data, status: e.bySeq.size ? "ok" : "missing" };
        this.touch(id);
        return;
      }
      this.addEvents(e, file.events);
      e.data = {
        ...e.data,
        meta: file.meta ?? e.data.meta,
        prompt: e.data.prompt ?? file.prompt,
        inventory: e.data.inventory ?? file.inventory,
        config: file.config ?? null,
        status: "ok",
      };
    } catch {
      e.data = { ...e.data, status: e.bySeq.size ? "ok" : "missing" };
    }
    this.touch(id);
  }

  /**
   * Repite un archivo grabado bajo `id`: los eventos salen con su ritmo real,
   * con las pausas comprimidas (máx. 1,6 s). Devuelve cómo detenerla.
   */
  replay(id: string, file: TraceFile, label: string, opts: { speed?: number; onEvent?: (ev: TraceEvent) => void; onEnd?: () => void } = {}): () => void {
    const e = this.entry(id);
    e.bySeq.clear();
    e.data = { id, meta: file.meta, events: [], prompt: file.prompt, inventory: file.inventory, config: (file.config as TraceConfig | null | undefined) ?? null, status: "ok", replay: label };
    this.touch(id);
    const events = [...file.events].sort((a, b) => a.seq - b.seq);
    const speed = opts.speed ?? 1;
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const step = () => {
      if (stopped) return;
      if (i >= events.length) {
        opts.onEnd?.();
        return;
      }
      const ev = events[i++];
      this.addEvents(e, [ev]);
      this.touch(id);
      opts.onEvent?.(ev);
      const next = events[i];
      const gap = next ? Math.min(1600, Math.max(120, next.t - ev.t)) / speed : 0;
      timer = setTimeout(step, gap);
    };
    timer = setTimeout(step, 300 / speed);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }

  drop(id: string) {
    this.entries.delete(id);
    this.touch(id);
  }
}

export const traceStore = new TraceStore();

/** La traza de un personaje; la pide al agente la primera vez que alguien la mira. */
export function useTrace(id: string | null): TraceData {
  const data = useSyncExternalStore(
    (fn) => (id ? traceStore.subscribe(id, fn) : () => {}),
    () => traceStore.get(id),
    () => EMPTY,
  );
  useEffect(() => {
    if (id && traceStore.get(id).status === "idle") void traceStore.load(id);
  }, [id]);
  return data;
}

/** "repetición de las 19:42" (+ el día si no es hoy). Nunca se disfraza de lo vivo. */
export function replayLabel(startedAt: string | undefined, now = new Date()): string {
  const d = startedAt ? new Date(startedAt) : null;
  if (!d || Number.isNaN(d.getTime())) return "repetición de una traza grabada";
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? `repetición de las ${hm}` : `repetición de las ${hm} del ${d.getDate()}/${d.getMonth() + 1}`;
}

export type { CliRunConfig };
