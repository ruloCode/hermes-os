// RuloView — detección de presencia con la señal WiFi entre un teléfono (router)
// y tres nodos ESP32. El servidor es RuView (fork ruloCode/RuView, rama de
// "rulostark") corriendo en Docker; el agente lo arranca y reenvía su stream.
// Aquí vive la lógica PURA que comparten agente y dashboard: el recorte del
// mensaje del servidor, la métrica de perturbación por enlace (portada de
// rulostark-web/observatory/link-metric.js) y el estado del Escenario 2D.
//
// Sin timers ni performance.now(): quien la usa pasa `now` (ms) y llama a
// `tick(now)` cada 250 ms. Así los tests corren con un reloj sintético.

import {
  isFaceLandmark,
  POSE,
  POSE_LANDMARK_COUNT,
  PUPPET_HEAD,
  PUPPET_POINT_COUNT,
  type PuppetFrame,
} from "./sala-puppet.js";

export type RuNodeId = 1 | 2 | 3;
export const RU_NODE_IDS: readonly RuNodeId[] = [1, 2, 3];

/** Estado de la sala según el servidor (room_inference.classification). */
export type RuRoomState = "absent" | "present_still" | "present_moving";

export interface RuNodeFeature {
  node_id: number;
  stale: boolean;
  frame_rate_hz: number;
  rssi_dbm: number | null;
  motion_band_power: number;
  motion_level: string | null;
}

export interface RuNodeReading {
  node_id: number;
  rssi_dbm: number | null;
  /** Contador de tramas del nodo: el servidor repite la última lectura de todos. */
  seq: number | null;
}

/** Lo que el dashboard usa de un `sensing_update` (el agente recorta el resto). */
export interface RuSensing {
  source: string | null;
  room: string | null;
  room_confidence: number;
  motion_band_power: number;
  node_features: RuNodeFeature[];
  nodes: RuNodeReading[];
}

export interface RuEdgeVitals {
  node_id: number;
  motion_energy: number;
}

/** Cómo le llega el stream al agente: WS del servidor, polling de respaldo o nada. */
export type RuStreamState = "ws" | "poll" | "down";

export type RuStreamMsg =
  | { type: "sensing"; d: RuSensing }
  | { type: "vitals"; v: RuEdgeVitals }
  | { type: "link"; state: RuStreamState; error?: string };

export type RuCsiSource = "simulated" | "esp32";

/** GET /ruloview/status — todo dato es medido en el momento, nada supuesto. */
export interface RuloviewStatus {
  enabled: boolean;
  /** Carpeta del clon de RuView (RUVIEW_PATH); null si no está configurada. */
  path: string | null;
  pathOk: boolean;
  /** URL del servidor vista desde el agente. */
  url: string;
  hasToken: boolean;
  /** Fuente configurada en docker/.env (lo que el servidor usará al arrancar). */
  source: RuCsiSource | null;
  docker: { daemon: boolean; container: boolean; relay: boolean; image: boolean };
  /** El servidor responde /health. */
  serverUp: boolean;
  /** Fuente que REPORTA el servidor en su última lectura. */
  liveSource: string | null;
  /** Arranque/parada en curso (lo lanza el agente, tarda: colima + imagen). */
  busy: "starting" | "stopping" | null;
  /** Últimas líneas del arranque/parada para que la UI cuente qué pasa. */
  log: string[];
  error: string | null;
  /** Páginas originales del servidor (solo abren en la máquina del agente). */
  pages: { observatory: string; escenario: string; sala3d: string } | null;
}

// ── Recorte del mensaje del servidor ────────────────────────────────────

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** Recorta un `sensing_update` (o /api/v1/sensing/latest) a lo que usa la UI. */
export function trimSensing(raw: unknown): RuSensing | null {
  const d = obj(raw);
  if (!Array.isArray(d.node_features) && !Array.isArray(d.nodes) && !d.room_inference && !d.features) return null;
  const ri = obj(d.room_inference);
  const cls = obj(d.classification);
  const feat = obj(d.features);
  const room =
    (typeof ri.classification === "string" && ri.classification) ||
    (typeof cls.motion_level === "string" && cls.motion_level) ||
    null;
  const node_features: RuNodeFeature[] = [];
  for (const f of Array.isArray(d.node_features) ? d.node_features : []) {
    const n = obj(f);
    const id = num(n.node_id);
    if (id == null) continue;
    node_features.push({
      node_id: id,
      stale: Boolean(n.stale),
      frame_rate_hz: num(n.frame_rate_hz) ?? 0,
      rssi_dbm: num(n.rssi_dbm),
      motion_band_power: num(obj(n.features).motion_band_power) ?? 0,
      motion_level: (obj(n.classification).motion_level as string | undefined) ?? null,
    });
  }
  const nodes: RuNodeReading[] = [];
  for (const r of Array.isArray(d.nodes) ? d.nodes : []) {
    const n = obj(r);
    const id = num(n.node_id);
    if (id == null) continue;
    nodes.push({ node_id: id, rssi_dbm: num(n.rssi_dbm), seq: num(obj(n.sync).csi_fps_samples) });
  }
  return {
    source: typeof d.source === "string" ? d.source : null,
    room,
    room_confidence: num(ri.confidence) ?? 0,
    motion_band_power: num(feat.motion_band_power) ?? 0,
    node_features,
    nodes,
  };
}

