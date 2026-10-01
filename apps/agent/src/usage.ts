/**
 * Acumulador diario de costo de los runs de Claude Code (CLI).
 *
 * Cada run terminado suma su total_cost_usd al archivo del día en
 * <repo>/.data/usage/YYYY-MM-DD.json — así el total sobrevive reinicios del
 * agente y alimenta el header del Orquestador vía GET /stats.
 */
import { appendFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lastDays, localDay as dayOf, parseSpendEntry, type DailyRunUsage, type RunTokenUsage, type SpendDay, type SpendEntry } from "@hermes/shared";
import { REPO_ROOT } from "./env.js";

const DIR = join(REPO_ROOT, ".data", "usage");

// Día LOCAL, no UTC: en Colombia (UTC-5) el gasto "de hoy" rotaría a las
// 7pm si usáramos toISOString().
function localDay(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function todayFile(): string {
  return join(DIR, `${localDay()}.json`);
}

const ZERO_TOKENS: RunTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
};

async function readToday(): Promise<DailyRunUsage> {
  try {
    const raw = await readFile(todayFile(), "utf8");
    const d = JSON.parse(raw) as DailyRunUsage;
    return {
      costUsd: Number(d.costUsd) || 0,
      runs: Number(d.runs) || 0,
      // Archivos previos a la captura de tokens no traen `tokens`: se asume 0.
      tokens: {
        inputTokens: Number(d.tokens?.inputTokens) || 0,
        outputTokens: Number(d.tokens?.outputTokens) || 0,
        cacheCreationTokens: Number(d.tokens?.cacheCreationTokens) || 0,
        cacheReadTokens: Number(d.tokens?.cacheReadTokens) || 0,
      },
    };
  } catch {
    return { costUsd: 0, runs: 0, tokens: { ...ZERO_TOKENS } };
  }
}

// Serializa las escrituras: dos runs terminando a la vez no se pisan la suma.
let chain: Promise<unknown> = Promise.resolve();

export function addRunCost(costUsd: number | undefined, usage?: RunTokenUsage): void {
  chain = chain
    .then(async () => {
      const cur = await readToday();
      const t = cur.tokens ?? { ...ZERO_TOKENS };
      const next: DailyRunUsage = {
        costUsd: Math.round((cur.costUsd + (costUsd ?? 0)) * 10000) / 10000,
        runs: cur.runs + 1,
        tokens: {
          inputTokens: t.inputTokens + (usage?.inputTokens ?? 0),
          outputTokens: t.outputTokens + (usage?.outputTokens ?? 0),
          cacheCreationTokens: t.cacheCreationTokens + (usage?.cacheCreationTokens ?? 0),
          cacheReadTokens: t.cacheReadTokens + (usage?.cacheReadTokens ?? 0),
        },
      };
      await mkdir(DIR, { recursive: true });
      const file = todayFile();
      const tmp = `${file}.tmp`;
      await writeFile(tmp, JSON.stringify(next), "utf8");
      await rename(tmp, file); // atómico
    })
    .catch((err) => console.error("[hermes] usage add", err));
}

export async function getDailyUsage(): Promise<DailyRunUsage> {
  await chain.catch(() => {});
  return readToday();
}

// ── Registro por run (tablero de gasto de la Oficina) ───────────────────
// El archivo diario solo guarda el total. Para saber cuánto gastó cada
// proyecto y cada modelo, cada run terminado deja además una línea en
// runs-AAAA-MM-DD.jsonl. El desglose existe desde el primer archivo de estos.

function ledgerFile(day: string): string {
  return join(DIR, `runs-${day}.jsonl`);
}

/**
 * Un run (o tarea del SDK) terminó: suma al total del día y deja su línea en
 * el registro. Misma cadena que addRunCost: no se pisan entre sí.
 */
export function recordRunSpend(entry: SpendEntry): void {
  addRunCost(entry.costUsd ?? undefined, entry.tokens ?? undefined);
  chain = chain
    .then(async () => {
      await mkdir(DIR, { recursive: true });
      await appendFile(ledgerFile(dayOf(new Date(entry.ts))), `${JSON.stringify(entry)}\n`, "utf8");
    })
    .catch((err) => console.error("[hermes] usage ledger", err));
}

/**
 * Los totales diarios que existan en los últimos `n` días (archivos de esta
 * máquina) y el primer día con archivo, aunque quede fuera de la ventana.
 */
export async function readUsageDays(n: number): Promise<{ days: SpendDay[]; first: string | null }> {
  await chain.catch(() => {});
  const want = new Set(lastDays(localDay(), n));
  let names: string[] = [];
  try {
    names = await readdir(DIR);
  } catch {
    return { days: [], first: null };
  }
  const out: SpendDay[] = [];
  let first: string | null = null;
  for (const name of names) {
    const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
    if (m && (!first || m[1] < first)) first = m[1];
    if (!m || !want.has(m[1])) continue;
    try {
      const d = JSON.parse(await readFile(join(DIR, name), "utf8")) as DailyRunUsage;
      out.push({ day: m[1], costUsd: Number(d.costUsd) || 0, runs: Number(d.runs) || 0, tokens: d.tokens });
    } catch {
      /* archivo roto: ese día no se muestra */
    }
  }
  return { days: out.sort((a, b) => a.day.localeCompare(b.day)), first };
}

/** Las líneas del registro de los últimos `n` días. */
export async function readSpendLedger(n: number): Promise<SpendEntry[]> {
  await chain.catch(() => {});
  const out: SpendEntry[] = [];
  for (const day of lastDays(localDay(), n)) {
    let raw: string;
    try {
      raw = await readFile(ledgerFile(day), "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const e = line.trim() ? parseSpendEntry(line) : null;
      if (e) out.push(e);
    }
  }
  return out;
}
