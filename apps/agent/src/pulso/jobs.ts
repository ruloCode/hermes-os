import { registerJob } from "../jobs.js";
import { currentMode, runRealPulse } from "./index.js";

/** Cada cuánto late el pulso. */
export const PULSE_INTERVAL_MS = 10 * 60_000;

/**
 * Job del pulso: revisa el estado agregado y decide si algo merece interrumpir.
 * `HERMES_PULSE=off` lo apaga (ni se registra). Por defecto: bandeja, sin avisos.
 */
export function registerPulseJobs(): void {
  if (currentMode() === "off") return;
  registerJob("pulso", PULSE_INTERVAL_MS, () => runRealPulse(), (r) => {
    if (r.skipped) return null;
    const model = r.model?.called ? "con modelo" : r.model?.reason ? `sin modelo (${r.model.reason})` : "sin modelo";
    return `${r.added.length} cambios · ${r.cards.length} tarjetas nuevas · ${model}`;
  });
}
