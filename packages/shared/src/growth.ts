/**
 * El compañero (Hermes toma la iniciativa): lógica pura.
 *
 * Diseño completo en hermes-phone/docs/companero.md. Lo que vive aquí:
 * - el estado de una meta según la regla del dueño (sueño · objetivo · en marcha);
 * - cuándo toca preguntar por un plan y los vetos del lado del agente;
 * - el texto del check-in (plantilla: pregunta por TU plan, sin cifras inventadas);
 * - lo que se le pasa a la llamada semanal y cuándo suena la próxima.
 *
 * Sin red, sin disco y con el reloj inyectado: se prueba en
 * apps/agent/src/growth/growth.test.ts.
 */

// ── Tipos ────────────────────────────────────────────────────────────────

/** Regla del dueño: solo meta = sueño · con fecha = objetivo · con fecha y plan = en marcha. */
export type GoalStage = "sueno" | "objetivo" | "en_marcha";

/** Lo mínimo de una fila de `goals` que usa el compañero. */
export interface GrowthGoalRef {
  id: number;
  title: string;
  status: string;
  due_date?: string | null;
  created_at?: string | null;
  target_value?: number | null;
  current_value?: number | null;
  unit?: string | null;
}

/** Cuándo le toca al plan: días fijos a una hora, o un bloque de SU agenda. */
export type PlanWhen =
  | { kind: "weekly"; days: number[]; time: string }
  | { kind: "calendar"; match: string };

/** Cómo se sabe si se cumplió: el check-in de un hábito, o solo lo que él diga. */
export type PlanMeasure = { kind: "habit"; habit_id: number; habit_name?: string | null } | { kind: "self_report" };

export interface GrowthPlan {
  id: string;
  goal_id: number;
  /** El plan tal como lo dijo el dueño ("L-V a las 6 voy a calistenia"). */
  words: string;
  when: PlanWhen;
  measure: PlanMeasure;
  /** Minutos después de la hora del plan (o del fin del bloque) en que se pregunta. */
  checkin_after_min: number;
  /** Cuánto vale la pregunta: pasada la ventana ya no se manda. */
  window_min: number;
  status: "active" | "paused";
  created_at: string;
}

/** Qué llamada es: arrancar el día, cerrarlo o revisar la semana. */
export type CallKind = "morning" | "evening" | "weekly";

/** Una llamada que el DUEÑO agendó: días (1=lunes..7=domingo) y hora local. */
export interface CallSlot {
  kind: CallKind;
  days: number[];
  time: string;
}

export const CALL_LABEL: Record<CallKind, string> = {
  morning: "Arranque del día",
  evening: "Cierre del día",
  weekly: "Revisión semanal",
};

/** Tope de cada llamada en minutos: las diarias son cortas a propósito. */
export const CALL_MAX_MIN: Record<CallKind, number> = { morning: 3, evening: 3, weekly: 5 };

/** Si a la hora de la llamada hay una junta, se espera hasta este margen; pasado, no suena ese día. */
export const CALL_DEFER_MAX_MS = 90 * 60_000;

export interface GrowthSettings {
  /** Franja diaria en que acepta mensajes (hora local). */
  messages: { start: string; end: string };
  /** Las llamadas que agendó el dueño. Vacío = Hermes no llama. */
  calls: CallSlot[];
  /**
   * Qué hace el No molestar del teléfono con un check-in: "silent" = llega callado
   * a la bandeja (Android ya lo silencia) · "veto" = el teléfono lo retiene.
   */
  dnd: "silent" | "veto";
  /** Planes silenciados con "nunca de esto". */
  never_plans: string[];
}

export const DEFAULT_GROWTH_SETTINGS: GrowthSettings = {
  messages: { start: "07:00", end: "21:30" },
  calls: [],
  dnd: "silent",
  never_plans: [],
};

export const CHECKIN_REPLIES = ["Hecho", "Hoy no", "Hablemos"] as const;
export type CheckinReply = (typeof CHECKIN_REPLIES)[number];
export type InitiativeFeedback = "up" | "down" | "later" | "never";