export function trimEdgeVitals(raw: unknown): RuEdgeVitals | null {
  const d = obj(raw);
  const id = num(d.node_id);
  if (id == null) return null;
  return { node_id: id, motion_energy: num(d.motion_energy) ?? 0 };
}

/** Lee CSI_SOURCE / RUVIEW_API_TOKEN de un docker/.env (formato KEY=valor). */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trimStart().startsWith("#")) continue;
    out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

/** Reescribe (o agrega) una clave del .env sin tocar las demás líneas. */
export function setDotenvKey(text: string, key: string, value: string): string {
  const lines = text.split(/\r?\n/);
  const re = new RegExp(`^\\s*${key}\\s*=`);
  const i = lines.findIndex((l) => re.test(l));
  if (i >= 0) lines[i] = `${key}=${value}`;
  else {
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
    lines.push(`${key}=${value}`, "");
  }
  return lines.join("\n");
}

// ── Geometría de la sala (Sala 3D) ──────────────────────────────────────
// Sala ~11 m (x) × 15 m (z) × 3 m. x: izquierda(-) → derecha(+);
// z: escenario(-) → puerta(+). "T" = el teléfono que hace de router.

export interface RuPoint {
  x: number;
  y: number;
  z: number;
}
export type RuPosKey = "T" | "1" | "2" | "3";
export type RuPositions = Record<RuPosKey, RuPoint>;

export const RU_DEFAULT_POS: RuPositions = {
  T: { x: -0.2, y: 0.8, z: -0.6 },
  "1": { x: -4.6, y: 0.05, z: -0.4 },
  "2": { x: 5.0, y: 0.05, z: -2.8 },
  "3": { x: -0.2, y: 0.45, z: -6.6 },
};

/** Tarima (recuadro del escenario) en coordenadas de la sala. */
export const RU_STAGE = { x0: -4.0, x1: 4.0, z0: -7.5, z1: -3.6 } as const;
/** Margen (m): el enlace es sensible en una franja alrededor de la línea. */
const FRESNEL = 0.3;

export interface RuStageGeo {
  /** Fracción del recorrido teléfono→nodo que cae sobre la tarima. */
  w: number;
  /** Punto medio de ese tramo. */
  mid: { x: number; z: number } | null;
}

export interface RuZone {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Qué fracción de cada enlace router→nodo cae sobre la zona (y su punto medio). */
export function stageGeometry(pos: RuPositions, zone: RuZone = RU_STAGE): Record<RuNodeId, RuStageGeo> {
  const out = {} as Record<RuNodeId, RuStageGeo>;
  const N = 60;
  for (const id of RU_NODE_IDS) {
    const a = pos.T;
    const b = pos[String(id) as RuPosKey];
    let n = 0;
    let mx = 0;
    let mz = 0;
    for (let k = 0; k <= N; k++) {
      const x = a.x + ((b.x - a.x) * k) / N;
      const z = a.z + ((b.z - a.z) * k) / N;
      if (
        x >= zone.x0 - FRESNEL &&
        x <= zone.x1 + FRESNEL &&
        z >= zone.z0 - FRESNEL &&
        z <= zone.z1 + FRESNEL
      ) {
        n++;
        mx += x;
        mz += z;
      }
    }
    out[id] = { w: n / (N + 1), mid: n ? { x: mx / n, z: mz / n } : null };
  }
  return out;
}

// ── Métrica de perturbación por enlace ──────────────────────────────────
// Cada 250 ms y por enlace, con el RSSI de cada trama NUEVA:
//  - zVar:  variabilidad del RSSI en 2 s (alguien moviéndose cruza el enlace)
//  - zJump: salto del RSSI medio de los últimos 0,75 s frente a los 2–6 s previos
//  - zDrop: caída del RSSI medio (un cuerpo quieto bloquea el enlace)
//  - zM:    energía de movimiento del firmware (ruidosa: pesa 0,75)
// contra la referencia de "escenario vacío" (calibración de 20 s) y la línea
// base móvil de los últimos 2 min, que NO aprende mientras el enlace está
// activo (salvo que lleve 20 s activo). Se usa el mayor z × sensibilidad.

export interface RuKV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}
const MEMORY_KV = (): RuKV => {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
};

export const RU_POS_KEY = "ruloview-pos-v1";
export const RU_REF_KEY = "ruloview-ref-v1";
export const RU_SENS_KEY = "ruloview-sens-v1";
export const RU_SENS_DEFAULT = 1;
export const RU_SENS_MIN = 0.5;
export const RU_SENS_MAX = 2;

