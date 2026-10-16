/**
 * Daily brief unificado, en este orden: agenda de hoy, finanzas del mes,
 * hábitos de hoy con rachas y, al final (es lo largo), proyectos activos. Texto plano corto en español, apto para que la
 * voz lo narre (lo consumen /tools/get_daily_brief, la tool del agente y el
 * brief de la mañana que llega al teléfono). Cada sección es best-effort: sin
 * datos, se omite.
 */
import type { CalendarEvent } from "@hermes/shared";
import { getUpcomingCalendar } from "./calendar.js";
import { env } from "./env.js";
import { readProjects } from "./vault/projects.js";
import { financeBriefLine } from "./finance/advisor.js";
import { habitsToday } from "./habits/store.js";

const AGENDA_MAX = 5;

const trimEnd = (s: string) => s.replace(/[.\s]+$/, "");

/**
 * La primera línea con contenido del "Estado Actual" de un proyecto. Salta las
 * cabeceras de callout de Obsidian (`> [!note] Hermes · fecha`) y quita las
 * marcas de cita y viñeta: tomar la línea 0 a ciegas narraba la cabecera
 * como si fuera el estado.
 */
export function statusLine(estado: string, max = 150): string {
  for (const raw of estado.split("\n")) {
    const line = raw.replace(/^\s*(>\s*)+/, "").replace(/^\s*[-*+]\s+/, "").trim();
    if (!line || /^\[![a-z-]+\]/i.test(line)) continue;
    return trimEnd(line).slice(0, max);
  }
  return "";
}

/**
 * Línea de agenda: lo de HOY (zona del dueño) que no ha terminado, en orden.
 * null si no hay nada — sin calendario no se inventa un "día libre".
 */
export function agendaLine(events: readonly CalendarEvent[], nowIso: string, tz: string): string | null {
  const day = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const today = day(nowIso);
  const now = Date.parse(nowIso);
  const todays = events
    .filter((e) => day(e.start) === today || (e.allDay && Date.parse(e.start) <= now && (!e.end || Date.parse(e.end) > now)))
    .filter((e) => !e.end || Date.parse(e.end) > now)
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || Date.parse(a.start) - Date.parse(b.start));
  if (!todays.length) return null;
  const hour = (iso: string) =>
    new Date(iso).toLocaleTimeString("es-CO", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const items = todays.slice(0, AGENDA_MAX).map((e) => {
    const when = e.allDay ? "todo el día" : Date.parse(e.start) <= now ? `en curso desde ${hour(e.start)}` : hour(e.start);
    return `${when} ${e.title}${e.location ? ` (${e.location})` : ""}`;
  });
  const more = todays.length > AGENDA_MAX ? ` y ${todays.length - AGENDA_MAX} más` : "";
  return `Agenda de hoy: ${items.join(" · ")}${more}.`;
}

/**
 * `finance: false` omite la línea de saldo/gasto: el brief que arma la tool del
 * agente termina como NOTIFICACIÓN en el teléfono, y una notificación la lee
 * cualquiera que tenga el teléfono desbloqueado. La plata se pide aparte (tools
 * de finanzas, que desde el teléfono exigen la huella: finance/guard.ts).
 */
export async function buildDailyBrief(opts: { finance?: boolean } = {}): Promise<string> {
  const sections: string[] = [];

  // Agenda primero: es lo que ordena el día.
  try {
    const cal = await getUpcomingCalendar(2, 20);
    const line = agendaLine(cal.events, new Date().toISOString(), env.SCHEDULED_TZ);
    if (line) sections.push(line);
  } catch (err) {
    console.error("[brief] agenda:", err);
  }

  // Proyectos activos (lógica original del brief). Van AL FINAL: son la parte
  // larga, y lo diario (agenda, hábitos, plata) no debe quedar tras un corte.
  let projectsSection: string | null = null;
  try {
    const projects = (await readProjects()).filter((p) => p.estado === "activo");
    if (projects.length) {
      projectsSection = (
        projects
          .map(
            (p) =>
              `${p.name}: ${statusLine(p.estado_actual) || "sin estado"}. Próximo: ${trimEnd(p.tareas_pendientes[0] ?? "") || "nada pendiente"}.`,
          )
          .join(" \n")
      );
    }
  } catch (err) {
    console.error("[brief] proyectos:", err);
  }

  // Finanzas del mes (gastado vs presupuestado + riesgo).
  if (opts.finance !== false) try {
    const finance = await financeBriefLine();
    if (finance) sections.push(finance);
  } catch (err) {
    console.error("[brief] finanzas:", err);
  }

  // Hábitos: pendientes de hoy + rachas notables.
  try {
    const habits = await habitsToday();
    if (habits.length) {
      const pending = habits.filter((h) => !h.done_today);
      const bits: string[] = [];
      if (pending.length) {
        bits.push(`Hábitos pendientes hoy: ${pending.map((h) => h.name).join(", ")}.`);
      } else {
        bits.push("Hábitos de hoy: todos hechos.");
      }
      const notable = habits.filter((h) => h.streak >= 3);
      if (notable.length) {
        bits.push(
          `Rachas: ${notable
            .map((h) => `${h.name} ${h.streak} ${h.cadence === "weekly" ? "semanas" : "días"}`)
            .join(", ")}.`,
        );
      }
      sections.push(bits.join(" "));
    }
  } catch (err) {
    console.error("[brief] hábitos:", err);
  }

  if (projectsSection) sections.push(projectsSection);
  return sections.join("\n") || "No hay datos para el brief: ni agenda, ni proyectos activos, ni finanzas, ni hábitos.";
}
