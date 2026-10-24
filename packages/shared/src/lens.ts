/**
 * LENTE — las sugerencias de la junta EN VIVO en formato "de mirar", como las
 * AI Cues de unas gafas con pantalla (Even Realities G2). Lógica pura que
 * comparten el agente (evento `cue` del WS) y cada superficie (/lente en la
 * web, Hermes Phone, y unas gafas reales vía Even Hub). Guía:
 * docs/lente-gafas.md.
 *
 * La lente NO es un cerebro nuevo: toda tarjeta sale de una LiveSuggestion de
 * los motores que ya existen. Lo que agrega es la disciplina de mirar:
 * - texto corto (cabe en la pantalla de las gafas: 576 px de ancho útil),
 *   cortado en frase completa, nunca a media palabra;
 * - una tarjeta a la vez, que se va sola (TTL por tipo y por largo);
 * - prioridad: lo que responde a algo que te dijeron pisa a lo demás;
 * - lo atrasado se descarta: en una lente, una tarjeta vieja estorba.
 */
import type { LiveSuggestion, LiveSuggestionKind } from "./types.js";
import { looksLikeSilence, parseClassHelp } from "./english-class.js";
import { OPENING_WHY, parseContribution } from "./team-copilot.js";

/**
 * Tipos de tarjeta (taxonomía de las G2 + los nuestros). Hoy salen
 * sugerencia · respuesta · concepto · dilo-asi; persona, dato-ojo, traducción
 * y punto quedan reservados para las fases 2-3 del plan.
 */
export type LensCueType =
  | "sugerencia"
  | "respuesta"
  | "concepto"
  | "dilo-asi"
  | "persona"
  | "dato-ojo"
  | "traduccion"
  | "punto";

export interface LensCue {
  /** Mismo id que la LiveSuggestion: la versión en streaming y la final son UNA tarjeta. */
  id: string;
  type: LensCueType;
  /** Etiqueta corta sobre el texto (ángulo del aporte, término del concepto…). */
  title?: string;
  /** Texto de mirar, ya recortado (≤ LENS_MAX_CHARS). */
  text: string;
  /** El texto completo cuando hubo que recortar (para el historial). */
  full?: string;
  ttlMs: number;
  /** Mayor = más importante. 6 = te nombraron o te preguntaron · 5 = lo pediste a mano. */
  priority: number;
  /** Responde a algo dirigido a ti: el modo "calma" solo deja pasar éstas. */
  urgent: boolean;
  /** ms desde el inicio de la junta (el momento al que responde). */
  atMs: number;
  /** Aún llegando por streaming: no vence hasta que llegue la final. */
  pending?: boolean;
}

/** Tope de caracteres de una tarjeta (~3 líneas en la pantalla de la G2). */
export const LENS_MAX_CHARS = 90;

/** Cuántas tarjetas esperan detrás de la visible (más = atraso). */
export const LENS_QUEUE_MAX = 2;

/** Una tarjeta en cola más vieja que esto ya no sirve: se descarta. */
export const LENS_STALE_MS = 20_000;

/** Una tarjeta en streaming que no termina en este tiempo se suelta. */
export const LENS_PENDING_MAX_MS = 20_000;

/** Lo mínimo que una tarjeta se deja ver antes de que otra más urgente la pise. */
export const LENS_MIN_VIEW_MS = 1_500;

const BASE_TTL: Record<LensCueType, number> = {
  sugerencia: 8_000,
  respuesta: 10_000,
  concepto: 10_000,
  "dilo-asi": 8_000,
  persona: 12_000,
  "dato-ojo": 10_000,
  traduccion: 15_000,
  punto: 8_000,
};

const BASE_PRIORITY: Record<LensCueType, number> = {
  sugerencia: 2,
  punto: 1,
  concepto: 2,
  "dilo-asi": 2,
  persona: 3,
  respuesta: 4,
  "dato-ojo": 4,
  traduccion: 4,
};

export const LENS_TYPE_LABEL: Record<LensCueType, string> = {
  sugerencia: "Sugerencia",
  respuesta: "Respuesta",
  concepto: "Concepto",
  "dilo-asi": "Dilo así",
  persona: "Persona",
  "dato-ojo": "Ojo",
  traduccion: "Traducción",
  punto: "Te falta",
};

const TYPE_BY_KIND: Record<LiveSuggestionKind, LensCueType> = {
  decir: "sugerencia",
  preguntar: "sugerencia",
  rumbo: "sugerencia",
  aportar: "sugerencia",
  andamio: "sugerencia",
  dato: "respuesta",
  entender: "concepto",
  explicar: "concepto",
  corregir: "dilo-asi",
  pulir: "dilo-asi",
};

