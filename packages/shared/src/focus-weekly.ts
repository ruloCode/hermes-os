/**
 * v6 «teléfono: foco» — resumen semanal de foco (`GET /focus/weekly`), lógica pura.
 *
 * Entra lo que el TELÉFONO subió por día (`PUT /focus/usage/:fecha`): minutos y,
 * desde v6, aperturas por app y los cortes por regla (hojas, elecciones,
 * intenciones y presupuesto usado). Sale el resumen de la semana: minutos y
 * aperturas por app, días dentro y fuera de presupuesto y la comparación con la
 * semana anterior.
 *
 * Solo datos reales (P5): lo que no se midió es `null`, nunca 0. Un teléfono
 * viejo no manda aperturas → `opens: null`. Sin días medidos la semana anterior
 * no hay comparación. La semana en curso se compara contra el MISMO tramo de la
 * anterior (lunes→mismo día), no contra la semana entera: comparar tres días
 * contra siete siempre "mejoraría". Nunca hay aquí qué se miró: no llega.
 */

export interface WeeklyUsageApp {
  package: string;
  label: string | null;
  minutes: number;
  /** Desde v6; ausente en teléfonos viejos. */
  opens?: number | null;
}

export interface WeeklyRuleDay {
  rule_id: string;
  rule_name: string | null;
  budget_min?: number | null;
  used_min?: number | null;
  shown?: number | null;
  choices?: Record<string, number> | null;
  intents?: Record<string, number> | null;
}

export interface WeeklyUsageDay {
  date: string;
  complete: boolean;
  apps: WeeklyUsageApp[];
  rules?: WeeklyRuleDay[] | null;
}

export interface WeeklyApp {
  package: string;
  label: string | null;
  minutes: number;
  /** null = ningún día de la semana trajo aperturas (teléfono viejo). */
  opens: number | null;
  /** Días de la semana en que se usó. */
  days: number;
  /** null = la semana anterior no tiene días medidos. */
  prev_minutes: number | null;
  prev_opens: number | null;
}

export interface WeeklyBudget {
  rule_id: string;
  rule_name: string | null;
  /** El tope del último día reportado (el dueño pudo cambiarlo a mitad de semana: cada día se juzga con el suyo). */
  budget_min: number;
  days_within: number;
  days_over: number;
  days: { date: string; used_min: number; budget_min: number; within: boolean }[];
}

export interface WeeklyRule {
  rule_id: string;
  rule_name: string | null;
  shown: number;
  choices: Record<string, number>;
  intents: Record<string, number>;
}

