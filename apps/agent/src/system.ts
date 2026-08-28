/**
 * Métricas del Mac local para el panel SISTEMA del dashboard.
 *
 * Todo sale del propio sistema operativo, sin dependencias externas:
 * - CPU: sampler de ticks de os.cpus() (delta cada 5s → % real de uso).
 * - RAM: os.totalmem()/os.freemem() (indicativo en macOS, ver nota abajo).
 * - Disco: statfs("/") de node:fs/promises, cacheado 60s.
 * - Uptimes: os.uptime() para el Mac; el del agente llega como parámetro.
 */
import os from "node:os";
import { statfs } from "node:fs/promises";
import type { SystemMetrics } from "@hermes/shared";

// ── CPU: sampler por delta de ticks ─────────────────────────────────────────
// os.cpus() devuelve contadores acumulados desde el boot; un snapshot suelto
// no dice nada del "ahora". Guardamos los ticks y cada 5s calculamos el delta.

const SAMPLE_INTERVAL_MS = 5_000;

interface CpuTicks {
  idle: number;
  total: number;
}

function readTicks(): CpuTicks {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    idle += cpu.times.idle;
    total +=
      cpu.times.user +
      cpu.times.nice +
      cpu.times.sys +
      cpu.times.idle +
      cpu.times.irq;
  }
  return { idle, total };
}

let prevTicks: CpuTicks | null = null;
/** null hasta que el sampler completa su primer delta. */
let cpuPct: number | null = null;
let samplerTimer: NodeJS.Timeout | null = null;

function sample(): void {
  const ticks = readTicks();
  if (prevTicks) {
    const dTotal = ticks.total - prevTicks.total;
    const dIdle = ticks.idle - prevTicks.idle;
    if (dTotal > 0) {
      cpuPct = Math.round(((dTotal - dIdle) / dTotal) * 1000) / 10;
    }
  }
  prevTicks = ticks;
}

/**
 * Arranca el sampler de CPU (idempotente: si ya corre, no duplica).
 * Usa .unref() para no bloquear el shutdown del proceso.
 */
export function startSystemSampler(): void {
  if (samplerTimer) return;
  sample(); // primer snapshot: deja los ticks base para el primer delta
  samplerTimer = setInterval(sample, SAMPLE_INTERVAL_MS);
  samplerTimer.unref();
}

// Antes del primer delta (arranque del agente), aproximamos con loadavg:
// carga promedio 1min normalizada por nº de cores.
function approxCpuPct(): number {
  const cores = os.cpus().length || 1;
  const pct = (os.loadavg()[0] / cores) * 100;
  return Math.round(Math.min(100, pct) * 10) / 10;
}

// ── Disco: statfs("/") con cache de 60s ─────────────────────────────────────
// El espacio en disco no cambia rápido; evitamos un syscall por request.

const DISK_CACHE_MS = 60_000;

interface DiskInfo {
  usedPct: number;
  totalBytes: number;
  freeBytes: number;
}

let diskCache: DiskInfo | null = null;
let diskCacheAt = 0;
let diskErrorLogged = false;

async function readDisk(): Promise<DiskInfo> {
  const now = Date.now();
  if (diskCache && now - diskCacheAt < DISK_CACHE_MS) return diskCache;
  try {
    const fs = await statfs("/");
    const total = fs.blocks * fs.bsize;
    const free = fs.bavail * fs.bsize;
    const usedPct =
      total > 0 ? Math.round(((total - free) / total) * 1000) / 10 : 0;
    diskCache = { usedPct, totalBytes: total, freeBytes: free };
    diskCacheAt = now;
  } catch (err) {
    // El front oculta la barra cuando diskTotalBytes es 0.
    if (!diskErrorLogged) {
      diskErrorLogged = true;
      console.error(
        "[hermes] system statfs",
        err instanceof Error ? err.message : err,
      );
    }
    diskCache = { usedPct: 0, totalBytes: 0, freeBytes: 0 };
    diskCacheAt = now;
  }
  return diskCache;
}

// ── Snapshot completo ───────────────────────────────────────────────────────

/** Snapshot de métricas del Mac con el shape SystemMetrics del dashboard. */
export async function getSystemMetrics(
  uptimeAgentSeconds: number,
): Promise<SystemMetrics> {
  const disk = await readDisk();

  // Nota macOS: freemem() no cuenta la memoria "inactive/purgeable" que el
  // sistema liberaría bajo presión, así que memUsedPct es indicativo (alto).
  const memTotal = os.totalmem();
  const memUsed = memTotal - os.freemem();

  return {
    cpuPct: cpuPct ?? approxCpuPct(),
    loadAvg1: Math.round(os.loadavg()[0] * 100) / 100,
    memUsedPct:
      memTotal > 0 ? Math.round((memUsed / memTotal) * 1000) / 10 : 0,
    memTotalBytes: memTotal,
    memUsedBytes: memUsed,
    diskUsedPct: disk.usedPct,
    diskTotalBytes: disk.totalBytes,
    diskFreeBytes: disk.freeBytes,
    uptimeOsSeconds: Math.round(os.uptime()),
    uptimeAgentSeconds,
  };
}
