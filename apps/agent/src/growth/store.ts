import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DEFAULT_GROWTH_SETTINGS,
  type CallKind,
  parseGrowthSettings,
  parsePlanWhen,
  type GrowthPlan,
  type GrowthSettings,
  type Initiative,
  type PlanMeasure,
} from "@hermes/shared";
import { HERMES_HOME } from "../home.js";

/**
 * Lo del compañero en disco (~/.hermes-os/growth/, sin migración, como focus/ y
 * finance/plan): planes, el registro de iniciativas y los ajustes. La META vive
 * en la tabla `goals` (una sola idea de meta para todo Hermes).
 *
 * Vive en UNA máquina (la Mac): con un agente de ensayo encima del mismo disco,
 * su job está apagado (HERMES_JOBS=off) y no escribe aquí por su cuenta.
 */

export const GROWTH_DIR = join(HERMES_HOME, "growth");

/** El registro guarda ~4 meses: lo que mira la llamada y el retiro de apoyos. */
const KEEP_DAYS = 120;

/** Una llamada semanal: cuándo se armó su contexto, cómo terminó y su acta. */
export interface CallRecord {
  id: string;
  at: string;
  outcome: "pending" | "answered" | "declined" | "missed" | "failed";
  reason?: string;
  duration_s?: number;
  acta_md?: string;
  closed_at?: string;
  kind?: CallKind;
}

export interface GrowthData {
  plans: GrowthPlan[];
  initiatives: Initiative[];
  settings: GrowthSettings;
  calls: CallRecord[];
}

export interface GrowthStore {
  load(): Promise<GrowthData>;
  save(d: GrowthData): Promise<void>;
}

/** Valida un plan (lo que llega del chat o del teléfono es dato externo). */
export function parsePlan(raw: unknown): GrowthPlan | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  const id = typeof o.id === "string" && o.id.trim() ? o.id.trim().slice(0, 80) : null;
  const goal_id = typeof o.goal_id === "number" && Number.isInteger(o.goal_id) && o.goal_id > 0 ? o.goal_id : null;
  const words = typeof o.words === "string" ? o.words.trim().slice(0, 200) : "";
  const when = parsePlanWhen(o.when);
  const m = (o.measure ?? {}) as Record<string, unknown>;
  const measure: PlanMeasure | null =
    m.kind === "habit" && typeof m.habit_id === "number" && Number.isInteger(m.habit_id)
      ? { kind: "habit", habit_id: m.habit_id, habit_name: typeof m.habit_name === "string" ? m.habit_name.slice(0, 80) : null }
      : m.kind === "self_report" || o.measure === undefined
        ? { kind: "self_report" }
        : null;
  if (!id || !goal_id || !words || !when || !measure) return null;
  const num = (v: unknown, min: number, max: number, dflt: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : dflt;
  return {
    id,
    goal_id,
    words,
    when,
    measure,
    checkin_after_min: num(o.checkin_after_min, 0, 600, when.kind === "weekly" ? 60 : 15),
    window_min: num(o.window_min, 15, 720, 180),
    status: o.status === "paused" ? "paused" : "active",
    created_at: typeof o.created_at === "string" && !Number.isNaN(Date.parse(o.created_at)) ? o.created_at : new Date().toISOString(),
  };
}

function parseInitiatives(raw: unknown): Initiative[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (x): x is Initiative =>
      !!x &&
      typeof x === "object" &&
      typeof (x as Initiative).id === "string" &&
      typeof (x as Initiative).plan_id === "string" &&
      typeof (x as Initiative).date === "string" &&
      typeof (x as Initiative).at === "string",
  );
}

/** Olvida lo de hace más de KEEP_DAYS. */
export function pruneInitiatives(list: readonly Initiative[], now: Date): Initiative[] {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  return list.filter((i) => i.date >= cutoff);
}

export function fileGrowthStore(dir = GROWTH_DIR): GrowthStore {
  const path = (f: string) => join(dir, f);
  async function read(f: string): Promise<unknown> {
    try {
      return JSON.parse(await readFile(path(f), "utf8"));
    } catch {
      return null;
    }
  }
  async function write(f: string, v: unknown) {
    const p = path(f);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(v, null, 2) + "\n");
    await rename(tmp, p);
  }
  return {
    async load() {
      const [plans, initiatives, settings, calls] = await Promise.all([
        read("plans.json"),
        read("initiatives.json"),
        read("settings.json"),
        read("calls.json"),
      ]);
      return {
        plans: (Array.isArray(plans) ? plans : []).map(parsePlan).filter((p): p is GrowthPlan => p !== null),
        initiatives: parseInitiatives(initiatives),
        settings: settings ? parseGrowthSettings(settings) : { ...DEFAULT_GROWTH_SETTINGS },
        calls: Array.isArray(calls) ? (calls as CallRecord[]).filter((c) => c && typeof c.id === "string") : [],
      };
    },
    async save(d) {
      await Promise.all([
        write("plans.json", d.plans),
        write("initiatives.json", d.initiatives),
        write("settings.json", d.settings),
        write("calls.json", d.calls.slice(-60)),
      ]);
    },
  };
}

export function memGrowthStore(initial?: Partial<GrowthData>): GrowthStore & { data: GrowthData } {
  const s = {
    data: {
      plans: initial?.plans ?? [],
      initiatives: initial?.initiatives ?? [],
      settings: initial?.settings ?? { ...DEFAULT_GROWTH_SETTINGS },
      calls: initial?.calls ?? [],
    } as GrowthData,
    async load() {
      return structuredClone(s.data);
    },
    async save(d: GrowthData) {
      s.data = structuredClone(d);
    },
  };
  return s;
}

/** Un solo escritor a la vez: el barrido y una respuesta del teléfono no se pisan. */
export function serialStore(store: GrowthStore) {
  let queue: Promise<unknown> = Promise.resolve();
  return function mutate<T>(fn: (d: GrowthData) => T | Promise<T>): Promise<T> {
    const run = queue.then(async () => {
      const d = await store.load();
      const out = await fn(d);
      await store.save(d);
      return out;
    });
    queue = run.catch(() => undefined);
    return run;
  };
}