const KEEP_MS = 6000;
const WIN_MS = 2000;
const SHORT_MS = 750;
const HIST_LEN = 60; // 2 min de ventanas de 2 s que no se solapan
const HIST_MIN = 10; // 20 s de calentamiento antes de usar la línea base móvil
const RELEARN_MS = 20000;
export const RU_LIVE_MS = 3000;

const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const quantile = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor((s.length - 1) * q)] : 0;
};
const mad = (a: number[], m: number) => median(a.map((x) => Math.abs(x - m))) * 1.4826;
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const std = (a: number[]) => {
  if (a.length < 3) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
};
const zscore = (v: number, hist: number[]) => {
  if (hist.length < 20) return 0;
  const m = median(hist);
  return (v - m) / Math.max(mad(hist, m), 0.5);
};
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

interface RefNode {
  mean: number;
  meanMad: number;
  sdMed: number;
  sdMad: number;
}
export interface RuReference {
  /** Hora local de la captura (es-CO, HH:MM). */
  at: string;
  nodes: Partial<Record<RuNodeId, RefNode>>;
}

export interface RuLinkDebug {
  m: number;
  sd: number;
  jump: number;
  zVar: number;
  zJump: number;
  zDrop: number;
  zM: number;
  z: number;
  ref: "vacío" | "móvil";
  n: number;
}

export interface RuLinkState {
  /** Perturbación 0..1 (sube rápido, baja despacio). */
  d: number;
  /** Enlace activo con histéresis (0,35 sostenido 250 ms · <0,15 durante 1,5 s). */
  on: boolean;
  fps: number;
  rssiNow: number | null;
  stale: boolean;
  dbg: RuLinkDebug | null;
}

interface LinkInternal extends RuLinkState {
  rssi: [number, number][];
  me: number[];
  hist: [number, number, number][];
  seq: number | null;
  tickN: number;
  onSince: number | null;
  hiSince: number | null;
  loSince: number | null;
}

export interface RuStageState {
  /** Algún enlace cruza la tarima (si no, no hay medición de la tarima). */
  available: boolean;
  score: number;
  on: boolean;
  link: RuNodeId | null;
  mid: { x: number; z: number } | null;
}

export class LinkMetric {
  readonly nodes: Record<RuNodeId, LinkInternal>;
  readonly stage: RuStageState & { hiSince: number | null; loSince: number | null };
  lastOk = 0;
  sens: number;
  pos!: RuPositions;
  zone: RuZone;
  stageGeo!: Record<RuNodeId, RuStageGeo>;
  calib: { until: number; samples: Partial<Record<RuNodeId, [number, number][]>> } | null = null;
  onCalibrated: ((ref: RuReference) => void) | null = null;
  private store: RuKV;

  constructor(opts: { pos?: RuPositions; zone?: RuZone; store?: RuKV } = {}) {
    this.store = opts.store ?? MEMORY_KV();
    this.zone = opts.zone ?? RU_STAGE;
    const blank = (): LinkInternal => ({
      d: 0,
      on: false,
      fps: 0,
      rssiNow: null,
      stale: true,
      dbg: null,
      rssi: [],
      me: [],
      hist: [],
      seq: null,
      tickN: 0,
      onSince: null,
      hiSince: null,
      loSince: null,
    });
    this.nodes = { 1: blank(), 2: blank(), 3: blank() };
    this.sens = Number(this.store.getItem(RU_SENS_KEY)) || RU_SENS_DEFAULT;
    this.stage = { available: false, score: 0, on: false, link: null, mid: null, hiSince: null, loSince: null };
    this.setPos(opts.pos ?? readPositions(this.store));
  }

  get ref(): RuReference | null {
    try {
      return JSON.parse(this.store.getItem(RU_REF_KEY) || "null") as RuReference | null;
    } catch {
      return null;
    }
  }

  setPos(pos: RuPositions, zone: RuZone = this.zone) {
    this.pos = pos;
    this.zone = zone;
    this.stageGeo = stageGeometry(pos, zone);
  }

  setSensitivity(v: number): number {
    this.sens = Math.round(Math.max(RU_SENS_MIN, Math.min(RU_SENS_MAX, v)) * 4) / 4;
    this.store.setItem(RU_SENS_KEY, String(this.sens));
    return this.sens;
  }

  onSensing(d: RuSensing, now: number) {
    for (const n of d.nodes) {
      const s = this.nodes[n.node_id as RuNodeId];
      if (!s || n.rssi_dbm == null) continue;
      s.rssiNow = n.rssi_dbm;
      // cada mensaje repite el último RSSI de todos los nodos: solo cuenta la trama nueva
      if (n.seq != null && n.seq === s.seq) continue;
      s.seq = n.seq;
      s.rssi.push([now, n.rssi_dbm]);
      while (s.rssi.length && now - s.rssi[0][0] > KEEP_MS) s.rssi.shift();
    }
    for (const f of d.node_features) {
      const s = this.nodes[f.node_id as RuNodeId];
      if (!s) continue;
      s.fps = f.frame_rate_hz;
      s.stale = f.stale;
    }
    this.lastOk = now;
  }

