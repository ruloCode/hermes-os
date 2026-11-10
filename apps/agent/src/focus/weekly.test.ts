import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { focusWeekly, focusWeeklyLine, focusWeekStart, isFocusWeeklyDate, type WeeklyUsageDay } from "@hermes/shared";
import { fileFocusStore, ingestUsage, validateUsage, type UsageDay } from "./store.js";

/**
 * Contrato de v6 «teléfono: foco» en el agente (openspec telefono-foco,
 * «El resumen sube al agente»): el teléfono sube por día minutos y aperturas
 * por app y los cortes por regla; el resumen semanal trae minutos y aperturas
 * por app, días dentro y fuera de presupuesto y la comparación con la semana
 * anterior. Solo datos reales: lo no medido es null. Nunca qué se miró.
 */

const IG = "com.instagram.android";
const TT = "com.zhiliaoapp.musically";

function day(date: string, apps: [string, number, number?][], rules?: WeeklyUsageDay["rules"]): UsageDay {
  return validateUsage(date, {
    complete: true,
    apps: apps.map(([p, m, o]) => ({ package: p, label: p === IG ? "Instagram" : "TikTok", minutes: m, ...(o != null ? { opens: o } : {}) })),
    ...(rules ? { rules } : {}),
  }) as UsageDay;
}

const budget = (used: number, extra: Record<string, unknown> = {}) => ({ rule_id: "tpl-budget-social", rule_name: "Redes · 30 min al día", budget_min: 30, used_min: used, ...extra });

describe("resumen semanal de foco", () => {
  // Semana anterior: lun 2 → dom 8 nov. Esta: lun 9 → hoy mar 10 nov 2026.
  const usage: Record<string, UsageDay> = {
    "2026-11-02": day("2026-11-02", [[IG, 50, 20], [TT, 10, 4]], [budget(60)]),
    "2026-11-03": day("2026-11-03", [[IG, 40, 15]], [budget(40)]),
    "2026-11-04": day("2026-11-04", [[IG, 90, 30]]), // fuera del tramo comparable (miércoles)
    "2026-11-09": day("2026-11-09", [[IG, 25, 9], [TT, 5, 2]], [budget(30, { shown: 3, choices: { volver: 2, entrar: 1 }, intents: { mensaje: 1 } })]),
    "2026-11-10": day("2026-11-10", [[IG, 35, 11]], [budget(35, { shown: 4, choices: { entrar: 2, volver: 2 }, intents: { mirar: 2 } })]),
  };

  it("Resumen semanal: minutos y aperturas por app, días dentro y fuera de presupuesto y la comparación con la semana anterior", () => {
    const w = focusWeekly(usage, "2026-11-10", "2026-11-10");
    assert.deepEqual(w.week, { from: "2026-11-09", to: "2026-11-15", through: "2026-11-10" });
    assert.deepEqual(w.previous, { from: "2026-11-02", through: "2026-11-03" }, "el mismo tramo (lun→mar), no la semana entera");
    const ig = w.apps.find((a) => a.package === IG)!;
    assert.deepEqual(
      { minutes: ig.minutes, opens: ig.opens, days: ig.days, prev_minutes: ig.prev_minutes, prev_opens: ig.prev_opens },
      { minutes: 60, opens: 20, days: 2, prev_minutes: 90, prev_opens: 35 },
    );
    assert.equal(w.apps[0].package, IG, "ordenado por minutos");
    assert.equal(w.totals.minutes, 65);
    assert.equal(w.totals.prev_minutes, 100);
    assert.equal(w.totals.change_pct, -35);
    const b = w.budgets[0];
    assert.equal(w.budgets.length, 1);
    assert.equal(b.days_within, 1, "30 de 30 está dentro");
    assert.equal(b.days_over, 1, "35 de 30 está fuera");
    assert.deepEqual(w.rules, [
      { rule_id: "tpl-budget-social", rule_name: "Redes · 30 min al día", shown: 7, choices: { volver: 4, entrar: 3 }, intents: { mensaje: 1, mirar: 2 } },
    ]);
    const line = focusWeeklyLine(w);
    assert.match(line, /Instagram: 1 h 0 min, 20 aperturas/);
    assert.match(line, /30 min menos que el mismo tramo/);
    assert.match(line, /1 día dentro y 1 fuera/);
  });

  it("solo datos reales: sin semana anterior no hay comparación, y un teléfono viejo no inventa aperturas", () => {
    const old: Record<string, UsageDay> = { "2026-11-09": day("2026-11-09", [[IG, 25]]) };
    const w = focusWeekly(old, "2026-11-09", "2026-11-10");
    assert.equal(w.apps[0].opens, null);
    assert.equal(w.totals.opens, null);
    assert.equal(w.apps[0].prev_minutes, null);
    assert.equal(w.totals.change_pct, null);
    assert.equal(w.prev_days_measured, 0);
    assert.deepEqual(w.budgets, []);
    const empty = focusWeekly({}, "2026-11-10", "2026-11-10");
    assert.equal(empty.days_measured, 0);
    assert.match(focusWeeklyLine(empty), /aún no ha subido/);
  });

  it("una semana pasada se resume entera contra la anterior entera", () => {
    const w = focusWeekly(usage, "2026-11-04", "2026-11-10");
    assert.deepEqual(w.week, { from: "2026-11-02", to: "2026-11-08", through: "2026-11-08" });
    assert.equal(w.apps.find((a) => a.package === IG)!.minutes, 180);
    assert.equal(w.budgets[0].days_over, 2);
    assert.equal(focusWeekStart("2026-11-15"), "2026-11-09", "el domingo es de la semana del lunes anterior");
    assert.equal(isFocusWeeklyDate("2026-13-40"), false);
  });
});

