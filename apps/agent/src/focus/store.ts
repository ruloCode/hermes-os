import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HERMES_HOME } from "../home.js";

/**
 * Foco (Hermes Phone): el TELÉFONO es el dueño de las sesiones y del uso —
 * tienen que funcionar con la Mac apagada— y aquí llega el resumen, con cola
 * y reintento. Idempotente por id de sesión: reenviar nunca duplica.
 *
 * Lo que se guarda (en ~/.hermes-os/focus/, sin migración, como finance/plan):
 * - sesiones: para qué, minutos planeados/reales/contados, estado y las reglas
 *   que saltaron con lo que eligió el dueño (rule_id → P2: toda intervención
 *   dice qué regla la disparó).
 * - uso: minutos por app y por día. Nunca qué se miró (P3).
 *
 * El check-in del hábito atado lo hace el agente al recibir una sesión que lo
 * gana (`earns_habit`), con la FECHA DE LA SESIÓN (una del martes que sube el
 * miércoles marca el martes), una sola vez, y nunca se deshace: nada resta (P7).
 * Las sesiones de QA (`source: "qa"`) jamás tocan los hábitos reales.
 */

export const FOCUS_DIR = join(HERMES_HOME, "focus");

export type FocusStatus = "completed" | "ended_early";

export interface RuleHit {
  rule_id: string;
  rule_name: string | null;
  at: string;
  choice: string;
}

export interface FocusSessionRecord {
  id: string;
  purpose: string;
  planned_min: number;
  focused_min: number;
  counted_min: number;
  started_at: string;
  ended_at: string | null;
  /** Fecha local (AAAA-MM-DD) de inicio: la del check-in. */
  date: string;
  status: FocusStatus;
  counted: boolean | null;
  habit_id: number | null;
  habit_name: string | null;
  earns_habit: boolean;
  plants: boolean;
  strict: boolean;
  source: string;
  rule_hits: RuleHit[];
  /** Lo pone el agente cuando el check-in quedó hecho (no viene del teléfono). */
  habit_checked: boolean;
  received_at: string;
}

export interface UsageApp {
  package: string;
  label: string | null;
  minutes: number;
}

export interface UsageDay {
  date: string;
  complete: boolean;
  apps: UsageApp[];
}

export interface FocusData {
  sessions: FocusSessionRecord[];
  usage: Record<string, UsageDay>;
}

// ── Validación (lo que manda el teléfono es dato externo) ──────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max = 200): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : null;
const iso = (v: unknown): string | null => {
  const s = str(v, 40);
  return s && !Number.isNaN(Date.parse(s)) ? new Date(s).toISOString() : null;
};

type Incoming = Omit<FocusSessionRecord, "habit_checked" | "received_at">;

export function validateSessions(raw: unknown): { items: Incoming[]; rejected: string[] } {
  const items: Incoming[] = [];
  const rejected: string[] = [];
  for (const [i, r] of (Array.isArray(raw) ? raw : []).entries()) {
    const o = (r ?? {}) as Record<string, unknown>;
    const id = str(o.id, 80);
    const planned = int(o.planned_min, 1, 240);
    const started = iso(o.started_at);
    const date = str(o.date, 10);
    const status = o.status === "completed" || o.status === "ended_early" ? o.status : null;
    if (!id || !planned || !started || !date || !DATE_RE.test(date) || !status) {
      rejected.push(`sesión ${i}: faltan id, planned_min, started_at, date o status válidos`);
      continue;
    }
    const hits = (Array.isArray(o.rule_hits) ? o.rule_hits : []).slice(0, 50).flatMap((h) => {
      const x = (h ?? {}) as Record<string, unknown>;
      const rule_id = str(x.rule_id, 60);
      const at = iso(x.at);
      const choice = str(x.choice, 20);
      return rule_id && at && choice ? [{ rule_id, rule_name: str(x.rule_name, 60), at, choice }] : [];
    });
    items.push({
      id,
      purpose: str(o.purpose, 120) ?? "Foco",
      planned_min: planned,
      focused_min: int(o.focused_min, 0, 240) ?? 0,
      counted_min: int(o.counted_min, 0, 240) ?? 0,
      started_at: started,
      ended_at: iso(o.ended_at),
      date,
      status,
      counted: typeof o.counted === "boolean" ? o.counted : null,
      habit_id: int(o.habit_id, 1, Number.MAX_SAFE_INTEGER),
      habit_name: str(o.habit_name, 80),
      earns_habit: o.earns_habit === true,
      plants: o.plants === true,
      strict: o.strict === true,
      source: str(o.source, 20) ?? "tap",
      rule_hits: hits,
    });
  }
  return { items, rejected };
}