  onEdgeVitals(v: RuEdgeVitals) {
    const s = this.nodes[v.node_id as RuNodeId];
    if (!s) return;
    s.me.push(v.motion_energy);
    if (s.me.length > 120) s.me.shift();
  }

  startCalibration(now: number, ms = 20000) {
    this.calib = { until: now + ms, samples: {} };
  }
  clearReference() {
    this.store.removeItem(RU_REF_KEY);
  }

  private finishCalibration(date: Date) {
    const nodes: RuReference["nodes"] = {};
    for (const id of RU_NODE_IDS) {
      const a = this.calib?.samples[id] ?? [];
      if (a.length < 20) continue;
      const ms = a.map((x) => x[0]);
      const ss = a.map((x) => x[1]);
      const mM = median(ms);
      const sM = median(ss);
      nodes[id] = { mean: mM, meanMad: mad(ms, mM), sdMed: sM, sdMad: mad(ss, sM) };
    }
    const ref: RuReference = {
      at: date.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }),
      nodes,
    };
    this.store.setItem(RU_REF_KEY, JSON.stringify(ref));
    this.calib = null;
    this.onCalibrated?.(ref);
  }

  /** Recalcula cada enlace y la tarima. Llamar cada ~250 ms. */
  tick(now: number, date: Date = new Date()) {
    const REF = this.ref;
    for (const id of RU_NODE_IDS) {
      const s = this.nodes[id];
      const win = s.rssi.filter((x) => now - x[0] <= WIN_MS).map((x) => x[1]);
      if (win.length < 5) {
        s.d *= 0.8;
        if (s.d < 0.15) s.on = false;
        continue;
      }
      const m = mean(win);
      const sd = std(win);
      const short = s.rssi.filter((x) => now - x[0] <= SHORT_MS).map((x) => x[1]);
      const prev = s.rssi.filter((x) => now - x[0] > WIN_MS).map((x) => x[1]);
      const jump = short.length >= 3 && prev.length >= 10 ? Math.abs(mean(short) - mean(prev)) : 0;
      if (this.calib) (this.calib.samples[id] ||= []).push([m, sd]);

      // línea base móvil: congelada mientras el enlace está activo (salvo que lleve 20 s activo)
      const learning = !s.on || (s.onSince != null && now - s.onSince > RELEARN_MS);
      s.tickN++;
      if (learning && s.tickN % 8 === 0) {
        s.hist.push([m, sd, jump]);
        if (s.hist.length > HIST_LEN) s.hist.shift();
      }
      let base: (RefNode & { jMed: number; jMad: number }) | null = null;
      if (s.hist.length >= HIST_MIN) {
        const old = s.hist.slice(0, -1);
        const ms = old.map((x) => x[0]);
        const ss = old.map((x) => x[1]);
        const js = old.map((x) => x[2]);
        const mM = median(ms);
        const sQ = quantile(ss, 0.3);
        const jM = median(js);
        base = { mean: mM, meanMad: mad(ms, mM), sdMed: sQ, sdMad: mad(ss, sQ), jMed: jM, jMad: mad(js, jM) };
      }
      const r = REF?.nodes?.[id];
      // con referencia de escenario vacío: se usa la más sensible de las dos
      const sdMed = r && base ? Math.min(r.sdMed, base.sdMed) : (r ?? base)?.sdMed;
      const sdMad = r && base ? Math.min(r.sdMad, base.sdMad) : (r ?? base)?.sdMad;
      const ref = r ?? base;

      let zVar = 0;
      let zDrop = 0;
      let zJump = 0;
      if (ref && sdMed != null && sdMad != null) {
        zVar = (sd - sdMed) / Math.max(sdMad, 0.25);
        zDrop = (ref.mean - m) / Math.max(ref.meanMad, 0.7);
      }
      if (base) zJump = (jump - base.jMed) / Math.max(base.jMad, 0.5);
      const zM = s.me.length > 20 ? zscore(Math.max(...s.me.slice(-2)), s.me.slice(0, -2)) : 0;
      const z = Math.max(zVar, zDrop, zJump, 0.75 * zM) * this.sens;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      s.dbg = {
        m: Math.round(m * 10) / 10,
        sd: r2(sd),
        jump: r2(jump),
        zVar: r2(zVar),
        zJump: r2(zJump),
        zDrop: r2(zDrop),
        zM: r2(zM),
        z: r2(z),
        ref: r ? "vacío" : "móvil",
        n: win.length,
      };

      // sube rápido y baja despacio
      const target = clamp01((z - 1.5) / 2);
      s.d += (target - s.d) * (target > s.d ? 0.5 : 0.2);
      if (s.d > 0.35) {
        s.hiSince ??= now;
        s.loSince = null;
        if (!s.on && now - s.hiSince >= 250) {
          s.on = true;
          s.onSince = now;
        }
      } else if (s.d < 0.15) {
        s.loSince ??= now;
        s.hiSince = null;
        if (now - s.loSince > 1500) {
          s.on = false;
          s.onSince = null;
        }
      }
      if (s.stale) {
        s.on = false;
        s.onSince = null;
      }
    }
    this.tickStage(now);
    if (this.calib && now > this.calib.until) this.finishCalibration(date);
  }

  // Actividad en la tarima = el enlace más perturbado entre los que la cruzan
  // (un enlace corto sobre la tarima pesa menos).
  private tickStage(now: number) {
    const G = this.stageGeo;
    const st = this.stage;
    let any = false;
    let score = 0;
    let best: RuNodeId | null = null;
    let bestV = -1;
    for (const id of RU_NODE_IDS) {
      const w = G[id].w;
      const n = this.nodes[id];
      if (w <= 0.02 || n.stale) continue;
      any = true;
      const v = n.d * Math.min(1, 0.5 + w * 2);
      if (v > score) score = v;
      if (w * (0.2 + n.d) > bestV) {
        bestV = w * (0.2 + n.d);
        best = id;
      }
    }
    st.available = any;
    st.score = any ? score : 0;
    st.link = best;
    st.mid = best ? G[best].mid : null;
    if (st.score > 0.3) {
      st.hiSince ??= now;
      st.loSince = null;
      if (now - st.hiSince >= 250) st.on = true;
    } else if (st.score < 0.15) {
      st.loSince ??= now;
      st.hiSince = null;
      if (now - st.loSince > 1500) st.on = false;
    }
    if (!st.available) st.on = false;
  }

  live(now: number) {
    return this.lastOk > 0 && now - this.lastOk < RU_LIVE_MS;
  }
  activeLinks(): RuNodeId[] {
    return RU_NODE_IDS.filter((id) => this.nodes[id].on);
  }
}

