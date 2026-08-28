/**
 * Lector de uso de Claude Code. Solo servidor.
 * Recorre ~/.claude/projects/(proyecto)/*.jsonl, deduplica los mensajes del
 * asistente y agrega tokens + coste estimado (equivalente a precios de API)
 * por día, modelo y proyecto. Se importa únicamente desde el API route.
 */

import { createReadStream, promises as fs } from "fs";
import readline from "readline";
import os from "os";
import path from "path";

// ── Precios (USD por token). Fuente: tabla de modelos del skill claude-api ──

interface ModelPrice {
  input: number; // por token
  output: number; // por token
}

const M = 1_000_000;

const PRICING: Record<string, ModelPrice> = {
  "claude-opus-5": { input: 5 / M, output: 25 / M },
  "claude-opus-4-8": { input: 5 / M, output: 25 / M },
  "claude-opus-4-7": { input: 5 / M, output: 25 / M },
  "claude-opus-4-6": { input: 5 / M, output: 25 / M },
  "claude-opus-4-5": { input: 5 / M, output: 25 / M },
  "claude-sonnet-5": { input: 3 / M, output: 15 / M },
  "claude-sonnet-4-6": { input: 3 / M, output: 15 / M },
  "claude-sonnet-4-5": { input: 3 / M, output: 15 / M },
  "claude-haiku-4-5": { input: 1 / M, output: 5 / M },
  "claude-fable-5": { input: 10 / M, output: 50 / M },
};

// Multiplicadores de caché relativos a la tarifa de input del modelo.
const CACHE_READ_MULT = 0.1;
const CACHE_WRITE_5M_MULT = 1.25;
const CACHE_WRITE_1H_MULT = 2.0;

function priceFor(model: string): ModelPrice | null {
  if (PRICING[model]) return PRICING[model];
  // Modelos Claude desconocidos → tarifa Opus para no dar coste cero silencioso.
  if (model.startsWith("claude-")) return PRICING["claude-opus-5"];
  return null;
}

function costFor(
  model: string,
  input: number,
  output: number,
  cacheRead: number,
  write1h: number,
  write5m: number,
): number {
  const p = priceFor(model);
  if (!p) return 0;
  return (
    input * p.input +
    output * p.output +
    cacheRead * p.input * CACHE_READ_MULT +
    write5m * p.input * CACHE_WRITE_5M_MULT +
    write1h * p.input * CACHE_WRITE_1H_MULT
  );
}

// ── Tipos públicos ──────────────────────────────────────────────────────

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
  messages: number;
}

export interface DayUsage extends UsageTotals {
  date: string; // YYYY-MM-DD (hora local)
}

export interface ModelUsage extends UsageTotals {
  model: string;
}

export interface ProjectUsage {
  project: string; // etiqueta legible
  raw: string; // nombre del directorio codificado
  totalTokens: number;
  cost: number;
  messages: number;
  sessions: number;
}

export interface ClaudeUsageData {
  available: boolean;
  generatedAt: string; // ISO
  totals: UsageTotals & { sessions: number };
  today: UsageTotals;
  last7Days: UsageTotals;
  last30Days: UsageTotals;
  byDay: DayUsage[]; // ascendente por fecha
  byModel: ModelUsage[]; // descendente por coste
  byProject: ProjectUsage[]; // descendente por coste
  error?: string;
}

// ── Acumuladores internos ───────────────────────────────────────────────

interface Accum {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
  messages: number;
}

function emptyAccum(): Accum {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cost: 0,
    messages: 0,
  };
}

interface RecordDelta {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  cost: number;
}

function add(acc: Accum, d: RecordDelta) {
  acc.inputTokens += d.input;
  acc.outputTokens += d.output;
  acc.cacheCreationTokens += d.cacheCreation;
  acc.cacheReadTokens += d.cacheRead;
  acc.cost += d.cost;
  acc.messages += 1;
}

function mergeAccum(target: Accum, src: Accum) {
  target.inputTokens += src.inputTokens;
  target.outputTokens += src.outputTokens;
  target.cacheCreationTokens += src.cacheCreationTokens;
  target.cacheReadTokens += src.cacheReadTokens;
  target.cost += src.cost;
  target.messages += src.messages;
}

