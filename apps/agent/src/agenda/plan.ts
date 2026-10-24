import { nextRun } from "../scheduled/cron.js";

/**
 * La agenda combinada (2026-10-20): por día, lo que está en el calendario, lo
 * que depende del dueño (sus pendientes con fecha) y lo que hacen sus agentes
 * solos (tareas programadas, escenas del cuarto). Lógica pura: fechas, zonas y
 * ocurrencias de cron; los datos los junta agenda/index.ts.
 */

/** Diferencia (ms) entre la hora de pared de `tz` y UTC en el instante `t`. */
function tzOffsetMs(t: number, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date(t)).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return asUtc - t;
}

/** Instante de la medianoche local de `date` (AAAA-MM-DD) en `tz`. */
export function zonedMidnight(date: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y!, m! - 1, d!);
  return new Date(guess - tzOffsetMs(guess, tz));
}

/** "2026-10-20" + n días. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + n)).toISOString().slice(0, 10);
}

/** Cada vez que el cron corre dentro de ese día local (tope de 48 para crons por minuto). */
export function occurrencesOn(cron: string, tz: string, date: string, max = 48): Date[] {
  const start = zonedMidnight(date, tz).getTime();
  const end = zonedMidnight(addDays(date, 1), tz).getTime();
  const out: Date[] = [];
  let from = new Date(start - 1);
  while (out.length < max) {
    const n = nextRun(cron, tz, from);
    if (!n || n.getTime() >= end) break;
    out.push(n);
    from = n;
  }
  return out;
}

/** Parsea "AAAA-MM-DD"; cualquier otra cosa → null (las fechas las resuelve el modelo, no aquí). */
export function parseDue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d ? s : null;
}

/**
 * ¿Este pendiente va en el día `date`? Con fecha: solo ese día. Sin fecha:
 * hoy (se arrastra hasta que se hace). Hecho: solo el día en que se cerró.
 */
export function taskOnDay(
  t: { due: string | null; done: boolean; doneOn: string | null },
  date: string,
  today: string,
): boolean {
  if (t.done) return t.doneOn === date;
  if (t.due) return t.due === date || (t.due < today && date === today); // vencida: se ve hoy
  return date === today;
}
