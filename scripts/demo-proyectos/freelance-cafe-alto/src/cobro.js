// Cuenta de cobro de un freelancer (persona natural, no responsable de IVA):
// horas del mes × tarifa = subtotal; la empresa retiene en la fuente el % de honorarios.
import { readFileSync } from "node:fs";

export function leerHoras(ruta) {
  const [, ...lineas] = readFileSync(ruta, "utf8").trim().split("\n");
  return lineas.map((l) => {
    const partes = l.split(",");
    return { fecha: partes[0], tarea: partes.slice(1, -1).join(","), horas: partes.at(-1) };
  });
}

export function cuentaDeCobro(horas, { tarifa, retencion }) {
  const totalHoras = horas.reduce((s, h) => s + h.horas, 0);
  const subtotal = Math.round(totalHoras * tarifa);
  const valorRetencion = Math.round(subtotal * retencion);
  return { totalHoras, subtotal, retencion: valorRetencion, total: subtotal + valorRetencion };
}
