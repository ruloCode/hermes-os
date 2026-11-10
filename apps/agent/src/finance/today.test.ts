import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  antExpenses,
  availableToday,
  categoryDrift,
  merchantKey,
  recurringCharges,
  type TodayPlan,
  type TodayTx,
} from "@hermes/shared";
import { FINANCE_TOOLS, financeGate } from "./guard.js";

// Contratos de la spec openspec/changes/v6-nucleo/specs/finanzas: un bloque por
// `#### Scenario` + bordes. Datos sintéticos, nunca los del dueño.

const PLAN: TodayPlan = {
  confirmed_at: "2026-10-01T00:00:00Z",
  items: [
    { kind: "income", label: "Sueldo", amount: 3_000_000, currency: "COP", category: "salario" },
    { kind: "expense", label: "Arriendo", amount: 1_000_000, currency: "COP", category: "vivienda" },
    { kind: "expense", label: "Internet", amount: 100_000, currency: "COP", category: "servicios" },
  ],
};

let seq = 0;
function tx(p: Partial<TodayTx> & { amount: number; occurred_on: string }): TodayTx {
  seq++;
  return { kind: "expense", currency: "COP", category: "restaurantes", note: `gasto ${seq}`, ...p };
}

function ok(r: ReturnType<typeof availableToday>) {
  assert.equal(r.ok, true, r.ok ? "" : r.reason);
  return (r as Extract<typeof r, { ok: true }>).today;
}

