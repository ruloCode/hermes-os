/**
 * v6 «Núcleo»: lógica pura del PULSO (openspec/changes/v6-nucleo/specs/pulso).
 *
 * El pulso reemplaza la idea de «un job por función» por un solo observador que
 * mira el estado agregado cada 10 min. Dos reglas lo ordenan:
 *
 *  1. **Bandeja antes que aviso.** Todo lo que encuentra queda en una bandeja;
 *     solo lo urgente, con `HERMES_PULSE=notify` y presupuesto, suena.
 *  2. **No gasta si nada cambió.** El estado se convierte en SITUACIONES con una
 *     clave estable (`situations`). `diffState` compara claves: que avance el
 *     reloj no es un cambio; que un evento entre en la ventana de «empieza en
 *     menos de 30 min sin preparación», sí (aparece una clave nueva).
 *
 * Lo determinista (un pendiente vencido, una tarea bloqueada) sale por REGLA,
 * sin modelo. El modelo solo ve lo que pide juicio (oportunidad, meta sin
 * avance, foco, finanzas) y puede decir «nada».
 *
 * Todo aquí recibe el reloj y la zona horaria: nada lee `Date.now()`.
 */

// ── Tipos ────────────────────────────────────────────────────────────────

export const PULSE_KINDS = [
  "junta-sin-preparar",
  "pendiente-vencido",
  "accionables-sin-triage",
  "meta-sin-avance",
  "tarea-bloqueada",
  "oportunidad",
  "habito",
  "foco",
  "finanzas",
] as const;
export type PulseKind = (typeof PULSE_KINDS)[number];

export const PULSE_KIND_LABEL: Record<PulseKind, string> = {
  "junta-sin-preparar": "Junta sin preparar",
  "pendiente-vencido": "Pendiente vencido",
  "accionables-sin-triage": "Accionables sin decidir",
  "meta-sin-avance": "Meta sin avance",
  "tarea-bloqueada": "Tarea programada",
  oportunidad: "Oportunidad",
  habito: "Hábitos",
  foco: "Foco",
  finanzas: "Finanzas",
};

export const PULSE_SOURCE_KINDS = ["calendar", "day-task", "meeting", "goal", "scheduled", "upwork", "habit", "focus", "finance"] as const;
export type PulseSourceKind = (typeof PULSE_SOURCE_KINDS)[number];

export interface PulseSource {
  kind: PulseSourceKind;
  /** Id en su fuente (evento, tarea, `proyecto/acta`, jobId…). */
  ref: string;
  /** Cómo se nombra en la tarjeta ("Agenda", "Acta del 9-nov"…). */
  label: string;
  /** Enlace externo cuando la fuente vive fuera de Hermes (oferta de Upwork). */
  url?: string;
}

export interface PulseCard {
  id: string;
  /** Clave de la situación que la produjo: la misma situación no da dos tarjetas. */
  key: string;
  kind: PulseKind;
  title: string;
  text: string;
  /** Por qué está en la bandeja (visible). */
  why: string;
  source: PulseSource;
  urgent: boolean;
  createdAt: string;
  expiresAt: string;
  /** Quién la redactó: una regla o el modelo. */
  by: "rule" | "model";
  /** Solo con `HERMES_PULSE=notify`: si salió como aviso y, si no, por qué. */
  notice?: { sent: boolean; reason: string };
}

// ── Estado agregado (foto compacta) ─────────────────────────────────────
// Cada sección es opcional: la fuente que falla o no existe simplemente no está.

export interface PulseEvent {
  id: string;
  title: string;
  start: string;
  allDay: boolean;
  /** Proyecto reconocido (lo resuelve la preparación de juntas). */
  project?: string | null;
  /** true = hay hoja de preparación de hoy; false = no; ausente = no aplica. */
  prepared?: boolean;
}

export interface PulseTask {
  id: number;
  title: string;
  due: string | null;
}

export interface PulseHabit {
  name: string;
  done: boolean;
}

