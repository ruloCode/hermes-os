// Lo que dicen los NPC de la Oficina (puro: sin DOM ni red). Recepción
// resume el estado REAL de la oficina, Barista lee el snapshot de /dashboard y
// las tareas programadas, y la azotea ofrece una pausa con un temporizador de
// verdad. Regla de oro del dashboard: cada línea con un dato sale de una
// fuente; si la fuente no existe o falló, la línea NO se dice (y la opción que
// la pide ni siquiera aparece). Los NPC son roles, no personas con nombre: el
// repo es público y corre en máquinas de otros.

import type { DashboardSnapshot } from "./types.js";
import { officeCounts, type OfficeWorker, type OfficeWorkerStatus } from "./office.js";

export type OfficeNpcRole = "reception" | "barista" | "rooftop";

export const OFFICE_NPCS: Record<OfficeNpcRole, { name: string; floor: number; place: string }> = {
  reception: { name: "Recepción", floor: 0, place: "Piso 1 · Equipos" },
  barista: { name: "Barista", floor: 1, place: "Piso 2 · Café" },
  rooftop: { name: "Respiro", floor: 2, place: "Piso 3 · Azotea" },
};

export function isOfficeNpcRole(v: unknown): v is OfficeNpcRole {
  return v === "reception" || v === "barista" || v === "rooftop";
}

/** Una línea del diálogo. Con `workerId`, la UI ofrece ir con ese agente. */
export interface NpcLine {
  text: string;
  workerId?: string;
}

const STATUS_WORDS: [OfficeWorkerStatus, string, string][] = [
  ["needs_you", "te necesita", "te necesitan"],
  ["working", "trabajando", "trabajando"],
  ["starting", "arrancando", "arrancando"],
  ["thinking", "pensando", "pensando"],
  ["blocked", "bloqueado", "bloqueados"],
  ["done", "listo", "listos"],
  ["error", "con error", "con error"],
];

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} y ${parts[parts.length - 1]}`;
}

export interface ReceptionContext {
  /** ¿Hay conexión con /office/events? Sin ella no se sabe quién trabaja. */
  connected: boolean;
  /** La oficina es la simulación de QA: se dice. */
  simulated: boolean;
  projectName: (slug: string) => string;
}

/** "¿Qué está pasando?": los conteos del HUD, en palabras, y quién te necesita. */
export function receptionSummary(workers: readonly OfficeWorker[], ctx: ReceptionContext): NpcLine[] {
  const pre = ctx.simulated ? "(Simulación) " : "";
  if (!ctx.connected && !ctx.simulated) return [{ text: "No tengo conexión con el agente ahora mismo, así que no sé quién está trabajando." }];
  if (!workers.length) return [{ text: `${pre}No hay nadie trabajando ahora. Cualquier escritorio libre sirve para contratar.` }];
  const c = officeCounts(workers);
  const parts = STATUS_WORDS.filter(([k]) => c[k] > 0).map(([k, one, many]) => `${c[k]} ${c[k] === 1 ? one : many}`);
  const lines: NpcLine[] = [{ text: `${pre}Hay ${workers.length} ${workers.length === 1 ? "sesión viva" : "sesiones vivas"}: ${joinList(parts)}.` }];
  for (const w of workers.filter((x) => x.status === "needs_you").slice(0, 3)) {
    lines.push({ text: `${w.name} (${ctx.projectName(w.project)}) te pide permiso${w.approval?.summary ? `: ${w.approval.summary}` : ""}.`, workerId: w.id });
  }
  return lines;
}

export type ReceptionQuestion = "needs_you" | "working" | "done";

/** Lista de una categoría, cada agente con su proyecto y lo que hace (todo del estado real). */
export function receptionList(workers: readonly OfficeWorker[], which: ReceptionQuestion, ctx: ReceptionContext): NpcLine[] {
  const pre = ctx.simulated ? "(Simulación) " : "";
  if (!ctx.connected && !ctx.simulated) return [{ text: "Sin conexión con el agente no puedo saberlo." }];
  const pick =
    which === "needs_you"
      ? workers.filter((w) => w.status === "needs_you")
      : which === "working"
        ? workers.filter((w) => w.status === "working" || w.status === "thinking" || w.status === "starting" || w.status === "blocked")
        : workers.filter((w) => w.status === "done" || w.status === "error");
  if (!pick.length) {
    const none = which === "needs_you" ? "Nadie te está pidiendo permiso." : which === "working" ? "Nadie está trabajando ahora." : "Nadie ha terminado todavía.";
    return [{ text: `${pre}${none}` }];
  }
  const head = which === "needs_you" ? "Te necesitan:" : which === "working" ? "Trabajando ahora:" : "Terminaron:";
  return [
    { text: `${pre}${head}` },
    ...pick.slice(0, 6).map((w) => {
      const what = w.status === "needs_you" ? (w.approval?.summary ?? w.task.summary) : w.status === "error" ? `falló · ${w.task.summary}` : w.task.summary;
      return { text: `${w.name} · ${ctx.projectName(w.project)}${what ? ` — ${what}` : ""}`, workerId: w.id };
    }),
    ...(pick.length > 6 ? [{ text: `…y ${pick.length - 6} más.` }] : []),
  ];
}

/** Descripción del código WMO de Open-Meteo (rangos oficiales). */
export function weatherWords(code: number): string {
  if (code >= 95) return "con tormenta";
  if (code >= 85) return "con chubascos de nieve";
  if (code >= 80) return "con chubascos";
  if (code >= 71) return "con nieve";
  if (code >= 61) return "lloviendo";
  if (code >= 51) return "con llovizna";
  if (code >= 45) return "con niebla";
  if (code >= 2) return "nublado";
  if (code === 1) return "casi despejado";
  return "despejado";
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 3.636.000 → "3,6 millones de tokens"; 48.200 → "48 mil tokens". */
export function tokenWords(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} millones de tokens`;
  return `${Math.round(n / 1000)} mil tokens`;
}

