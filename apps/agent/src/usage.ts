/**
 * Acumulador diario de costo de los runs de Claude Code (CLI).
 *
 * Cada run terminado suma su total_cost_usd al archivo del día en
 * <repo>/.data/usage/YYYY-MM-DD.json — así el total sobrevive reinicios del
 * agente y alimenta el header del Orquestador vía GET /stats.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DailyRunUsage } from "@hermes/shared";
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

async function readToday(): Promise<DailyRunUsage> {
  try {
    const raw = await readFile(todayFile(), "utf8");
    const d = JSON.parse(raw) as DailyRunUsage;
    return { costUsd: Number(d.costUsd) || 0, runs: Number(d.runs) || 0 };
  } catch {
    return { costUsd: 0, runs: 0 };
  }
}

// Serializa las escrituras: dos runs terminando a la vez no se pisan la suma.
let chain: Promise<unknown> = Promise.resolve();

export function addRunCost(costUsd: number | undefined): void {
  chain = chain
    .then(async () => {
      const cur = await readToday();
      const next: DailyRunUsage = {
        costUsd: Math.round((cur.costUsd + (costUsd ?? 0)) * 10000) / 10000,
        runs: cur.runs + 1,
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