describe("Disponible hoy", () => {
  it("Plan confirmado: (ingresos − fijos − variable del mes) ÷ días que quedan, incluido hoy", () => {
    // 10 de noviembre (30 días): quedan 21 días contando hoy.
    const txs = [tx({ amount: 200_000, occurred_on: "2026-11-03" }), tx({ amount: 100_000, occurred_on: "2026-11-09" })];
    const t = ok(availableToday(PLAN, txs, "2026-11-10", null));
    assert.equal(t.daysLeft, 21);
    assert.equal(t.available, Math.floor((3_000_000 - 1_100_000 - 300_000) / 21));
    assert.deepEqual(t.plan, { income: 3_000_000, fixed: 1_100_000, variable: 300_000 });
    assert.equal(t.currency, "COP");
    assert.equal(t.overBy, undefined);
    assert.match(t.method, /÷ 21 días que quedan, incluido hoy/);
    assert.match(t.method, /\$3\.000\.000/);
  });

  it("un gasto fijo del plan ya pagado no se resta dos veces", () => {
    const txs = [tx({ amount: 1_000_000, category: "vivienda", note: "arriendo", occurred_on: "2026-11-01" })];
    const t = ok(availableToday(PLAN, txs, "2026-11-10", null));
    assert.equal(t.plan.variable, 0);
    assert.equal(t.available, Math.floor(1_900_000 / 21));
  });

  it("lo que pasa de la reserva del plan en esa categoría sí es variable", () => {
    const txs = [tx({ amount: 1_150_000, category: "vivienda", occurred_on: "2026-11-01" })];
    const t = ok(availableToday(PLAN, txs, "2026-11-10", null));
    assert.equal(t.plan.variable, 150_000);
  });

  it("Sin plan: no hay número, se dice que falta confirmar el plan", () => {
    for (const plan of [null, { ...PLAN, confirmed_at: null }, { items: [], confirmed_at: "2026-10-01" }]) {
      const r = availableToday(plan, [], "2026-11-10", null);
      assert.equal(r.ok, false);
      if (!r.ok) {
        assert.equal(r.missing, "plan");
        assert.match(r.reason, /confirmar el plan/);
      }
      assert.equal("today" in r, false);
    }
  });

  it("Ya se pasó: disponible cero y por cuánto", () => {
    // Libre del plan = 1.900.000; variable = 2.000.000 → se pasó por 100.000.
    const txs = [tx({ amount: 2_000_000, occurred_on: "2026-11-05" })];
    const t = ok(availableToday(PLAN, txs, "2026-11-10", null));
    assert.equal(t.available, 0);
    assert.equal(t.overBy, 100_000);
    assert.match(t.method, /^Disponible 0/);
    assert.match(t.method, /por \$100\.000/);
  });

  it("si hoy mismo se pasa, overBy cuenta el gasto de hoy", () => {
    const txs = [tx({ amount: 1_800_000, occurred_on: "2026-11-05" }), tx({ amount: 150_000, occurred_on: "2026-11-10" })];
    const t = ok(availableToday(PLAN, txs, "2026-11-10", null));
    assert.equal(t.available, Math.floor(100_000 / 21));
    assert.equal(t.overBy, 50_000);
    assert.ok(t.remaining < 0, "lo que queda puede ser negativo");
  });

  it("Transferencias propias: no cuentan como gasto ni como ingreso", () => {
    const base = ok(availableToday(PLAN, [], "2026-11-10", null));
    const txs = [
      tx({ amount: 500_000, category: "transferencia", occurred_on: "2026-11-02" }),
      tx({ kind: "income", amount: 900_000, category: "transferencia", occurred_on: "2026-11-02" }),
      tx({ amount: 70_000, category: "transferencia", occurred_on: "2026-11-10" }),
    ];
    const t = ok(availableToday(PLAN, txs, "2026-11-10", null));
    assert.equal(t.available, base.available);
    assert.equal(t.spentToday, 0);
    assert.equal(t.plan.variable, 0);
  });

  it("los anulados tampoco cuentan", () => {
    const t = ok(availableToday(PLAN, [tx({ amount: 999_000, occurred_on: "2026-11-02", voided_at: "x" })], "2026-11-10", null));
    assert.equal(t.plan.variable, 0);
  });

  it("Dos monedas: todo a la moneda del plan con la tasa del día, y dice qué tasa usó", () => {
    const plan: TodayPlan = {
      confirmed_at: "2026-10-01",
      items: [
        { kind: "income", label: "Sueldo", amount: 1_000, currency: "USD", category: "salario" },
        { kind: "expense", label: "Arriendo", amount: 1_000_000, currency: "COP", category: "vivienda" },
      ],
    };
    const fx = { usdCop: 4_000, asOf: "Mon, 09 Nov 2026 00:02:31 +0000" };
    const txs = [tx({ amount: 50, currency: "USD", occurred_on: "2026-11-02" }), tx({ amount: 100_000, occurred_on: "2026-11-03" })];
    const t = ok(availableToday(plan, txs, "2026-11-10", fx));
    assert.equal(t.currency, "COP");
    assert.equal(t.plan.income, 4_000_000);
    assert.equal(t.plan.variable, 300_000);
    assert.equal(t.available, Math.floor((4_000_000 - 1_000_000 - 300_000) / 21));
    assert.deepEqual(t.fx, { ...fx, converted: 2 });
    assert.match(t.method, /tasa de \$4\.000 por dólar \(del 2026-11-09\)/);
  });

  it("dos monedas sin tasa: no se inventa el cambio", () => {
    const plan: TodayPlan = { ...PLAN, items: [...PLAN.items, { kind: "income", label: "Extra", amount: 10, currency: "USD", category: "freelance" }] };
    const r = availableToday(plan, [], "2026-11-10", null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.missing, "fx");
  });

  it("sin conversión no aparece fx", () => {
    assert.equal(ok(availableToday(PLAN, [], "2026-11-10", { usdCop: 4000, asOf: "x" })).fx, undefined);
  });

  it("borde: todo en USD → el plan se vive en dólares, con centavos", () => {
    const plan: TodayPlan = {
      confirmed_at: "2026-10-01",
      items: [
        { kind: "income", label: "Sueldo", amount: 2_000, currency: "USD", category: "salario" },
        { kind: "expense", label: "Renta", amount: 1_000, currency: "USD", category: "vivienda" },
      ],
    };
    const t = ok(availableToday(plan, [tx({ amount: 12.345, currency: "USD", occurred_on: "2026-11-10" })], "2026-11-10", null));
    assert.equal(t.currency, "USD");
    assert.equal(t.available, 47.61); // 1000 / 21 = 47,619… hacia abajo
    assert.equal(t.spentToday, 12.35); // hacia arriba
    assert.equal(t.remaining, 35.26);
    assert.equal(t.fx, undefined);
  });

  it("borde: último día del mes → divide entre 1", () => {
    const t = ok(availableToday(PLAN, [tx({ amount: 1_000_000, occurred_on: "2026-11-15" })], "2026-11-30", null));
    assert.equal(t.daysLeft, 1);
    assert.equal(t.available, 900_000);
  });

  it("borde: mes sin transacciones → todo lo libre repartido", () => {
    const t = ok(availableToday(PLAN, [tx({ amount: 5_000, occurred_on: "2026-10-31" })], "2026-11-01", null));
    assert.equal(t.daysLeft, 30);
    assert.equal(t.available, Math.floor(1_900_000 / 30));
    assert.equal(t.spentToday, 0);
  });

  it("borde: plan sin ingresos → sin número y con motivo", () => {
    const r = availableToday({ confirmed_at: "x", items: PLAN.items.filter((i) => i.kind === "expense") }, [], "2026-11-10", null);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.missing, "income");
  });
});