/** "¿Cómo va el día?": hora local, ejecuciones y costo de hoy y el próximo evento del calendario. */
export function baristaDay(snap: DashboardSnapshot | null, now: Date): NpcLine[] {
  const lines: NpcLine[] = [{ text: `Son las ${hhmm(now)}.` }];
  if (!snap) return lines;
  const u = snap.usage;
  if (u.runs > 0) {
    const tokens = u.tokens ? u.tokens.inputTokens + u.tokens.outputTokens + u.tokens.cacheCreationTokens + u.tokens.cacheReadTokens : 0;
    lines.push({
      text: `Hoy van ${u.runs} ${u.runs === 1 ? "ejecución terminada" : "ejecuciones terminadas"} por US$ ${u.costUsd.toFixed(2)}${tokens >= 1000 ? ` (${tokenWords(tokens)})` : ""}.`,
    });
  } else lines.push({ text: "Hoy todavía no ha terminado ninguna ejecución." });
  const cal = snap.calendar;
  if (cal.configured) {
    const next = cal.events.find((e) => !e.allDay && e.startsInMin > -30) ?? null;
    if (next) {
      const m = next.startsInMin;
      const when =
        m < 0 ? `empezó hace ${-m} min` : m < 60 ? `en ${m} min` : `a las ${hhmm(new Date(next.start))}${new Date(next.start).toDateString() === now.toDateString() ? "" : ` del ${new Date(next.start).toLocaleDateString("es-CO", { weekday: "long", day: "numeric" })}`}`;
      lines.push({ text: `Tu próximo evento: ${next.title}, ${when}.` });
    } else if (!cal.stale) lines.push({ text: "No tienes eventos próximos en el calendario." });
  }
  return lines;
}

/** "¿Qué tal el clima?": solo si el agente reporta clima (si no, la opción no existe). */
export function baristaWeather(snap: DashboardSnapshot | null): NpcLine[] {
  const w = snap?.weather;
  if (!w) return [];
  const today = w.daily[0];
  const rain = today?.precipProbPct != null && today.precipProbPct >= 20 ? `, ${today.precipProbPct}% de probabilidad de lluvia` : "";
  return [
    {
      text: `En ${w.place} hace ${Math.round(w.now.tempC)}°, ${weatherWords(w.now.weatherCode)}${today ? `. Hoy entre ${Math.round(today.minC)}° y ${Math.round(today.maxC)}°${rain}` : ""}.${w.stale ? " (Es el último dato que llegó, puede estar viejo.)" : ""}`,
    },
  ];
}

/** Fila de GET /scheduled (con `when`, la lectura en español de su cron). */
export interface ScheduledLite {
  title: string;
  enabled: boolean;
  next_run_at: string | null;
  blocked_reason?: string | null;
  when?: string;
}

/** "¿Qué hay programado?": las próximas tareas programadas activas (null = la fuente falló: nada que decir). */
export function baristaScheduled(tasks: readonly ScheduledLite[] | null, now: Date): NpcLine[] {
  if (!tasks) return [];
  const next = tasks
    .filter((t) => t.enabled && !t.blocked_reason && t.next_run_at && !Number.isNaN(Date.parse(t.next_run_at)))
    .sort((a, b) => Date.parse(a.next_run_at!) - Date.parse(b.next_run_at!));
  if (!next.length) return [{ text: "No hay tareas programadas activas." }];
  return next.slice(0, 3).map((t, i) => {
    const at = new Date(t.next_run_at!);
    const sameDay = at.toDateString() === now.toDateString();
    const day = sameDay ? "hoy" : at.toLocaleDateString("es-CO", { weekday: "long", day: "numeric" });
    return { text: `${i === 0 ? "La próxima: " : ""}${t.title}, ${day} a las ${hhmm(at)}${t.when ? ` (${t.when})` : ""}.` };
  });
}

/** Lo que dura la pausa de la azotea. */
export const ROOFTOP_PAUSE_MS = 5 * 60_000;

export function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
