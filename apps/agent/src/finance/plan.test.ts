import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Transaction, Wallet } from "@hermes/shared";
import { conceptKey, planLabel, planTotals, suggestPlan, validatePlanItems } from "./plan.js";
import { snapshotOf, upsertSnapshot } from "./history.js";

/**
 * Contrato del plan mensual: Hermes SUGIERE (nunca confirma solo), no inventa
 * días de pago a partir de la fecha en que se dictó algo, y lo que manda el
 * teléfono se valida ítem por ítem. La historia del saldo guarda una foto por
 * día y nunca un $0 falso.
 */

let n = 0;
const tx = (o: Partial<Transaction>): Transaction => ({
  id: ++n,
  kind: "expense",
  amount: 100_000,
  currency: "COP",
  category: "servicios",
  account: null,
  note: null,
  occurred_on: "2026-07-09",
  source: "voice",
  created_at: "2026-07-09T23:05:00Z",
  voided_at: null,
  ...o,
});

describe("plan mensual · sugerencias", () => {
  it("lo que dice «mensual» se sugiere; lo demás queda como candidato sin marcar", () => {
    const { suggestions, candidates } = suggestPlan([
      tx({ note: "luz Usme mensual", amount: 90_000 }),
      tx({ note: "arriendo Bambú", amount: 1_420_000, category: "vivienda" }),
      tx({ kind: "income", note: "Teker mensual", amount: 2_500_000, category: "salario" }),
    ]);
    assert.deepEqual(suggestions.map((s) => s.label), ["Teker", "Luz Usme"]);
    assert.equal(suggestions[0].reason, "dice «mensual»");
    assert.deepEqual(candidates.map((s) => s.label), ["Arriendo Bambú"]);
    assert.equal(candidates[0].reason, null);
  });

  it("la fecha en que se DICTÓ no es día de pago: sin repetición, day = null", () => {
    const { suggestions } = suggestPlan([tx({ note: "agua mensual", occurred_on: "2026-07-09" })]);
    assert.equal(suggestions[0].day, null);
  });

  it("el mismo concepto el mismo día en 2 meses sí da día de pago y se sugiere por repetición", () => {
    const { suggestions } = suggestPlan([
      tx({ note: "Internet Bogotá", occurred_on: "2026-08-12", amount: 151_331 }),
      tx({ note: "internet bogota", occurred_on: "2026-07-12", amount: 150_000 }),
    ]);
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].day, 12);
    assert.equal(suggestions[0].amount, 151_331, "manda el monto más reciente");
    assert.match(suggestions[0].reason ?? "", /2 meses/);
  });

  it("una anulada no cuenta", () => {
    const { suggestions, candidates } = suggestPlan([tx({ note: "gas mensual", voided_at: "2026-07-10T00:00:00Z" })]);
    assert.equal(suggestions.length + candidates.length, 0);
  });

  it("la llave del concepto ignora tildes, mayúsculas y la palabra mensual", () => {
    assert.equal(conceptKey("Luz USME mensual"), conceptKey("luz usme"));
    assert.equal(planLabel("comida mensual"), "Comida");
  });
});

describe("plan mensual · validación", () => {
  it("descarta ítems rotos con motivo y conserva los buenos", () => {
    const { items, rejected } = validatePlanItems([
      { kind: "expense", label: "Arriendo", amount: 1_420_000, day: 5 },
      { kind: "expense", label: "", amount: 10 },
      { kind: "income", label: "Empresa", amount: 3000, currency: "USD" },
      { kind: "expense", label: "Gas", amount: -5 },
      { kind: "expense", label: "Luz", amount: 90_000, day: 40 },
    ]);
    assert.deepEqual(items.map((i) => [i.label, i.currency, i.day]), [["Arriendo", "COP", 5], ["Empresa", "USD", null]]);
    assert.equal(rejected.length, 3);
  });

  it("totales por moneda, sin convertir", () => {
    const { items } = validatePlanItems([
      { kind: "income", label: "Teker", amount: 2_500_000 },
      { kind: "income", label: "Empresa", amount: 3000, currency: "USD" },
      { kind: "expense", label: "Arriendo", amount: 1_420_000 },
    ]);
    assert.deepEqual(planTotals(items), { COP: { income: 2_500_000, expense: 1_420_000 }, USD: { income: 3000, expense: 0 } });
  });
});

describe("historia del saldo", () => {
  const w = (name: string, balance: number, currency: "COP" | "USD" = "COP"): Wallet => ({ id: 1, name, balance, currency });
  const tz = "America/Bogota";

  it("una foto por día: la última del día manda", () => {
    const a = snapshotOf([w("nu", 100)], new Date("2026-10-14T13:00:00Z"), tz);
    const b = snapshotOf([w("nu", 80)], new Date("2026-10-14T22:00:00Z"), tz);
    const list = upsertSnapshot(upsertSnapshot([], a), b);
    assert.equal(list.length, 1);
    assert.equal(list[0].totals.COP, 80);
  });

  it("el día es el de Bogotá, y las monedas no se mezclan", () => {
    const s = snapshotOf([w("nu", 100), w("ontop", 5, "USD")], new Date("2026-10-15T03:00:00Z"), tz);
    assert.equal(s.date, "2026-10-14");
    assert.deepEqual(s.totals, { COP: 100, USD: 5 });
  });

  it("sin billeteras no se guarda un $0 falso", () => {
    assert.equal(upsertSnapshot([], snapshotOf([], new Date(), tz)).length, 0);
  });
});

import { validateNotifMovements } from "./notifications.js";

describe("movimientos desde avisos del banco · validación", () => {
  const ok = { key: "sms:0123456789abcdef0123", kind: "expense", amount: 3500, account: "bancolombia", note: "Transferencia", occurred_on: "2026-10-14" };
  it("acepta lo bien formado y rechaza con motivo lo roto", () => {
    const { items, rejected } = validateNotifMovements([
      ok,
      { ...ok, key: "texto crudo del aviso" },
      { ...ok, kind: "transfer" },
      { ...ok, amount: -1 },
      { ...ok, account: "davivienda" },
      { ...ok, occurred_on: "14/10/26" },
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].currency, "COP");
    assert.equal(rejected.length, 5);
  });
  it("nunca acepta más de 200 de una vez", () => {
    assert.equal(validateNotifMovements(Array.from({ length: 300 }, (_, i) => ({ ...ok, key: `app:${String(i).padStart(12, "0")}` }))).items.length, 200);
  });
});

import { FINANCE_TOOLS, financeGate } from "./guard.js";

describe("candado de finanzas desde el teléfono", () => {
  const h = (o: Record<string, string>) => (k: string) => o[k];
  it("teléfono sin huella: las tools de finanzas no existen en el turno", () => {
    const g = financeGate(h({ "X-Hermes-Client": "phone" }));
    assert.equal(g.locked, true);
    assert.deepEqual(g.disallowedTools, FINANCE_TOOLS);
    assert.ok(g.disallowedTools.includes("mcp__hermes__get_balance"));
    assert.match(g.note ?? "", /huella/);
  });
  it("teléfono con Finanzas desbloqueada: todo igual que siempre", () => {
    assert.equal(financeGate(h({ "X-Hermes-Client": "phone", "X-Hermes-Finance": "unlocked" })).locked, false);
  });
  it("desde la Mac no cambia nada", () => {
    const g = financeGate(h({}));
    assert.equal(g.locked, false);
    assert.deepEqual(g.disallowedTools, []);
  });
});
