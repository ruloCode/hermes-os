import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GROWTH_SETTINGS,
  busyEvent,
  checkinMessage,
  decideCheckin,
  goalStage,
  localParts,
  nextCall,
  callBusy,
  callId,
  dailyCallContext,
  parseCallId,
  parseGrowthSettings,
  planOccurrence,
  weeklyCallContext,
  zonedInstant,
  type CheckinInput,
  type GrowthGoalRef,
  type GrowthPlan,
  type Initiative,
} from "@hermes/shared";
import { createCompanion, type CompanionDeps } from "./companion.js";
import { memGrowthStore, parsePlan } from "./store.js";
import { admitNotice, parseNotices, type NoticeInput, type PhoneNotice } from "../phone/notices.js";
import { parsePhoneMessage } from "../phone/protocol.js";

/**
 * Contrato del compañero: solo pregunta por metas EN MARCHA (fecha + plan),
 * una vez por plan y día, dentro de su ventana y de la franja del dueño, nunca
 * en una junta, y si ya lo hizo no escribe. Tres ignoradas → día por medio,
 * dicho una vez. "Hecho" marca el hábito con la fecha de la ocurrencia. La
 * llamada semanal arma su contexto con datos y el acta nunca se pierde.
 */

const TZ = "America/Bogota";
// Jueves 15-oct-2026. Bogotá = UTC-5 sin horario de verano.
const at = (localHHMM: string, date = "2026-10-15") => zonedInstant(date, localHHMM, TZ);

const goal = (o: Partial<GrowthGoalRef> = {}): GrowthGoalRef => ({
  id: 1,
  title: "Calistenia",
  status: "active",
  due_date: "2026-12-15",
  ...o,
});

const plan = (o: Partial<GrowthPlan> = {}): GrowthPlan => ({
  id: "p1",
  goal_id: 1,
  words: "L-V a las 6 entreno calistenia",
  when: { kind: "weekly", days: [1, 2, 3, 4, 5], time: "06:00" },
  measure: { kind: "habit", habit_id: 5, habit_name: "Gym" },
  checkin_after_min: 60,
  window_min: 180,
  status: "active",
  created_at: "2026-10-14T12:00:00Z",
  ...o,
});

function input(o: Partial<CheckinInput> = {}): CheckinInput {
  const p = o.plan ?? plan();
  const now = o.now ?? at("07:05");
  return {
    now,
    tz: TZ,
    plan: p,
    goal: goal(),
    plans: [p],
    settings: { ...DEFAULT_GROWTH_SETTINGS },
    ledger: [],
    occurrence: planOccurrence(p, now, TZ),
    measureDone: false,
    busyWith: null,
    liveMeeting: false,
    nextCallAt: null,
    ...o,
  };
}

const sent = (date: string, o: Partial<Initiative> = {}): Initiative => ({
  id: `i-${date}`,
  kind: "checkin",
  plan_id: "p1",
  goal_id: 1,
  date,
  at: `${date}T12:05:00.000Z`,
  status: "sent",
  not_after: `${date}T15:00:00.000Z`,
  done: false,
  ...o,
});

describe("regla del dueño: sueño · objetivo · en marcha", () => {
  it("sin fecha es sueño, con fecha es objetivo, con fecha y un plan activo está en marcha", () => {
    assert.equal(goalStage(goal({ due_date: null }), [plan()]), "sueno");
    assert.equal(goalStage(goal(), []), "objetivo");
    assert.equal(goalStage(goal(), [plan({ status: "paused" })]), "objetivo");
    assert.equal(goalStage(goal(), [plan()]), "en_marcha");
    assert.equal(goalStage(goal(), [plan({ goal_id: 2 })]), "objetivo", "el plan de OTRA meta no cuenta");
  });

  it("una meta que no está en marcha no recibe check-ins", () => {
    const d = decideCheckin(input({ goal: goal({ due_date: null }) }));
    assert.equal(d.action, "idle");
  });
});

describe("tiempo en la zona del dueño", () => {
  it("las 6:00 en Bogotá son las 11:00 UTC y se leen de vuelta igual", () => {
    assert.equal(at("06:00").toISOString(), "2026-10-15T11:00:00.000Z");
    assert.deepEqual(localParts(at("06:00"), TZ), { date: "2026-10-15", dow: 4, minutes: 360 });
  });
});

