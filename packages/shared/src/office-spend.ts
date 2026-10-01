// Gasto de tokens de la Oficina de agentes: agregación PURA (sin fs ni red) de
// lo que el agente guarda en disco. El agente lee los archivos y llama a estas
// funciones; los tests las corren con datos sintéticos.
//
// Tres fuentes, cada una con su alcance (todo número visible sale de una):
//   · Total del día: `.data/usage/AAAA-MM-DD.json` (usage.ts). Existe desde
//     antes de esta función: es la serie de 7/30 días.
//   · Registro por run: `.data/usage/runs-AAAA-MM-DD.jsonl`, una línea por run
//     terminado con su proyecto y su `modelUsage`. Nació con el tablero de
//     gasto: el desglose por proyecto y por modelo existe solo desde ese día, y
//     el tablero lo dice (`since`).
//   · Personajes vivos: el costo llega SOLO en el evento `result` del CLI, al
//     terminar. Mientras corre, lo real son los tokens que reporta cada mensaje
//     de la API: se muestran esos y el costo "al terminar".

import type { RunTokenUsage } from "./types.js";

export const ZERO_TOKENS: RunTokenUsage = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

/** Lo que gastó un modelo dentro de un run (del `modelUsage` del CLI). */
export interface SpendModel {
  model: string;
  costUsd: number;
  tokens: RunTokenUsage;
}

/** Una línea del registro: un run (claude -p) o una tarea del SDK que terminó. */
export interface SpendEntry {
  /** ISO de cuando terminó. */
  ts: string;
  id: string;
  source: "run" | "task";
  project: string;
  title: string;
  /** null si el CLI no reportó costo (un run cancelado antes del result). */
  costUsd: number | null;
  tokens: RunTokenUsage | null;
  models: SpendModel[];
  durationMs?: number;
  status: "done" | "error";
}

/** El total de un día (archivo diario de usage.ts). */
export interface SpendDay {
  day: string;
  costUsd: number;
  runs: number;
  tokens?: RunTokenUsage;
}

/** Gasto de un personaje vivo (OfficeWorker.spend). */
export interface WorkerSpend {
  /** Solo existe al terminar (evento result). */
  costUsd?: number;
  /** Tokens hasta ahora: sumados por mensaje de la API mientras corre, los del result al terminar. */
  tokens?: RunTokenUsage;
  /** Modelos que usó (del result). */
  models?: string[];
  /** true = cifra final del result; false = parcial, en curso. */
  final: boolean;
}

export interface SpendRow {
  key: string;
  costUsd: number;
  runs: number;
  tokens: RunTokenUsage;
}

export interface SpendLiveRow {
  id: string;
  name: string;
  project: string;
  status: string;
  spend: WorkerSpend | null;
}

export interface SpendSeriesPoint {
  day: string;
  costUsd: number;
  runs: number;
  /** false = antes del primer archivo de esta máquina: no hay dato, no es un cero. */
  known: boolean;
}

/** Respuesta de GET /office/spend. Cada bloque dice de dónde sale. */
export interface OfficeSpend {
  fetchedAt: string;
  today: { day: string; costUsd: number; runs: number; tokens: RunTokenUsage | null };
  /** Personajes de la Oficina (vivos o en su gracia de 3 min), con lo que llevan. */
  live: SpendLiveRow[];
  byProject: { today: SpendRow[]; week: SpendRow[] };
  /** null si ningún run del registro trajo modelUsage. */
  byModel: { today: SpendRow[]; week: SpendRow[] } | null;
  /** Primer día del registro por run (desglose por proyecto/modelo); null = vacío. */
  since: string | null;
  /** Serie diaria de los últimos 30 días (archivos diarios). Vacía = sin histórico en esta máquina. */
  series: SpendSeriesPoint[];
  /** Runs recientes del registro (los últimos 12), para la lista "por agente". */
  recent: SpendEntry[];
}

/** Día LOCAL (AAAA-MM-DD): en Bogotá el gasto de hoy no rota a las 7 p. m. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Suma redondeada a 4 decimales (los costos del CLI traen ruido de flotante). */
function addUsd(a: number, b: number): number {
  return Math.round((a + b) * 10000) / 10000;
}

