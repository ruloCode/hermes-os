import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assistantUsageDelta,
  buildOfficeSpend,
  formatPlanReset,
  formatTokens,
  formatUsd,
  parsePlanUsage,
  lastDays,
  parseModelUsage,
  parseSpendEntry,
  setWorkerSpend,
  shortModel,
  spendByModel,
  spendByProject,
  spendSeries,
  ZERO_TOKENS,
  type OfficeWorker,
  type SpendEntry,
} from "@hermes/shared";

const tok = (input: number, output: number) => ({ ...ZERO_TOKENS, inputTokens: input, outputTokens: output });

const entry = (id: string, project: string, costUsd: number | null, ts: string, models: SpendEntry["models"] = []): SpendEntry => ({
  ts,
  id,
  source: "run",
  project,
  title: id,
  costUsd,
  tokens: tok(10, 5),
  models,
  status: "done",
});

describe("gasto de la oficina", () => {
  it("lee el modelUsage del CLI, ignora lo que no tiene costo y ordena por costo", () => {
    const m = parseModelUsage({
      "claude-haiku-4-5": { inputTokens: 3, outputTokens: 4, cacheReadInputTokens: 5, cacheCreationInputTokens: 6, costUSD: 0.01 },
      "claude-sonnet-4-5": { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUSD: 0.5 },
      roto: { inputTokens: 9 },
    });
    assert.deepEqual(m.map((x) => x.model), ["claude-sonnet-4-5", "claude-haiku-4-5"]);
    assert.deepEqual(m[1].tokens, { inputTokens: 3, outputTokens: 4, cacheReadTokens: 5, cacheCreationTokens: 6 });
    assert.deepEqual(parseModelUsage(null), []);
    assert.deepEqual(parseModelUsage([1, 2]), []);
  });

  it("suma los tokens de cada mensaje de la API una sola vez aunque el CLI lo repita por bloque", () => {
    const seen = new Set<string>();
    const ev = { type: "assistant", message: { id: "msg_1", usage: { input_tokens: 7, output_tokens: 3 } } };
    assert.deepEqual(assistantUsageDelta(ev, seen), { inputTokens: 7, outputTokens: 3, cacheCreationTokens: 0, cacheReadTokens: 0 });
    assert.equal(assistantUsageDelta(ev, seen), null);
    assert.equal(assistantUsageDelta({ message: { id: "msg_2" } }, seen), null);
  });

  it("agrupa por proyecto, suma y pone primero lo más caro", () => {
    const rows = spendByProject([
      entry("a", "hermes-os", 0.1, "2026-09-30T15:00:00Z"),
      entry("b", "zylen", 0.5, "2026-09-30T15:00:00Z"),
      entry("c", "hermes-os", 0.2, "2026-09-30T15:00:00Z"),
      entry("d", "zylen", null, "2026-09-30T15:00:00Z"),
    ]);
    assert.deepEqual(rows.map((r) => [r.key, r.costUsd, r.runs]), [["zylen", 0.5, 2], ["hermes-os", 0.3, 2]]);
    assert.deepEqual(rows[1].tokens, tok(20, 10));
  });

  it("por modelo cuenta en cada modelo del run y deja fuera los runs sin modelUsage", () => {
    const rows = spendByModel([
      entry("a", "x", 0.6, "2026-09-30T15:00:00Z", [
        { model: "claude-sonnet-4-5-20250929", costUsd: 0.5, tokens: tok(1, 1) },
        { model: "claude-haiku-4-5", costUsd: 0.1, tokens: tok(1, 1) },
      ]),
      entry("b", "x", 9, "2026-09-30T15:00:00Z"),
    ]);
    assert.deepEqual(rows.map((r) => [r.key, r.costUsd, r.runs]), [["sonnet-4-5", 0.5, 1], ["haiku-4-5", 0.1, 1]]);
  });

  it("la serie diaria no inventa ceros antes del primer archivo de la máquina", () => {
    const s = spendSeries([{ day: "2026-09-28", costUsd: 1, runs: 2 }, { day: "2026-09-30", costUsd: 3, runs: 1 }], "2026-09-30", 5);
    assert.deepEqual(s.map((p) => p.day), ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"]);
    assert.deepEqual(s.map((p) => p.known), [false, false, true, true, true]);
    assert.deepEqual(s.map((p) => p.costUsd), [0, 0, 1, 0, 3]);
    assert.deepEqual(spendSeries([], "2026-09-30", 7), []);
    // Con archivos de hace meses, los días sin archivo de la ventana son ceros reales.
    assert.ok(spendSeries([], "2026-09-30", 3, "2026-07-06").every((p) => p.known && p.costUsd === 0));
  });

  it("los días cruzan el cambio de mes", () => {
    assert.deepEqual(lastDays("2026-10-02", 3), ["2026-09-30", "2026-10-01", "2026-10-02"]);
  });

  it("separa hoy de la semana con el día LOCAL y dice desde cuándo hay desglose", () => {
    const now = new Date(2026, 8, 30, 20, 0, 0); // 30 sep, 8 p. m. local
    const todayTs = new Date(2026, 8, 30, 19, 0, 0).toISOString();
    const oldTs = new Date(2026, 8, 26, 10, 0, 0).toISOString();
    const out = buildOfficeSpend({
      now,
      today: { day: "2026-09-30", costUsd: 1.5, runs: 3 },
      days: [{ day: "2026-09-30", costUsd: 1.5, runs: 3 }],
      entries: [entry("a", "hermes-os", 1, todayTs), entry("b", "zylen", 2, oldTs)],
      live: [],
    });
    assert.equal(out.today.costUsd, 1.5);
    assert.deepEqual(out.byProject.today.map((r) => r.key), ["hermes-os"]);
    assert.deepEqual(out.byProject.week.map((r) => r.key), ["zylen", "hermes-os"]);
    assert.equal(out.byModel, null);
    assert.equal(out.since, "2026-09-26");
    assert.deepEqual(out.recent.map((e) => e.id), ["a", "b"]);
  });

  it("sin archivos no hay histórico ni desglose (no ceros que parezcan dato)", () => {
    const out = buildOfficeSpend({ now: new Date(2026, 8, 30), today: null, days: [], entries: [], live: [] });
    assert.deepEqual(out.series, []);
    assert.equal(out.since, null);
    assert.equal(out.today.tokens, null);
  });

  it("descarta líneas del registro que no tienen la forma", () => {
    assert.equal(parseSpendEntry("{no es json"), null);
    assert.equal(parseSpendEntry(JSON.stringify({ ts: "x", id: "a", project: "p", source: "otro" })), null);
    const ok = parseSpendEntry(JSON.stringify({ ts: "2026-09-30T00:00:00Z", id: "a", project: "p", source: "task", costUsd: "caro" }));
    assert.equal(ok?.costUsd, null);
    assert.deepEqual(ok?.models, []);
  });

  it("un costo final no se pisa con tokens parciales que lleguen tarde", () => {
    const w = { id: "r1" } as OfficeWorker;
    const workers = new Map([["r1", w]]);
    assert.ok(setWorkerSpend(workers, "r1", { tokens: tok(1, 1), final: false }));
    assert.ok(setWorkerSpend(workers, "r1", { costUsd: 0.2, tokens: tok(5, 5), final: true }));
    assert.equal(setWorkerSpend(workers, "r1", { tokens: tok(9, 9), final: false }), null);
    assert.equal(w.spend?.costUsd, 0.2);
    assert.equal(setWorkerSpend(workers, "r1", { costUsd: 0.2, tokens: tok(5, 5), final: true }), null, "sin cambios no publica");
    assert.equal(setWorkerSpend(workers, "nadie", { final: true }), null);
  });

  it("formatea sin redondear a cero lo que no llega a un centavo", () => {
    assert.equal(formatUsd(0.004), "<$0.01");
    assert.equal(formatUsd(0), "$0.00");
    assert.equal(formatUsd(12.345), "$12.35");
    assert.equal(formatUsd(null), "—");
    assert.equal(formatTokens(950), "950");
    assert.equal(formatTokens(1234), "1.2k");
    assert.equal(formatTokens(48605), "49k");
    assert.equal(formatTokens(4_604_576), "4.6M");
    assert.equal(shortModel("claude-opus-4-1-20250805"), "opus-4-1");
  });

  it("el uso del plan trae sesión, semana y los límites por modelo con su reinicio", () => {
    const now = new Date("2026-10-01T03:00:00Z");
    const u = parsePlanUsage(
      {
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: {
          five_hour: { utilization: 33, resets_at: "2026-10-01T05:20:00Z" },
          seven_day: { utilization: 54, resets_at: "2026-10-02T06:00:00Z" },
          seven_day_opus: null,
          seven_day_sonnet: { utilization: null, resets_at: null },
          model_scoped: [{ display_name: "Fable", utilization: 38, resets_at: "2026-10-02T06:00:00Z" }, { display_name: "Roto" }],
        },
      },
      now,
    );
    assert.equal(u.available, true);
    assert.equal(u.subscription, "max");
    assert.deepEqual(u.windows.map((w) => [w.label, w.utilization]), [["Sesión actual", 33], ["Esta semana", 54], ["Fable esta semana", 38]]);
    assert.equal(u.windows[2].note, "Límite semanal independiente para Fable");
  });

  it("sin límites de plan (API key) no inventa barras", () => {
    const u = parsePlanUsage({ subscription_type: null, rate_limits_available: false, rate_limits: null }, new Date());
    assert.equal(u.available, false);
    assert.deepEqual(u.windows, []);
    assert.ok(u.error);
    assert.equal(parsePlanUsage(null, new Date()).available, false);
  });

  it("dice cuándo se restablece en hora local, corto para la sesión y largo para la semana", () => {
    const now = new Date(2026, 8, 30, 22, 0); // mié 30 sep, 10 p. m. local
    assert.equal(formatPlanReset(new Date(2026, 9, 1, 0, 20).toISOString(), now), "Se restablece el jue, 12:20 a.m.");
    assert.equal(formatPlanReset(new Date(2026, 9, 2, 1, 0).toISOString(), now, true), "Se restablece el viernes, 1:00 a.m.");
    assert.equal(formatPlanReset(new Date(2026, 8, 30, 23, 5).toISOString(), now), "Se restablece hoy, 11:05 p.m.");
    assert.equal(formatPlanReset(new Date(2026, 9, 1, 0, 19, 59, 880).toISOString(), now), "Se restablece el jue, 12:20 a.m.");
    assert.equal(formatPlanReset(null, now), null);
  });
});
