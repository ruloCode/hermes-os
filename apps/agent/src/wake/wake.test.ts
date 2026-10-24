import { strict as assert } from "node:assert";
import { test } from "node:test";
import { nextAlarmState, type AlarmState } from "../tv/alarm.js";
import { alarmDue, buildGreeting, DAILY_QUOTES, parseScenes, tvTokenAllows } from "../tv/plan.js";
import {
  dueNudge,
  pickWakeTarget,
  scoreWake,
  streakBefore,
  wakeBase,
  wakeResultSpeech,
  wakeStats,
  wakeTier,
  type WakeRecord,
} from "./plan.js";

const rec = (date: string, delta: number | null, extra: Partial<WakeRecord> = {}): WakeRecord => ({
  date,
  target_at: `${date}T10:30:00.000Z`,
  target_source: "alarma",
  started_at: `${date}T10:30:00.000Z`,
  confirmed_at: delta == null ? null : new Date(Date.parse(`${date}T10:30:00.000Z`) + delta * 60_000).toISOString(),
  confirmed_by: delta == null ? null : "tv",
  delta_min: delta,
  base: delta == null ? 0 : wakeBase(delta),
  bonus: 0,
  points: delta == null ? 0 : wakeBase(delta),
  streak: 0,
  ...extra,
});

test("menos minutos de diferencia, más puntos; levantarse tarde igual cuenta", () => {
  assert.equal(wakeBase(-15), 100); // antes de tu hora
  assert.equal(wakeBase(0), 100);
  assert.equal(wakeBase(2), 100); // gracia: apagar la alarma y pararse
  assert.equal(wakeBase(3), 98);
  assert.equal(wakeBase(10), 84);
  assert.equal(wakeBase(30), 44);
  assert.equal(wakeBase(200), 10); // piso
  for (let d = 0; d < 60; d++) assert.ok(wakeBase(d) >= wakeBase(d + 1), "nunca da más por llegar más tarde");
});

test("el tramo dice el dato, no un adjetivo", () => {
  assert.equal(wakeTier(1), "alarma");
  assert.equal(wakeTier(10), "a-tiempo");
  assert.equal(wakeTier(11), "tarde");
  assert.equal(wakeTier(45), "muy-tarde");
  assert.equal(wakeTier(null), "no-confirmo");
});

test("la racha cuenta mañanas SEGUIDAS a tiempo hasta ayer; un hueco o una tarde la corta", () => {
  const h = [rec("2026-10-19", 3), rec("2026-10-20", 8), rec("2026-10-21", 0)];
  assert.equal(streakBefore(h, "2026-10-22"), 3);
  assert.equal(streakBefore([...h.slice(0, 2), rec("2026-10-21", 25)], "2026-10-22"), 0);
  assert.equal(streakBefore([rec("2026-10-19", 3), rec("2026-10-20", 3)], "2026-10-22"), 0); // faltó el 21
  assert.equal(streakBefore([rec("2026-10-21", null)], "2026-10-22"), 0); // no confirmó
});

test("confirmar a tiempo suma el bono de racha; tarde no, y la racha vuelve a 0", () => {
  const h = [rec("2026-10-20", 1), rec("2026-10-21", 4)];
  const base = { date: "2026-10-22", target_at: "2026-10-22T10:30:00.000Z", target_source: "alarma" as const, started_at: "2026-10-22T10:30:00.000Z" };
  const onTime = scoreWake({ ...base, confirmed_at: "2026-10-22T10:35:00.000Z", confirmed_by: "tv" }, h);
  assert.deepEqual([onTime.delta_min, onTime.base, onTime.bonus, onTime.points, onTime.streak], [5, 94, 10, 104, 3]);
  const late = scoreWake({ ...base, confirmed_at: "2026-10-22T11:00:00.000Z", confirmed_by: "tv" }, h);
  assert.deepEqual([late.delta_min, late.bonus, late.streak], [30, 0, 0]);
  const missed = scoreWake({ ...base, confirmed_at: null, confirmed_by: null }, h);
  assert.deepEqual([missed.points, missed.streak], [0, 0]);
});

test("el bono de racha tiene tope", () => {
  const h = Array.from({ length: 20 }, (_, i) => rec(`2026-09-${String(i + 1).padStart(2, "0")}`, 0));
  const r = scoreWake({ date: "2026-09-21", target_at: "2026-09-21T10:30:00Z", target_source: "alarma", started_at: "2026-09-21T10:30:00Z", confirmed_at: "2026-09-21T10:30:00Z", confirmed_by: "tv" }, h);
  assert.equal(r.bonus, 30);
});

test("hora objetivo: el compromiso manda sobre la alarma; sin ninguna cerca, la hora de la escena", () => {
  const now = new Date("2026-10-23T10:25:00Z");
  const alarm = { at: "2026-10-23T10:30:00Z", source: "alarma" as const };
  const commit = { at: "2026-10-23T10:20:00Z", source: "compromiso" as const };
  assert.deepEqual(pickWakeTarget([alarm, commit], now), commit);
  assert.deepEqual(pickWakeTarget([alarm], now), alarm);
  // La alarma de mañana (ya avisada por el teléfono) no es la de esta mañana.
  assert.deepEqual(pickWakeTarget([{ at: "2026-10-24T10:30:00Z", source: "alarma" }, { at: "2026-10-23T10:30:00Z", source: "alarma" }], now), alarm);
  assert.deepEqual(pickWakeTarget([{ at: "2026-10-24T10:30:00Z", source: "alarma" }], now), { at: now.toISOString(), source: "escena" });
});