/** Etiqueta de las sugerencias del loop estratégico (no traen ángulo). */
const KIND_TITLE: Partial<Record<LiveSuggestionKind, string>> = {
  preguntar: "Pregunta",
  rumbo: "Rumbo",
};

/** Lo que el loop estratégico propone sin que nadie lo pida: cede ante lo demás. */
const LOW_KINDS = new Set<LiveSuggestionKind>(["rumbo"]);

/** Motivos que significan "esto va dirigido a ti". */
const URGENT_WHY = new Set<string>([OPENING_WHY.named, OPENING_WHY.question]);

/**
 * Recorta a `max` caracteres para mirar: primero intenta cerrar en un fin de
 * frase (si deja al menos el 40 %), luego en una pausa (coma, dos puntos,
 * guion), y si no en la última palabra entera con "…". Nunca corta una palabra.
 */
export function glanceText(raw: string, max = LENS_MAX_CHARS): string {
  const t = raw.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const min = Math.floor(max * 0.4);
  const sentence = lastMatchEnd(head, /[.!?](?=\s)/g);
  if (sentence >= min) return head.slice(0, sentence).trim();
  // Deja lugar para el "…".
  const room = t.slice(0, max - 1);
  const pause = lastMatchEnd(room, /[,;:—–](?=\s)/g);
  if (pause >= min) return `${room.slice(0, pause - 1).trim()}…`;
  const space = room.lastIndexOf(" ");
  const cut = space >= min ? room.slice(0, space) : room;
  return `${cut.replace(/[\s,;:—–-]+$/, "")}…`;
}

function lastMatchEnd(s: string, re: RegExp): number {
  let end = -1;
  for (const m of s.matchAll(re)) end = (m.index ?? 0) + m[0].length;
  return end;
}

/** Cuánto se queda una tarjeta: lo del tipo, o más si el texto es largo de leer. */
export function cueTtl(type: LensCueType, text: string): number {
  return Math.max(BASE_TTL[type], 2_000 + text.length * 70);
}

/** Te nombraron o te preguntaron: hay que hablar YA. */
function isDirect(s: LiveSuggestion): boolean {
  if (URGENT_WHY.has(s.why)) return true;
  // La capa rápida de la junta y la clase responden a una pregunta detectada.
  return s.source === "fast" && (s.kind === "decir" || s.kind === "andamio");
}

/** Lo que va en la tarjeta según de qué motor salió: título opcional + cuerpo. */
function cueBody(s: LiveSuggestion): { title?: string; body: string } | null {
  const raw = s.text.trim();
  if (!raw || looksLikeSilence(raw)) return null;
  switch (s.kind) {
    case "aportar": {
      if (s.angle) return { title: s.angle, body: raw };
      const c = parseContribution(raw);
      return c ? { title: c.angle, body: c.text } : null;
    }
    case "entender": {
      // «término — explicación» (conceptText): el término va de título.
      const m = /^(.{2,60}?)\s+[—–]\s+(.+)$/s.exec(raw);
      return m ? { title: m[1].trim(), body: m[2].trim() } : { body: raw };
    }
    case "corregir":
    case "pulir": {
      // «lo que dijiste → mejor»: en la lente solo cabe cómo decirlo.
      const arrow = raw.lastIndexOf("→");
      const better = arrow >= 0 ? raw.slice(arrow + 1).trim() : raw;
      return better ? { body: better } : null;
    }
    case "decir":
    case "andamio":
    case "explicar": {
      // Ayudas de la clase: FRASE / Clave · Arranca · Sube. Sin prefijos (la
      // capa rápida de la junta) parseClassHelp devuelve el texto tal cual.
      const h = parseClassHelp(raw);
      if (h.main) return { body: h.main };
      if (h.start) return { title: "Arranca", body: h.start };
      if (h.keys.length) return { title: "Clave", body: h.keys.join(" · ") };
      return null;
    }
    default:
      return { title: KIND_TITLE[s.kind], body: raw };
  }
}

/**
 * LiveSuggestion → tarjeta de lente. null = no hay nada que mirar (silencio
 * del modelo, texto vacío, aporte sin frase todavía).
 * `pending` = la sugerencia aún llega por streaming (texto parcial).
 */