describe("PUT /focus/usage compatible", () => {
  it("un teléfono viejo sigue funcionando: se guarda igual que antes, sin campos nuevos", () => {
    const v = validateUsage("2026-11-10", { complete: false, apps: [{ package: IG, label: "Instagram", minutes: 12 }] });
    assert.deepEqual(v, { date: "2026-11-10", complete: false, apps: [{ package: IG, label: "Instagram", minutes: 12 }] });
  });

  it("lo nuevo se valida campo a campo y nunca guarda qué se miró", () => {
    const v = validateUsage("2026-11-10", {
      complete: true,
      apps: [{ package: IG, label: "Instagram", minutes: 12, opens: 7, screen: "reel de @alguien", texts: ["hola"] }],
      rules: [
        { rule_id: "r1", rule_name: "Sin Reels", shown: 2, choices: { volver: 1, "<script>": 3, entrar: -1 }, intents: { mirar: 1 }, viewed: "reel 123" },
        { rule_id: "b", rule_name: "Presupuesto", budget_min: 30, used_min: 41 },
        { rule_name: "sin id" },
      ],
    })!;
    assert.deepEqual(v.apps, [{ package: IG, label: "Instagram", minutes: 12, opens: 7 }]);
    assert.deepEqual(v.rules, [
      { rule_id: "r1", rule_name: "Sin Reels", shown: 2, choices: { volver: 1 }, intents: { mirar: 1 } },
      { rule_id: "b", rule_name: "Presupuesto", budget_min: 30, used_min: 41 },
    ]);
    assert.equal(/@alguien|reel 123|hola/.test(JSON.stringify(v)), false);
  });

  it("lo que sube se guarda en disco y el resumen lo lee", async () => {
    const store = fileFocusStore(await mkdtemp(join(tmpdir(), "focus-weekly-")));
    await ingestUsage(store, validateUsage("2026-11-10", { complete: false, apps: [{ package: IG, label: "Instagram", minutes: 9, opens: 3 }] })!);
    const w = focusWeekly((await store.load()).usage, "2026-11-10", "2026-11-10");
    assert.equal(w.apps[0].opens, 3);
    assert.equal(w.totals.minutes, 9);
  });
});