describe("ocurrencias del plan", () => {
  it("un plan de L-V a las 6 toca el jueves y no el sábado", () => {
    assert.equal(planOccurrence(plan(), at("07:00"), TZ)?.start.toISOString(), "2026-10-15T11:00:00.000Z");
    assert.equal(planOccurrence(plan(), at("07:00", "2026-10-17"), TZ), null);
  });

  it("un plan de agenda calza con el bloque de HOY aunque traiga emoji y mayúsculas; ignora el de todo el día", () => {
    const p = plan({ when: { kind: "calendar", match: "gym" } });
    const events = [
      { title: "🏋️ Gym", start: "2026-10-16T11:00:00Z", end: "2026-10-16T12:00:00Z", allDay: false },
      { title: "Gym day", start: "2026-10-15T05:00:00Z", end: null, allDay: true },
      { title: "🏋️ Gym", start: "2026-10-15T11:00:00Z", end: "2026-10-15T12:00:00Z", allDay: false },
    ];
    const occ = planOccurrence(p, at("08:00"), TZ, events);
    assert.equal(occ?.end.toISOString(), "2026-10-15T12:00:00.000Z");
  });
});

describe("decisión del agente", () => {
  it("antes de la hora espera; dentro de la ventana manda, con la ventana como límite", () => {
    assert.equal(decideCheckin(input({ now: at("06:30") })).action, "wait");
    const d = decideCheckin(input());
    assert.equal(d.action, "send");
    if (d.action === "send") assert.equal(d.not_after.toISOString(), at("10:00").toISOString());
  });

  it("si ya lo hizo, no escribe: cuenta como hecho sin recordatorio", () => {
    assert.deepEqual(decideCheckin(input({ measureDone: true })), { action: "skip", reason: "ya estaba hecho", done: true });
  });

  it("pasada la ventana no se manda (se registra para la semana)", () => {
    const d = decideCheckin(input({ now: at("11:00") }));
    assert.equal(d.action, "skip");
  });

  it("un plan recién creado no pregunta por la ocurrencia de hoy que ya pasó", () => {
    const fresh = plan({ created_at: at("09:00").toISOString() });
    assert.equal(decideCheckin(input({ plan: fresh, plans: [fresh] })).action, "idle");
  });

  it("una pregunta por plan y día", () => {
    assert.equal(decideCheckin(input({ ledger: [sent("2026-10-15")] })).action, "idle");
  });

  it("una ventana que cae fuera de la franja de mensajes no se manda nunca", () => {
    const late = plan({ when: { kind: "weekly", days: [4], time: "23:00" } });
    const d = decideCheckin(input({ plan: late, plans: [late], now: at("23:30") }));
    assert.equal(d.action, "skip");
  });

  it("junta en vivo, un bloque ocupado o la llamada en menos de una hora: espera, no descarta", () => {
    assert.equal(decideCheckin(input({ liveMeeting: true })).action, "wait");
    assert.equal(decideCheckin(input({ busyWith: "Daily del cliente" })).action, "wait");
    assert.equal(decideCheckin(input({ nextCallAt: at("07:45") })).action, "wait");
    assert.equal(decideCheckin(input({ nextCallAt: at("09:30") })).action, "send");
  });

  it("«nunca de esto» lo silencia y un plan en pausa no pregunta", () => {
    assert.equal(decideCheckin(input({ settings: { ...DEFAULT_GROWTH_SETTINGS, never_plans: ["p1"] } })).action, "idle");
    const paused = plan({ status: "paused" });
    assert.equal(decideCheckin(input({ plan: paused, plans: [paused] })).action, "idle");
  });

  it("tres ignoradas seguidas → día por medio, y el primer mensaje después lo dice una vez", () => {
    const three = [sent("2026-10-11"), sent("2026-10-12"), sent("2026-10-13")];
    const d = decideCheckin(input({ ledger: three }));
    assert.equal(d.action, "send");
    if (d.action === "send") assert.equal(d.slowedNote, true);
    const andYesterday = [...three, sent("2026-10-14")];
    assert.equal(decideCheckin(input({ ledger: andYesterday })).action, "skip");
    const answered = [...three.slice(0, 2), sent("2026-10-13", { status: "answered", reply: { choice: "Hoy no", at: "x" } })];
    const d2 = decideCheckin(input({ ledger: answered }));
    assert.equal(d2.action === "send" && d2.slowedNote, false, "una respuesta corta la racha");
  });

  it("estar en el bloque del propio plan no es estar ocupado", () => {
    const events = [{ title: "🏋️ Gym", start: at("06:30").toISOString(), end: at("07:30").toISOString(), allDay: false }];
    assert.equal(busyEvent(events, at("07:00"), "gym"), null);
    assert.equal(busyEvent(events, at("07:00")), "🏋️ Gym");
  });
});