export function readPositions(store: RuKV): RuPositions {
  try {
    const p = JSON.parse(store.getItem(RU_POS_KEY) || "null") as RuPositions | null;
    if (p && (["T", "1", "2", "3"] as const).every((k) => p[k] && Number.isFinite(p[k].x) && Number.isFinite(p[k].z)))
      return p;
  } catch {
    /* posiciones corruptas: se usan las de fábrica */
  }
  return structuredClone(RU_DEFAULT_POS);
}

// ── Escenario 2D: estado de la sala con histéresis ──────────────────────
// Un estado nuevo debe sostenerse 0,8 s antes de mostrarse. La barra de cada
// nodo se normaliza contra el máximo reciente COMPARTIDO (mínimo 8) para que
// los tres se comparen entre sí. La silueta se inclina hacia el nodo que
// registra más perturbación (`lean`, -0,5..0,5).

/** Posición de cada nodo en el piso del Escenario: u izquierda→derecha, v fondo→frente. */
export const RU_ESCENARIO_NODES: Record<RuNodeId, { u: number; v: number; hgt: number }> = {
  1: { u: 0.07, v: 0.93, hgt: 0.03 },
  2: { u: 0.8, v: 0.42, hgt: 0.09 },
  3: { u: 0.4, v: 0.27, hgt: 0.09 },
};

export const RU_ROOM_TEXT: Record<RuRoomState, string> = {
  absent: "Sala vacía",
  present_still: "Hay presencia quieta en la sala",
  present_moving: "Hay movimiento en la sala",
};

export interface RuEscenarioNode {
  v: number;
  norm: number;
  fps: number;
  rssi: number | null;
  stale: boolean;
}

export class EscenarioState {
  room = "absent";
  shown = "absent";
  conf = 0;
  motion = 0;
  lean = 0;
  scale = 8;
  /** Fuente distinta de esp32 (p.ej. "simulated"): la UI lo dice siempre. */
  sourceWarn: string | null = null;
  nodes: Partial<Record<RuNodeId, RuEscenarioNode>> = {};
  private pending: string | null = null;
  private pendingSince = 0;

  ingest(d: RuSensing, now: number) {
    const room = d.room ?? "absent";
    this.conf = d.room_confidence;
    this.sourceWarn = d.source !== "esp32" ? (d.source ?? "desconocida") : null;
    if (room !== this.shown) {
      if (this.pending !== room) {
        this.pending = room;
        this.pendingSince = now;
      } else if (now - this.pendingSince > 800) {
        this.shown = room;
        this.pending = null;
      }
    } else this.pending = null;
    this.room = room;

    const maxNow = Math.max(0, ...d.node_features.map((n) => n.motion_band_power));
    this.scale = Math.max(8, maxNow, this.scale * 0.998);
    let wsum = 0;
    let lean = 0;
    for (const n of d.node_features) {
      const id = n.node_id as RuNodeId;
      const v = n.motion_band_power;
      this.nodes[id] = {
        v,
        norm: Math.min(v / this.scale, 1),
        fps: n.frame_rate_hz,
        rssi: n.rssi_dbm,
        stale: n.stale,
      };
      const pos = RU_ESCENARIO_NODES[id];
      if (!n.stale && pos) {
        wsum += v;
        lean += v * (pos.u - 0.5);
      }
    }
    this.lean = wsum > 0 ? lean / wsum : 0;
    this.motion = Math.min(d.motion_band_power / 12, 1);
  }
}