export function validateUsage(date: string, raw: unknown): UsageDay | null {
  if (!DATE_RE.test(date)) return null;
  const o = (raw ?? {}) as Record<string, unknown>;
  const apps = (Array.isArray(o.apps) ? o.apps : []).slice(0, 300).flatMap((a) => {
    const x = (a ?? {}) as Record<string, unknown>;
    const pkg = str(x.package, 200);
    const minutes = int(x.minutes, 0, 1440);
    return pkg && minutes != null ? [{ package: pkg, label: str(x.label, 80), minutes }] : [];
  });
  return { date, complete: o.complete === true, apps };
}

// ── Mezcla idempotente ───────────────────────────────────────────────────

export type MergeStatus = "saved" | "updated" | "unchanged";

/** Lo que llega gana (el dueño pudo decidir "contar" después), salvo lo que pone el agente. */
export function mergeSessions(
  existing: readonly FocusSessionRecord[],
  incoming: readonly Incoming[],
  now = new Date().toISOString(),
): { next: FocusSessionRecord[]; results: { id: string; status: MergeStatus }[] } {
  const byId = new Map(existing.map((s) => [s.id, s]));
  const results: { id: string; status: MergeStatus }[] = [];
  for (const inc of incoming) {
    const prev = byId.get(inc.id);
    if (!prev) {
      byId.set(inc.id, { ...inc, habit_checked: false, received_at: now });
      results.push({ id: inc.id, status: "saved" });
      continue;
    }
    const { habit_checked, received_at, ...prevPhone } = prev;
    if (JSON.stringify(prevPhone) === JSON.stringify(inc)) {
      results.push({ id: inc.id, status: "unchanged" });
      continue;
    }
    byId.set(inc.id, { ...inc, habit_checked, received_at });
    results.push({ id: inc.id, status: "updated" });
  }
  const next = [...byId.values()].sort((a, b) => a.started_at.localeCompare(b.started_at));
  return { next, results };
}

/** Sesiones que deben marcar su hábito y aún no lo hicieron. QA nunca toca hábitos reales. */
export function pendingCheckins(sessions: readonly FocusSessionRecord[]): FocusSessionRecord[] {
  return sessions.filter((s) => s.earns_habit && s.habit_id != null && !s.habit_checked && s.source !== "qa");
}

// ── Resumen ──────────────────────────────────────────────────────────────