export interface PulseMeeting {
  project: string;
  id: string;
  title: string;
  /** Fecha ISO del acta. */
  date: string;
  /** Accionables sin decidir (sin tarea ni issue). */
  untriaged: number;
}

export interface PulseGoal {
  id: number;
  title: string;
  due: string | null;
  /** Ocurrencias del plan en los últimos 7 días y cuántas se hicieron. */
  occurrences: number;
  done: number;
}

export interface PulseScheduled {
  id: string;
  title: string;
  blocked: string | null;
  failures: number;
}

export interface PulseOpportunity {
  id: string;
  title: string;
  score: number;
  receivedAt: string;
  url?: string;
}

export interface PulseFocus {
  date: string;
  /** Minutos de hoy (hasta ahora) en las apps que el dueño marcó como distracción. */
  minutes: number;
  /** Promedio por día completo de los últimos días con dato. */
  average: number;
  days: number;
}

export interface PulseFinance {
  month: string;
  /** El gasto variable del mes ya pasó lo que el plan dejaba libre. */
  over: boolean;
  /** Categorías por encima de su mediana (solo nombres: NUNCA montos). */
  drift: string[];
}

export interface PulseState {
  at: string;
  events?: PulseEvent[];
  tasks?: PulseTask[];
  habits?: PulseHabit[];
  meetings?: PulseMeeting[];
  goals?: PulseGoal[];
  scheduled?: PulseScheduled[];
  opportunities?: PulseOpportunity[];
  focus?: PulseFocus;
  finance?: PulseFinance;
  /** Qué fuentes respondieron y cuáles fallaron (para el registro). */
  sources: { ok: string[]; failed: string[] };
}