/** Correlación de Pearson de pares [x, y]; null si no hay datos o varianza. */
export function pearson(p: [number, number][]): number | null {
  const n = p.length;
  if (n < 50) return null;
  const mx = p.reduce((s, x) => s + x[0], 0) / n;
  const my = p.reduce((s, x) => s + x[1], 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const [x, y] of p) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  if (sxx < 1e-4 || syy < 1e-4) return null;
  return sxy / Math.sqrt(sxx * syy);
}

// ── El cuarto (config del humano, ~/.hermes-os/ruloview/room.json) ──────
// Dónde está cada cosa en metros. x: pared izquierda → derecha; z: pared del
// fondo (0) → frente; y: altura. Nada de esto vive en el código: cada quien
// describe SU cuarto. Sin archivo se usa un cuarto vacío de 4×4 m.

export interface RuFurniture {
  name: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Altura de la cara de arriba. */
  h: number;
  /** Altura de la cara de abajo (0 = apoyado en el piso). */
  y0?: number;
  kind?: "mueble" | "cama" | "pantalla" | "planta" | "ventana";
}

export interface RuRoom {
  name: string;
  size: { w: number; d: number; h: number };
  furniture: RuFurniture[];
  /** Router (T) y nodos 1-3. */
  nodes: RuPositions;
  /** Zona de captura: donde los enlaces se miden como "actividad en la zona". */
  zone: RuZone;
  /** Dónde se dibuja el esqueleto de la cámara (punto en el piso) y hacia dónde mira la persona. */
  anchor: { x: number; z: number };
  /** Cámara maestra: posición + hacia dónde mira (yaw 0 = hacia +z, el frente; pitch + = arriba) y FOV horizontal. */
  camera?: RuCamera;
  /** Escaneo 3D del cuarto (room.glb junto al room.json) y cómo se alineó a estos ejes. */
  scan?: RuScan;
  /** Etiqueta de cada nodo (dónde está pegado). */
  labels?: Partial<Record<RuPosKey, string>>;
}

export interface RuCamera extends RuPoint {
  /** Grados. 0 = mira hacia +z (el frente del cuarto); 90 = hacia +x. */
  yaw: number;
  /** Grados. Positivo = mira hacia arriba. */
  pitch: number;
  /** FOV horizontal en grados (webcam 16:9 típica ≈ 70). */
  hfov: number;
}

export interface RuScan {
  file: string;
  /** rotation.y (grados, convención three.js) que deja las paredes del escaneo alineadas a x/z. */
  yaw: number;
  /** Traslado DESPUÉS del giro: piso en y=0 y la esquina (x0, z0) en el origen. */
  offset: RuPoint;
  scale: number;
  bytes: number;
  at: string;
}