export function toCue(s: LiveSuggestion, opts: { pending?: boolean } = {}): LensCue | null {
  const body = cueBody(s);
  if (!body) return null;
  const type = TYPE_BY_KIND[s.kind] ?? "sugerencia";
  const flat = body.body.replace(/\s+/g, " ").trim();
  const text = glanceText(flat);
  const direct = isDirect(s);
  const urgent = direct || !!s.manual;
  return {
    id: s.id,
    type,
    ...(body.title ? { title: body.title } : {}),
    text,
    ...(text !== flat ? { full: flat } : {}),
    ttlMs: cueTtl(type, text),
    priority: direct ? 6 : urgent ? 5 : LOW_KINDS.has(s.kind) ? 1 : BASE_PRIORITY[type],
    urgent,
    atMs: s.atMs,
    ...(opts.pending ? { pending: true } : {}),
  };
}

/** Qué deja pasar cada superficie: todo, o solo lo dirigido a ti. */
export type LensLevel = "normal" | "calma";

export function isLensLevel(v: unknown): v is LensLevel {
  return v === "normal" || v === "calma";
}

export function cueAllowed(cue: LensCue, level: LensLevel): boolean {
  return level === "normal" || cue.urgent;
}

// ── La baraja: una tarjeta a la vez ──────────────────────────────────────

interface Shown {
  cue: LensCue;
  shownAt: number;
  /** Cuándo se va (Infinity mientras está pending). */
  until: number;
}

interface Waiting {
  cue: LensCue;
  arrivedAt: number;
}

export interface LensView {
  cue: LensCue | null;
  /** 0..1 de tiempo que le queda a la tarjeta visible (1 = recién llegó; pending = 1). */
  remaining: number;
  /** Tarjetas esperando detrás. */
  queued: number;
}

/**
 * Decide qué tarjeta se ve. Pura, con el reloj inyectado (`now`): la UI llama
 * `push`/`tick`/`next` y pinta `view(now)`.
 *
 * Reglas:
 * - una visible; detrás, a lo sumo LENS_QUEUE_MAX (sale la menos importante y
 *   más vieja);
 * - una más importante pisa a la visible apenas ésta cumple LENS_MIN_VIEW_MS
 *   (al llegar, o en el `tick` si llegó antes de ese mínimo);
 * - el mismo id actualiza en sitio (streaming → final) sin perder el lugar;
 * - lo que esperó más de LENS_STALE_MS se descarta al llegarle el turno.
 */
export class LensDeck {
  private current: Shown | null = null;
  private queue: Waiting[] = [];

  /** Agrega o actualiza. Devuelve true si cambió lo visible. */
  push(cue: LensCue, now: number): boolean {
    if (this.current?.cue.id === cue.id) {
      this.current = {
        cue,
        shownAt: this.current.shownAt,
        until: this.untilFor(cue, now),
      };
      return true;
    }
    const waiting = this.queue.findIndex((w) => w.cue.id === cue.id);
    if (waiting >= 0) {
      this.queue[waiting] = { cue, arrivedAt: this.queue[waiting].arrivedAt };
      return false;
    }
    this.expire(now);
    if (!this.current) {
      this.show(cue, now);
      return true;
    }
    const cur = this.current;
    if (cue.priority > cur.cue.priority && now - cur.shownAt >= LENS_MIN_VIEW_MS) {
      // La pisada no vuelve a la cola: ya se vio, y en una lente lo visto pasa.
      this.show(cue, now);
      return true;
    }
    this.queue.push({ cue, arrivedAt: now });
    this.trimQueue();
    return false;
  }

  /** Quita una tarjeta (sugerencia abortada). Devuelve true si cambió lo visible. */
  remove(id: string, now: number): boolean {
    this.queue = this.queue.filter((w) => w.cue.id !== id);
    if (this.current?.cue.id !== id) return false;
    this.current = null;
    this.advance(now);
    return true;
  }

  /** "Siguiente": suelta la visible y sube la que sigue. */
  next(now: number): void {
    this.current = null;
    this.advance(now);
  }

  /** Avanza el reloj. Devuelve true si cambió lo visible. */
  tick(now: number): boolean {
    const before = this.current?.cue.id ?? null;
    this.expire(now);
    return (this.current?.cue.id ?? null) !== before;
  }

  view(now: number): LensView {
    const c = this.current;
    if (!c) return { cue: null, remaining: 0, queued: this.queue.length };
    const remaining = Number.isFinite(c.until)
      ? Math.max(0, Math.min(1, (c.until - now) / Math.max(1, c.until - c.shownAt)))
      : 1;
    return { cue: c.cue, remaining, queued: this.queue.length };
  }

