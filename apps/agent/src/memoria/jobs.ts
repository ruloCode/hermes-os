/**
 * Jobs de la memoria v2: sincronización incremental cada 15 min y el «sueño»
 * (consolidación) una vez por noche a las 3:30, hora local.
 *
 * El sueño se registra como un job de 5 min que solo trabaja cuando ya pasó la
 * hora y no ha corrido hoy: así un agente que estaba apagado a las 3:30 lo hace
 * al volver (en la madrugada), y uno que arranca de día no lo repite.
 */
import { registerJob } from "../jobs.js";
import { supabase } from "../supabase.js";
import { embedChain } from "./embedder.js";
import { modelDecider, runDream, type DreamRun } from "./dream.js";
import { flushIndex, withIndex } from "./service.js";
import { allCollectors } from "./sources.js";
import { noteDreamRun } from "./status.js";
import { syncIndex, type SyncResult } from "./sync.js";

export const SYNC_INTERVAL_MS = 15 * 60_000;
export const DREAM_HOUR = 3;
export const DREAM_MINUTE = 30;

export async function runMemoriaSync(full = false): Promise<SyncResult> {
  await flushIndex();
  return withIndex((idx) => syncIndex(idx, allCollectors(supabase), embedChain(), { full }));
}

/** Día local AAAA-MM-DD (la hora de la máquina es la del dueño). */
const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** ¿Toca soñar? Pasadas las 3:30 de hoy y sin sueño hoy (puro, con reloj inyectado). */
export function dreamDue(now: Date, lastDream: string | null): boolean {
  const mark = new Date(now);
  mark.setHours(DREAM_HOUR, DREAM_MINUTE, 0, 0);
  if (now < mark) return false;
  if (!lastDream) return true;
  return localDay(new Date(lastDream)) !== localDay(now);
}

/** Una corrida del sueño. `force` = a mano (ruta), sin mirar la hora. */
export async function runMemoriaDream(force = false): Promise<DreamRun | null> {
  return withIndex(async (idx) => {
    if (!force && !dreamDue(new Date(), idx.state.lastDream)) return null;
    const run = await runDream(idx, { decide: modelDecider, auto: (process.env.HERMES_LEARNING || "").toLowerCase() === "auto" });
    await idx.persistState();
    noteDreamRun(run);
    if (run.proposals || run.error) {
      console.log(`[memoria] sueño: ${run.candidates} grupos, ${run.proposals} propuestas, ${run.applied} aplicadas${run.error ? ` · error: ${run.error}` : ""}`);
    }
    return run;
  });
}

export function registerMemoriaJobs(): void {
  if (process.env.HERMES_MEMORY === "supabase") return;
  registerJob(
    "memoria-sync",
    SYNC_INTERVAL_MS,
    () => runMemoriaSync(false),
    (r) =>
      `${r.docs} documentos · ${r.embedded} vectores nuevos · ${r.removed} quitados${Object.keys(r.sourceErrors).length ? ` · ${Object.keys(r.sourceErrors).length} fuentes con error` : ""}${r.engineError ? ` · sin vectores: ${r.engineError.slice(0, 80)}` : ""}`,
  );
  registerJob(
    "memoria-sueño",
    5 * 60_000,
    () => runMemoriaDream(false),
    (r) => (r ? `${r.candidates} grupos · ${r.proposals} propuestas · ${r.applied} aplicadas` : null),
  );
}
