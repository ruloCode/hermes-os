import { evolutionStage, type EvolutionMetric, type EvolutionMetrics, type EvolutionResult } from "@hermes/shared";
import { supabase } from "../supabase.js";
import { listSkills } from "../learning/skills.js";

/**
 * GET /evolution: las métricas REALES de la relación con el dueño y la etapa
 * que salen de ellas (la lógica de etapas es pura, en shared/evolution.ts).
 *
 * Cada métrica se pide aparte (Promise.allSettled): una fuente caída se
 * reporta como null con el motivo en `sources` y cuenta como 0 para la etapa
 * — nunca se rellena con un número inventado. Cache de 60 s (como
 * knowledgeStats): el teléfono la pide en cada home.
 */

export interface EvolutionReport extends EvolutionResult {
  metrics: Record<EvolutionMetric, number | null>;
  /** ISO de la primera interacción real (memoria o mensaje más antiguo); null si no hay. */
  since: string | null;
  /** De dónde sale cada número, o por qué falta. */
  sources: Record<EvolutionMetric, string>;
}

const TTL_MS = 60_000;
let cache: { at: number; report: EvolutionReport } | null = null;

const NO_DB = "Supabase no configurado (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)";

function db() {
  if (!supabase) throw new Error(NO_DB);
  return supabase;
}

/** Conteo exacto (head) que FALLA si la consulta falla — un 0 silencioso mentiría. */
async function headCount(table: string, filters: [string, string][] = []): Promise<number> {
  let q = db().from(table).select("*", { count: "exact", head: true });
  for (const [col, val] of filters) q = q.eq(col, val);
  const { count, error } = await q;
  if (error) throw new Error(`${table}: ${error.message}`);
  return count ?? 0;
}

/** Valor más antiguo de una columna de fecha (null si la tabla está vacía). */
async function earliest(table: string, col: string): Promise<string | null> {
  const { data, error } = await db()
    .from(table)
    .select(col)
    .not(col, "is", null)
    .order(col, { ascending: true })
    .limit(1);
  if (error) throw new Error(`${table}.${col}: ${error.message}`);
  const row = (data?.[0] ?? null) as unknown as Record<string, unknown> | null;
  return row && typeof row[col] === "string" ? (row[col] as string) : null;
}

const DAY_MS = 86_400_000;

/** Días completos entre `sinceIso` y `now` (piso; nunca negativo). */
export function daysBetween(sinceIso: string, now: Date): number {
  const t = Date.parse(sinceIso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

async function computeSince(): Promise<string | null> {
  // conversation_messages.ts es la hora REAL del mensaje (created_at es la hora
  // de inserción: el backfill la pone en el día que corrió).
  const [mem, msg] = await Promise.all([earliest("memories", "created_at"), earliest("conversation_messages", "ts")]);
  const dates = [mem, msg].filter((d): d is string => !!d).sort((a, b) => Date.parse(a) - Date.parse(b));
  return dates[0] ?? null;
}

async function skillsUsed(): Promise<number> {
  // El uso vive en Supabase (skill_usage); sin base, useCount sería 0 para
  // todas — falta de dato, no "ninguna se usó".
  db();
  return (await listSkills()).filter((s) => s.useCount > 0).length;
}

const SOURCES: Record<EvolutionMetric, string> = {
  daysTogether:
    "días completos desde la primera interacción real: el más antiguo entre memories.created_at y conversation_messages.ts",
  memories: "conteo exacto de la tabla memories",
  skillsUsed: "skills del plugin local (~/.hermes-os/plugin/skills) con use_count > 0 en skill_usage",
  executionsDone: "conteo exacto de task_executions con status = 'done'",
  conversations:
    "mensajes TUYOS en conversation_messages (role = 'user', texto y voz) — cada turno que le hablaste a Hermes; no hay un id de conversación fiable para contar sesiones",
};

export async function evolutionReport(now = new Date()): Promise<EvolutionReport> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.report;

  const [sinceR, memoriesR, skillsR, execR, convR] = await Promise.allSettled([
    computeSince(),
    headCount("memories"),
    skillsUsed(),
    headCount("task_executions", [["status", "done"]]),
    headCount("conversation_messages", [["role", "user"]]),
  ]);

  const sources = { ...SOURCES };
  const reason = (r: PromiseRejectedResult) => (r.reason instanceof Error ? r.reason.message : String(r.reason));
  const pick = (metric: EvolutionMetric, r: PromiseSettledResult<number>): number | null => {
    if (r.status === "fulfilled") return r.value;
    sources[metric] = `sin dato: ${reason(r)}`;
    return null;
  };

  let since: string | null = null;
  let daysTogether: number | null = null;
  if (sinceR.status === "fulfilled") {
    since = sinceR.value;
    daysTogether = since ? daysBetween(since, now) : 0;
    if (!since) sources.daysTogether = `${SOURCES.daysTogether} (aún no hay ninguna)`;
  } else {
    sources.daysTogether = `sin dato: ${reason(sinceR)}`;
  }

  const metrics: Record<EvolutionMetric, number | null> = {
    daysTogether,
    memories: pick("memories", memoriesR),
    skillsUsed: pick("skillsUsed", skillsR),
    executionsDone: pick("executionsDone", execR),
    conversations: pick("conversations", convR),
  };
  const forStage = Object.fromEntries(
    Object.entries(metrics).map(([k, v]) => [k, v ?? 0]),
  ) as EvolutionMetrics;

  const report: EvolutionReport = { metrics, ...evolutionStage(forStage), since, sources };
  // Una consulta caída no se cachea un minuto entero: que el próximo poll reintente.
  const anyFailed = [sinceR, memoriesR, skillsR, execR, convR].some((r) => r.status === "rejected");
  if (!anyFailed) cache = { at: Date.now(), report };
  return report;
}