/**
 * Una ocurrencia de un plan en un día, con lo que se decidió. Una por plan y
 * día: es el registro del motor (prueba de que nada salió en un veto) y la
 * base del ritmo semanal.
 */
export interface Initiative {
  id: string;
  kind: "checkin";
  plan_id: string;
  goal_id: number;
  /** Día local de la ocurrencia ("2026-10-15"). */
  date: string;
  /** Cuándo se decidió. */
  at: string;
  /**
   * skipped = no se mandó (ya estaba hecho, se pasó la ventana, frecuencia bajada) ·
   * dropped = presupuesto de avisos agotado · sent = salió al teléfono ·
   * shown = el teléfono lo mostró · vetoed = el teléfono no pudo mostrarlo en su ventana ·
   * answered = el dueño respondió.
   */
  status: "skipped" | "dropped" | "sent" | "shown" | "vetoed" | "answered";
  reason?: string;
  notice_id?: string;
  text?: string;
  why?: string;
  /** Fin de la ventana en que valía la pregunta. */
  not_after?: string;
  /** Cuándo la mostró el teléfono (en un momento sin veto). */
  shown_at?: string;
  reply?: { choice: string; at: string };
  feedback?: { value: InitiativeFeedback; at: string };
  /** La medida se cumplió ese día: antes de preguntar (sin recordatorio) o con "Hecho". */
  done: boolean;
  /** Se cumplió antes de que Hermes preguntara. */
  done_before?: boolean;
}

// ── Estado de una meta ───────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidDate(s: unknown): s is string {
  return typeof s === "string" && DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
}

export function isValidTime(s: unknown): s is string {
  return typeof s === "string" && TIME_RE.test(s);
}

export function goalStage(goal: GrowthGoalRef, plans: readonly GrowthPlan[]): GoalStage {
  if (!isValidDate(goal.due_date)) return "sueno";
  const active = plans.some((p) => p.goal_id === goal.id && p.status === "active");
  return active ? "en_marcha" : "objetivo";
}

export const STAGE_LABEL: Record<GoalStage, string> = {
  sueno: "Sueño",
  objetivo: "Objetivo",
  en_marcha: "En marcha",
};

// ── Tiempo en la zona del dueño ──────────────────────────────────────────

export interface LocalParts {
  /** "2026-10-15" */
  date: string;
  /** 1 = lunes … 7 = domingo */
  dow: number;
  /** Minutos desde la medianoche local. */
  minutes: number;
}

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export function localParts(at: Date, tz: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    dow: WEEKDAYS[get("weekday")] ?? 1,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

/** El instante en que el reloj de pared de `tz` marca `date` a las `time`. */
export function zonedInstant(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Dos pasadas: el desfase se mide en el instante tentativo (cambios de horario incluidos).
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(guess), tz);
    const [gy, gm, gd] = p.date.split("-").map(Number);
    const seen = Date.UTC(gy, gm - 1, gd, Math.floor(p.minutes / 60), p.minutes % 60);
    guess += wall - seen;
  }
  return new Date(guess);
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const es = (o: Intl.DateTimeFormatOptions, tz: string, at: Date) =>
  new Intl.DateTimeFormat("es-CO", { timeZone: tz, ...o }).format(at);

/** "jueves 15 de octubre" */
export function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** "6:00 a. m." en la zona del dueño. */
export function hourLabel(at: Date, tz: string): string {
  return es({ hour: "numeric", minute: "2-digit" }, tz, at);
}

// ── Ocurrencias del plan ─────────────────────────────────────────────────

/** Un evento de agenda reducido a lo que usa el compañero. */
export interface GrowthEvent {
  title: string;
  start: string;
  end: string | null;
  allDay: boolean;
}

export interface Occurrence {
  date: string;
  /** Inicio del plan (la hora fija o el inicio del bloque). */
  start: Date;
  /** Fin: igual al inicio en los planes de hora fija; el fin del bloque en los de agenda. */
  end: Date;
}