export function addTokens(a: RunTokenUsage, b: RunTokenUsage | null | undefined): RunTokenUsage {
  if (!b) return { ...a };
  return {
    inputTokens: a.inputTokens + (b.inputTokens || 0),
    outputTokens: a.outputTokens + (b.outputTokens || 0),
    cacheCreationTokens: a.cacheCreationTokens + (b.cacheCreationTokens || 0),
    cacheReadTokens: a.cacheReadTokens + (b.cacheReadTokens || 0),
  };
}

export function totalTokens(t: RunTokenUsage | null | undefined): number {
  return t ? t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens : 0;
}

/** Los tokens del `usage` de la API (snake_case) o null si no vienen. */
export function tokensFromApiUsage(u: unknown): RunTokenUsage | null {
  if (!u || typeof u !== "object") return null;
  const o = u as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : 0);
  return {
    inputTokens: n("input_tokens"),
    outputTokens: n("output_tokens"),
    cacheCreationTokens: n("cache_creation_input_tokens"),
    cacheReadTokens: n("cache_read_input_tokens"),
  };
}

/**
 * El `modelUsage` del evento result (CLI o SDK): `{ "<modelo>": { inputTokens,
 * outputTokens, cacheReadInputTokens, cacheCreationInputTokens, costUSD } }`.
 * Lo que no tenga la forma se ignora; ordenado por costo.
 */
export function parseModelUsage(raw: unknown): SpendModel[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const out: SpendModel[] = [];
  for (const [model, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const n = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : 0);
    if (typeof o.costUSD !== "number") continue;
    out.push({
      model,
      costUsd: n("costUSD"),
      tokens: {
        inputTokens: n("inputTokens"),
        outputTokens: n("outputTokens"),
        cacheCreationTokens: n("cacheCreationInputTokens"),
        cacheReadTokens: n("cacheReadInputTokens"),
      },
    });
  }
  return out.sort((a, b) => b.costUsd - a.costUsd);
}

/** Nombre corto del modelo para la UI: "claude-sonnet-4-5-20250929" → "sonnet-4-5". */
export function shortModel(model: string): string {
  const m = /claude-([a-z]+(?:-\d+)*)/i.exec(model);
  if (!m) return model;
  return m[1].replace(/-\d{8}$/, "");
}

/**
 * Lo que trae un mensaje `assistant` del stream: su id y su usage. El CLI
 * repite el mismo mensaje una vez por bloque de contenido, con el mismo usage:
 * se suma una vez por id (`seen`). Devuelve los tokens nuevos o null.
 */
export function assistantUsageDelta(ev: unknown, seen: Set<string>): RunTokenUsage | null {
  if (!ev || typeof ev !== "object") return null;
  const msg = (ev as { message?: { id?: unknown; usage?: unknown } }).message;
  if (!msg || typeof msg.id !== "string" || seen.has(msg.id)) return null;
  const t = tokensFromApiUsage(msg.usage);
  if (!t) return null;
  seen.add(msg.id);
  return t;
}

/** Valida una línea del registro (lo que no tiene la forma se descarta). */
export function parseSpendEntry(line: string): SpendEntry | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const e = v as Partial<SpendEntry>;
  if (typeof e.ts !== "string" || typeof e.id !== "string" || typeof e.project !== "string") return null;
  if (e.source !== "run" && e.source !== "task") return null;
  return {
    ts: e.ts,
    id: e.id,
    source: e.source,
    project: e.project,
    title: typeof e.title === "string" ? e.title : "",
    costUsd: typeof e.costUsd === "number" && Number.isFinite(e.costUsd) ? e.costUsd : null,
    tokens: e.tokens && typeof e.tokens === "object" ? addTokens(ZERO_TOKENS, e.tokens) : null,
    models: Array.isArray(e.models) ? e.models.filter((m) => m && typeof m.model === "string" && typeof m.costUsd === "number") : [],
    durationMs: typeof e.durationMs === "number" ? e.durationMs : undefined,
    status: e.status === "error" ? "error" : "done",
  };
}