export interface FocusWeekly {
  week: { from: string; to: string; through: string };
  /** El tramo de la semana anterior con el que se compara. */
  previous: { from: string; through: string };
  days_measured: number;
  prev_days_measured: number;
  apps: WeeklyApp[];
  totals: {
    minutes: number;
    opens: number | null;
    prev_minutes: number | null;
    prev_opens: number | null;
    /** Cambio de minutos en % contra el tramo anterior; null sin base. */
    change_pct: number | null;
  };
  budgets: WeeklyBudget[];
  rules: WeeklyRule[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isFocusWeeklyDate(s: string): boolean {
  return DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`));
}

function shiftDay(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function focusWeekStart(date: string): string {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = domingo
  return shiftDay(date, -((dow + 6) % 7));
}

function span(from: string, through: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= through; d = shiftDay(d, 1)) out.push(d);
  return out;
}

interface Agg {
  minutes: Map<string, number>;
  opens: Map<string, number>;
  days: Map<string, number>;
  labels: Map<string, string | null>;
  hasOpens: boolean;
  measured: number;
}

function aggregate(usage: Record<string, WeeklyUsageDay>, dates: string[]): Agg {
  const a: Agg = { minutes: new Map(), opens: new Map(), days: new Map(), labels: new Map(), hasOpens: false, measured: 0 };
  for (const date of dates) {
    const day = usage[date];
    if (!day) continue;
    a.measured += 1;
    for (const app of day.apps) {
      a.minutes.set(app.package, (a.minutes.get(app.package) ?? 0) + app.minutes);
      if (app.minutes > 0) a.days.set(app.package, (a.days.get(app.package) ?? 0) + 1);
      if (typeof app.opens === "number") {
        a.hasOpens = true;
        a.opens.set(app.package, (a.opens.get(app.package) ?? 0) + app.opens);
      }
      if (app.label || !a.labels.has(app.package)) a.labels.set(app.package, app.label ?? null);
    }
  }
  return a;
}

const sum = (m: Map<string, number>) => [...m.values()].reduce((x, y) => x + y, 0);

/**
 * El resumen de la semana que contiene [anchor] (AAAA-MM-DD). [today] corta la
 * semana en curso: no hay datos del futuro, y la comparación usa el mismo tramo.
 */
export function focusWeekly(usage: Record<string, WeeklyUsageDay>, anchor: string, today: string): FocusWeekly {
  const from = focusWeekStart(anchor);
  const to = shiftDay(from, 6);
  const through = to < today ? to : today < from ? from : today;
  const dates = span(from, through);
  const prevDates = dates.map((d) => shiftDay(d, -7));
  const cur = aggregate(usage, dates);
  const prev = aggregate(usage, prevDates);
  const hasPrev = prev.measured > 0;

  const apps: WeeklyApp[] = [...cur.minutes.keys()]
    .map((pkg) => ({
      package: pkg,
      label: cur.labels.get(pkg) ?? prev.labels.get(pkg) ?? null,
      minutes: cur.minutes.get(pkg) ?? 0,
      opens: cur.hasOpens ? (cur.opens.get(pkg) ?? 0) : null,
      days: cur.days.get(pkg) ?? 0,
      prev_minutes: hasPrev ? (prev.minutes.get(pkg) ?? 0) : null,
      prev_opens: hasPrev && prev.hasOpens ? (prev.opens.get(pkg) ?? 0) : null,
    }))
    .filter((a) => a.minutes > 0 || (a.opens ?? 0) > 0)
    .sort((a, b) => b.minutes - a.minutes || a.package.localeCompare(b.package));

  const minutes = sum(cur.minutes);
  const prevMinutes = hasPrev ? sum(prev.minutes) : null;

  // Presupuestos: cada día se juzga con el tope que tenía ese día.
  const budgets = new Map<string, WeeklyBudget>();
  const rules = new Map<string, WeeklyRule>();
  for (const date of dates) {
    for (const r of usage[date]?.rules ?? []) {
      if (typeof r.budget_min === "number" && typeof r.used_min === "number" && r.budget_min > 0) {
        const b = budgets.get(r.rule_id) ?? { rule_id: r.rule_id, rule_name: r.rule_name, budget_min: r.budget_min, days_within: 0, days_over: 0, days: [] };
        const within = r.used_min <= r.budget_min;
        b.days.push({ date, used_min: r.used_min, budget_min: r.budget_min, within });
        if (within) b.days_within += 1;
        else b.days_over += 1;
        b.budget_min = r.budget_min;
        if (r.rule_name) b.rule_name = r.rule_name;
        budgets.set(r.rule_id, b);
      }
      if (typeof r.shown === "number" || r.choices || r.intents) {
        const e = rules.get(r.rule_id) ?? { rule_id: r.rule_id, rule_name: r.rule_name, shown: 0, choices: {}, intents: {} };
        e.shown += r.shown ?? 0;
        for (const [k, v] of Object.entries(r.choices ?? {})) e.choices[k] = (e.choices[k] ?? 0) + v;
        for (const [k, v] of Object.entries(r.intents ?? {})) e.intents[k] = (e.intents[k] ?? 0) + v;
        if (r.rule_name) e.rule_name = r.rule_name;
        rules.set(r.rule_id, e);
      }
    }
  }

  return {
    week: { from, to, through },
    previous: { from: prevDates[0], through: prevDates[prevDates.length - 1] },
    days_measured: cur.measured,
    prev_days_measured: prev.measured,
    apps,
    totals: {
      minutes,
      opens: cur.hasOpens ? sum(cur.opens) : null,
      prev_minutes: prevMinutes,
      prev_opens: hasPrev && prev.hasOpens ? sum(prev.opens) : null,
      change_pct: prevMinutes ? Math.round(((minutes - prevMinutes) / prevMinutes) * 100) : null,
    },
    budgets: [...budgets.values()],
    rules: [...rules.values()].sort((a, b) => b.shown - a.shown),
  };
}

function hm(m: number): string {
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`;
}

/** Una línea narrable (chat, voz) que no culpa: lo medido y, si hay base, la comparación. */
export function focusWeeklyLine(w: FocusWeekly): string {
  if (w.days_measured === 0) return "Esta semana el teléfono aún no ha subido uso de apps.";
  const parts: string[] = [];
  const top = w.apps[0];
  if (top) {
    const opens = top.opens != null ? `, ${top.opens} ${top.opens === 1 ? "apertura" : "aperturas"}` : "";
    parts.push(`Esta semana lo que más usaste fue ${top.label ?? top.package}: ${hm(top.minutes)}${opens}.`);
  }
  if (top && top.prev_minutes != null) {
    const d = top.minutes - top.prev_minutes;
    parts.push(d < 0 ? `Son ${hm(-d)} menos que el mismo tramo de la semana pasada.` : d > 0 ? `Son ${hm(d)} más que el mismo tramo de la semana pasada.` : "Igual que el mismo tramo de la semana pasada.");
  }
  for (const b of w.budgets) {
    parts.push(`Presupuesto «${b.rule_name ?? b.rule_id}»: ${b.days_within} ${b.days_within === 1 ? "día" : "días"} dentro y ${b.days_over} fuera.`);
  }
  return parts.join(" ");
}