/** Sin acentos ni mayúsculas ni emojis: "🏋️ Gym" calza con "gym". */
export function normalizeTitle(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** La ocurrencia de HOY del plan, o null si hoy no le toca. */
export function planOccurrence(
  plan: GrowthPlan,
  now: Date,
  tz: string,
  events: readonly GrowthEvent[] = [],
): Occurrence | null {
  const today = localParts(now, tz);
  if (plan.when.kind === "weekly") {
    if (!plan.when.days.includes(today.dow) || !isValidTime(plan.when.time)) return null;
    const start = zonedInstant(today.date, plan.when.time, tz);
    return { date: today.date, start, end: start };
  }
  const needle = normalizeTitle(plan.when.match);
  if (!needle) return null;
  const hit = events
    .filter((e) => !e.allDay && normalizeTitle(e.title).includes(needle))
    .map((e) => ({ start: new Date(e.start), end: e.end ? new Date(e.end) : new Date(e.start) }))
    .filter((e) => !Number.isNaN(e.start.getTime()) && localParts(e.start, tz).date === today.date)
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  return hit ? { date: today.date, start: hit.start, end: hit.end } : null;
}

/** Ventana del check-in: desde `fin + checkin_after_min`, durante `window_min`, recortada a la franja de mensajes. */
export function checkinWindow(
  plan: GrowthPlan,
  occ: Occurrence,
  settings: GrowthSettings,
  tz: string,
): { not_before: Date; not_after: Date } | null {
  const from = new Date(occ.end.getTime() + plan.checkin_after_min * 60_000);
  const to = new Date(from.getTime() + plan.window_min * 60_000);
  const day = localParts(from, tz).date;
  const open = zonedInstant(day, settings.messages.start, tz);
  const close = zonedInstant(day, settings.messages.end, tz);
  const notBefore = new Date(Math.max(from.getTime(), open.getTime()));
  const notAfter = new Date(Math.min(to.getTime(), close.getTime()));
  return notBefore < notAfter ? { not_before: notBefore, not_after: notAfter } : null;
}

// ── Lo ignorado ──────────────────────────────────────────────────────────

/** Margen tras la ventana para dar un aviso por ignorado. */
export const IGNORED_AFTER_MS = 2 * 60 * 60_000;

/**
 * Cuántas preguntas seguidas de este plan quedaron sin respuesta (de la más
 * nueva hacia atrás). Lo que no se mandó (saltado, descartado, vetado) ni
 * suma ni corta: el dueño nunca lo vio.
 */
export function ignoredStreak(ledger: readonly Initiative[], planId: string, now: Date): number {
  let n = 0;
  const mine = ledger.filter((i) => i.plan_id === planId).sort((a, b) => b.at.localeCompare(a.at));
  for (const i of mine) {
    if (i.status === "answered" || i.reply) break;
    if (i.status !== "sent" && i.status !== "shown") continue;
    const end = i.not_after ? Date.parse(i.not_after) : Date.parse(i.at);
    if (now.getTime() < end + IGNORED_AFTER_MS) continue; // aún puede responder
    n += 1;
  }
  return n;
}

/** Con 3 o más seguidas sin respuesta, ese plan pregunta día por medio. */
export const SLOW_AFTER = 3;

// ── La decisión del agente ───────────────────────────────────────────────

export interface CheckinInput {
  now: Date;
  tz: string;
  plan: GrowthPlan;
  goal: GrowthGoalRef | undefined;
  plans: readonly GrowthPlan[];
  settings: GrowthSettings;
  ledger: readonly Initiative[];
  occurrence: Occurrence | null;
  /** La medida de hoy ya se cumplió (el check-in del hábito existe). */
  measureDone: boolean;
  /** Título de un evento de agenda en curso que NO es el del plan (una junta). */
  busyWith: string | null;
  /** Hay una junta en vivo en la Mac. */
  liveMeeting: boolean;
  /** Próxima llamada semanal: si cae en la próxima hora, no se escribe aparte. */
  nextCallAt: Date | null;
}

export type CheckinDecision =
  /** Nada que hacer ni que registrar (hoy no toca, meta sin fecha, plan en pausa…). */
  | { action: "idle"; reason: string }
  /** Aún no: se vuelve a mirar en el próximo barrido. */
  | { action: "wait"; reason: string }
  /** Se registra la ocurrencia sin mandar nada. */
  | { action: "skip"; reason: string; done: boolean }
  | { action: "send"; not_after: Date; slowedNote: boolean };

export function decideCheckin(i: CheckinInput): CheckinDecision {
  const { plan, goal } = i;
  if (plan.status !== "active") return { action: "idle", reason: "plan en pausa" };
  if (!goal || goal.status !== "active") return { action: "idle", reason: "meta inactiva o inexistente" };
  if (goalStage(goal, i.plans) !== "en_marcha") return { action: "idle", reason: "la meta no está en marcha (falta fecha o plan)" };
  if (i.settings.never_plans.includes(plan.id)) return { action: "idle", reason: "silenciado con «nunca de esto»" };
  const occ = i.occurrence;
  if (!occ) return { action: "idle", reason: "hoy no le toca" };
  // Un plan recién dicho no pregunta por lo que ya pasó: "¿hiciste lo de las 12?" a un plan creado a las 2 no es la pregunta.
  if (occ.start.getTime() < Date.parse(plan.created_at)) return { action: "idle", reason: "el plan es posterior a esta ocurrencia" };
  if (i.ledger.some((x) => x.plan_id === plan.id && x.date === occ.date)) {
    return { action: "idle", reason: "ya se decidió hoy" };
  }
  const win = checkinWindow(plan, occ, i.settings, i.tz);
  if (!win) return { action: "skip", reason: "la ventana queda fuera de tu franja de mensajes", done: i.measureDone };
  if (i.now < win.not_before) return { action: "wait", reason: "aún no es la hora" };
  // Lo hizo antes de que Hermes preguntara: no se escribe y cuenta como "sin recordatorio".
  if (i.measureDone) return { action: "skip", reason: "ya estaba hecho", done: true };
  if (i.now >= win.not_after) return { action: "skip", reason: "se pasó la ventana sin un momento libre", done: false };

  const streak = ignoredStreak(i.ledger, plan.id, i.now);
  if (streak >= SLOW_AFTER) {
    const yesterday = addDays(occ.date, -1);
    const sentYesterday = i.ledger.some(
      (x) => x.plan_id === plan.id && x.date === yesterday && (x.status === "sent" || x.status === "shown"),
    );
    if (sentYesterday) return { action: "skip", reason: `día por medio (${streak} seguidas sin respuesta)`, done: false };
  }

  // Vetos que pueden pasar dentro de la ventana: se espera, no se descarta.
  if (i.liveMeeting) return { action: "wait", reason: "junta en vivo en la Mac" };
  if (i.busyWith) return { action: "wait", reason: `en «${i.busyWith}»` };
  if (i.nextCallAt && i.nextCallAt > i.now && i.nextCallAt.getTime() - i.now.getTime() <= 60 * 60_000) {
    return { action: "wait", reason: "la llamada semanal es en menos de una hora" };
  }
  return { action: "send", not_after: win.not_after, slowedNote: streak === SLOW_AFTER };
}

/**
 * El evento de agenda en curso que veta escribir: no es de todo el día y no es
 * el bloque del propio plan (estar "en el gym" no es estar ocupado para el gym).
 */
export function busyEvent(events: readonly GrowthEvent[], now: Date, ownMatch?: string): string | null {
  const own = ownMatch ? normalizeTitle(ownMatch) : "";
  for (const e of events) {
    if (e.allDay) continue;
    const s = Date.parse(e.start);
    const end = e.end ? Date.parse(e.end) : s;
    if (Number.isNaN(s) || !(s <= now.getTime() && now.getTime() < end)) continue;
    if (own && normalizeTitle(e.title).includes(own)) continue;
    return e.title;
  }
  return null;
}

// ── El texto ─────────────────────────────────────────────────────────────

function dueLabel(due: string | null | undefined): string {
  return isValidDate(due)
    ? new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${due}T12:00:00Z`))
    : "";
}

/**
 * El check-in: UNA pregunta sobre el plan que él escribió, sin cifras ni
 * elogios. El porqué dice qué lo disparó y de dónde sale.
 */
export function checkinMessage(
  plan: GrowthPlan,
  goal: GrowthGoalRef,
  occ: Occurrence,
  tz: string,
  slowedNote = false,
): { title: string; body: string; why: string } {
  const words = plan.words.trim().replace(/[«»"]/g, "");
  const when = plan.when.kind === "weekly" ? `a las ${hourLabel(occ.start, tz)}` : `en tu bloque de las ${hourLabel(occ.start, tz)}`;
  const body =
    `Tu plan de hoy ${when}: «${words}». ¿Lo hiciste?` +
    (slowedNote ? " (Como no respondiste las últimas 3, de este plan te pregunto día por medio.)" : "");
  const measure =
    plan.measure.kind === "habit"
      ? `y no hay check-in de «${plan.measure.habit_name ?? "tu hábito"}» hoy`
      : "y aún no me has dicho si lo hiciste";
  const due = dueLabel(goal.due_date);
  const why = `Por qué te escribo: es el plan de tu meta «${goal.title}»${due ? ` (para el ${due})` : ""}, tocaba ${when} ${measure}.`;
  return { title: goal.title, body, why };
}

// ── La semana y la llamada ───────────────────────────────────────────────

/** Ocurrencias del plan en [from, to] (días locales) y en cuántas se cumplió. */
export function planWeek(
  ledger: readonly Initiative[],
  planId: string,
  from: string,
  to: string,
): { occurrences: number; done: number; without_reminder: number } {
  const mine = ledger.filter((i) => i.plan_id === planId && i.date >= from && i.date <= to);
  return {
    occurrences: mine.length,
    done: mine.filter((i) => i.done).length,
    without_reminder: mine.filter((i) => i.done_before).length,
  };
}

/** Días que faltan (calendario local) hasta la fecha de la meta; negativo = vencida. */
export function daysLeft(due: string, today: string): number {
  return Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

/** La próxima llamada agendada estrictamente después de `now` (la más cercana entre todas). */
export function nextCall(settings: GrowthSettings, now: Date, tz: string): { at: Date; kind: CallKind } | null {
  const today = localParts(now, tz);
  let best: { at: Date; kind: CallKind } | null = null;
  for (let k = 0; k <= 7; k++) {
    const date = addDays(today.date, k);
    const dow = ((today.dow - 1 + k) % 7) + 1;
    for (const slot of settings.calls) {
      if (!slot.days.includes(dow) || !isValidTime(slot.time)) continue;
      const at = zonedInstant(date, slot.time, tz);
      if (at > now && (!best || at < best.at)) best = { at, kind: slot.kind };
    }
    if (best) return best;
  }
  return best;
}

/** Id estable de una llamada: dice qué llamada es y cuándo (el teléfono deduplica por él). */
export function callId(at: Date, kind: CallKind = "weekly"): string {
  return `call-${kind}-${at.toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
}

/** Qué llamada es y a qué hora estaba agendada, desde su id ("call-202610151930" viejo = semanal). */
export function parseCallId(id: string): { kind: CallKind; at: Date | null } {
  const m = /^call-(?:(morning|evening|weekly)-)?(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(id);
  if (!m) return { kind: "weekly", at: null };
  const at = new Date(Date.UTC(+m[2], +m[3] - 1, +m[4], +m[5], +m[6]));
  return { kind: (m[1] as CallKind | undefined) ?? "weekly", at };
}

/**
 * ¿Hay una junta de la agenda en curso? La llamada espera a que termine (no
 * suena encima de un daily); si termina después de `deadline`, ese día no suena.
 */
export function callBusy(
  events: readonly GrowthEvent[],
  now: Date,
  deadline: Date,
): { title: string; retryAt: Date } | { title: string; skip: true } | null {
  let busyUntil = now.getTime();
  let title: string | null = null;
  // Juntas seguidas (un daily detrás de otro) se encadenan: se espera hasta que haya un hueco.
  for (let guard = 0; guard < 6; guard++) {
    const hit = events.find((e) => {
      if (e.allDay) return false;
      const s = Date.parse(e.start);
      const end = e.end ? Date.parse(e.end) : s;
      return !Number.isNaN(s) && s <= busyUntil && busyUntil < end;
    });
    if (!hit) break;
    title = title ?? hit.title;
    busyUntil = Date.parse(hit.end as string);
  }
  if (!title) return null;
  const retryAt = new Date(busyUntil + 2 * 60_000);
  return retryAt > deadline ? { title, skip: true } : { title, retryAt };
}

export interface CallContext {
  opening: string;
  /** Líneas con dato y fuente; van como variable dinámica al agente de voz. */
  lines: string[];
}

/**
 * Lo que Hermes sabe de la semana para la llamada: solo metas en marcha con
 * sus planes, el avance numérico si existe, las marcas reales de los hábitos
 * que miden un plan, y una línea con los sueños sin fecha. Cada línea dice de
 * dónde sale.
 *
 * Lo que NO hay se dice como falta de dato, nunca como cero: en la primera
 * prueba real, "sin ocurrencias registradas" de un plan creado ese mismo día
 * salió por voz como "cero clases de inglés, no ocurrieron", y el día anterior
 * había clase con el hábito marcado.
 */
export function weeklyCallContext(input: {
  goals: readonly GrowthGoalRef[];
  plans: readonly GrowthPlan[];
  ledger: readonly Initiative[];
  now: Date;
  tz: string;
  /** Días con el hábito marcado en los últimos 7 días, por id de hábito (fuente: check-ins). */
  habitDays?: Readonly<Record<number, readonly string[]>>;
}): CallContext {
  const today = localParts(input.now, input.tz).date;
  const from = addDays(today, -6);
  const short = (d: string) =>
    new Intl.DateTimeFormat("es-CO", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00Z`));
  const localDay = (iso: string | null | undefined) => (iso && !Number.isNaN(Date.parse(iso)) ? localParts(new Date(iso), input.tz).date : null);
  const lines: string[] = [];
  const active = input.goals.filter((g) => g.status === "active");
  for (const g of active) {
    if (goalStage(g, input.plans) !== "en_marcha") continue;
    const due = g.due_date as string;
    const left = daysLeft(due, today);
    const born = localDay(g.created_at);
    const head =
      `Meta «${g.title}», para el ${dueLabel(due)} (${left >= 0 ? `faltan ${left} días` : `venció hace ${-left} días`})` +
      `${born && born >= from ? `, creada el ${short(born)}` : ""}.`;
    const numeric =
      g.target_value != null
        ? ` Avance registrado: ${g.current_value ?? 0} de ${g.target_value}${g.unit ? ` ${g.unit}` : ""} (fuente: tabla de metas).`
        : "";
    lines.push(head + numeric);
    for (const p of input.plans.filter((x) => x.goal_id === g.id && x.status === "active")) {
      const w = planWeek(input.ledger, p.id, from, today);
      const planBorn = localDay(p.created_at);
      let line = `  Plan «${p.words}»: `;
      if (w.occurrences) {
        line +=
          `cumplido ${w.done} de ${w.occurrences} veces en los últimos 7 días` +
          `${w.without_reminder ? `, ${w.without_reminder} sin que Hermes preguntara` : ""} (fuente: check-ins y respuestas a Hermes).`;
      } else if (planBorn && planBorn >= from) {
        line += `plan nuevo (creado el ${short(planBorn)}): aún no le ha tocado ninguna vez, así que no hay dato de cumplimiento.`;
      } else {
        line += "sin dato de cumplimiento esta semana (no quiere decir que no lo hizo: pregúntale).";
      }
      lines.push(line);
      if (p.measure.kind === "habit" && input.habitDays) {
        const days = input.habitDays[p.measure.habit_id];
        if (days) {
          const name = p.measure.habit_name ?? "el hábito";
          lines.push(
            days.length
              ? `  Hábito «${name}»: marcado ${days.length} ${days.length === 1 ? "vez" : "veces"} en los últimos 7 días (${days.map(short).join(", ")}) (fuente: hábitos).`
              : `  Hábito «${name}»: sin marcas en los últimos 7 días (fuente: hábitos).`,
          );
        }
      }
    }
  }
  const dreams = active.filter((g) => goalStage(g, input.plans) !== "en_marcha").map((g) => `«${g.title}»`);
  if (dreams.length) lines.push(`Metas sin fecha o sin plan (sueños u objetivos): ${dreams.join(", ")}.`);
  if (!lines.length) lines.push("No hay metas en marcha: ninguna meta activa tiene fecha y plan.");
  const day = new Intl.DateTimeFormat("es-CO", { timeZone: input.tz, weekday: "long" }).format(input.now);
  return {
    opening: `Te llamo porque es ${day} a las ${hourLabel(input.now, input.tz)} y quedamos en revisar la semana. Son cinco minutos.`,
    lines,
  };
}

/**
 * Las llamadas diarias, cortas: la de la MAÑANA dice qué planes tocan hoy y qué
 * hay en la agenda, y pregunta por UNA intención; la de la TARDE repasa los
 * planes de hoy (hecho, "hoy no" o sin dato: se pregunta) y lo de mañana.
 * Mismo principio que la semanal: lo que no hay es falta de dato, nunca cero.
 */
export function dailyCallContext(input: {
  kind: "morning" | "evening";
  goals: readonly GrowthGoalRef[];
  plans: readonly GrowthPlan[];
  ledger: readonly Initiative[];
  events: readonly GrowthEvent[];
  now: Date;
  tz: string;
  /** Hábitos marcados HOY, por id (fuente: check-ins). */
  habitToday?: Readonly<Record<number, boolean>>;
}): CallContext {
  const today = localParts(input.now, input.tz).date;
  const goalOf = (p: GrowthPlan) => input.goals.find((g) => g.id === p.goal_id);
  const live = input.plans.filter((p) => {
    const g = goalOf(p);
    return p.status === "active" && g && g.status === "active" && goalStage(g, input.plans) === "en_marcha";
  });
  // Como en los check-ins: lo que pasó antes de que existiera el plan no se pregunta.
  const occToday = (p: GrowthPlan) => {
    const o = planOccurrence(p, input.now, input.tz, input.events);
    return o && o.start.getTime() >= Date.parse(p.created_at) ? o : null;
  };
  const lines: string[] = [];
  if (input.kind === "morning") {
    const todays = live.map((p) => ({ p, o: occToday(p) })).filter((x) => x.o);
    lines.push(todays.length ? "Planes que te tocan hoy (fuente: tus planes):" : "Hoy no te toca ningún plan de tus metas (fuente: tus planes).");
    for (const { p, o } of todays) lines.push(`  ${hourLabel(o!.start, input.tz)} · «${p.words}» (meta «${goalOf(p)!.title}»).`);
    const agenda = input.events
      .filter((e) => !e.allDay && Date.parse(e.start) >= input.now.getTime() && localParts(new Date(e.start), input.tz).date === today)
      .sort((a, b) => a.start.localeCompare(b.start))
      .slice(0, 6);
    if (agenda.length) {
      lines.push("Lo que sigue en tu agenda hoy (fuente: calendario):");
      for (const e of agenda) lines.push(`  ${hourLabel(new Date(e.start), input.tz)} · ${e.title}`);
    }
  } else {
    const todays = live.map((p) => ({ p, o: occToday(p) })).filter((x) => x.o);
    lines.push(todays.length ? "Tus planes de hoy y lo que se sabe (fuente: check-ins, hábitos y tus respuestas):" : "Hoy no te tocaba ningún plan de tus metas.");
    for (const { p } of todays) {
      const rec = input.ledger.find((i) => i.plan_id === p.id && i.date === today);
      const habitDone = p.measure.kind === "habit" ? input.habitToday?.[p.measure.habit_id] : undefined;
      const known =
        rec?.done || habitDone
          ? "hecho"
          : rec?.reply?.choice === "Hoy no"
            ? "respondiste «Hoy no»"
            : rec?.status === "dropped" || rec?.status === "skipped" || rec?.status === "vetoed"
              ? "Hermes no te preguntó: sin dato, pregúntale"
              : "sin respuesta todavía: sin dato, pregúntale";
      lines.push(`  «${p.words}»: ${known}.`);
    }
    const tomorrow = addDays(today, 1);
    const tomorrowAt = zonedInstant(tomorrow, "12:00", input.tz);
    const next = live
      .map((p) => ({ p, o: p.when.kind === "weekly" ? planOccurrence(p, tomorrowAt, input.tz) : null }))
      .filter((x) => x.o);
    if (next.length) {
      lines.push("Mañana te tocan (fuente: tus planes):");
      for (const { p, o } of next) lines.push(`  ${hourLabel(o!.start, input.tz)} · «${p.words}».`);
    }
  }
  const opening =
    input.kind === "morning"
      ? "Buenos días. Te llamo para arrancar el día, son tres minutos."
      : "Te llamo para cerrar el día, son tres minutos.";
  return { opening, lines };
}

// ── Validación de lo que llega de afuera ─────────────────────────────────

export function parsePlanWhen(raw: unknown): PlanWhen | null {
  const o = (raw ?? {}) as Record<string, unknown>;
  if (o.kind === "weekly") {
    const days = Array.isArray(o.days) ? [...new Set(o.days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))].sort() : [];
    return days.length && isValidTime(o.time) ? { kind: "weekly", days, time: o.time } : null;
  }
  if (o.kind === "calendar") {
    const match = typeof o.match === "string" ? o.match.trim().slice(0, 80) : "";
    return normalizeTitle(match) ? { kind: "calendar", match } : null;
  }
  return null;
}

export function parseGrowthSettings(raw: unknown, base: GrowthSettings = DEFAULT_GROWTH_SETTINGS): GrowthSettings {
  const o = (raw ?? {}) as Record<string, unknown>;
  const m = (o.messages ?? {}) as Record<string, unknown>;
  const messages =
    isValidTime(m.start) && isValidTime(m.end) && m.start < m.end ? { start: m.start, end: m.end } : base.messages;
  let calls = base.calls;
  if (Array.isArray(o.calls)) {
    calls = o.calls.flatMap((x): CallSlot[] => {
      const c = (x ?? {}) as Record<string, unknown>;
      const kind: CallKind | null = c.kind === "morning" || c.kind === "evening" || c.kind === "weekly" ? c.kind : null;
      const days = Array.isArray(c.days)
        ? [...new Set(c.days.filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))].sort()
        : [];
      return kind && days.length && isValidTime(c.time) ? [{ kind, days, time: c.time }] : [];
    }).slice(0, 6);
  } else if (o.weekly_call === null) {
    calls = calls.filter((c) => c.kind !== "weekly");
  } else if (o.weekly_call && typeof o.weekly_call === "object") {
    // Forma vieja (una sola llamada semanal): se convierte.
    const w = o.weekly_call as Record<string, unknown>;
    if (Number.isInteger(w.dow) && (w.dow as number) >= 1 && (w.dow as number) <= 7 && isValidTime(w.time)) {
      calls = [...calls.filter((c) => c.kind !== "weekly"), { kind: "weekly", days: [w.dow as number], time: w.time }];
    }
  }
  const dnd = o.dnd === "veto" || o.dnd === "silent" ? o.dnd : base.dnd;
  const never_plans = Array.isArray(o.never_plans)
    ? o.never_plans.filter((x): x is string => typeof x === "string").slice(0, 200)
    : base.never_plans;
  return { messages, calls, dnd, never_plans };
}
