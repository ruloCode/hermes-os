import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { CalendarEvent } from "@hermes/shared";
import { addSample, emptyDay, eventsToday, localDate, minutesLabel, parseHidIdleSeconds } from "./plan.js";

const TZ = "America/Bogota";

test("la inactividad de la Mac sale de ioreg en segundos; sin el campo, null", () => {
  assert.equal(parseHidIdleSeconds('  | |   "HIDIdleTime" = 431499000\n'), 0.431499);
  assert.equal(parseHidIdleSeconds("nada"), null);
});

test("cada muestra suma a lo sumo un minuto; un hueco no se rellena", () => {
  let log = emptyDay("2026-10-20");
  const t0 = new Date("2026-10-20T15:00:00Z");
  log = addSample(log, { at: t0, deskActive: true, tvOn: false });
  log = addSample(log, { at: new Date(t0.getTime() + 60_000), deskActive: true, tvOn: true });
  // el agente estuvo caído 2 horas: la siguiente muestra cuenta UN minuto, no 120
  log = addSample(log, { at: new Date(t0.getTime() + 2 * 3600_000), deskActive: true, tvOn: false });
  assert.equal(log.desk_min, 3);
  assert.equal(log.tv_min, 1);
});

test("dos muestras del mismo minuto no cuentan doble", () => {
  const t0 = new Date("2026-10-20T15:00:00Z");
  let log = addSample(emptyDay("2026-10-20"), { at: t0, deskActive: true, tvOn: true });
  log = addSample(log, { at: new Date(t0.getTime() + 10_000), deskActive: true, tvOn: true });
  assert.equal(log.desk_min, 1);
  assert.equal(log.tv_min, 1);
});

test("la fecha local es la de Bogotá, no la de UTC", () => {
  // 02:30 UTC del 21 = 21:30 del 20 en Bogotá
  assert.equal(localDate(new Date("2026-10-21T02:30:00Z"), TZ), "2026-10-20");
  assert.equal(minutesLabel(250), "4 h 10 min");
  assert.equal(minutesLabel(45), "45 min");
  assert.equal(minutesLabel(120), "2 h");
});

const ev = (title: string, start: string, allDay = false): CalendarEvent =>
  ({ id: title, title, start, end: null, allDay, location: null, description: null, startsInMin: 0 }) as CalendarEvent;

test("agenda de hoy: los de todo el día primero; un 'todo el día' con fecha sola no se corre al día anterior", () => {
  const out = eventsToday(
    [ev("Gym", "2026-10-21T11:00:00Z"), ev("Junta", "2026-10-20T19:00:00Z"), ev("Cumple", "2026-10-20", true), ev("Tarde", "2026-10-21T02:00:00Z")],
    "2026-10-20",
    TZ,
  );
  assert.deepEqual(out.map((e) => e.title), ["Cumple", "Junta", "Tarde"]);
});
