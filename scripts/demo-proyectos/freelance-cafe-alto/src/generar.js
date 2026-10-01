// npm run cobro → escribe cobros/cuenta-de-cobro-2026-10.md
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cuentaDeCobro, leerHoras } from "./cobro.js";

const cliente = JSON.parse(readFileSync(new URL("../cliente.json", import.meta.url), "utf8"));
const horas = leerHoras(new URL("../horas/2026-10.csv", import.meta.url));
const c = cuentaDeCobro(horas, { tarifa: cliente.tarifa_hora_cop, retencion: cliente.retencion_honorarios });
const cop = (n) => "$ " + Math.round(n).toLocaleString("es-CO");
const md = `# Cuenta de cobro · octubre 2026\n\n**Para:** ${cliente.cliente} (${cliente.ciudad})\n\n| Concepto | Valor |\n|---|---|\n| ${c.totalHoras} horas × ${cop(cliente.tarifa_hora_cop)} | ${cop(c.subtotal)} |\n| Retención en la fuente (${cliente.retencion_honorarios * 100} %) | −${cop(c.retencion)} |\n| **Total a pagar** | **${cop(c.total)}** |\n`;
mkdirSync("cobros", { recursive: true });
writeFileSync("cobros/cuenta-de-cobro-2026-10.md", md);
console.log(md);
