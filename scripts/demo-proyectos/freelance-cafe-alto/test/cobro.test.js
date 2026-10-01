import { test } from "node:test";
import assert from "node:assert/strict";
import { cuentaDeCobro, leerHoras } from "../src/cobro.js";

const c = cuentaDeCobro(leerHoras(new URL("../horas/2026-10.csv", import.meta.url)), { tarifa: 95000, retencion: 0.1 });

test("suma las horas del mes", () => assert.equal(c.totalHoras, 24.5));
test("subtotal = horas × tarifa", () => assert.equal(c.subtotal, 2327500));
test("la retención se RESTA del subtotal", () => {
  assert.equal(c.retencion, 232750);
  assert.equal(c.total, 2094750);
});
