import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EVOLUTION_STAGES, evolutionStage, type EvolutionMetrics } from "@hermes/shared";
import { daysBetween } from "./evolution.js";

/**
 * La etapa de Hermes sale SOLO de métricas reales. Lo que se protege: que un
 * umbral exacto cuente, que una métrica corta frene la etapa aunque el resto
 * sobre, que subir números nunca baje de etapa y que "lo que falta" diga
 * exactamente qué falta.
 */

const ZERO: EvolutionMetrics = { daysTogether: 0, memories: 0, skillsUsed: 0, executionsDone: 0, conversations: 0 };
const m = (p: Partial<EvolutionMetrics>): EvolutionMetrics => ({ ...ZERO, ...p });

describe("evolutionStage", () => {
  it("sin nada es Semilla, con Brote como siguiente y progreso 0", () => {
    const r = evolutionStage(ZERO);
    assert.equal(r.stage.key, "semilla");
    assert.equal(r.next?.stage.key, "brote");
    assert.deepEqual(
      r.next?.missing.map((x) => x.metric).sort(),
      ["daysTogether", "memories"],
    );
    assert.equal(r.progress, 0);
  });

  it("justo en el umbral cuenta (>=)", () => {
    assert.equal(evolutionStage(m({ daysTogether: 7, memories: 25 })).stage.key, "brote");
    assert.equal(evolutionStage(m({ daysTogether: 30, memories: 100, skillsUsed: 3 })).stage.key, "hojas");
    assert.equal(
      evolutionStage(m({ daysTogether: 90, memories: 100, skillsUsed: 10, executionsDone: 50 })).stage.key,
      "companero",
    );
  });

  it("una sola métrica corta bloquea la etapa y aparece en missing con have/need", () => {
    const r = evolutionStage(m({ daysTogether: 400, memories: 24, skillsUsed: 50, executionsDone: 500 }));
    assert.equal(r.stage.key, "semilla");
    assert.deepEqual(r.next?.missing, [{ metric: "memories", have: 24, need: 25 }]);
  });

  it("las etapas son secuenciales: cumplir la 4 sin la 3 no salta", () => {
    const r = evolutionStage(m({ daysTogether: 90, memories: 30, skillsUsed: 10, executionsDone: 50 }));
    assert.equal(r.stage.key, "brote");
    assert.deepEqual(r.next?.missing, [{ metric: "memories", have: 30, need: 100 }]);
  });

  it("la última etapa no tiene siguiente y su progreso es 1", () => {
    const r = evolutionStage(m({ daysTogether: 1000, memories: 1000, skillsUsed: 100, executionsDone: 1000 }));
    assert.equal(r.stage.level, 4);
    assert.equal(r.next, null);
    assert.equal(r.progress, 1);
  });

  it("el progreso es la media de los cocientes topados en 1", () => {
    // Hacia Brote: días 7/7 = 1 (topado aunque sobre), memorias 5/25 = 0.2 → 0.6
    const r = evolutionStage(m({ daysTogether: 70, memories: 5 }));
    assert.ok(Math.abs(r.progress - 0.6) < 1e-9);
  });

  it("subir cualquier métrica nunca baja de nivel y el progreso queda en [0,1]", () => {
    const keys = Object.keys(ZERO) as (keyof EvolutionMetrics)[];
    const steps = [0, 3, 7, 10, 25, 30, 50, 90, 100, 200];
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 300; i++) {
      const base = Object.fromEntries(keys.map((k) => [k, steps[Math.floor(rand() * steps.length)]])) as EvolutionMetrics;
      const k = keys[Math.floor(rand() * keys.length)];
      const more = { ...base, [k]: base[k] + 1 + Math.floor(rand() * 100) };
      const a = evolutionStage(base);
      const b = evolutionStage(more);
      assert.ok(b.stage.level >= a.stage.level, `${JSON.stringify(base)} → ${k}↑ bajó de nivel`);
      for (const r of [a, b]) assert.ok(r.progress >= 0 && r.progress <= 1);
    }
  });

  it("valores inválidos (NaN, negativos) cuentan como 0", () => {
    const r = evolutionStage(m({ daysTogether: Number.NaN, memories: -5 }));
    assert.equal(r.stage.key, "semilla");
    assert.equal(r.progress, 0);
  });

  it("los niveles van 1..4 en orden y la Semilla no exige nada", () => {
    assert.deepEqual(EVOLUTION_STAGES.map((s) => s.level), [1, 2, 3, 4]);
    assert.deepEqual(EVOLUTION_STAGES[0].requires, {});
  });
});

describe("daysBetween", () => {
  it("cuenta días completos (piso) y nunca da negativo", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    assert.equal(daysBetween("2026-10-06T12:00:00Z", now), 7);
    assert.equal(daysBetween("2026-10-06T12:00:01Z", now), 6);
    assert.equal(daysBetween("2026-10-14T00:00:00Z", now), 0);
    assert.equal(daysBetween("no es fecha", now), 0);
  });
});