describe("Ritmo del día", () => {
  it("Día en curso: gastado, disponible y lo que queda, sin redondear a favor", () => {
    const txs = [
      tx({ amount: 30_000.4, occurred_on: "2026-11-10" }),
      tx({ amount: 20_000, occurred_on: "2026-11-10" }),
      tx({ amount: 100_000, category: "servicios", note: "internet", occurred_on: "2026-11-10" }), // cubierto por el plan
    ];
    const t = ok(availableToday(PLAN, txs, "2026-11-10", null));
    assert.equal(t.available, Math.floor(1_900_000 / 21)); // el gasto de hoy no achica el disponible de hoy
    assert.equal(t.spentToday, 50_001); // 50.000,4 hacia arriba
    assert.equal(t.spentTodayPlanned, 100_000);
    assert.equal(t.remaining, t.available - 50_001);
  });

  it("los gastos con fecha futura no cuentan todavía", () => {
    const t = ok(availableToday(PLAN, [tx({ amount: 500_000, occurred_on: "2026-11-20" })], "2026-11-10", null));
    assert.equal(t.plan.variable, 0);
    assert.equal(t.spentToday, 0);
  });
});

describe("Cargos repetidos", () => {
  it("Suscripción: monto parecido (±10 %) en dos o más meses → monto mensual, última fecha y total del año", () => {
    const txs = [
      tx({ amount: 26_900, note: "SPOTIFY", occurred_on: "2025-12-05" }),
      tx({ amount: 26_900, note: "Spotify", occurred_on: "2026-01-05" }),
      tx({ amount: 27_900, note: "spotify ", occurred_on: "2026-02-05" }),
      tx({ amount: 27_900, note: "SPOTIFY", occurred_on: "2026-03-05" }),
    ];
    const [r, ...rest] = recurringCharges(txs, "2026-03-20");
    assert.equal(rest.length, 0);
    assert.equal(r.key, "spotify");
    assert.equal(r.months, 4);
    assert.equal(r.monthly, 27_400);
    assert.equal(r.lastDate, "2026-03-05");
    assert.equal(r.yearTotal, 26_900 + 27_900 + 27_900); // diciembre es del año anterior
    assert.match(r.method, /4 meses distintos/);
  });

  it("normaliza mayúsculas, sufijos, sucursal y el banco de destino", () => {
    assert.equal(merchantKey("NETFLIX.COM S.A.S. 0123"), "netflix com");
    assert.equal(merchantKey("Netflix com SAS"), "netflix com");
    assert.equal(merchantKey("A KRE**** SAS** (Bancolombia)"), "kre");
    assert.equal(merchantKey("Envío desde Nequi"), null);
    assert.equal(merchantKey("Transferencia a cuenta *0000"), null);
    assert.equal(merchantKey(""), null);
  });

  it("Compra repetida que no es suscripción: montos muy distintos no se listan", () => {
    const txs = [
      tx({ amount: 12_000, note: "Tienda D1", occurred_on: "2026-01-04" }),
      tx({ amount: 85_000, note: "Tienda D1", occurred_on: "2026-02-11" }),
      tx({ amount: 40_000, note: "Tienda D1", occurred_on: "2026-03-02" }),
    ];
    assert.deepEqual(recurringCharges(txs, "2026-03-20"), []);
  });

  it("el mismo monto varias veces en el mismo mes es hormiga, no suscripción", () => {
    const days = ["01", "02", "03", "04", "05"];
    const txs = [
      ...days.map((d) => tx({ amount: 6_000, note: "Café", occurred_on: `2026-02-${d}` })),
      ...days.map((d) => tx({ amount: 6_000, note: "Café", occurred_on: `2026-03-${d}` })),
    ];
    assert.deepEqual(recurringCharges(txs, "2026-03-20"), []);
  });

  it("un solo mes no basta y las transferencias propias no son cargos", () => {
    const txs = [
      tx({ amount: 20_000, note: "Gym", occurred_on: "2026-03-01" }),
      tx({ amount: 300_000, note: "A mi Nu", category: "transferencia", occurred_on: "2026-02-01" }),
      tx({ amount: 300_000, note: "A mi Nu", category: "transferencia", occurred_on: "2026-03-01" }),
    ];
    assert.deepEqual(recurringCharges(txs, "2026-03-20"), []);
  });
});