export interface FocusSummary {
  week: { from: string; to: string; focus_min: number; sessions: number; by_day: number[] };
  total: { focus_min: number; plants: number; sessions: number };
  /** Días con al menos un hábito cumplido (para el jardín). null = sin datos de hábitos. */
  habit_days: number | null;
  rules_hit: { rule_id: string; rule_name: string | null; times: number; back: number }[];
  usage_days: number;
  last_session: Pick<FocusSessionRecord, "purpose" | "status" | "counted_min" | "planned_min" | "date" | "habit_name"> | null;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function mondayOf(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return addDays(date, -((dow + 6) % 7));
}

export function summarize(data: FocusData, today: string, habitDays: number | null): FocusSummary {
  const from = mondayOf(today);
  const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const inWeek = data.sessions.filter((s) => s.date >= from && s.date <= days[6]);
  const by_day = days.map((d) => inWeek.filter((s) => s.date === d).reduce((a, s) => a + s.counted_min, 0));
  const hits = new Map<string, { rule_id: string; rule_name: string | null; times: number; back: number }>();
  for (const s of inWeek) {
    for (const h of s.rule_hits) {
      const e = hits.get(h.rule_id) ?? { rule_id: h.rule_id, rule_name: h.rule_name, times: 0, back: 0 };
      e.times += 1;
      if (h.choice === "volver") e.back += 1;
      hits.set(h.rule_id, e);
    }
  }
  const last = data.sessions.at(-1);
  return {
    week: { from, to: days[6], focus_min: by_day.reduce((a, b) => a + b, 0), sessions: inWeek.filter((s) => s.counted_min > 0).length, by_day },
    total: {
      focus_min: data.sessions.reduce((a, s) => a + s.counted_min, 0),
      plants: data.sessions.filter((s) => s.plants).length,
      sessions: data.sessions.length,
    },
    habit_days: habitDays,
    rules_hit: [...hits.values()].sort((a, b) => b.times - a.times),
    usage_days: Object.values(data.usage).filter((d) => d.complete).length,
    last_session: last
      ? { purpose: last.purpose, status: last.status, counted_min: last.counted_min, planned_min: last.planned_min, date: last.date, habit_name: last.habit_name }
      : null,
  };
}

/** Una línea narrable (chat, voz) que no culpa: lo hecho, sin conteos acusadores. */
export function summaryLine(s: FocusSummary): string {
  const m = s.week.focus_min;
  const hm = m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
  const parts = [m ? `Esta semana llevas ${hm} de foco en ${s.week.sessions} ${s.week.sessions === 1 ? "sesión" : "sesiones"}.` : "Esta semana aún no hay sesiones de foco."];
  parts.push(`Tu jardín tiene ${s.total.plants} ${s.total.plants === 1 ? "planta" : "plantas"}.`);
  if (s.habit_days != null) parts.push(`${s.habit_days} días con al menos un hábito cumplido.`);
  return parts.join(" ");
}

// ── Disco ────────────────────────────────────────────────────────────────

export interface FocusStore {
  load(): Promise<FocusData>;
  save(d: FocusData): Promise<void>;
}

export function fileFocusStore(dir = FOCUS_DIR): FocusStore {
  const sessionsPath = join(dir, "sessions.json");
  const usagePath = join(dir, "usage.json");
  async function read<T>(p: string, empty: T): Promise<T> {
    try {
      return JSON.parse(await readFile(p, "utf8")) as T;
    } catch {
      return empty;
    }
  }
  async function write(p: string, v: unknown) {
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(v, null, 2) + "\n");
    await rename(tmp, p);
  }
  return {
    async load() {
      const [sessions, usage] = await Promise.all([read<FocusSessionRecord[]>(sessionsPath, []), read<Record<string, UsageDay>>(usagePath, {})]);
      return { sessions: Array.isArray(sessions) ? sessions : [], usage: usage && typeof usage === "object" ? usage : {} };
    },
    async save(d) {
      await Promise.all([write(sessionsPath, d.sessions), write(usagePath, d.usage)]);
    },
  };
}

// ── Ingesta (con el check-in inyectado, para probarla sin Supabase) ──────

export type Checkin = (habitId: number, date: string, note: string) => Promise<boolean>;

let queue: Promise<unknown> = Promise.resolve();
/** Un solo escritor a la vez: dos reintentos del teléfono no se pisan el archivo. */
function serial<T>(f: () => Promise<T>): Promise<T> {
  const run = queue.then(f, f);
  queue = run.catch(() => undefined);
  return run;
}

export function ingestSessions(store: FocusStore, items: Incoming[], checkin: Checkin) {
  return serial(async () => {
    const data = await store.load();
    const { next, results } = mergeSessions(data.sessions, items);
    const checked: { id: string; habit: string | null; date: string }[] = [];
    for (const s of pendingCheckins(next)) {
      const note = `Foco: ${s.purpose} (${s.counted_min} min)`;
      if (await checkin(s.habit_id as number, s.date, note).catch(() => false)) {
        s.habit_checked = true;
        checked.push({ id: s.id, habit: s.habit_name, date: s.date });
      }
    }
    await store.save({ ...data, sessions: next });
    // Cada resultado dice si su hábito YA está marcado: el teléfono solo muestra ✓ con esto
    // (y sigue reintentando mientras no lo esté).
    const byId = new Map(next.map((s) => [s.id, s]));
    return { results: results.map((r) => ({ ...r, habit_checked: byId.get(r.id)?.habit_checked === true })), checked };
  });
}

export function ingestUsage(store: FocusStore, day: UsageDay) {
  return serial(async () => {
    const data = await store.load();
    // Un día completo no lo pisa uno incompleto (el teléfono pudo perder eventos viejos).
    if (data.usage[day.date]?.complete && !day.complete) return { status: "kept" as const };
    data.usage[day.date] = day;
    await store.save(data);
    return { status: "saved" as const };
  });
}