function toTotals(a: Accum): UsageTotals {
  return {
    inputTokens: a.inputTokens,
    outputTokens: a.outputTokens,
    cacheCreationTokens: a.cacheCreationTokens,
    cacheReadTokens: a.cacheReadTokens,
    totalTokens:
      a.inputTokens + a.outputTokens + a.cacheCreationTokens + a.cacheReadTokens,
    cost: a.cost,
    messages: a.messages,
  };
}

// Agregado por archivo, cacheado por mtime+size: al reabrir solo reparsea
// los archivos que cambiaron.
interface FileAgg {
  byDay: Map<string, Accum>;
  byModel: Map<string, Accum>;
  messages: number;
  raw: string; // nombre del directorio del proyecto
}

interface CacheEntry {
  mtimeMs: number;
  size: number;
  agg: FileAgg;
}

// Cache a nivel de módulo: sobrevive entre requests mientras corre el server.
const fileCache = new Map<string, CacheEntry>();

// ── Parsing ─────────────────────────────────────────────────────────────

function toLocalDate(ts: unknown): string | null {
  if (typeof ts !== "string") return null;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function bump(map: Map<string, Accum>, key: string, d: RecordDelta) {
  let acc = map.get(key);
  if (!acc) {
    acc = emptyAccum();
    map.set(key, acc);
  }
  add(acc, d);
}

async function parseFile(filePath: string, raw: string): Promise<FileAgg> {
  const agg: FileAgg = {
    byDay: new Map(),
    byModel: new Map(),
    messages: 0,
    raw,
  };
  const seen = new Set<string>();

  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line) continue;
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // líneas malformadas / parciales
    }
    if (rec.type !== "assistant") continue;

    const msg = rec.message as Record<string, unknown> | undefined;
    if (!msg || typeof msg !== "object") continue;

    const usage = msg.usage as Record<string, unknown> | undefined;
    if (!usage || typeof usage !== "object") continue;

    const model = typeof msg.model === "string" ? msg.model : "unknown";
    if (model === "<synthetic>") continue; // turnos sintéticos no se facturan

    // Deduplicar por id de mensaje + id de request (el streaming puede loguear
    // el mismo mensaje del asistente varias veces dentro de una sesión).
    const msgId = typeof msg.id === "string" ? msg.id : "";
    const reqId = typeof rec.requestId === "string" ? rec.requestId : "";
    if (msgId && reqId) {
      const key = `${msgId}:${reqId}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }

    const input = Number(usage.input_tokens) || 0;
    const output = Number(usage.output_tokens) || 0;
    const cacheRead = Number(usage.cache_read_input_tokens) || 0;
    const cacheCreation = Number(usage.cache_creation_input_tokens) || 0;

    // Separar escritura de caché en 5m vs 1h cuando hay desglose (Claude Code
    // usa caché de 1h); si no, tratar todo como 5m.
    const cc = usage.cache_creation as Record<string, unknown> | undefined;
    const cw1h = cc ? Number(cc.ephemeral_1h_input_tokens) || 0 : 0;
    const cw5m = cc ? Number(cc.ephemeral_5m_input_tokens) || 0 : 0;
    const hasBreakdown = cw1h + cw5m > 0;
    const write1h = hasBreakdown ? cw1h : 0;
    const write5m = hasBreakdown ? cw5m : cacheCreation;

    const cost = costFor(model, input, output, cacheRead, write1h, write5m);

    const delta: RecordDelta = {
      input,
      output,
      cacheCreation,
      cacheRead,
      cost,
    };

    agg.messages += 1;
    bump(agg.byModel, model, delta);

    const date = toLocalDate(rec.timestamp);
    if (date) bump(agg.byDay, date, delta);
  }

  return agg;
}

async function getFileAgg(filePath: string, raw: string): Promise<FileAgg> {
  const stat = await fs.stat(filePath);
  const cached = fileCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.agg;
  }
  const agg = await parseFile(filePath, raw);
  fileCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, agg });
  return agg;
}

// Map con concurrencia acotada: evita abrir cientos de streams a la vez.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

// ── Etiqueta de proyecto ────────────────────────────────────────────────

function friendlyProject(raw: string): string {
  // Los nombres de directorio codifican una ruta absoluta con '/' → '-'.
  // Quitamos un prefijo home "-Users-<user>-" (o "-home-<user>-") y mostramos
  // el resto con barras. Los espacios codificados como '-' no se pueden
  // recuperar con certeza, así que es una etiqueta best-effort.
  let s = raw.replace(/^-(?:Users|home)-[^-]+-+/, "");
  if (!s) s = raw.replace(/^-+/, "");
  return s.replace(/-+/g, "/") || raw;
}

// ── Punto de entrada público ────────────────────────────────────────────

function emptyData(available: boolean, error?: string): ClaudeUsageData {
  const zero = toTotals(emptyAccum());
  return {
    available,
    generatedAt: new Date().toISOString(),
    totals: { ...zero, sessions: 0 },
    today: zero,
    last7Days: zero,
    last30Days: zero,
    byDay: [],
    byModel: [],
    byProject: [],
    error,
  };
}

export async function getClaudeUsage(): Promise<ClaudeUsageData> {
  const root = path.join(os.homedir(), ".claude", "projects");

  let dirents;
  try {
    dirents = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return emptyData(false, "No se encontró ~/.claude/projects");
  }

  // Recolectar cada archivo de sesión con el nombre de su directorio.
  const files: { filePath: string; raw: string }[] = [];
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const raw = dirent.name;
    const dirPath = path.join(root, raw);
    let names: string[];
    try {
      names = await fs.readdir(dirPath);
    } catch {
      continue;
    }
    for (const name of names) {
      if (name.endsWith(".jsonl")) {
        files.push({ filePath: path.join(dirPath, name), raw });
      }
    }
  }

  const perFile = await mapLimit(files, 8, async ({ filePath, raw }) => {
    try {
      return await getFileAgg(filePath, raw);
    } catch {
      return null; // archivo ilegible → saltar
    }
  });

  const byModel = new Map<string, Accum>();
  const byDay = new Map<string, Accum>();
  const byProject = new Map<
    string,
    { acc: Accum; sessions: number; raw: string }
  >();
  let sessions = 0;

  for (const agg of perFile) {
    if (!agg || agg.messages === 0) continue;
    sessions += 1;

    for (const [model, acc] of agg.byModel) {
      let m = byModel.get(model);
      if (!m) {
        m = emptyAccum();
        byModel.set(model, m);
      }
      mergeAccum(m, acc);
    }

    for (const [date, acc] of agg.byDay) {
      let d = byDay.get(date);
      if (!d) {
        d = emptyAccum();
        byDay.set(date, d);
      }
      mergeAccum(d, acc);
    }

    let proj = byProject.get(agg.raw);
    if (!proj) {
      proj = { acc: emptyAccum(), sessions: 0, raw: agg.raw };
      byProject.set(agg.raw, proj);
    }
    proj.sessions += 1;
    for (const acc of agg.byModel.values()) mergeAccum(proj.acc, acc);
  }

  // Los totales son la suma de todos los mensajes contados (vía byModel).
  const totalsAcc = emptyAccum();
  for (const acc of byModel.values()) mergeAccum(totalsAcc, acc);

  // Ventanas temporales sobre días de calendario local.
  const now = new Date();
  const startToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const start7 = startToday - 6 * 86_400_000;
  const start30 = startToday - 29 * 86_400_000;

  const todayAcc = emptyAccum();
  const last7Acc = emptyAccum();
  const last30Acc = emptyAccum();

  const dayList: DayUsage[] = [];
  for (const [date, acc] of byDay) {
    const [y, mo, dd] = date.split("-").map(Number);
    const t = new Date(y, mo - 1, dd).getTime();
    if (t >= startToday) mergeAccum(todayAcc, acc);
    if (t >= start7) mergeAccum(last7Acc, acc);
    if (t >= start30) mergeAccum(last30Acc, acc);
    dayList.push({ date, ...toTotals(acc) });
  }
  dayList.sort((a, b) => a.date.localeCompare(b.date));

  const modelList: ModelUsage[] = Array.from(byModel.entries())
    .map(([model, acc]) => ({ model, ...toTotals(acc) }))
    .sort((a, b) => b.cost - a.cost);

  const projectList: ProjectUsage[] = Array.from(byProject.values())
    .map(({ acc, sessions: s, raw }) => {
      const t = toTotals(acc);
      return {
        project: friendlyProject(raw),
        raw,
        totalTokens: t.totalTokens,
        cost: t.cost,
        messages: t.messages,
        sessions: s,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  return {
    available: true,
    generatedAt: new Date().toISOString(),
    totals: { ...toTotals(totalsAcc), sessions },
    today: toTotals(todayAcc),
    last7Days: toTotals(last7Acc),
    last30Days: toTotals(last30Acc),
    byDay: dayList,
    byModel: modelList,
    byProject: projectList,
  };
}
