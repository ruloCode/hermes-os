import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  baristaDay,
  baristaScheduled,
  baristaWeather,
  formatCountdown,
  officeCounts,
  receptionList,
  receptionSummary,
  type DashboardSnapshot,
  type OfficeWorker,
  type OfficeWorkerStatus,
} from "@hermes/shared";

function worker(id: string, status: OfficeWorkerStatus, extra: Partial<OfficeWorker> = {}): OfficeWorker {
  return {
    id,
    source: "run",
    project: "hermes-os",
    name: `Agente ${id}`,
    status,
    task: { name: `Tarea ${id}`, summary: `haciendo ${id}` },
    startedAt: "2026-09-30T10:00:00Z",
    lastEventAt: "2026-09-30T10:00:00Z",
    toolCalls: 0,
    failStreak: 0,
    machine: "mac",
    lines: [],
    ...extra,
  };
}

const ctx = { connected: true, simulated: false, projectName: (s: string) => (s === "hermes-os" ? "Hermes OS" : s) };

/** Todos los números que aparecen en un texto. */
const numbers = (t: string) => (t.match(/\d+/g) ?? []).map(Number);

describe("Recepción", () => {
  it("dice los mismos conteos que el HUD, ni uno más", () => {
    const ws = [worker("a", "working"), worker("b", "working"), worker("c", "thinking"), worker("d", "done"), worker("e", "needs_you", { approval: { id: "x", tool: "Bash", summary: "git push", detail: "git push", requestedAt: "", expiresAt: "" } as never })];
    const [head, ...rest] = receptionSummary(ws, ctx);
    const c = officeCounts(ws);
    assert.match(head.text, /^Hay 5 sesiones vivas: /);
    assert.deepEqual(numbers(head.text).slice(1).sort(), [c.needs_you, c.working, c.thinking, c.done].sort());
    assert.equal(rest.length, 1);
    assert.equal(rest[0].workerId, "e");
    assert.match(rest[0].text, /git push/);
  });

  it("sin agentes no inventa a nadie; sin conexión no afirma nada", () => {
    assert.match(receptionSummary([], ctx)[0].text, /No hay nadie trabajando/);
    const off = receptionSummary([worker("a", "working")], { ...ctx, connected: false });
    assert.equal(off.length, 1);
    assert.match(off[0].text, /No tengo conexión/);
    assert.deepEqual(numbers(off[0].text), []);
  });

  it("la simulación se dice", () => {
    assert.match(receptionSummary([worker("a", "working")], { ...ctx, connected: false, simulated: true })[0].text, /^\(Simulación\)/);
  });

  it("las listas solo traen agentes reales de esa categoría, cada uno con su id", () => {
    const ws = [worker("a", "working"), worker("b", "done"), worker("c", "error"), worker("d", "thinking")];
    const working = receptionList(ws, "working", ctx).filter((l) => l.workerId);
    assert.deepEqual(working.map((l) => l.workerId).sort(), ["a", "d"]);
    const done = receptionList(ws, "done", ctx).filter((l) => l.workerId);
    assert.deepEqual(done.map((l) => l.workerId).sort(), ["b", "c"]);
    assert.match(receptionList(ws, "needs_you", ctx)[0].text, /Nadie te está pidiendo permiso/);
  });
});

function snapshot(over: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    generatedAt: "",
    machine: "mac",
    system: {} as DashboardSnapshot["system"],
    presence: [],
    knowledge: {} as DashboardSnapshot["knowledge"],
    tracker: {} as DashboardSnapshot["tracker"],
    jobs: [],
    activity: null,
    weather: null,
    calendar: { configured: false, fetchedAt: null, stale: false, events: [] },
    usage: { costUsd: 0, runs: 0 },
    ...over,
  };
}

