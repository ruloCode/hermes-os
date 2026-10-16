import { randomUUID } from "node:crypto";
import {
  CALL_DEFER_MAX_MS,
  CALL_LABEL,
  CALL_MAX_MIN,
  CHECKIN_REPLIES,
  busyEvent,
  callBusy,
  callId,
  dailyCallContext,
  parseCallId,
  checkinMessage,
  decideCheckin,
  goalStage,
  localParts,
  addDays,
  nextCall,
  planOccurrence,
  planWeek,
  weeklyCallContext,
  type CallKind,
  type GoalStage,
  type GrowthEvent,
  type GrowthGoalRef,
  type GrowthPlan,
  type GrowthSettings,
  type Initiative,
} from "@hermes/shared";
import type { NoticeInput, PhoneNotice } from "../phone/notices.js";
import type { GrowthFrame } from "../phone/link.js";
import { parsePlan, pruneInitiatives, serialStore, type CallRecord, type GrowthStore } from "./store.js";

/**
 * El compañero en marcha (diseño: hermes-phone/docs/companero.md).
 *
 * - `sweep()` (job cada 5 min): por cada plan de una meta EN MARCHA decide si
 *   toca preguntar, con la lógica pura de @hermes/shared/growth. Lo que sale va
 *   por el canal de avisos del teléfono, con su presupuesto diario (el que se
 *   pasa se descarta, no se encola).
 * - `handleFrame()`: lo que el teléfono devuelve (mostrado, vetado, la
 *   respuesta, el 👍/👎, cómo terminó la llamada).
 * - La llamada semanal: el teléfono guarda la hora y la hace sonar; aquí se
 *   arma su contexto con datos y se escribe el acta al colgar.
 *
 * Todo lo externo entra por `deps`: los tests no tocan Supabase, la agenda ni el WS.
 */

export interface CompanionDeps {
  store: GrowthStore;
  now: () => Date;
  tz: string;
  listGoals: () => Promise<GrowthGoalRef[]>;
  /** null = no se sabe (sin Supabase): se trata como no hecho. */
  habitDoneOn: (habitId: number, date: string) => Promise<boolean | null>;
  /** Días con el hábito marcado entre dos fechas locales. null = no se sabe (no se menciona). */
  habitDates: (habitId: number, from: string, to: string) => Promise<string[] | null>;
  /** Eventos de HOY de la agenda del dueño (los ya empezados también). */
  eventsToday: () => Promise<GrowthEvent[]>;
  liveMeeting: () => boolean;
  notify: (input: NoticeInput) => Promise<PhoneNotice | null>;
  sendCallSchedule: (next: { id: string; at: string; reason: string } | null) => boolean;
  checkinHabit: (habitId: number, date: string, note: string) => Promise<boolean>;
  /** Escribe el acta (modelo) a partir del contexto y la transcripción. Lanza si no pudo. */
  writeActa: (input: { kind: CallKind; context: string[]; transcript: { role: string; text: string }[]; date: string }) => Promise<string>;
  /** Guarda el acta en el vault (la semanal en su archivo, las diarias en la nota del día); ruta o null sin vault. */
  saveActa: (md: string, date: string, kind: CallKind) => Promise<string | null>;
  onEvent?: (detail: string) => void;
}

export interface GoalView extends GrowthGoalRef {
  stage: GoalStage;
  plans: Array<GrowthPlan & { week: { occurrences: number; done: number; without_reminder: number } }>;
}

export interface CompanionStatus {
  settings: GrowthSettings;
  goals: GoalView[];
  recent: Initiative[];
  next_call: { id: string; at: string; kind: CallKind } | null;
  calls: CallRecord[];
}

