/**
 * Fechas "de calendario" en America/Bogota. Todo "hoy" de finanzas y hábitos
 * pasa por aquí — NUNCA toISOString() directo, que es UTC y cambia de día a
 * las 7pm hora colombiana (rompería check-ins, rachas y límites de mes).
 */

const TZ = "America/Bogota";

// en-CA formatea YYYY-MM-DD directamente.
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

/** Fecha YYYY-MM-DD de "hoy" en Bogotá. */
export function todayBogota(): string {
  return fmt.format(new Date());
}

/** Mes actual YYYY-MM en Bogotá. */
export function currentMonthBogota(): string {
  return todayBogota().slice(0, 7);
}

/** Suma n días (puede ser negativo) a una fecha YYYY-MM-DD, en calendario puro. */
export function addDays(date: string, n: number): string {
  // Mediodía UTC evita saltos de día por DST/offsets al operar la fecha plana.
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana de `date` (default hoy Bogotá), YYYY-MM-DD. */
export function startOfWeekBogota(date?: string): string {
  const base = date ?? todayBogota();
  const d = new Date(`${base}T12:00:00Z`);
  const dow = d.getUTCDay(); // 0=domingo … 6=sábado
  const sinceMonday = (dow + 6) % 7;
  return addDays(base, -sinceMonday);
}

/** Rango [desde, hasta) de un mes YYYY-MM, para filtrar occurred_on. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const to = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { from, to };
}

/** Días que tiene el mes YYYY-MM y qué día va corriendo si es el mes actual. */
export function monthProgress(month: string): { daysInMonth: number; dayOfMonth: number } {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const today = todayBogota();
  const dayOfMonth = today.startsWith(month) ? Number(today.slice(8, 10)) : daysInMonth;
  return { daysInMonth, dayOfMonth };
}