describe("Barista", () => {
  const now = new Date(2026, 8, 30, 15, 4);

  it("sin snapshot solo dice la hora (que es del reloj local)", () => {
    const lines = baristaDay(null, now);
    assert.deepEqual(lines.map((l) => l.text), ["Son las 15:04."]);
  });

  it("uso del día y próximo evento salen del snapshot", () => {
    const lines = baristaDay(
      snapshot({
        usage: { costUsd: 1.234, runs: 3 },
        calendar: {
          configured: true,
          fetchedAt: "",
          stale: false,
          events: [{ id: "1", title: "Junta con el cliente", start: new Date(2026, 8, 30, 15, 30).toISOString(), end: null, allDay: false, location: null, description: null, startsInMin: 26 }],
        },
      }),
      now,
    ).map((l) => l.text);
    assert.ok(lines.includes("Hoy van 3 ejecuciones terminadas por US$ 1.23."));
    assert.ok(lines.includes("Tu próximo evento: Junta con el cliente, en 26 min."));
  });

  it("sin calendario configurado no habla de eventos", () => {
    const lines = baristaDay(snapshot(), now).map((l) => l.text);
    assert.ok(!lines.some((t) => /evento/.test(t)));
  });

  it("el clima solo existe si el agente lo reporta", () => {
    assert.deepEqual(baristaWeather(null), []);
    assert.deepEqual(baristaWeather(snapshot()), []);
    const [l] = baristaWeather(
      snapshot({
        weather: {
          place: "Bogotá",
          fetchedAt: "",
          stale: true,
          now: { tempC: 14.6, feelsLikeC: 13, humidityPct: 80, precipitationMm: 0, windKmh: 5, weatherCode: 3 },
          daily: [{ date: "2026-09-30", minC: 8.2, maxC: 19.7, precipProbPct: 60, weatherCode: 61 }],
        },
      }),
    );
    assert.match(l.text, /^En Bogotá hace 15°, nublado\. Hoy entre 8° y 20°, 60% de probabilidad de lluvia\./);
    assert.match(l.text, /puede estar viejo/);
  });

  it("tareas programadas: null (la fuente falló) = nada; activas ordenadas por la próxima corrida", () => {
    assert.deepEqual(baristaScheduled(null, now), []);
    assert.deepEqual(baristaScheduled([], now).map((l) => l.text), ["No hay tareas programadas activas."]);
    const lines = baristaScheduled(
      [
        { title: "Resumen semanal", enabled: true, next_run_at: new Date(2026, 9, 5, 8, 0).toISOString() },
        { title: "Backup", enabled: true, next_run_at: new Date(2026, 8, 30, 18, 0).toISOString(), when: "todos los días a las 6 p. m." },
        { title: "Apagada", enabled: false, next_run_at: new Date(2026, 8, 30, 16, 0).toISOString() },
        { title: "Bloqueada", enabled: true, blocked_reason: "3 fallos", next_run_at: new Date(2026, 8, 30, 16, 0).toISOString() },
      ],
      now,
    ).map((l) => l.text);
    assert.equal(lines.length, 2);
    assert.equal(lines[0], "La próxima: Backup, hoy a las 18:00 (todos los días a las 6 p. m.).");
    assert.match(lines[1], /^Resumen semanal, /);
  });

  it("los tokens se dicen en mil o millones", () => {
    const lines = baristaDay(snapshot({ usage: { costUsd: 2, runs: 1, tokens: { inputTokens: 3_000_000, outputTokens: 600_000, cacheCreationTokens: 0, cacheReadTokens: 36_000 } } }), now).map((l) => l.text);
    assert.ok(lines.includes("Hoy van 1 ejecución terminada por US$ 2.00 (3,6 millones de tokens)."), lines.join(" / "));
  });

  it("cuenta regresiva de la pausa", () => {
    assert.equal(formatCountdown(300_000), "5:00");
    assert.equal(formatCountdown(61_500), "1:02");
    assert.equal(formatCountdown(-5), "0:00");
  });
});