export const RU_EMPTY_ROOM: RuRoom = {
  name: "Cuarto",
  size: { w: 4, d: 4, h: 2.5 },
  furniture: [],
  nodes: {
    T: { x: 3.7, y: 0.8, z: 0.3 },
    "1": { x: 0.3, y: 1.8, z: 0.3 },
    "2": { x: 0.3, y: 1.0, z: 3.7 },
    "3": { x: 3.7, y: 0.4, z: 3.7 },
  },
  zone: { x0: 1, x1: 3, z0: 1, z1: 3 },
  anchor: { x: 2, z: 2 },
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Valida un room.json; devuelve el cuarto o el motivo exacto de por qué no sirve. */
export function parseRoom(raw: unknown): { ok: true; room: RuRoom } | { ok: false; error: string } {
  const r = obj(raw);
  const size = obj(r.size);
  if (!finite(size.w) || !finite(size.d) || !finite(size.h) || size.w <= 0 || size.d <= 0 || size.h <= 0)
    return { ok: false, error: "size necesita w, d y h positivos (metros)" };
  const nodes = obj(r.nodes);
  const pos = {} as RuPositions;
  for (const k of ["T", "1", "2", "3"] as const) {
    const n = obj(nodes[k]);
    if (!finite(n.x) || !finite(n.y) || !finite(n.z)) return { ok: false, error: `nodes.${k} necesita x, y, z` };
    pos[k] = { x: n.x, y: n.y, z: n.z };
  }
  const z = obj(r.zone);
  if (![z.x0, z.x1, z.z0, z.z1].every(finite) || (z.x0 as number) >= (z.x1 as number) || (z.z0 as number) >= (z.z1 as number))
    return { ok: false, error: "zone necesita x0 < x1 y z0 < z1" };
  const a = obj(r.anchor);
  if (!finite(a.x) || !finite(a.z)) return { ok: false, error: "anchor necesita x, z" };
  const furniture: RuFurniture[] = [];
  for (const [i, f] of (Array.isArray(r.furniture) ? r.furniture : []).entries()) {
    const m = obj(f);
    if (![m.x0, m.x1, m.z0, m.z1, m.h].every(finite)) return { ok: false, error: `furniture[${i}] necesita x0, x1, z0, z1, h` };
    furniture.push({
      name: typeof m.name === "string" ? m.name : `mueble ${i + 1}`,
      x0: m.x0 as number,
      x1: m.x1 as number,
      z0: m.z0 as number,
      z1: m.z1 as number,
      h: m.h as number,
      y0: finite(m.y0) ? m.y0 : 0,
      kind: (["mueble", "cama", "pantalla", "planta", "ventana"] as const).find((k) => k === m.kind) ?? "mueble",
    });
  }
  const cam = obj(r.camera);
  const sc = obj(r.scan);
  const off = obj(sc.offset);
  const scan: RuScan | undefined =
    typeof sc.file === "string" && finite(sc.yaw) && finite(off.x) && finite(off.y) && finite(off.z)
      ? {
          file: sc.file,
          yaw: sc.yaw,
          offset: { x: off.x, y: off.y, z: off.z },
          scale: finite(sc.scale) && sc.scale > 0 ? sc.scale : 1,
          bytes: finite(sc.bytes) ? sc.bytes : 0,
          at: typeof sc.at === "string" ? sc.at : "",
        }
      : undefined;
  const labels: RuRoom["labels"] = {};
  for (const [k, v] of Object.entries(obj(r.labels))) if (typeof v === "string" && ["T", "1", "2", "3"].includes(k)) labels[k as RuPosKey] = v;
  return {
    ok: true,
    room: {
      name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : "Cuarto",
      size: { w: size.w, d: size.d, h: size.h },
      furniture,
      nodes: pos,
      zone: { x0: z.x0 as number, x1: z.x1 as number, z0: z.z0 as number, z1: z.z1 as number },
      anchor: { x: a.x, z: a.z },
      camera:
        finite(cam.x) && finite(cam.y) && finite(cam.z)
          ? {
              x: cam.x,
              y: cam.y,
              z: cam.z,
              yaw: finite(cam.yaw) ? cam.yaw : 180,
              pitch: finite(cam.pitch) ? cam.pitch : 0,
              hfov: finite(cam.hfov) && cam.hfov > 10 && cam.hfov < 170 ? cam.hfov : 70,
            }
          : undefined,
      scan,
      labels,
    },
  };
}

// ── Alineación del escaneo ──────────────────────────────────────────────
// Un escaneo del celular llega con ejes arbitrarios en el plano: las paredes
// pueden estar giradas cualquier ángulo. Las paredes son las superficies
// grandes con normal HORIZONTAL; sus normales, dobladas módulo 90°, se apilan
// en un ángulo. Se usa la media circular (ángulo ×4, que identifica θ con
// θ+90°) ponderada por área: con paredes claras da su giro; sin paredes (ruido
// horizontal escaso) devuelve 0 en vez de inventar un giro.

/** [nx, nz, área] de cada triángulo (normal en el plano XZ, sin normalizar). */
export type RuNormalSample = [number, number, number];

/**
 * Grados en (−45, 45] a aplicar como `rotation.y` (convención de three.js: un
 * vector a θ queda a θ − α) para alinear las paredes del escaneo a x/z.
 */
export function dominantYaw(samples: RuNormalSample[]): number {
  let sx = 0;
  let sy = 0;
  let total = 0;
  for (const [nx, nz, area] of samples) {
    const len = Math.hypot(nx, nz);
    if (len < 0.85 || area <= 0) continue; // solo superficies casi verticales (paredes, frentes)
    const a = Math.atan2(nz, nx) * 4;
    sx += Math.cos(a) * area;
    sy += Math.sin(a) * area;
    total += area;
  }
  if (total <= 0 || Math.hypot(sx, sy) / total < 0.2) return 0;
  const theta = Math.atan2(sy, sx) / 4; // giro de las paredes, en (−45°, 45°]
  return Math.round(((theta * 180) / Math.PI) * 100) / 100;
}

// ── Cámara maestra → posición real en el cuarto ─────────────────────────
// MediaPipe da los worldLandmarks en metros pero CENTRADOS en la cadera: dicen
// la pose, no dónde está la persona. Con el modelo pinhole de la cámara se
// ubica: la dirección sale del punto 2D de la cadera y el FOV; la distancia, de
// comparar el largo REAL del torso (metros, world landmarks) con su largo en
// píxeles (d = f · L / l). Aproxima un torso de frente a la cámara; de lado
// subestima la distancia — por eso la UI lo llama "posición estimada".

export interface RuVec3 {
  x: number;
  y: number;
  z: number;
}

interface Lm {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/** Ejes de la cámara en el cuarto: hacia dónde mira (f), su derecha (r) y su arriba (u). */
export function cameraBasis(cam: RuCamera): { f: RuVec3; r: RuVec3; u: RuVec3 } {
  const yaw = (cam.yaw * Math.PI) / 180;
  const pitch = (cam.pitch * Math.PI) / 180;
  const f = { x: Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
  // r = f × arriba; mirando a +z con y arriba, la derecha es −x
  let r = { x: -f.z, y: 0, z: f.x };
  const rl = Math.hypot(r.x, r.z) || 1;
  r = { x: r.x / rl, y: 0, z: r.z / rl };
  // u = r × f
  const u = { x: r.y * f.z - r.z * f.y, y: r.z * f.x - r.x * f.z, z: r.x * f.y - r.y * f.x };
  return { f, r, u };
}

export interface RuBodyInRoom {
  /** 33 puntos de MediaPipe en coordenadas del cuarto. */
  points: RuVec3[];
  /** Centro de la cadera en el cuarto. */
  hip: RuVec3;
  /** Distancia estimada cámara → cadera (m). */
  distance: number;
}

/**
 * Ubica el cuerpo en el cuarto. `image` son los landmarks 2D normalizados (0..1),
 * `video` el tamaño del cuadro. null si no se ven hombros y caderas.
 */
export function cameraToRoom(
  world: Lm[],
  image: Lm[],
  video: { width: number; height: number },
  cam: RuCamera,
  minVisibility = 0.5,
): RuBodyInRoom | null {
  const LS = 11, RS = 12, LH = 23, RH = 24;
  for (const i of [LS, RS, LH, RH]) {
    if (!world[i] || !image[i] || (image[i].visibility ?? 1) < minVisibility) return null;
  }
  const W = video.width;
  const H = video.height;
  if (!(W > 0 && H > 0)) return null;
  const fx = W / 2 / Math.tan(((cam.hfov * Math.PI) / 180) / 2);
  const d3 = (a: Lm, b: Lm) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const d2 = (a: Lm, b: Lm) => Math.hypot((a.x - b.x) * W, (a.y - b.y) * H);
  const real = (d3(world[LS], world[LH]) + d3(world[RS], world[RH])) / 2;
  const pix = (d2(image[LS], image[LH]) + d2(image[RS], image[RH])) / 2;
  if (real < 0.15 || pix < 4) return null;
  // f·L/l es la PROFUNDIDAD sobre el eje óptico (Z), no la distancia por el rayo.
  const depth = (fx * real) / pix;

  const { f, r, u } = cameraBasis(cam);
  const hu = ((image[LH].x + image[RH].x) / 2) * W;
  const hv = ((image[LH].y + image[RH].y) / 2) * H;
  const xn = (hu - W / 2) / fx;
  const yn = -(hv - H / 2) / fx;
  // (xn, yn) = (X/Z, Y/Z): el punto es cam + Z·(f + xn·r + yn·u), sin normalizar.
  const dir = { x: f.x + xn * r.x + yn * u.x, y: f.y + xn * r.y + yn * u.y, z: f.z + xn * r.z + yn * u.z };
  const hip = { x: cam.x + dir.x * depth, y: cam.y + dir.y * depth, z: cam.z + dir.z * depth };
  const distance = depth * Math.hypot(dir.x, dir.y, dir.z);
  // world landmarks: x a la derecha de la imagen, y hacia abajo, z lejos de la cámara → ejes de la cámara
  const points = world.map((p) => ({
    x: hip.x + r.x * p.x - u.x * p.y + f.x * p.z,
    y: hip.y + r.y * p.x - u.y * p.y + f.y * p.z,
    z: hip.z + r.z * p.x - u.z * p.y + f.z * p.z,
  }));
  return { points, hip, distance };
}

/**
 * Frame de la marioneta (34 puntos: 33 + cabeza virtual) desde puntos YA en el
 * cuarto. Misma regla que `puppetFrame` de la Sala: lo que el modelo no ve
 * (visibility baja) no se dibuja, la cara no se dibuja (la cabeza es una
 * esfera) y la cabeza es la media de las orejas visibles o, sin orejas, la nariz.
 */
export function roomPuppetFrame(points: RuVec3[], world: Lm[], minVisibility = 0.5): PuppetFrame {
  const out: RuVec3[] = new Array(PUPPET_POINT_COUNT);
  const visible: boolean[] = new Array(PUPPET_POINT_COUNT).fill(false);
  for (let i = 0; i < POSE_LANDMARK_COUNT; i++) {
    out[i] = points[i] ?? { x: 0, y: 0, z: 0 };
    visible[i] = Boolean(points[i]) && (world[i]?.visibility ?? 1) >= minVisibility && !isFaceLandmark(i);
  }
  const ears = [POSE.LEFT_EAR, POSE.RIGHT_EAR].filter((i) => points[i] && (world[i]?.visibility ?? 1) >= minVisibility);
  if (ears.length) {
    const acc = { x: 0, y: 0, z: 0 };
    for (const i of ears) {
      acc.x += points[i].x;
      acc.y += points[i].y;
      acc.z += points[i].z;
    }
    out[PUPPET_HEAD] = { x: acc.x / ears.length, y: acc.y / ears.length, z: acc.z / ears.length };
    visible[PUPPET_HEAD] = true;
  } else if (points[POSE.NOSE] && (world[POSE.NOSE]?.visibility ?? 1) >= minVisibility) {
    out[PUPPET_HEAD] = points[POSE.NOSE];
    visible[PUPPET_HEAD] = true;
  } else out[PUPPET_HEAD] = { x: 0, y: 0, z: 0 };
  return { points: out, visible };
}
