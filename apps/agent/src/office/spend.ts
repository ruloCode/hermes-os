// GET /office/spend: el gasto de tokens que pinta el tablero de la Oficina.
// Lee los archivos de usage.ts (total diario + registro por run) y el gasto
// de los personajes vivos, y arma la respuesta con la lógica pura de
// @hermes/shared (office-spend.ts). Caché corta: el tablero consulta cada 15 s
// y los archivos solo cambian cuando termina un run.

import { buildOfficeSpend, localDay, type OfficeSpend, type SpendLiveRow } from "@hermes/shared";
import { readSpendLedger, readUsageDays } from "../usage.js";
import { officeWorkers } from "./state.js";

const CACHE_MS = 10_000;
let cached: { at: number; files: { usage: Awaited<ReturnType<typeof readUsageDays>>; entries: Awaited<ReturnType<typeof readSpendLedger>> } } | null = null;

/** Los personajes de la Oficina con lo que llevan (lo vivo no se cachea: cambia con cada mensaje). */
function liveRows(): SpendLiveRow[] {
  return officeWorkers()
    .filter((w) => !w.private)
    .map((w) => ({ id: w.id, name: w.name, project: w.project, status: w.status, spend: w.spend ?? null }));
}

export async function officeSpend(force = false): Promise<OfficeSpend> {
  const now = new Date();
  if (force || !cached || Date.now() - cached.at > CACHE_MS) {
    const [usage, entries] = await Promise.all([readUsageDays(30), readSpendLedger(7)]);
    cached = { at: Date.now(), files: { usage, entries } };
  }
  const { usage, entries } = cached.files;
  const today = usage.days.find((d) => d.day === localDay(now)) ?? null;
  return buildOfficeSpend({ now, today, days: usage.days, firstDay: usage.first, entries, live: liveRows() });
}