// ── Reloj y zona ────────────────────────────────────────────────────────

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Fecha y minutos locales de un instante. */
export function pulseLocal(at: Date, tz: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

export const QUIET_START_H = 22;
export const QUIET_END_H = 7;

/** De 22:00 a 7:00 hora local no se llama al modelo ni se avisa. */
export function quietHours(now: Date, tz: string, startH = QUIET_START_H, endH = QUIET_END_H): boolean {
  const m = pulseLocal(now, tz).minutes;
  return startH > endH ? m >= startH * 60 || m < endH * 60 : m >= startH * 60 && m < endH * 60;
}

function plusDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Lunes de la semana local (clave de «una vez por semana»). */
function mondayOfDate(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return plusDays(date, -((dow + 6) % 7));
}

/** Hash corto y estable (FNV-1a) para ids de tarjeta. */
export function pulseHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ── Situaciones ─────────────────────────────────────────────────────────

/** Ventana de «la junta empieza pronto». */
export const MEETING_SOON_MIN = 30;
/** Desde esta hora local se mira si quedan hábitos sin marcar. */
export const HABIT_CHECK_H = 20;
/** Actas de hasta estos días con accionables sin decidir. */
export const MEETING_RECENT_DAYS = 3;
/** Oportunidades de hasta estas horas. */
export const OPPORTUNITY_MAX_AGE_H = 24;
/** Foco: hoy por encima del promedio en este factor Y por al menos estos minutos. */
export const FOCUS_FACTOR = 1.5;
export const FOCUS_MIN_OVER = 30;

export interface PulseSituation {
  key: string;
  kind: PulseKind;
  /** `rule` = tarjeta por regla, sin modelo. `judgment` = la decide el modelo. */
  mode: "rule" | "judgment";
  /** El hecho en una línea, para el modelo y el registro. */
  fact: string;
  source: PulseSource;
  urgent: boolean;
  expiresAt: string;
  /** Solo en las de regla: la tarjeta ya redactada. */
  card?: { title: string; text: string; why: string };
}

function hm(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("es-CO", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Las situaciones que hay en un estado, con la clave que las identifica.
 * Depende de `state.at` (el reloj de la foto): así cruzar una ventana es un
 * cambio y el simple paso del tiempo no.
 */
export function situations(state: PulseState, tz: string): PulseSituation[] {
  const now = new Date(state.at);
  const nowMs = now.getTime();
  const { date: today, minutes } = pulseLocal(now, tz);
  const endOfDay = new Date(nowMs + (24 * 60 - minutes) * MIN).toISOString();
  const inHours = (h: number) => new Date(nowMs + h * HOUR).toISOString();
  const out: PulseSituation[] = [];

  for (const e of state.events ?? []) {
    if (e.allDay || !e.project || e.prepared !== false) continue;
    const startMs = Date.parse(e.start);
    const inMin = (startMs - nowMs) / MIN;
    if (!(inMin > 0 && inMin <= MEETING_SOON_MIN)) continue;
    out.push({
      key: `junta-sin-preparar:${e.id}`,
      kind: "junta-sin-preparar",
      mode: "rule",
      fact: `«${e.title}» empieza a las ${hm(e.start, tz)} (proyecto ${e.project}) y no tiene hoja de preparación de hoy.`,
      source: { kind: "calendar", ref: e.id, label: `Agenda · ${hm(e.start, tz)}` },
      urgent: true,
      expiresAt: new Date(startMs + 30 * MIN).toISOString(),
      card: {
        title: `Prepara «${e.title}»`,
        text: `Empieza a las ${hm(e.start, tz)} y aún no tiene hoja de preparación. Armarla toma un par de minutos.`,
        why: `Faltan ${Math.round(inMin)} min y la preparación de hoy de ${e.project} no existe.`,
      },
    });
  }

  for (const t of state.tasks ?? []) {
    if (!t.due || t.due >= today) continue;
    out.push({
      key: `pendiente-vencido:${t.id}:${t.due}`,
      kind: "pendiente-vencido",
      mode: "rule",
      fact: `El pendiente «${t.title}» venció el ${t.due}.`,
      source: { kind: "day-task", ref: String(t.id), label: "Mi día" },
      urgent: false,
      expiresAt: endOfDay,
      card: {
        title: t.title,
        text: `Venció el ${t.due} y sigue abierto. Hazlo, muévelo a otra fecha o ciérralo.`,
        why: "Un pendiente con fecha pasada se arrastra solo a hoy.",
      },
    });
  }

  const habits = state.habits ?? [];
  const missing = habits.filter((h) => !h.done);
  if (minutes >= HABIT_CHECK_H * 60 && missing.length) {
    out.push({
      key: `habito:${today}`,
      kind: "habito",
      mode: "rule",
      fact: `A las ${HABIT_CHECK_H}:00 quedan sin marcar: ${missing.map((h) => h.name).join(", ")}.`,
      source: { kind: "habit", ref: today, label: "Hábitos de hoy" },
      urgent: false,
      expiresAt: endOfDay,
      card: {
        title: `${plural(missing.length, "hábito", "hábitos")} sin marcar hoy`,
        text: missing.map((h) => h.name).join(" · "),
        why: `Son más de las ${HABIT_CHECK_H}:00 y hoy no tienen check-in.`,
      },
    });
  }

  for (const m of state.meetings ?? []) {
    if (m.untriaged <= 0) continue;
    if (nowMs - Date.parse(m.date) > MEETING_RECENT_DAYS * DAY) continue;
    const ref = `${m.project}/${m.id}`;
    out.push({
      key: `accionables-sin-triage:${ref}`,
      kind: "accionables-sin-triage",
      mode: "rule",
      fact: `El acta «${m.title}» (${m.project}) tiene ${m.untriaged} accionables sin decidir.`,
      source: { kind: "meeting", ref, label: `Acta · ${m.project}` },
      urgent: false,
      expiresAt: new Date(Date.parse(m.date) + MEETING_RECENT_DAYS * DAY).toISOString(),
      card: {
        title: `Decide los accionables de «${m.title}»`,
        text: `${plural(m.untriaged, "accionable", "accionables")} de la junta siguen sin decidir: ejecutar, pasar a Linear o ignorar.`,
        why: "Lo acordado en una junta se pierde si nadie lo tría en los días siguientes.",
      },
    });
  }

  for (const s of state.scheduled ?? []) {
    if (s.blocked) {
      out.push({
        key: `tarea-bloqueada:${s.id}:${pulseHash(s.blocked)}`,
        kind: "tarea-bloqueada",
        mode: "rule",
        fact: `La tarea programada «${s.title}» está bloqueada: ${s.blocked}`,
        source: { kind: "scheduled", ref: s.id, label: "Tareas programadas" },
        urgent: false,
        expiresAt: inHours(72),
        card: {
          title: `«${s.title}» dejó de correr`,
          text: s.blocked.slice(0, 240),
          why: "Una tarea programada se bloquea a los 3 fallos seguidos: no vuelve a correr hasta que la revises.",
        },
      });
    }
  }

  for (const g of state.goals ?? []) {
    if (g.occurrences < 2 || g.done > 0) continue;
    out.push({
      key: `meta-sin-avance:${g.id}:${mondayOfDate(today)}`,
      kind: "meta-sin-avance",
      mode: "judgment",
      fact: `La meta en marcha «${g.title}»${g.due ? ` (fecha ${g.due})` : ""}: ${g.occurrences} ocurrencias de su plan en 7 días, ninguna hecha.`,
      source: { kind: "goal", ref: String(g.id), label: "Metas en marcha" },
      urgent: false,
      expiresAt: inHours(72),
    });
  }

  for (const o of state.opportunities ?? []) {
    if (nowMs - Date.parse(o.receivedAt) > OPPORTUNITY_MAX_AGE_H * HOUR) continue;
    out.push({
      key: `oportunidad:${o.id}`,
      kind: "oportunidad",
      mode: "judgment",
      fact: `Oportunidad nueva con puntaje ${o.score}: «${o.title}» (llegó ${hm(o.receivedAt, tz)}).`,
      source: { kind: "upwork", ref: o.id, label: "Upwork", ...(o.url ? { url: o.url } : {}) },
      urgent: false,
      expiresAt: new Date(Date.parse(o.receivedAt) + OPPORTUNITY_MAX_AGE_H * HOUR).toISOString(),
    });
  }

  const f = state.focus;
  if (f && f.date === today && f.days >= 3 && f.minutes >= f.average * FOCUS_FACTOR && f.minutes - f.average >= FOCUS_MIN_OVER) {
    out.push({
      key: `foco:${today}`,
      kind: "foco",
      mode: "judgment",
      fact: `Hoy van ${f.minutes} min en apps de distracción; el promedio de un día completo es ${Math.round(f.average)} min (${f.days} días).`,
      source: { kind: "focus", ref: today, label: "Uso del teléfono" },
      urgent: false,
      expiresAt: endOfDay,
    });
  }

  const fin = state.finance;
  if (fin) {
    // Sin montos: el modelo no ve cifras, así no puede escribirlas.
    if (fin.over) {
      out.push({
        key: `finanzas:excedido:${fin.month}`,
        kind: "finanzas",
        mode: "judgment",
        fact: "El gasto variable del mes ya pasó lo que el plan dejaba libre.",
        source: { kind: "finance", ref: `${fin.month}:plan`, label: "Finanzas de hoy" },
        urgent: false,
        expiresAt: inHours(72),
      });
    }
    for (const c of fin.drift) {
      out.push({
        key: `finanzas:desvio:${fin.month}:${c}`,
        kind: "finanzas",
        mode: "judgment",
        fact: `La categoría «${c}» va por encima de su mediana de tres meses.`,
        source: { kind: "finance", ref: `${fin.month}:${c}`, label: "Finanzas · desvíos" },
        urgent: false,
        expiresAt: inHours(72),
      });
    }
  }

  return out;
}

export interface PulseDiff {
  /** Situaciones que no estaban en la foto anterior. */
  added: PulseSituation[];
  /** Claves que estaban y ya no (se resolvieron o vencieron). */
  resolved: string[];
}

/**
 * Qué cambió de forma RELEVANTE. Compara claves de situación: un evento que
 * cambia de título, un pendiente más sin fecha, o el reloj avanzando dentro de
 * una ventana no son cambios. Sin foto anterior, todo es nuevo.
 */
export function diffState(prev: PulseState | null, next: PulseState, tz: string): PulseDiff {
  const before = new Set(prev ? situations(prev, tz).map((s) => s.key) : []);
  const now = situations(next, tz);
  const nowKeys = new Set(now.map((s) => s.key));
  // Una fuente que FALLÓ en la foto nueva no resuelve nada: sus situaciones no desaparecieron, no se ven.
  const failed = new Set(next.sources.failed);
  const resolved = [...before].filter((k) => !nowKeys.has(k) && !failed.has(sectionOfKind(k.split(":")[0] as PulseKind)));
  return { added: now.filter((s) => !before.has(s.key)), resolved };
}

const SECTIONS = ["events", "tasks", "habits", "meetings", "goals", "scheduled", "opportunities", "focus", "finance"] as const;

/**
 * Una fuente que falló en esta pasada conserva lo que se sabía de ella en la
 * foto anterior. Sin esto, una caída de Supabase haría desaparecer sus
 * situaciones y al volver serían "nuevas": otra llamada al modelo por nada.
 */
export function carryOver(prev: PulseState | null, next: PulseState): PulseState {
  if (!prev) return next;
  const out: PulseState = { ...next };
  for (const sec of SECTIONS) {
    if (next.sources.failed.includes(sec) && prev[sec] !== undefined) (out as unknown as Record<string, unknown>)[sec] = prev[sec];
  }
  return out;
}

/** Sección de PulseState de donde sale cada clase (para no "resolver" por una fuente caída). */
export function sectionOfKind(kind: PulseKind): keyof PulseState {
  const map: Record<PulseKind, keyof PulseState> = {
    "junta-sin-preparar": "events",
    "pendiente-vencido": "tasks",
    "accionables-sin-triage": "meetings",
    "meta-sin-avance": "goals",
    "tarea-bloqueada": "scheduled",
    oportunidad: "opportunities",
    habito: "habits",
    foco: "focus",
    finanzas: "finance",
  };
  return map[kind];
}

// ── Bandeja ─────────────────────────────────────────────────────────────

export const PULSE_MAX_LIVE = 12;
/** Cuánto se recuerda una tarjeta descartada (para que no vuelva por la misma causa). */
export const DISMISSED_KEEP_MS = 30 * DAY;

export interface PulseInbox {
  cards: PulseCard[];
  dismissed: { key: string; at: string }[];
  never: PulseKind[];
}

export const emptyInbox = (): PulseInbox => ({ cards: [], dismissed: [], never: [] });

export function parseInbox(raw: unknown): PulseInbox {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<PulseInbox>;
  return {
    cards: Array.isArray(r.cards) ? r.cards.filter((c) => validateCard(c).ok) : [],
    dismissed: Array.isArray(r.dismissed) ? r.dismissed.filter((d) => d && typeof d.key === "string") : [],
    never: Array.isArray(r.never) ? r.never.filter((k): k is PulseKind => (PULSE_KINDS as readonly string[]).includes(k)) : [],
  };
}

const TITLE_MAX = 90;
const TEXT_MAX = 320;
const WHY_MAX = 200;

/** Una tarjeta sin fuente válida (o mal formada) se descarta. Finanzas nunca lleva cifras. */
export function validateCard(c: unknown): { ok: true } | { ok: false; reason: string } {
  if (!c || typeof c !== "object") return { ok: false, reason: "no es una tarjeta" };
  const x = c as Partial<PulseCard>;
  if (!x.kind || !(PULSE_KINDS as readonly string[]).includes(x.kind)) return { ok: false, reason: "clase desconocida" };
  for (const f of ["id", "key", "title", "text", "why", "createdAt", "expiresAt"] as const) {
    if (typeof x[f] !== "string" || !x[f]!.trim()) return { ok: false, reason: `falta ${f}` };
  }
  if (x.title!.length > TITLE_MAX || x.text!.length > TEXT_MAX || x.why!.length > WHY_MAX) return { ok: false, reason: "texto demasiado largo" };
  const s = x.source;
  if (!s || !(PULSE_SOURCE_KINDS as readonly string[]).includes(s.kind) || typeof s.ref !== "string" || !s.ref.trim() || typeof s.label !== "string" || !s.label.trim()) {
    return { ok: false, reason: "sin fuente válida" };
  }
  if (Number.isNaN(Date.parse(x.createdAt!)) || Number.isNaN(Date.parse(x.expiresAt!))) return { ok: false, reason: "fechas inválidas" };
  // Las cifras de finanzas tienen candado en el teléfono: una tarjeta podría salir como aviso.
  if (x.kind === "finanzas" && /\d/.test(`${x.title} ${x.text} ${x.why}`)) return { ok: false, reason: "finanzas con cifras" };
  return { ok: true };
}

/** La tarjeta de una situación de regla. */
export function ruleCard(s: PulseSituation, now: Date): PulseCard | null {
  if (!s.card) return null;
  return {
    id: `p_${pulseHash(s.key)}`,
    key: s.key,
    kind: s.kind,
    title: s.card.title.slice(0, TITLE_MAX),
    text: s.card.text.slice(0, TEXT_MAX),
    why: s.card.why.slice(0, WHY_MAX),
    source: s.source,
    urgent: s.urgent,
    createdAt: now.toISOString(),
    expiresAt: s.expiresAt,
    by: "rule",
  };
}

/** Clases a las que el modelo puede marcar urgentes (las demás nunca suenan por juicio). */
export const MODEL_URGENT_KINDS: readonly PulseKind[] = ["oportunidad"];

export interface ModelCardInput {
  /** Id corto de la situación que se le dio ("s1"…). */
  situation: string;
  title: string;
  text: string;
  why: string;
  urgent?: boolean;
}

/**
 * Convierte lo que devolvió el modelo en tarjetas. La FUENTE y la clase no las
 * escribe el modelo: salen de la situación que cita. Si cita una que no se le
 * dio, la tarjeta se descarta (no hay fuente válida).
 */
export function modelCards(
  raw: readonly ModelCardInput[],
  given: readonly PulseSituation[],
  now: Date,
): { cards: PulseCard[]; rejected: string[] } {
  const cards: PulseCard[] = [];
  const rejected: string[] = [];
  const used = new Set<string>();
  for (const r of raw) {
    const idx = /^s(\d+)$/.exec(String(r.situation ?? "").trim());
    const s = idx ? given[Number(idx[1]) - 1] : undefined;
    if (!s) {
      rejected.push(`cita una situación que no existe (${String(r.situation).slice(0, 20)})`);
      continue;
    }
    if (used.has(s.key)) {
      rejected.push(`dos tarjetas para ${s.key}`);
      continue;
    }
    const card: PulseCard = {
      id: `p_${pulseHash(s.key)}`,
      key: s.key,
      kind: s.kind,
      title: String(r.title ?? "").trim(),
      text: String(r.text ?? "").trim(),
      why: String(r.why ?? "").trim(),
      source: s.source,
      urgent: !!r.urgent && MODEL_URGENT_KINDS.includes(s.kind),
      createdAt: now.toISOString(),
      expiresAt: s.expiresAt,
      by: "model",
    };
    const v = validateCard(card);
    if (!v.ok) {
      rejected.push(`${s.key}: ${v.reason}`);
      continue;
    }
    used.add(s.key);
    cards.push(card);
  }
  return { cards, rejected };
}

/** Urgentes primero, luego las más recientes. */
export function orderCards(cards: readonly PulseCard[]): PulseCard[] {
  return [...cards].sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.createdAt.localeCompare(a.createdAt));
}

/** ¿Esta clave ya tiene tarjeta viva o fue descartada? */
export function seenKey(inbox: PulseInbox, key: string): boolean {
  return inbox.cards.some((c) => c.key === key) || inbox.dismissed.some((d) => d.key === key);
}

/**
 * Agrega tarjetas: sin duplicar la misma situación, sin las clases silenciadas
 * y con tope de vivas (sale la no urgente más vieja). Devuelve las que entraron.
 */
export function addCards(inbox: PulseInbox, incoming: readonly PulseCard[], max = PULSE_MAX_LIVE): { inbox: PulseInbox; added: PulseCard[] } {
  const added: PulseCard[] = [];
  let cards = [...inbox.cards];
  for (const c of incoming) {
    if (inbox.never.includes(c.kind) || !validateCard(c).ok) continue;
    if (cards.some((x) => x.key === c.key) || inbox.dismissed.some((d) => d.key === c.key)) continue;
    cards.push(c);
    added.push(c);
  }
  cards = orderCards(cards);
  while (cards.length > max) {
    const i = cards.map((c) => !c.urgent).lastIndexOf(true);
    cards.splice(i >= 0 ? i : cards.length - 1, 1);
  }
  const live = new Set(cards.map((c) => c.id));
  return { inbox: { ...inbox, cards }, added: added.filter((c) => live.has(c.id)) };
}

/** Vence lo caducado, quita lo resuelto y olvida los descartes viejos. */
export function sweepInbox(inbox: PulseInbox, now: Date, resolved: readonly string[] = []): PulseInbox {
  const t = now.getTime();
  const gone = new Set(resolved);
  return {
    ...inbox,
    cards: inbox.cards.filter((c) => Date.parse(c.expiresAt) > t && !gone.has(c.key)),
    dismissed: inbox.dismissed.filter((d) => t - Date.parse(d.at) <= DISMISSED_KEEP_MS),
  };
}

/** «Listo»: la tarjeta sale y su causa no vuelve a producir otra. */
export function dismissCard(inbox: PulseInbox, id: string, now: Date): { inbox: PulseInbox; card: PulseCard | null } {
  const card = inbox.cards.find((c) => c.id === id) ?? null;
  if (!card) return { inbox, card: null };
  return {
    inbox: { ...inbox, cards: inbox.cards.filter((c) => c.id !== id), dismissed: [...inbox.dismissed, { key: card.key, at: now.toISOString() }] },
    card,
  };
}

/** «Nunca de esto»: silencia la clase y retira sus tarjetas vivas. */
export function neverKind(inbox: PulseInbox, kind: PulseKind): PulseInbox {
  return {
    ...inbox,
    cards: inbox.cards.filter((c) => c.kind !== kind),
    never: inbox.never.includes(kind) ? inbox.never : [...inbox.never, kind],
  };
}

// ── Presupuesto y decisión de la pasada ─────────────────────────────────

export type PulseMode = "off" | "inbox" | "notify";

/** `HERMES_PULSE`: off apaga, notify habilita avisos, cualquier otro valor = bandeja. */
export function pulseMode(raw: string | undefined): PulseMode {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "off" ? "off" : v === "notify" ? "notify" : "inbox";
}

export const PULSE_DEFAULT_MAX_CALLS = 12;

export function maxCalls(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : PULSE_DEFAULT_MAX_CALLS;
}

/** Llamadas al modelo de HOY (el contador se reinicia al cambiar el día local). */
export function callsToday(calls: { day: string; count: number } | null | undefined, today: string): number {
  return calls && calls.day === today ? calls.count : 0;
}

/** Cuántas situaciones de juicio entran en una llamada (el resto espera a la siguiente). */
export const JUDGE_BATCH = 8;
/** Una situación que el modelo no pudo revisar se reintenta a lo sumo estas veces. */
export const JUDGE_MAX_ATTEMPTS = 2;

export interface PendingSituation extends PulseSituation {
  attempts: number;
}

export interface PassPlan {
  /** Tarjetas por regla que entran ya. */
  rule: PulseSituation[];
  /** Lo que va al modelo en esta pasada (vacío = no se llama). */
  judge: PendingSituation[];
  /** Lo que espera (silencio, tope, o no cupo). */
  pending: PendingSituation[];
  /** Por qué no se llamó al modelo habiendo algo que juzgar. */
  holdReason: "silencio" | "tope" | null;
}

/**
 * Qué hace la pasada con el cambio. Puro: no llama a nada.
 * - Lo de regla entra siempre (también de noche: la bandeja no suena).
 * - Lo de juicio va al modelo si no es hora de silencio y queda presupuesto;
 *   si no, queda pendiente para la primera pasada posible.
 * - Lo pendiente que ya no está en el estado se olvida.
 */
export function planPass(input: {
  diff: PulseDiff;
  current: readonly PulseSituation[];
  pending: readonly PendingSituation[];
  inbox: PulseInbox;
  quiet: boolean;
  callsToday: number;
  maxCalls: number;
}): PassPlan {
  const alive = new Set(input.current.map((s) => s.key));
  const muted = (s: PulseSituation) => input.inbox.never.includes(s.kind) || seenKey(input.inbox, s.key);
  const rule = input.diff.added.filter((s) => s.mode === "rule" && !muted(s));
  const queue: PendingSituation[] = [];
  const push = (s: PendingSituation) => {
    if (!alive.has(s.key) || muted(s) || queue.some((q) => q.key === s.key)) return;
    queue.push(s);
  };
  for (const p of input.pending) if (p.attempts < JUDGE_MAX_ATTEMPTS) push(p);
  for (const s of input.diff.added) if (s.mode === "judgment") push({ ...s, attempts: 0 });

  if (!queue.length) return { rule, judge: [], pending: [], holdReason: null };
  if (input.quiet) return { rule, judge: [], pending: queue, holdReason: "silencio" };
  if (input.callsToday >= input.maxCalls) return { rule, judge: [], pending: queue, holdReason: "tope" };
  return { rule, judge: queue.slice(0, JUDGE_BATCH), pending: queue.slice(JUDGE_BATCH), holdReason: null };
}

/**
 * ¿Suena esta tarjeta? Solo con `notify`, urgente, fuera del silencio y con
 * avisos del día. Si no, queda en la bandeja con el motivo anotado.
 */
export function decideNotice(o: { mode: PulseMode; card: PulseCard; quiet: boolean; noticesLeft: number }): { send: boolean; reason: string } {
  if (o.mode !== "notify") return { send: false, reason: "avisos apagados (HERMES_PULSE no es notify)" };
  if (!o.card.urgent) return { send: false, reason: "no es urgente" };
  if (o.card.kind === "finanzas") return { send: false, reason: "finanzas nunca sale como aviso" };
  if (o.quiet) return { send: false, reason: "horas de silencio" };
  if (o.noticesLeft <= 0) return { send: false, reason: "sin avisos disponibles hoy" };
  return { send: true, reason: "urgente con avisos disponibles" };
}

/** Resumen corto del estado para el modelo (conteos, sin contenido de terceros). */
export function stateSummary(state: PulseState, tz: string): string {
  const now = new Date(state.at);
  const { date, minutes } = pulseLocal(now, tz);
  const parts: string[] = [`Ahora: ${date} ${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} (${tz}).`];
  if (state.events) {
    const next = state.events.filter((e) => !e.allDay && Date.parse(e.start) > now.getTime());
    parts.push(`Eventos que vienen hoy: ${next.length}.`);
  }
  if (state.tasks) parts.push(`Pendientes abiertos de hoy: ${state.tasks.length} (${state.tasks.filter((t) => t.due && t.due < date).length} vencidos).`);
  if (state.habits) parts.push(`Hábitos: ${state.habits.filter((h) => h.done).length} de ${state.habits.length} marcados.`);
  if (state.meetings) parts.push(`Actas recientes con accionables sin decidir: ${state.meetings.filter((m) => m.untriaged > 0).length}.`);
  if (state.goals) parts.push(`Metas en marcha: ${state.goals.length}.`);
  if (state.opportunities) parts.push(`Oportunidades nuevas con puntaje alto: ${state.opportunities.length}.`);
  if (state.sources.failed.length) parts.push(`Fuentes que no respondieron: ${state.sources.failed.join(", ")}.`);
  return parts.join(" ");
}