function groupRows(entries: SpendEntry[], keyOf: (e: SpendEntry) => { key: string; costUsd: number | null; tokens: RunTokenUsage | null }[]): SpendRow[] {
  const map = new Map<string, SpendRow>();
  for (const e of entries) {
    for (const k of keyOf(e)) {
      const row = map.get(k.key) ?? { key: k.key, costUsd: 0, runs: 0, tokens: { ...ZERO_TOKENS } };
      row.costUsd = addUsd(row.costUsd, k.costUsd ?? 0);
      row.runs += 1;
      row.tokens = addTokens(row.tokens, k.tokens);
      map.set(k.key, row);
    }
  }
  return [...map.values()].sort((a, b) => b.costUsd - a.costUsd || b.runs - a.runs || a.key.localeCompare(b.key));
}

/** Gasto por proyecto de las entradas dadas (más caro primero). */
export function spendByProject(entries: SpendEntry[]): SpendRow[] {
  return groupRows(entries, (e) => [{ key: e.project, costUsd: e.costUsd, tokens: e.tokens }]);
}

/** Gasto por modelo (solo las entradas que trajeron modelUsage); un run con dos modelos cuenta en ambos. */
export function spendByModel(entries: SpendEntry[]): SpendRow[] {
  return groupRows(
    entries.filter((e) => e.models.length),
    (e) => e.models.map((m) => ({ key: shortModel(m.model), costUsd: m.costUsd, tokens: m.tokens })),
  );
}

/** Días `[hoy − n + 1, hoy]` en orden. */
export function lastDays(today: string, n: number): string[] {
  const [y, m, d] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(localDay(new Date(y, m - 1, d - i)));
  return out;
}

/**
 * Serie diaria de los últimos `n` días. Un día sin archivo DESPUÉS del primero
 * que existe en la máquina (`firstDay`, aunque quede fuera de la ventana) es un
 * cero real (no hubo runs); antes no hay dato (`known:false`) y la UI no lo
 * pinta como cero.
 */
export function spendSeries(days: SpendDay[], today: string, n: number, firstDay?: string | null): SpendSeriesPoint[] {
  const first = firstDay ?? days.map((d) => d.day).sort()[0];
  if (!first) return [];
  const byDay = new Map(days.map((d) => [d.day, d]));
  return lastDays(today, n).map((day) => {
    const d = byDay.get(day);
    return { day, costUsd: d ? d.costUsd : 0, runs: d ? d.runs : 0, known: day >= first };
  });
}

/** Arma la respuesta de GET /office/spend con lo que el agente leyó del disco y de la oficina. */
export function buildOfficeSpend(input: {
  now: Date;
  today: SpendDay | null;
  days: SpendDay[];
  /** Primer archivo diario de la máquina (aunque sea de hace meses). */
  firstDay?: string | null;
  entries: SpendEntry[];
  live: SpendLiveRow[];
}): OfficeSpend {
  const today = localDay(input.now);
  const weekFrom = lastDays(today, 7)[0];
  const ofToday = input.entries.filter((e) => localDay(new Date(e.ts)) === today);
  const ofWeek = input.entries.filter((e) => localDay(new Date(e.ts)) >= weekFrom);
  const modelsToday = spendByModel(ofToday);
  const modelsWeek = spendByModel(ofWeek);
  const since = input.entries.length ? localDay(new Date(input.entries.map((e) => e.ts).sort()[0])) : null;
  return {
    fetchedAt: input.now.toISOString(),
    today: {
      day: today,
      costUsd: input.today?.costUsd ?? 0,
      runs: input.today?.runs ?? 0,
      tokens: input.today?.tokens ?? null,
    },
    live: input.live,
    byProject: { today: spendByProject(ofToday), week: spendByProject(ofWeek) },
    byModel: modelsToday.length || modelsWeek.length ? { today: modelsToday, week: modelsWeek } : null,
    since,
    series: spendSeries(input.days, today, 30, input.firstDay),
    recent: [...input.entries].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 12),
  };
}

/** "$1.23"; lo que no llega a un centavo se dice así (no se redondea a $0.00). */
export function formatUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n > 0 && n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

/** 950 · 12.4k · 3.1M */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

// ── Uso del plan (la suscripción de claude.ai, lo que muestra /usage) ──────
// Fuente: el control `get_usage` del CLI (`usage_EXPERIMENTAL…` del Agent
// SDK), que lee el endpoint de uso de claude.ai con la sesión del usuario. NO
// llama al modelo: cero tokens. Con API key, Bedrock o Vertex no hay límites
// de plan y `available` es false: el tablero lo dice en vez de inventar barras.