describe("el texto del check-in", () => {
  it("una sola pregunta, sobre SU plan, y el porqué nombra la meta", () => {
    const occ = planOccurrence(plan(), at("07:05"), TZ)!;
    const m = checkinMessage(plan(), goal(), occ, TZ);
    assert.equal((m.body.match(/\?/g) ?? []).length, 1);
    assert.match(m.body, /L-V a las 6 entreno calistenia/);
    assert.match(m.why, /Calistenia/);
    assert.match(m.why, /Gym/);
    assert.doesNotMatch(m.body, /genial|increíble|deberías|otra vez/i);
  });
});

describe("la llamada semanal", () => {
  const SLOTS = parseGrowthSettings({
    calls: [
      { kind: "morning", days: [1, 2, 3, 4, 5, 6, 7], time: "09:00" },
      { kind: "evening", days: [1, 2, 3, 4, 5, 6], time: "18:00" },
      { kind: "weekly", days: [7], time: "18:00" },
    ],
  });

  it("la próxima es la más cercana entre todas las agendadas", () => {
    assert.deepEqual(nextCall(SLOTS, at("14:30"), TZ), { at: at("18:00"), kind: "evening" });
    assert.deepEqual(nextCall(SLOTS, at("17:00", "2026-10-18"), TZ), { at: at("18:00", "2026-10-18"), kind: "weekly" });
    assert.deepEqual(nextCall(SLOTS, at("18:30", "2026-10-18"), TZ), { at: at("09:00", "2026-10-19"), kind: "morning" });
    assert.equal(nextCall(DEFAULT_GROWTH_SETTINGS, at("07:00"), TZ), null);
  });

  it("el id dice qué llamada es y a qué hora; el id viejo se lee como semanal", () => {
    const id = callId(at("09:00"), "morning");
    assert.deepEqual(parseCallId(id), { kind: "morning", at: at("09:00") });
    assert.equal(parseCallId("call-202610151930").kind, "weekly");
  });

  it("la forma vieja (una llamada semanal) se convierte, y null la quita", () => {
    const s = parseGrowthSettings({ weekly_call: { dow: 7, time: "19:00" } });
    assert.deepEqual(s.calls, [{ kind: "weekly", days: [7], time: "19:00" }]);
    assert.deepEqual(parseGrowthSettings({ weekly_call: null }, s).calls, []);
  });

  it("si suena en medio de los dailies, espera al hueco; si se pasa del margen, ese día no suena", () => {
    const dailies = [
      { title: "TeKer Daily", start: at("09:00").toISOString(), end: at("09:30").toISOString(), allDay: false },
      { title: "Careway Daily", start: at("09:30").toISOString(), end: at("10:00").toISOString(), allDay: false },
      { title: "Festivo", start: at("00:00").toISOString(), end: null, allDay: true },
    ];
    const b = callBusy(dailies, at("09:00"), new Date(at("09:00").getTime() + 90 * 60_000));
    assert.deepEqual(b, { title: "TeKer Daily", retryAt: at("10:02") });
    const tight = callBusy(dailies, at("09:00"), at("09:45"));
    assert.deepEqual(tight, { title: "TeKer Daily", skip: true });
    assert.equal(callBusy(dailies, at("18:00"), at("19:30")), null);
  });

  it("la de la mañana dice qué toca hoy y la agenda que sigue; la de la tarde no inventa ceros", () => {
    const p = plan({ created_at: "2026-10-01T00:00:00Z" });
    const events = [{ title: "TeKer Daily", start: at("09:00").toISOString(), end: at("09:30").toISOString(), allDay: false }];
    const am = dailyCallContext({ kind: "morning", goals: [goal()], plans: [p], ledger: [], events, now: at("08:00"), tz: TZ });
    assert.match(am.lines.join("\n"), /6:00 a\. ?m\. · «L-V a las 6 entreno calistenia»/);
    assert.match(am.lines.join("\n"), /TeKer Daily/);
    assert.match(am.opening, /arrancar el día/);
    const pm = dailyCallContext({ kind: "evening", goals: [goal()], plans: [p], ledger: [], events: [], now: at("18:00"), tz: TZ });
    assert.match(pm.lines.join("\n"), /sin dato, pregúntale/);
    assert.doesNotMatch(pm.lines.join("\n"), /\b0\b|no lo hiciste|no ocurri/);
    assert.match(pm.lines.join("\n"), /Mañana te tocan/);
    const done = dailyCallContext({ kind: "evening", goals: [goal()], plans: [p], ledger: [], events: [], now: at("18:00"), tz: TZ, habitToday: { 5: true } });
    const fresh = plan({ created_at: at("14:17").toISOString() });
    const pmFresh = dailyCallContext({ kind: "evening", goals: [goal()], plans: [fresh], ledger: [], events: [], now: at("18:00"), tz: TZ });
    assert.match(pmFresh.lines[0], /Hoy no te tocaba ningún plan/, "un plan creado después de su hora no se pregunta en el cierre");
    assert.match(done.lines.join("\n"), /«L-V a las 6 entreno calistenia»: hecho/);
  });

  it("el contexto trae el plan cumplido N de M y nombra los sueños sin fecha", () => {
    const ctx = weeklyCallContext({
      goals: [goal(), goal({ id: 2, title: "Componer un tema", due_date: null })],
      plans: [plan()],
      ledger: [sent("2026-10-13", { done: true, done_before: true }), sent("2026-10-14")],
      now: at("19:00", "2026-10-18"),
      tz: TZ,
    });
    const all = ctx.lines.join("\n");
    assert.match(all, /cumplido 1 de 2 veces/);
    assert.match(all, /1 sin que Hermes preguntara/);
    assert.match(all, /«Componer un tema»/);
    assert.match(ctx.opening, /domingo/);
  });

  it("un plan nuevo es falta de dato, nunca «cero»; el hábito trae sus marcas reales", () => {
    const fresh = plan({ created_at: at("14:17").toISOString(), measure: { kind: "habit", habit_id: 7, habit_name: "Práctica de inglés" } });
    const ctx = weeklyCallContext({
      goals: [goal({ created_at: at("14:17").toISOString() })],
      plans: [fresh],
      ledger: [],
      now: at("14:30"),
      tz: TZ,
      habitDays: { 7: ["2026-10-14"] },
    });
    const all = ctx.lines.join("\n");
    assert.match(all, /plan nuevo/);
    assert.match(all, /creada el/);
    assert.match(all, /marcado 1 vez en los últimos 7 días \(14 de oct/);
    assert.doesNotMatch(all, /cumplido 0|\b0 de\b|no ocurri/);
  });

  it("ajustes: lo inválido no pisa lo que había", () => {
    const s = parseGrowthSettings({ calls: [{ kind: "weekly", days: [9], time: "25:00" }], messages: { start: "22:00", end: "07:00" }, dnd: "x" });
    assert.deepEqual(s, DEFAULT_GROWTH_SETTINGS);
  });
});

describe("validación de planes", () => {
  it("sin cuándo no hay plan; los minutos por defecto dependen del tipo", () => {
    assert.equal(parsePlan({ id: "x", goal_id: 1, words: "leer", when: { kind: "weekly", days: [], time: "07:00" } }), null);
    assert.equal(parsePlan({ id: "x", goal_id: 1, words: "leer", when: { kind: "calendar", match: "📖" } }), null);
    assert.equal(parsePlan({ id: "x", goal_id: 1, words: "leer", when: { kind: "weekly", days: [1], time: "07:00" } })?.checkin_after_min, 60);
    assert.equal(parsePlan({ id: "x", goal_id: 1, words: "leer", when: { kind: "calendar", match: "Lectura" } })?.checkin_after_min, 15);
  });
});

describe("protocolo y avisos", () => {
  it("las respuestas del teléfono se validan; un valor desconocido se ignora", () => {
    assert.deepEqual(parsePhoneMessage('{"t":"reply","id":"n1","choice":"Hecho"}'), { t: "reply", id: "n1", choice: "Hecho" });
    assert.equal(parsePhoneMessage('{"t":"feedback","id":"n1","value":"meh"}'), null);
    assert.deepEqual(parsePhoneMessage('{"t":"call_result","id":"c1","outcome":"missed","reason":"junta"}'), {
      t: "call_result",
      id: "c1",
      outcome: "missed",
      reason: "junta",
    });
  });

  it("el aviso del compañero conserva su porqué, respuestas y ventana al guardarse y leerse", () => {
    const extra = { kind: "checkin" as const, why: "porque sí", replies: ["Hecho", "Hoy no", "Hablemos"], not_after: "2026-10-15T15:00:00Z" };
    const { notices } = admitNotice([], { title: "t", body: "b", source: "growth", extra }, { id: "n1", nowIso: "2026-10-15T12:00:00Z", tz: TZ, budget: 3 });
    assert.deepEqual(parseNotices(JSON.parse(JSON.stringify({ notices })))[0].extra, extra);
  });
});

// ── El compañero completo con dependencias falsas ───────────────────────

function harness(o: { now?: Date; habitDone?: boolean; dropped?: boolean; acta?: "ok" | "fail"; events?: { title: string; start: string; end: string | null; allDay: boolean }[] } = {}) {
  const store = memGrowthStore({ plans: [plan()], settings: { ...DEFAULT_GROWTH_SETTINGS, calls: [{ kind: "weekly", days: [7], time: "19:00" }] } });
  const notices: NoticeInput[] = [];
  const checkins: Array<[number, string]> = [];
  const schedules: unknown[] = [];
  const saved: string[] = [];
  let now = o.now ?? at("07:05");
  const deps: CompanionDeps = {
    store,
    now: () => now,
    tz: TZ,
    listGoals: async () => [goal()],
    habitDoneOn: async () => o.habitDone ?? false,
    habitDates: async () => ["2026-10-14"],
    eventsToday: async () => o.events ?? [],
    liveMeeting: () => false,
    notify: async (input) => {
      notices.push(input);
      const n: PhoneNotice = {
        id: `n${notices.length}`,
        title: input.title,
        body: input.body,
        source: input.source,
        created_at: now.toISOString(),
        status: o.dropped ? "dropped" : "sent",
        ...(o.dropped ? { reason: "presupuesto diario (3) agotado" } : {}),
      };
      return n;
    },
    sendCallSchedule: (next) => {
      schedules.push(next);
      return true;
    },
    checkinHabit: async (id, date) => {
      checkins.push([id, date]);
      return true;
    },
    writeActa: async ({ date }) => {
      if (o.acta === "fail") throw new Error("sin modelo");
      return `# Revisión semanal · ${date}\nacta`;
    },
    saveActa: async (md) => {
      saved.push(md);
      return "/vault/x.md";
    },
  };
  return { c: createCompanion(deps), store, notices, checkins, schedules, saved, setNow: (d: Date) => (now = d) };
}

describe("el compañero en marcha", () => {
  it("manda UN check-in con sus respuestas y no lo repite en el siguiente barrido", async () => {
    const h = harness();
    assert.deepEqual(await h.c.sweep(), { sent: 1, skipped: 0, dropped: 0 });
    h.setNow(at("07:15"));
    assert.deepEqual(await h.c.sweep(), { sent: 0, skipped: 0, dropped: 0 });
    assert.equal(h.notices.length, 1);
    assert.deepEqual(h.notices[0].extra?.replies, ["Hecho", "Hoy no", "Hablemos"]);
    assert.equal(h.store.data.initiatives[0].status, "sent");
  });

  it("sin presupuesto queda descartado con motivo, no en cola", async () => {
    const h = harness({ dropped: true });
    await h.c.sweep();
    assert.equal(h.store.data.initiatives[0].status, "dropped");
    assert.match(h.store.data.initiatives[0].reason ?? "", /presupuesto/);
  });

  it("si el hábito ya está marcado no escribe y lo cuenta como sin recordatorio", async () => {
    const h = harness({ habitDone: true });
    await h.c.sweep();
    assert.equal(h.notices.length, 0);
    assert.equal(h.store.data.initiatives[0].done_before, true);
  });

  it("«Hecho» marca el hábito con la fecha de la ocurrencia, y una sola vez", async () => {
    const h = harness();
    await h.c.sweep();
    const id = h.store.data.initiatives[0].notice_id!;
    h.setNow(at("23:50"));
    await h.c.handleFrame({ t: "reply", id, choice: "Hecho" });
    await h.c.handleFrame({ t: "reply", id, choice: "Hecho" });
    assert.deepEqual(h.checkins, [[5, "2026-10-15"]]);
    assert.equal(h.store.data.initiatives[0].status, "answered");
    assert.equal(h.store.data.initiatives[0].done, true);
  });

  it("«nunca de esto» silencia ese plan", async () => {
    const h = harness();
    await h.c.sweep();
    await h.c.handleFrame({ t: "feedback", id: h.store.data.initiatives[0].notice_id!, value: "never" });
    assert.deepEqual(h.store.data.settings.never_plans, ["p1"]);
  });

  it("una llamada que no sonó queda registrada y el teléfono recibe la siguiente", async () => {
    const h = harness();
    await h.c.handleFrame({ t: "call_result", id: "call-1", outcome: "missed", reason: "junta grabando" });
    assert.equal(h.store.data.calls[0].outcome, "missed");
    assert.equal(h.schedules.length, 1);
  });

  it("al colgar escribe el acta; sin modelo, el acta es la conversación tal cual", async () => {
    const transcript = [
      { role: "hermes", text: "Te llamo porque…" },
      { role: "user", text: "Esta semana no fui al gym, estaba cansado." },
    ];
    const ok = harness();
    await ok.c.callContext("call-1");
    const r = await ok.c.closeCall("call-1", { duration_s: 241, transcript });
    assert.match(r.acta_md ?? "", /acta/);
    assert.equal(ok.store.data.calls[0].outcome, "answered");
    assert.equal(ok.store.data.calls[0].duration_s, 241);

    const fail = harness({ acta: "fail" });
    const r2 = await fail.c.closeCall("call-2", { transcript });
    assert.match(r2.acta_md ?? "", /no fui al gym/);
    assert.equal(fail.saved.length, 1);
  });

  it("la llamada de la mañana en medio de un daily espera al hueco; muy tarde, no suena y queda por qué", async () => {
    const daily = [{ title: "TeKer Daily", start: at("09:00").toISOString(), end: at("09:30").toISOString(), allDay: false }];
    const h = harness({ now: at("09:00"), events: daily });
    const id = callId(at("09:00"), "morning");
    assert.deepEqual(await h.c.callContext(id), { ok: true, id, busy: "TeKer Daily", retry_at: at("09:32").toISOString() });
    h.setNow(at("09:32"));
    const ctx = await h.c.callContext(id);
    assert.equal(ctx.ok && "mode" in ctx ? ctx.mode : null, "morning");
    assert.equal(ctx.ok && "max_min" in ctx ? ctx.max_min : null, 3);

    const late = harness({ now: at("09:00"), events: [{ ...daily[0], end: at("12:00").toISOString() }] });
    const r = await late.c.callContext(id);
    assert.equal(r.ok, false);
    assert.equal(late.store.data.calls[0].outcome, "missed");
  });

  it("una llamada sin una palabra del dueño no deja acta", async () => {
    const h = harness();
    const r = await h.c.closeCall("call-3", { transcript: [{ role: "hermes", text: "¿Hola?" }] });
    assert.equal(r.acta_md, null);
    assert.equal(h.saved.length, 0);
  });
});
