/**
 * Despertar con puntos (lógica pura, sin disco ni red).
 *
 * La regla: la mañana empieza cuando el dueño CONFIRMA que está de pie (OK en
 * el control de la TV o "ya me levanté" en el chat), no cuando suena la
 * alarma. La distancia entre esa confirmación y la hora a la que se
 * comprometió (lo que dijo la noche anterior, o si no, la alarma del teléfono
 * — la que pone la calculadora de sueño) da los puntos: menos minutos, más
 * puntos. Levantarse siempre cuenta (piso de 10); no confirmar no da nada.
 */

/** Hasta aquí se considera "con la alarma": 100 puntos. */
export const WAKE_GRACE_MIN = 2;
/** Puntos que se pierden por cada minuto después de la gracia. */
export const WAKE_POINTS_PER_MIN = 2;
/** Levantarse tarde igual cuenta. */
export const WAKE_POINTS_FLOOR = 10;
/** "A tiempo" (para la racha): de pie a 10 minutos o menos de la hora. */
export const WAKE_ON_TIME_MIN = 10;
/** Bono de racha: +5 por cada día seguido a tiempo antes de hoy, con tope. */
export const WAKE_STREAK_STEP = 5;
export const WAKE_STREAK_CAP = 30;
/** Una hora (compromiso o alarma) vale para decidir el objetivo si está a este rato de ahora. */
export const WAKE_TARGET_WINDOW_MS = 3 * 3600_000;

export type WakeTier = "alarma" | "a-tiempo" | "tarde" | "muy-tarde" | "no-confirmo";

export interface WakeRecord {
  /** Fecha local AAAA-MM-DD de la mañana. */
  date: string;
  target_at: string;
  /** De dónde salió la hora objetivo. */
  target_source: "compromiso" | "alarma" | "escena";
  started_at: string;
  /** null = no confirmó a tiempo (la escena se rindió). */
  confirmed_at: string | null;
  confirmed_by: string | null;
  /** Minutos de la confirmación menos el objetivo (negativo = antes). null si no confirmó. */
  delta_min: number | null;
  base: number;
  bonus: number;
  points: number;
  /** Días seguidos a tiempo, contando este. */
  streak: number;
}

/** Puntos por los minutos de diferencia (negativo = antes de la hora, también 100). */
export function wakeBase(deltaMin: number): number {
  if (deltaMin <= WAKE_GRACE_MIN) return 100;
  return Math.max(WAKE_POINTS_FLOOR, 100 - WAKE_POINTS_PER_MIN * (deltaMin - WAKE_GRACE_MIN));
}

export function wakeTier(deltaMin: number | null): WakeTier {
  if (deltaMin == null) return "no-confirmo";
  if (deltaMin <= WAKE_GRACE_MIN) return "alarma";
  if (deltaMin <= WAKE_ON_TIME_MIN) return "a-tiempo";
  if (deltaMin <= 30) return "tarde";
  return "muy-tarde";
}

/** Minutos enteros entre dos instantes (redondeo al minuto más cercano). */
export const minutesBetween = (fromIso: string, toIso: string) => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000);

const dayBefore = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
};

/**
 * Racha que traía ANTES de `date`: días consecutivos (terminando ayer) en los
 * que se levantó a tiempo. Un día sin registro o tarde la corta.
 */
export function streakBefore(history: readonly WakeRecord[], date: string): number {
  const byDate = new Map(history.map((r) => [r.date, r]));
  let n = 0;
  let d = dayBefore(date);
  for (;;) {
    const r = byDate.get(d);
    if (!r || r.delta_min == null || r.delta_min > WAKE_ON_TIME_MIN) return n;
    n++;
    d = dayBefore(d);
  }
}

/** El registro de una mañana confirmada (o perdida, con confirmedAt = null). */
export function scoreWake(
  input: Pick<WakeRecord, "date" | "target_at" | "target_source" | "started_at"> & { confirmed_at: string | null; confirmed_by: string | null },
  history: readonly WakeRecord[],
): WakeRecord {
  const prior = history.filter((r) => r.date !== input.date);
  if (input.confirmed_at == null) {
    return { ...input, delta_min: null, base: 0, bonus: 0, points: 0, streak: 0 };
  }
  const delta = minutesBetween(input.target_at, input.confirmed_at);
  const base = wakeBase(delta);
  const before = streakBefore(prior, input.date);
  const onTime = delta <= WAKE_ON_TIME_MIN;
  const streak = onTime ? before + 1 : 0;
  const bonus = onTime ? Math.min(WAKE_STREAK_CAP, WAKE_STREAK_STEP * before) : 0;
  return { ...input, delta_min: delta, base, bonus, points: base + bonus, streak };
}

/** Puntos que daría confirmar AHORA (lo que la TV muestra mientras espera). */
export function pointsIfNow(targetAt: string, now: Date, history: readonly WakeRecord[], date: string): { delta_min: number; points: number } {
  const r = scoreWake(
    { date, target_at: targetAt, target_source: "alarma", started_at: targetAt, confirmed_at: now.toISOString(), confirmed_by: null },
    history,
  );
  return { delta_min: r.delta_min!, points: r.points };
}

