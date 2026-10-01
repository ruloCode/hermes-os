import { test } from "node:test";
import assert from "node:assert/strict";
import { leerMovimientos, resumenMes } from "../src/finanzas.js";

const r = resumenMes(leerMovimientos(), "2026-09", 4000);

test("los ingresos de septiembre suman salario y freelance (USD a la TRM)", () => {
  assert.equal(r.ingresos, 14500000);
});

test("los gastos no cuentan las transferencias entre cuentas propias", () => {
  assert.equal(r.gastos, 4391500);
});

test("la categoría donde más se gastó es vivienda", () => {
  const [primera] = Object.entries(r.porCategoria).sort((a, b) => b[1] - a[1]);
  assert.deepEqual(primera, ["vivienda", 2384300]);
});
