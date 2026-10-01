// Finanzas personales: resumen de un mes a partir de los movimientos de todas las cuentas.
import { readFileSync } from "node:fs";

export function leerMovimientos(ruta = new URL("../data/movimientos.csv", import.meta.url)) {
  const [cabecera, ...lineas] = readFileSync(ruta, "utf8").trim().split("\n");
  const campos = cabecera.split(",");
  return lineas.map((l) => {
    const valores = l.split(",");
    const m = Object.fromEntries(campos.map((c, i) => [c, valores[i]]));
    return { ...m, monto: Number(m.monto) };
  });
}

/** Resumen del mes ("2026-09"): ingresos, gastos, ahorro y gasto por categoría, en pesos. */
export function resumenMes(movimientos, mes, trm) {
  let ingresos = 0;
  let gastos = 0;
  const porCategoria = {};
  for (const m of movimientos) {
    if (!m.fecha.startsWith(mes)) continue;
    const valor = m.monto;
    if (valor > 0) ingresos += valor;
    else {
      gastos += -valor;
      porCategoria[m.categoria] = (porCategoria[m.categoria] ?? 0) - valor;
    }
  }
  return { ingresos, gastos, ahorro: ingresos - gastos, porCategoria };
}