/** 20 compras de referencia (mediana = 20.000) para que exista el umbral. */
function reference(month: string): TodayTx[] {
  return Array.from({ length: 20 }, (_, i) =>
    tx({ amount: (i + 1) * 2_000, note: `ref ${String.fromCharCode(97 + i)}`, occurred_on: `${month}-${String(i + 1).padStart(2, "0")}` }),
  );
}

describe("Gastos hormiga", () => {
  it("Muchas compras chicas: 5+ en el mes por debajo del umbral → número de compras y total", () => {
    // El umbral mide TODAS las compras de la ventana (las 20 de referencia + las 5
    // del café): por rango más cercano, la 13.ª de 25 → 16.000.
    const ref = reference("2026-10");
    const coffee = [3, 6, 9, 12, 15].map((d) => tx({ amount: 7_000, note: "Juan Valdez 045", occurred_on: `2026-11-${String(d).padStart(2, "0")}` }));
    const r = antExpenses([...ref, ...coffee], "2026-11", "2026-11-20");
    assert.equal(r.length, 1);
    assert.equal(r[0].key, "juan valdez");
    assert.equal(r[0].count, 5);
    assert.equal(r[0].total, 35_000);
    assert.equal(r[0].threshold, 16_000);
    assert.match(r[0].method, /mediana de tus gastos de los últimos 90 días/);
  });

  it("cuatro compras chicas no bastan; las grandes del mismo comercio no se cuentan", () => {
    const ref = reference("2026-10");
    const four = [3, 6, 9, 12].map((d) => tx({ amount: 7_000, note: "Juan Valdez", occurred_on: `2026-11-${String(d).padStart(2, "0")}` }));
    const big = tx({ amount: 90_000, note: "Juan Valdez", occurred_on: "2026-11-14" });
    assert.deepEqual(antExpenses([...ref, ...four, big], "2026-11", "2026-11-20"), []);
  });

  it("sin 20 compras de referencia no hay umbral ni lista", () => {
    const coffee = [1, 2, 3, 4, 5, 6].map((d) => tx({ amount: 1_000, note: "Café", occurred_on: `2026-11-0${d}` }));
    assert.deepEqual(antExpenses(coffee, "2026-11", "2026-11-20"), []);
  });

  it("transferencias propias no cuentan como compras chicas", () => {
    const ref = reference("2026-10");
    const moves = [1, 2, 3, 4, 5].map((d) => tx({ amount: 5_000, note: "Bolsillo", category: "transferencia", occurred_on: `2026-11-0${d}` }));
    assert.deepEqual(antExpenses([...ref, ...moves], "2026-11", "2026-11-20"), []);
  });
});