export type TargetCandidate = { at: string; source: WakeRecord["target_source"] };

/**
 * La hora objetivo de esta mañana: el compromiso manda sobre la alarma; de
 * cada clase, la más cercana a ahora dentro de 3 h. Sin ninguna, la hora en
 * que arrancó la escena (no se inventa una hora más temprana).
 */
export function pickWakeTarget(candidates: readonly TargetCandidate[], now: Date): TargetCandidate {
  const near = (c: TargetCandidate) => {
    const t = Date.parse(c.at);
    return Number.isFinite(t) && Math.abs(t - now.getTime()) <= WAKE_TARGET_WINDOW_MS;
  };
  for (const source of ["compromiso", "alarma"] as const) {
    const list = candidates.filter((c) => c.source === source && near(c));
    if (list.length) {
      return list.reduce((a, b) => (Math.abs(Date.parse(a.at) - now.getTime()) <= Math.abs(Date.parse(b.at) - now.getTime()) ? a : b));
    }
  }
  return { at: now.toISOString(), source: "escena" };
}

/**
 * Minutos (desde el objetivo) en los que la TV insiste mientras sigue en la
 * cama. Cada uno se dice una sola vez.
 */
export const WAKE_NUDGES_MIN = [5, 10, 20, 30, 45, 60, 75, 90] as const;

/** ¿Toca insistir? Devuelve el minuto del recordatorio pendiente más reciente, o null. */
export function dueNudge(minutesLate: number, alreadySaid: readonly number[]): number | null {
  const due = WAKE_NUDGES_MIN.filter((m) => m <= minutesLate && !alreadySaid.includes(m));
  return due.length ? due[due.length - 1] : null;
}

export interface WakeStats {
  /** Puntos de la semana ISO de `date` (lunes a domingo). */
  week_points: number;
  week_days: number;
  total_points: number;
  /** Racha vigente: si hoy no hay registro, la que trae hasta ayer. */
  streak: number;
  best_streak: number;
  /** Promedio de minutos de diferencia de los últimos 7 registros confirmados. */
  avg_delta_7: number | null;
}

function mondayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
}

export function wakeStats(history: readonly WakeRecord[], date: string): WakeStats {
  const monday = mondayOf(date);
  const week = history.filter((r) => r.date >= monday && r.date <= date);
  const today = history.find((r) => r.date === date);
  const confirmed = history.filter((r) => r.delta_min != null).sort((a, b) => a.date.localeCompare(b.date));
  const last7 = confirmed.slice(-7);
  return {
    week_points: week.reduce((s, r) => s + r.points, 0),
    week_days: week.filter((r) => r.delta_min != null).length,
    total_points: history.reduce((s, r) => s + r.points, 0),
    streak: today ? today.streak : streakBefore(history, date),
    best_streak: history.reduce((m, r) => Math.max(m, r.streak), 0),
    avg_delta_7: last7.length ? Math.round(last7.reduce((s, r) => s + Math.max(0, r.delta_min!), 0) / last7.length) : null,
  };
}

/** "5 y 33" — la hora dicha corta, sin "de la mañana" (es obvio a esa hora). */
export function shortClock(h: number, m: number): string {
  const h12 = h % 12 || 12;
  return m === 0 ? `${h12} en punto` : `${h12} y ${m}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Lo que se dice al confirmar: dato por dato, sin adjetivos que el número no respalde. */
export function wakeResultSpeech(owner: string, r: WakeRecord, stats: WakeStats, clock: { h: number; m: number }, next?: string): string {
  if (r.delta_min == null) return "";
  const at = shortClock(clock.h, clock.m);
  const say: string[] = [];
  const d = r.delta_min;
  if (d <= 0) say.push(`De pie a las ${at}, ${d === 0 ? "justo a tu hora" : `${plural(-d, "minuto", "minutos")} antes de tu hora`}.`);
  else say.push(`De pie a las ${at}, a ${plural(d, "minuto", "minutos")} de tu hora.`);
  say.push(`${r.base} puntos${r.bonus ? `, más ${r.bonus} por la racha` : ""}.`);
  if (r.streak >= 2) say.push(`Llevas ${r.streak} mañanas seguidas a tiempo.`);
  else if (r.streak === 1) say.push(`Hoy empieza tu racha, ${owner}.`);
  else say.push("Mañana recuperamos la racha.");
  say.push(`Esta semana llevas ${stats.week_points} puntos.`);
  if (next) say.push(next);
  return say.join(" ");
}

/** El recordatorio mientras sigue en la cama: minutos y lo que vale levantarse YA. */
export function nudgeSpeech(owner: string, minutesLate: number, pointsNow: number): string {
  return `${owner}, van ${plural(minutesLate, "minuto", "minutos")} desde tu hora. Si te levantas ahora son ${pointsNow} puntos. Ponte de pie y presiona OK.`;
}