  clear(): void {
    this.current = null;
    this.queue = [];
  }

  private untilFor(cue: LensCue, now: number): number {
    return cue.pending ? Infinity : now + cue.ttlMs;
  }

  private show(cue: LensCue, now: number): void {
    this.current = { cue, shownAt: now, until: this.untilFor(cue, now) };
  }

  private expire(now: number): void {
    const c = this.current;
    if (!c) return this.advance(now);
    const gone = c.cue.pending ? now - c.shownAt >= LENS_PENDING_MAX_MS : now >= c.until;
    // Una más importante que llegó durante el mínimo de vista no espera a que
    // la visible venza: con TTL de 10 s se quedaba atrás y caducaba en la cola.
    const outranked =
      now - c.shownAt >= LENS_MIN_VIEW_MS &&
      this.queue.some((w) => w.cue.priority > c.cue.priority && now - w.arrivedAt < LENS_STALE_MS);
    if (gone || outranked) {
      this.current = null;
      this.advance(now);
    }
  }

  private advance(now: number): void {
    this.queue = this.queue.filter((w) => now - w.arrivedAt < LENS_STALE_MS);
    if (!this.queue.length) return;
    // La más importante; a igual importancia, la más nueva (lo reciente sirve más).
    let best = 0;
    for (let i = 1; i < this.queue.length; i++) {
      const a = this.queue[i];
      const b = this.queue[best];
      if (a.cue.priority > b.cue.priority || (a.cue.priority === b.cue.priority && a.arrivedAt > b.arrivedAt))
        best = i;
    }
    const [w] = this.queue.splice(best, 1);
    this.show(w.cue, now);
  }

  private trimQueue(): void {
    while (this.queue.length > LENS_QUEUE_MAX) {
      // Sale la menos importante; a igual importancia, la más vieja.
      let worst = 0;
      for (let i = 1; i < this.queue.length; i++) {
        const a = this.queue[i];
        const b = this.queue[worst];
        if (a.cue.priority < b.cue.priority || (a.cue.priority === b.cue.priority && a.arrivedAt < b.arrivedAt))
          worst = i;
      }
      this.queue.splice(worst, 1);
    }
  }
}

// ── Streaming: la tarjeta antes de que termine ──────────────────────────

/** Lo mínimo de texto en streaming para que valga la pena pintarlo. */
export const LENS_STREAM_MIN_CHARS = 12;

/** Cada cuánto, como mucho, sale una versión parcial de la misma tarjeta. */
export const LENS_STREAM_EVERY_MS = 250;

interface LensStream {
  kind: LiveSuggestionKind;
  trigger: string;
  atMs: number;
  text: string;
  lastAt: number;
  lastText: string;
}

/**
 * Convierte el streaming de la capa rápida (start → deltas → done/aborted) en
 * tarjetas `pending` con la misma id que tendrá la final. Vive en el AGENTE,
 * para que cada superficie (web, teléfono, gafas) solo pinte `cue` y nadie
 * reimplemente el parseo parcial. Pura, con el reloj inyectado.
 */
export class LensStreamer {
  private streams = new Map<string, LensStream>();

  start(id: string, kind: LiveSuggestionKind, trigger: string, atMs: number): void {
    this.streams.set(id, { kind, trigger, atMs, text: "", lastAt: -Infinity, lastText: "" });
  }

  /** Suma un delta. Devuelve la tarjeta parcial si toca mandarla ahora. */
  delta(id: string, text: string, now: number): LensCue | null {
    const st = this.streams.get(id);
    if (!st) return null;
    st.text += text;
    if (now - st.lastAt < LENS_STREAM_EVERY_MS) return null;
    if (looksLikeSilence(st.text) || st.text.trim().length < LENS_STREAM_MIN_CHARS) return null;
    // Un aporte llega «ángulo ⏎ frase»: sin el salto todavía es solo el ángulo.
    if (st.kind === "aportar" && !st.text.includes("\n")) return null;
    const cue = toCue(
      { id, kind: st.kind, text: st.text, why: st.trigger, atMs: st.atMs, source: "fast" },
      { pending: true },
    );
    if (!cue || cue.text === st.lastText) return null;
    st.lastAt = now;
    st.lastText = cue.text;
    return cue;
  }

  /** Terminó (done/aborted): la final, si hay, sale por toCue de la sugerencia. */
  end(id: string): void {
    this.streams.delete(id);
  }
}