describe("Desvíos por categoría", () => {
  const history = (cat: string, amounts: [number, number, number]) => [
    tx({ amount: amounts[0], category: cat, occurred_on: "2026-08-10" }),
    tx({ amount: amounts[1], category: cat, occurred_on: "2026-09-10" }),
    tx({ amount: amounts[2], category: cat, occurred_on: "2026-10-10" }),
  ];

  it("Categoría disparada: supera su mediana de 3 meses ajustada al día → cuánto de más y la base", () => {
    // Mediana 300.000; día 10 de 30 → esperado 100.000; lleva 160.000 → 60.000 de más.
    const txs = [...history("restaurantes", [200_000, 300_000, 400_000]), tx({ amount: 160_000, occurred_on: "2026-11-05" })];
    const [d, ...rest] = categoryDrift(txs, "2026-11-10");
    assert.equal(rest.length, 0);
    assert.equal(d.category, "restaurantes");
    assert.equal(d.median, 300_000);
    assert.equal(d.expected, 100_000);
    assert.equal(d.spent, 160_000);
    assert.equal(d.over, 60_000);
    assert.deepEqual(d.baseMonths, ["2026-08", "2026-09", "2026-10"]);
    assert.match(d.method, /× 10 de 30 días/);
  });

  it("si va por debajo de lo esperado no aparece", () => {
    const txs = [...history("restaurantes", [200_000, 300_000, 400_000]), tx({ amount: 90_000, occurred_on: "2026-11-05" })];
    assert.deepEqual(categoryDrift(txs, "2026-11-10"), []);
  });

  it("Sin historia: con menos de tres meses de datos en la categoría no se evalúa", () => {
    const txs = [
      tx({ amount: 300_000, category: "ropa", occurred_on: "2026-09-10" }),
      tx({ amount: 300_000, category: "ropa", occurred_on: "2026-10-10" }),
      tx({ amount: 900_000, category: "ropa", occurred_on: "2026-11-05" }),
    ];
    assert.deepEqual(categoryDrift(txs, "2026-11-10"), []);
  });

  it("las transferencias propias no cuentan en la base ni en el mes", () => {
    const txs = [...history("transferencia", [100, 100, 100]), tx({ amount: 900_000, category: "transferencia", occurred_on: "2026-11-02" })];
    assert.deepEqual(categoryDrift(txs, "2026-11-10"), []);
  });

  it("cruza el año: noviembre de 2026 en enero compara oct–dic", () => {
    const txs = [
      tx({ amount: 100_000, category: "mercado", occurred_on: "2025-10-10" }),
      tx({ amount: 100_000, category: "mercado", occurred_on: "2025-11-10" }),
      tx({ amount: 100_000, category: "mercado", occurred_on: "2025-12-10" }),
      tx({ amount: 200_000, category: "mercado", occurred_on: "2026-01-03" }),
    ];
    const [d] = categoryDrift(txs, "2026-01-31");
    assert.deepEqual(d.baseMonths, ["2025-10", "2025-11", "2025-12"]);
    assert.equal(d.over, 100_000);
  });
});

describe("Candado del teléfono", () => {
  it("Teléfono sin huella: get_finance_today no existe en ese turno y se dice por qué", () => {
    assert.ok(FINANCE_TOOLS.includes("mcp__hermes__get_finance_today"));
    const g = financeGate((h) => (h === "X-Hermes-Client" ? "phone" : undefined));
    assert.equal(g.locked, true);
    assert.ok(g.disallowedTools.includes("mcp__hermes__get_finance_today"));
    assert.match(g.note ?? "", /BLOQUEADA/);
    const open = financeGate((h) => (h === "X-Hermes-Client" ? "phone" : h === "X-Hermes-Finance" ? "unlocked" : undefined));
    assert.equal(open.locked, false);
  });
});