export interface PlanWindow {
  /** five_hour · seven_day · seven_day_opus · seven_day_sonnet · model:<nombre>. */
  key: string;
  label: string;
  /** Aclaración (p. ej. "Límite semanal independiente para Fable"). */
  note?: string;
  /** % usado, 0-100. */
  utilization: number;
  /** ISO de cuándo se restablece (null si el servidor no lo dijo). */
  resetsAt: string | null;
}

export interface PlanUsage {
  available: boolean;
  /** pro · max · team · enterprise (null con API key). */
  subscription: string | null;
  windows: PlanWindow[];
  /** Por qué no hay datos (sin plan, el CLI falló…). */
  error?: string;
  fetchedAt: string;
}

const PLAN_WINDOWS: [string, string, string?][] = [
  ["five_hour", "Sesión actual"],
  ["seven_day", "Esta semana"],
  ["seven_day_opus", "Opus esta semana", "Límite semanal independiente para Opus"],
  ["seven_day_sonnet", "Sonnet esta semana", "Límite semanal independiente para Sonnet"],
];

/** Traduce la respuesta de `get_usage` a filas de barra. Lo que no trae % no se muestra. */
export function parsePlanUsage(raw: unknown, now: Date): PlanUsage {
  const fetchedAt = now.toISOString();
  if (!raw || typeof raw !== "object") return { available: false, subscription: null, windows: [], error: "respuesta vacía", fetchedAt };
  const r = raw as { subscription_type?: unknown; rate_limits_available?: unknown; rate_limits?: unknown };
  const subscription = typeof r.subscription_type === "string" ? r.subscription_type : null;
  const limits = r.rate_limits && typeof r.rate_limits === "object" ? (r.rate_limits as Record<string, unknown>) : null;
  if (r.rate_limits_available !== true || !limits) {
    return { available: false, subscription, windows: [], error: "Esta sesión no tiene límites de plan (API key o proveedor externo).", fetchedAt };
  }
  const windows: PlanWindow[] = [];
  const win = (v: unknown): { utilization: number; resetsAt: string | null } | null => {
    if (!v || typeof v !== "object") return null;
    const o = v as { utilization?: unknown; resets_at?: unknown };
    if (typeof o.utilization !== "number" || !Number.isFinite(o.utilization)) return null;
    return { utilization: Math.max(0, Math.min(100, o.utilization)), resetsAt: typeof o.resets_at === "string" ? o.resets_at : null };
  };
  for (const [key, label, note] of PLAN_WINDOWS) {
    const w = win(limits[key]);
    if (w) windows.push({ key, label, note, ...w });
  }
  if (Array.isArray(limits.model_scoped)) {
    for (const m of limits.model_scoped) {
      const name = m && typeof m === "object" && typeof (m as { display_name?: unknown }).display_name === "string" ? (m as { display_name: string }).display_name : null;
      const w = name ? win(m) : null;
      if (name && w && !windows.some((x) => x.key === `model:${name}`)) {
        windows.push({ key: `model:${name}`, label: `${name} esta semana`, note: `Límite semanal independiente para ${name}`, ...w });
      }
    }
  }
  return { available: true, subscription, windows, fetchedAt };
}

const DAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const DAYS_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/**
 * "Se restablece el jue, 12:20 a.m." (hora local del navegador), como lo dice
 * claude.ai: la sesión con el día corto y los límites semanales con el largo.
 * Hoy mismo dice "hoy"; sin fecha, null.
 */
export function formatPlanReset(iso: string | null, now: Date, long = false): string | null {
  if (!iso) return null;
  // El servidor manda 05:19:59.88: se lee 12:20, como en claude.ai.
  const d = new Date(Math.round(Date.parse(iso) / 60_000) * 60_000);
  if (Number.isNaN(d.getTime())) return null;
  const h = d.getHours();
  const time = `${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "a.m." : "p.m."}`;
  const same = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (same) return `Se restablece hoy, ${time}`;
  return `Se restablece el ${(long ? DAYS_LONG : DAYS_SHORT)[d.getDay()]}, ${time}`;
}