export function createCompanion(deps: CompanionDeps) {
  const mutate = serialStore(deps.store);
  const log = deps.onEvent ?? (() => {});

  /** La última llamada que se le mandó al teléfono: el barrido solo reenvía si cambió. */
  let lastPushed: string | null = null;

  async function sweep(): Promise<{ sent: number; skipped: number; dropped: number } | null> {
    const now = deps.now();
    const first = await deps.store.load();
    // Si pasó una llamada sin noticias del teléfono, la siguiente igual le llega.
    const upcoming = nextCall(first.settings, now, deps.tz);
    const upcomingId = upcoming ? callId(upcoming.at, upcoming.kind) : null;
    if (upcomingId !== lastPushed) await pushSchedule();
    if (!first.plans.some((p) => p.status === "active")) return null;
    const [goals, events] = await Promise.all([
      deps.listGoals().catch(() => [] as GrowthGoalRef[]),
      deps.eventsToday().catch(() => [] as GrowthEvent[]),
    ]);
    const live = deps.liveMeeting();
    const out = { sent: 0, skipped: 0, dropped: 0 };

    await mutate(async (d) => {
      const upcomingCall = nextCall(d.settings, now, deps.tz)?.at ?? null;
      for (const plan of d.plans) {
        if (plan.status !== "active") continue;
        const goal = goals.find((g) => g.id === plan.goal_id);
        const occ = planOccurrence(plan, now, deps.tz, events);
        const measureDone =
          plan.measure.kind === "habit" && occ ? (await deps.habitDoneOn(plan.measure.habit_id, occ.date)) === true : false;

        // Lo hizo DESPUÉS de que Hermes preguntara (o sin responder): la ocurrencia queda cumplida.
        const existing = occ ? d.initiatives.find((i) => i.plan_id === plan.id && i.date === occ.date) : undefined;
        if (existing && measureDone && !existing.done) existing.done = true;

        const decision = decideCheckin({
          now,
          tz: deps.tz,
          plan,
          goal,
          plans: d.plans,
          settings: d.settings,
          ledger: d.initiatives,
          occurrence: occ,
          measureDone,
          busyWith: busyEvent(events, now, plan.when.kind === "calendar" ? plan.when.match : undefined),
          liveMeeting: live,
          nextCallAt: upcomingCall,
        });
        if (!occ || !goal || decision.action === "idle" || decision.action === "wait") continue;

        const base: Initiative = {
          id: randomUUID(),
          kind: "checkin",
          plan_id: plan.id,
          goal_id: plan.goal_id,
          date: occ.date,
          at: now.toISOString(),
          status: "skipped",
          done: false,
        };
        if (decision.action === "skip") {
          d.initiatives.push({
            ...base,
            reason: decision.reason,
            done: decision.done,
            ...(decision.done ? { done_before: true } : {}),
          });
          out.skipped += 1;
          continue;
        }
        const msg = checkinMessage(plan, goal, occ, deps.tz, decision.slowedNote);
        const notice = await deps.notify({
          title: msg.title,
          body: msg.body,
          source: "growth",
          ref: base.id,
          extra: { kind: "checkin", why: msg.why, replies: [...CHECKIN_REPLIES], not_after: decision.not_after.toISOString() },
        });
        const dropped = !notice || notice.status === "dropped";
        d.initiatives.push({
          ...base,
          status: dropped ? "dropped" : "sent",
          ...(dropped ? { reason: notice?.reason ?? "sin cola de avisos" } : { notice_id: notice.id }),
          text: msg.body,
          why: msg.why,
          not_after: decision.not_after.toISOString(),
        });
        if (dropped) out.dropped += 1;
        else {
          out.sent += 1;
          log(`check-in enviado: ${goal.title}`);
        }
      }
      d.initiatives = pruneInitiatives(d.initiatives, now);
    });
    return out;
  }

  async function handleFrame(f: GrowthFrame): Promise<void> {
    if (f.t === "call_result") {
      await mutate((d) => {
        const c = d.calls.find((x) => x.id === f.id);
        const rec: CallRecord = c ?? { id: f.id, at: deps.now().toISOString(), outcome: "pending" };
        // La respuesta final (contestó y colgó) la cierra closeCall; aquí solo lo que no llegó a sonar o no se contestó.
        if (rec.outcome === "pending" || f.outcome !== "answered") {
          rec.outcome = f.outcome;
          if (f.reason) rec.reason = f.reason;
        }
        if (!c) d.calls.push(rec);
      });
      log(`llamada semanal: ${f.outcome}${f.reason ? ` (${f.reason})` : ""}`);
      // Pasó la llamada de esta semana: el teléfono necesita la siguiente.
      await pushSchedule();
      return;
    }
    const habit = await mutate((d): { id: number; date: string } | null => {
      const i = d.initiatives.find((x) => x.notice_id === f.id);
      if (!i) return null;
      const at = deps.now().toISOString();
      if (f.t === "shown") {
        if (i.status === "sent") i.status = "shown";
        i.shown_at = f.at;
      } else if (f.t === "vetoed") {
        if (i.status === "sent") {
          i.status = "vetoed";
          i.reason = f.reason;
        }
      } else if (f.t === "reply") {
        i.reply = { choice: f.choice, at };
        i.status = "answered";
        if (f.choice === "Hecho") {
          const plan = d.plans.find((p) => p.id === i.plan_id);
          const mark = !i.done && plan?.measure.kind === "habit" ? { id: plan.measure.habit_id, date: i.date } : null;
          i.done = true;
          return mark;
        }
      } else if (f.t === "feedback") {
        i.feedback = { value: f.value, at };
        if (f.value === "never" && !d.settings.never_plans.includes(i.plan_id)) d.settings.never_plans.push(i.plan_id);
      }
      return null;
    });
    // El check-in lleva la FECHA DE LA OCURRENCIA: un "Hecho" de anoche tarde no marca hoy.
    if (habit) await deps.checkinHabit(habit.id, habit.date, "Respuesta a Hermes: Hecho").catch(() => false);
  }

  async function status(): Promise<CompanionStatus> {
    const now = deps.now();
    const d = await deps.store.load();
    const goals = await deps.listGoals().catch(() => [] as GrowthGoalRef[]);
    const today = localParts(now, deps.tz).date;
    const from = addDays(today, -6);
    const next = nextCall(d.settings, now, deps.tz);
    return {
      settings: d.settings,
      goals: goals
        .filter((g) => g.status === "active")
        .map((g) => ({
          ...g,
          stage: goalStage(g, d.plans),
          plans: d.plans.filter((p) => p.goal_id === g.id).map((p) => ({ ...p, week: planWeek(d.initiatives, p.id, from, today) })),
        })),
      recent: [...d.initiatives].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20),
      next_call: next ? { id: callId(next.at, next.kind), at: next.at.toISOString(), kind: next.kind } : null,
      calls: [...d.calls].reverse().slice(0, 8),
    };
  }

  async function pushSchedule(): Promise<boolean> {
    const d = await deps.store.load();
    const next = nextCall(d.settings, deps.now(), deps.tz);
    const sent = deps.sendCallSchedule(next ? { id: callId(next.at, next.kind), at: next.at.toISOString(), reason: CALL_LABEL[next.kind] } : null);
    if (sent) lastPushed = next ? callId(next.at, next.kind) : null;
    return sent;
  }

  async function updateSettings(patch: (s: GrowthSettings) => GrowthSettings): Promise<GrowthSettings> {
    const s = await mutate((d) => {
      d.settings = patch(d.settings);
      return d.settings;
    });
    await pushSchedule();
    return s;
  }

  async function addPlan(raw: Record<string, unknown>): Promise<{ ok: true; plan: GrowthPlan } | { ok: false; error: string }> {
    const plan = parsePlan({ ...raw, id: randomUUID(), created_at: deps.now().toISOString() });
    if (!plan) return { ok: false, error: "Plan inválido: hace falta la meta, las palabras del plan y cuándo (días y hora, o un bloque de la agenda)." };
    const goals = await deps.listGoals().catch(() => [] as GrowthGoalRef[]);
    if (!goals.some((g) => g.id === plan.goal_id)) return { ok: false, error: `No existe la meta ${plan.goal_id}.` };
    const full = await mutate((d) => {
      if (d.plans.filter((p) => p.goal_id === plan.goal_id && p.status === "active").length >= 3) return true;
      d.plans.push(plan);
      return false;
    });
    if (full) return { ok: false, error: "Esa meta ya tiene 3 planes activos: pausa uno antes de sumar otro." };
    return { ok: true, plan };
  }

  async function setPlanStatus(id: string, st: "active" | "paused" | "removed"): Promise<boolean> {
    return mutate((d) => {
      const i = d.plans.findIndex((p) => p.id === id);
      if (i < 0) return false;
      if (st === "removed") d.plans.splice(i, 1);
      else d.plans[i] = { ...d.plans[i], status: st };
      return true;
    });
  }

  /** Las marcas reales de los hábitos que miden un plan, en los últimos 7 días: la llamada habla con ese dato. */
  async function habitDaysFor(plans: readonly GrowthPlan[], now: Date): Promise<Record<number, string[]>> {
    const today = localParts(now, deps.tz).date;
    const from = addDays(today, -6);
    const ids = [...new Set(plans.filter((p) => p.status === "active" && p.measure.kind === "habit").map((p) => (p.measure as { habit_id: number }).habit_id))];
    const out: Record<number, string[]> = {};
    for (const id of ids) {
      const days = await deps.habitDates(id, from, today).catch(() => null);
      if (days) out[id] = days;
    }
    return out;
  }

  /** Hábitos de los planes marcados HOY: la llamada de la tarde habla con ese dato. */
  async function habitTodayFor(plans: readonly GrowthPlan[], now: Date): Promise<Record<number, boolean>> {
    const today = localParts(now, deps.tz).date;
    const out: Record<number, boolean> = {};
    for (const p of plans) {
      if (p.status !== "active" || p.measure.kind !== "habit" || p.measure.habit_id in out) continue;
      const done = await deps.habitDoneOn(p.measure.habit_id, today).catch(() => null);
      if (done !== null) out[p.measure.habit_id] = done;
    }
    return out;
  }

  /** El contexto de una llamada, según qué llamada es (arranque, cierre o semanal). */
  async function buildContext(kind: CallKind, now: Date) {
    const goals = await deps.listGoals().catch(() => [] as GrowthGoalRef[]);
    const d = await deps.store.load();
    if (kind === "weekly") {
      const habitDays = await habitDaysFor(d.plans, now);
      return weeklyCallContext({ goals, plans: d.plans, ledger: d.initiatives, now, tz: deps.tz, habitDays });
    }
    const [events, habitToday] = await Promise.all([deps.eventsToday().catch(() => [] as GrowthEvent[]), habitTodayFor(d.plans, now)]);
    return dailyCallContext({ kind, goals, plans: d.plans, ledger: d.initiatives, events, now, tz: deps.tz, habitToday });
  }

  /**
   * Lo pide el teléfono al sonar. Si hay una junta de la agenda en curso, la
   * llamada espera a que termine (`retry_at`); si termina pasado el margen,
   * ese día no suena y queda registrado por qué.
   */
  async function callContext(
    id: string,
  ): Promise<
    | { ok: true; id: string; mode: CallKind; reason: string; opening: string; context: string; max_min: number }
    | { ok: true; id: string; busy: string; retry_at: string }
    | { ok: false; id: string; skip: string }
  > {
    const now = deps.now();
    const { kind, at } = parseCallId(id);
    const events = await deps.eventsToday().catch(() => [] as GrowthEvent[]);
    const busy = callBusy(events, now, new Date((at ?? now).getTime() + CALL_DEFER_MAX_MS));
    if (busy && "skip" in busy) {
      const reason = `estabas en «${busy.title}»`;
      await mutate((d) => {
        if (!d.calls.some((c) => c.id === id)) d.calls.push({ id, at: now.toISOString(), outcome: "missed", reason, kind });
      });
      log(`${CALL_LABEL[kind]}: no sonó (${reason})`);
      return { ok: false, id, skip: reason };
    }
    if (busy) return { ok: true, id, busy: busy.title, retry_at: busy.retryAt.toISOString() };
    const ctx = await buildContext(kind, now);
    await mutate((d) => {
      if (!d.calls.some((c) => c.id === id)) d.calls.push({ id, at: now.toISOString(), outcome: "pending", kind });
    });
    return { ok: true, id, mode: kind, reason: CALL_LABEL[kind], opening: ctx.opening, context: ctx.lines.join("\n"), max_min: CALL_MAX_MIN[kind] };
  }

  /** Al colgar: guarda cómo terminó y, si hubo conversación, escribe el acta. */
  async function closeCall(
    id: string,
    body: { duration_s?: number; transcript?: { role: string; text: string }[] },
  ): Promise<{ acta_md: string | null; vault_path: string | null }> {
    const now = deps.now();
    const { kind } = parseCallId(id);
    const transcript = (body.transcript ?? [])
      .filter((l) => l && typeof l.text === "string" && l.text.trim())
      .map((l) => ({ role: l.role === "user" ? "user" : "hermes", text: l.text.trim().slice(0, 2000) }))
      .slice(0, 200);
    const date = localParts(now, deps.tz).date;
    let acta: string | null = null;
    let path: string | null = null;
    if (transcript.some((l) => l.role === "user")) {
      const ctx = await buildContext(kind, now);
      try {
        acta = await deps.writeActa({ kind, context: ctx.lines, transcript, date });
      } catch (err) {
        // Sin modelo, el acta es la conversación tal cual: nunca se pierde lo que se dijo.
        acta = fallbackActa(date, ctx.lines, transcript, err instanceof Error ? err.message : String(err), kind);
      }
      path = await deps.saveActa(acta, date, kind).catch(() => null);
    }
    await mutate((d) => {
      const c = d.calls.find((x) => x.id === id) ?? (d.calls.push({ id, at: now.toISOString(), outcome: "pending", kind }), d.calls[d.calls.length - 1]);
      c.outcome = "answered";
      c.closed_at = now.toISOString();
      if (typeof body.duration_s === "number" && Number.isFinite(body.duration_s)) c.duration_s = Math.round(body.duration_s);
      if (acta) c.acta_md = acta;
    });
    log(`${CALL_LABEL[kind]} cerrada${path ? " · acta en el vault" : ""}`);
    await pushSchedule();
    return { acta_md: acta, vault_path: path };
  }

  return { sweep, handleFrame, status, pushSchedule, updateSettings, addPlan, setPlanStatus, callContext, closeCall };
}

export type Companion = ReturnType<typeof createCompanion>;

export function fallbackActa(
  date: string,
  context: string[],
  transcript: { role: string; text: string }[],
  why: string,
  kind: CallKind = "weekly",
): string {
  return [
    `${kind === "weekly" ? "#" : "##"} ${CALL_LABEL[kind]} · ${date}`,
    "",
    `_No pude resumir la llamada (${why.slice(0, 120)}): queda la conversación tal cual._`,
    "",
    "## Datos de la semana",
    ...context.map((l) => `- ${l.trim()}`),
    "",
    "## Conversación",
    ...transcript.map((l) => `**${l.role === "user" ? "Tú" : "Hermes"}:** ${l.text}`),
    "",
  ].join("\n");
}