test("al sonar la alarma, el teléfono avisa la de mañana y la de hoy queda como prev", () => {
  const a: AlarmState = { at: "2026-10-23T10:30:00Z", prev: null, updated_at: null, fired: {} };
  const rang = nextAlarmState(a, "2026-10-24T10:30:00Z", new Date("2026-10-23T10:30:02Z"));
  assert.equal(rang.prev, "2026-10-23T10:30:00Z");
  // Cambiar la alarma la noche anterior NO es "sonó".
  const moved = nextAlarmState(a, "2026-10-23T10:00:00Z", new Date("2026-10-23T02:00:00Z"));
  assert.equal(moved.prev, null);
});

test("escena a la hora (0 min): ventana de 5 min desde la hora, una vez por mañana", () => {
  const t = "2026-10-23T10:30:00Z";
  assert.equal(alarmDue(t, 0, new Date("2026-10-23T10:29:30Z"), null), false);
  assert.equal(alarmDue(t, 0, new Date("2026-10-23T10:30:20Z"), null), true);
  assert.equal(alarmDue(t, 0, new Date("2026-10-23T10:36:00Z"), null), false);
  // El compromiso de las 5:20 ya disparó: la alarma de las 5:30 no vuelve a hacerlo.
  assert.equal(alarmDue(t, 0, new Date("2026-10-23T10:30:20Z"), "2026-10-23T10:20:00Z"), false);
  // Mañana sí.
  assert.equal(alarmDue("2026-10-24T10:30:00Z", 0, new Date("2026-10-24T10:30:20Z"), t), true);
});

test("escenas: before_alarm_min acepta 0 y wait-awake se valida", () => {
  const ok = parseScenes({
    scenes: [{ id: "despertar", name: "Despertar", before_alarm_min: 0, steps: [{ kind: "tv-greeting" }, { kind: "wait-awake", max_ms: 5_400_000, next: "Vamos con la meditación." }] }],
  });
  assert.deepEqual(ok.errors, []);
  const d = ok.scenes.find((s) => s.id === "despertar")!;
  assert.equal(d.before_alarm_min, 0);
  assert.deepEqual(d.steps[1], { kind: "wait-awake", max_ms: 5_400_000, next: "Vamos con la meditación." });
  const bad = parseScenes({ scenes: [{ id: "x", steps: [{ kind: "wait-awake", max_ms: 10 }] }] });
  assert.equal(bad.errors.length, 1);
});

test("el token de la TV lee y confirma el despertar, y nada más del despertar", () => {
  assert.ok(tvTokenAllows("GET", "/wake"));
  assert.ok(tvTokenAllows("POST", "/wake/confirm"));
  assert.ok(!tvTokenAllows("POST", "/wake/commit")); // comprometerse es del dueño, no del aparato
});

test("recordatorios: uno por minuto marcado, sin repetir, y el más reciente si se acumularon", () => {
  assert.equal(dueNudge(3, []), null);
  assert.equal(dueNudge(5, []), 5);
  assert.equal(dueNudge(7, [5]), null);
  assert.equal(dueNudge(23, [5]), 20); // agente lento: se dice el último, no tres seguidos
});

test("estadísticas: semana ISO (lunes a domingo), total y mejor racha", () => {
  const h = [rec("2026-10-18", 0, { points: 100, streak: 5 }), rec("2026-10-19", 0, { points: 100, streak: 6 }), rec("2026-10-21", 20, { points: 64 })];
  const s = wakeStats(h, "2026-10-22"); // jueves; la semana empezó el lunes 19
  assert.equal(s.week_points, 164);
  assert.equal(s.week_days, 2);
  assert.equal(s.total_points, 264);
  assert.equal(s.best_streak, 6);
  assert.equal(s.streak, 0); // el 21 fue tarde
});

test("lo que se dice al confirmar sale de los números", () => {
  const r = { ...rec("2026-10-22", 4), base: 96, bonus: 10, points: 106, streak: 3 };
  const say = wakeResultSpeech("Ana", r, { week_points: 300, week_days: 3, total_points: 900, streak: 3, best_streak: 3, avg_delta_7: 4 }, { h: 5, m: 34 }, "Vamos con la meditación.");
  assert.match(say, /5 y 34, a 4 minutos de tu hora/);
  assert.match(say, /96 puntos, más 10 por la racha/);
  assert.match(say, /3 mañanas seguidas/);
  assert.match(say, /semana llevas 300 puntos/);
  assert.ok(say.endsWith("Vamos con la meditación."));
});

test("cada frase trae su discurso: original, hablable y de largo de mañana", () => {
  for (const q of DAILY_QUOTES) {
    const words = q.talk.split(/\s+/).length;
    assert.ok(words >= 30 && words <= 90, `${q.author}: ${words} palabras`);
    assert.ok(!/[«»"[\]]/.test(q.talk), "el discurso no cita entre comillas: son palabras de Hermes");
  }
});

test("con despertar, el saludo cierra con frase + discurso + llamado a ponerse de pie", () => {
  const g = buildGreeting({ owner: "Ana", date: "2026-10-23", events: [], tasks: [], habits: [], wake: { h: 5, m: 30, source: "alarma" } });
  const q = DAILY_QUOTES.find((x) => g.speech.includes(x.talk))!;
  assert.ok(q, "dice el discurso de la frase del día");
  assert.ok(g.speech.indexOf("semana") < g.speech.indexOf(q.talk), "primero el día, después el discurso");
  assert.match(g.speech, /Tu alarma era a las 5 y media de la mañana\. Ponte de pie y presiona OK/);
  assert.equal(g.speech.split(q.text).length, 2, "la frase se dice una sola vez");
  const c = buildGreeting({ owner: "Ana", date: "2026-10-23", events: [], tasks: [], habits: [], wake: { h: 1, m: 0, source: "compromiso" } });
  assert.match(c.speech, /Te comprometiste a levantarte a la 1 de la mañana/);
});
