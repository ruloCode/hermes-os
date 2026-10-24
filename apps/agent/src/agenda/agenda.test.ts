import { strict as assert } from "node:assert";
import { test } from "node:test";
import { addDays, occurrencesOn, parseDue, taskOnDay, zonedMidnight } from "./plan.js";

const TZ = "America/Bogota";

test("medianoche local de Bogotá = 05:00 UTC; sumar días cruza meses", () => {
  assert.equal(zonedMidnight("2026-10-20", TZ).toISOString(), "2026-10-20T05:00:00.000Z");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
});

test("ocurrencias de un cron en un día local: el lunes 8:00 sale el lunes y no el martes", () => {
  const mon = occurrencesOn("0 8 * * 1", TZ, "2026-10-19"); // 19-oct-2026 es lunes
  assert.deepEqual(mon.map((d) => d.toISOString()), ["2026-10-19T13:00:00.000Z"]);
  assert.deepEqual(occurrencesOn("0 8 * * 1", TZ, "2026-10-20"), []);
  assert.equal(occurrencesOn("0 */6 * * *", TZ, "2026-10-20").length, 4);
});

test("la fecha de un pendiente: solo AAAA-MM-DD válidas", () => {
  assert.equal(parseDue("2026-10-23"), "2026-10-23");
  assert.equal(parseDue("2026-02-30"), null);
  assert.equal(parseDue("el jueves"), null);
  assert.equal(parseDue(undefined), null);
});

test("en qué día va un pendiente: con fecha ese día; sin fecha hoy; vencido se arrastra a hoy; hecho el día que se cerró", () => {
  const today = "2026-10-20";
  assert.ok(taskOnDay({ due: "2026-10-23", done: false, doneOn: null }, "2026-10-23", today));
  assert.ok(!taskOnDay({ due: "2026-10-23", done: false, doneOn: null }, today, today));
  assert.ok(taskOnDay({ due: null, done: false, doneOn: null }, today, today));
  assert.ok(!taskOnDay({ due: null, done: false, doneOn: null }, "2026-10-21", today));
  assert.ok(taskOnDay({ due: "2026-10-18", done: false, doneOn: null }, today, today)); // vencida
  assert.ok(taskOnDay({ due: null, done: true, doneOn: today }, today, today));
  assert.ok(!taskOnDay({ due: null, done: true, doneOn: "2026-10-19" }, today, today));
});
