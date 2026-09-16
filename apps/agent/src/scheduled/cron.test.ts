import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cronError, describeCron, nextRun, parseCron } from "./cron.js";

/**
 * Contratos del cron, no snapshots: cada test afirma una RELACIÓN (la próxima
 * corrida cae en el minuto pedido, la tz manda sobre la del host), nunca
 * congela una fecha concreta que se rompa el año que viene.
 */

const BOG = "America/Bogota";

/** Hora de pared en una tz, para afirmar sobre lo que el humano ve. */
function wall(d: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "short",
    day: "2-digit", month: "2-digit", hour12: false,
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)!.value;
  return {
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: get("weekday"),
    day: Number(get("day")),
    month: Number(get("month")),
  };
}

describe("parseCron", () => {
  it("expande *, listas, rangos y pasos", () => {
    const f = parseCron("0,30 9-11 * * 1-5");
    assert.deepEqual(f.minutes, [0, 30]);
    assert.deepEqual(f.hours, [9, 10, 11]);
    assert.deepEqual(f.daysOfWeek, [1, 2, 3, 4, 5]);
    assert.equal(f.daysOfMonth.length, 31);
    assert.deepEqual(parseCron("*/15 * * * *").minutes, [0, 15, 30, 45]);
  });

  it("acepta alias y nombres de día", () => {
    assert.deepEqual(parseCron("@daily"), parseCron("0 0 * * *"));
    assert.deepEqual(parseCron("0 8 * * mon").daysOfWeek, [1]);
    assert.deepEqual(parseCron("0 8 * * lun").daysOfWeek, [1]);
  });

  it("trata 7 como domingo, igual que crontab", () => {
    assert.deepEqual(parseCron("0 8 * * 7").daysOfWeek, [0]);
  });

  it("rechaza lo inválido con un motivo legible", () => {
    assert.match(cronError("0 8 * *") ?? "", /5 campos/);
    assert.match(cronError("99 8 * * *") ?? "", /rango/);
    assert.match(cronError("0 8 * * */0") ?? "", /paso/);
    assert.equal(cronError("0 8 * * 1"), null);
  });
});

describe("nextRun", () => {
  it("es estrictamente futuro: nunca devuelve el instante que le pasas", () => {
    const now = new Date("2026-03-10T13:00:00Z"); // 08:00 en Bogotá
    const next = nextRun("0 8 * * *", BOG, now)!;
    assert.ok(next.getTime() > now.getTime(), "debe ser posterior a `from`");
    assert.equal(wall(next, BOG).hour, 8);
  });

  it("cae exactamente en la hora de pared pedida", () => {
    const next = nextRun("30 6 * * *", BOG, new Date("2026-03-10T20:00:00Z"))!;
    const w = wall(next, BOG);
    assert.equal(w.hour, 6);
    assert.equal(w.minute, 30);
  });

  it("respeta el día de la semana en la tz, no en UTC", () => {
    // Domingo 23:30 Bogotá = lunes 04:30 UTC: si el cálculo fuera en UTC,
    // "lunes 8am" saldría con 3.5 horas de diferencia.
    const next = nextRun("0 8 * * 1", BOG, new Date("2026-03-16T04:30:00Z"))!;
    const w = wall(next, BOG);
    assert.equal(w.weekday, "Mon");
    assert.equal(w.hour, 8);
  });

  it("la tz cambia el resultado: misma expresión, distinto instante", () => {
    const from = new Date("2026-06-15T00:00:00Z");
    const bog = nextRun("0 8 * * *", BOG, from)!;
    const tokyo = nextRun("0 8 * * *", "Asia/Tokyo", from)!;
    assert.notEqual(bog.getTime(), tokyo.getTime());
    assert.equal(wall(bog, BOG).hour, 8);
    assert.equal(wall(tokyo, "Asia/Tokyo").hour, 8);
  });

  it("encadena: la corrida siguiente a una diaria es 24h después", () => {
    const a = nextRun("0 8 * * *", BOG, new Date("2026-06-15T00:00:00Z"))!;
    const b = nextRun("0 8 * * *", BOG, a)!;
    assert.equal(b.getTime() - a.getTime(), 86_400_000);
  });

  it("mantiene la hora de pared al cruzar un cambio de horario", () => {
    // Nueva York cambia el 8 de marzo de 2026; el usuario espera 8am siempre.
    const before = nextRun("0 8 * * *", "America/New_York", new Date("2026-03-06T20:00:00Z"))!;
    const after = nextRun("0 8 * * *", "America/New_York", new Date("2026-03-09T20:00:00Z"))!;
    assert.equal(wall(before, "America/New_York").hour, 8);
    assert.equal(wall(after, "America/New_York").hour, 8);
  });

  it("con día-del-mes y día-de-semana ambos fijos, basta con que uno coincida", () => {
    // Regla clásica de crontab: es un OR, no un AND.
    const next = nextRun("0 8 1 * 1", BOG, new Date("2026-06-15T00:00:00Z"))!;
    const w = wall(next, BOG);
    assert.ok(w.day === 1 || w.weekday === "Mon");
  });

  it("resuelve fechas lejanas sin rendirse", () => {
    const next = nextRun("0 0 29 2 *", BOG, new Date("2026-06-15T00:00:00Z"));
    assert.ok(next, "29 de febrero existe dentro de la ventana de 2 años");
    assert.equal(wall(next!, BOG).day, 29);
    assert.equal(wall(next!, BOG).month, 2);
  });
});

describe("describeCron", () => {
  it("traduce los casos comunes a español", () => {
    assert.match(describeCron("0 8 * * *", BOG), /todos los días a las 08:00/);
    assert.match(describeCron("0 8 * * 1", BOG), /lunes a las 08:00/);
    assert.match(describeCron("0 8 * * 1,3,5", BOG), /lunes, miércoles y viernes/);
    assert.match(describeCron("*/15 * * * *", BOG), /cada 15 minutos/);
  });

  it("no revienta con una expresión inválida", () => {
    assert.equal(describeCron("no soy un cron", BOG), "no soy un cron");
  });
});
