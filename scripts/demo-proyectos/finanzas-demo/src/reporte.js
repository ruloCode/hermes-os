// npm run reporte -- 2026-09
import { readFileSync } from "node:fs";
import { leerMovimientos, resumenMes } from "./finanzas.js";

const mes = process.argv[2] ?? "2026-09";
const { COP_por_USD } = JSON.parse(readFileSync(new URL("../data/trm.json", import.meta.url), "utf8"));
const r = resumenMes(leerMovimientos(), mes, COP_por_USD);
const cop = (n) => "$ " + Math.round(n).toLocaleString("es-CO");
console.log(`Resumen ${mes}`);
console.log(`  Ingresos: ${cop(r.ingresos)}`);
console.log(`  Gastos:   ${cop(r.gastos)}`);
console.log(`  Ahorro:   ${cop(r.ahorro)}`);
for (const [c, v] of Object.entries(r.porCategoria).sort((a, b) => b[1] - a[1])) console.log(`    ${c.padEnd(14)} ${cop(v)}`);
